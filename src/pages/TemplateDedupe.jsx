import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, XCircle, AlertTriangle, Archive, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function TemplateDedupe() {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [toArchive, setToArchive] = useState([]);
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['all-templates'],
    queryFn: () => base44.entities.Template.list()
  });

  // Backfill template_key
  const backfillMutation = useMutation({
    mutationFn: async () => {
      const updates = templates
        .filter(t => !t.template_key || t.template_key === null)
        .map(t => {
          const templateKey = t.slug || t.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          return base44.entities.Template.update(t.id, { template_key: templateKey });
        });
      
      await Promise.all(updates);
      return updates.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries(['all-templates']);
      alert(`Backfilled ${count} templates`);
    }
  });

  // Deduplicate templates
  const dedupeMutation = useMutation({
    mutationFn: async () => {
      // Group by template_key
      const grouped = templates.reduce((acc, t) => {
        const key = t.template_key || t.slug || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {});

      const archivePromises = [];
      let archivedCount = 0;

      Object.entries(grouped).forEach(([key, group]) => {
        if (group.length <= 1) return;

        // Sort to find canonical (best) template - one with questions
        const sorted = group.sort((a, b) => {
          const aQuestions = a.questions?.length || 0;
          const bQuestions = b.questions?.length || 0;
          const aRendersOk = aQuestions > 0;
          const bRendersOk = bQuestions > 0;

          // Prefer templates that render
          if (aRendersOk && !bRendersOk) return -1;
          if (!aRendersOk && bRendersOk) return 1;

          // If both render or both don't, prefer more questions
          if (bQuestions !== aQuestions) return bQuestions - aQuestions;
          
          // If same question count, prefer published over other statuses
          if (a.status === 'published' && b.status !== 'published') return -1;
          if (b.status === 'published' && a.status !== 'published') return 1;
          
          return 0;
        });

        // Keep first (canonical), archive rest
        const duplicates = sorted.slice(1);

        duplicates.forEach(dup => {
          if (dup.status !== 'archived') {
            archivePromises.push(
              base44.entities.Template.update(dup.id, { status: 'archived' })
            );
            archivedCount++;
          }
        });
      });

      await Promise.all(archivePromises);
      return archivedCount;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries(['all-templates']);
      alert(`Archived ${count} duplicate templates`);
    }
  });

  // Archive broken templates
  const archiveBrokenMutation = useMutation({
    mutationFn: async (templateIds) => {
      const promises = templateIds.map(id =>
        base44.entities.Template.update(id, { status: 'archived' })
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['all-templates']);
      setConfirmArchive(false);
      setToArchive([]);
    }
  });

  const handleArchiveBroken = () => {
    const broken = templates.filter(t => {
      const questionCount = t.questions?.length || 0;
      return questionCount === 0 && t.status !== 'archived';
    });
    setToArchive(broken);
    setConfirmArchive(true);
  };

  const analyzedTemplates = templates.map(t => {
    const embeddedQuestionCount = t.questions?.length || 0;
    const normalizedQuestionCount = 0; // Placeholder for future normalization
    const rendersOk = embeddedQuestionCount > 0 || normalizedQuestionCount > 0;

    return {
      ...t,
      embeddedQuestionCount,
      normalizedQuestionCount,
      rendersOk
    };
  });

  // Count duplicates by template_key
  const duplicateCounts = analyzedTemplates.reduce((acc, t) => {
    const key = t.template_key || t.slug || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Template Deduplication</h1>
          <p className="text-slate-500 mt-1">
            Manage duplicate templates and archive broken ones.
          </p>
        </div>

        {/* Actions */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Button
                onClick={() => backfillMutation.mutate()}
                disabled={backfillMutation.isPending}
                variant="outline"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Backfill template_key ({templates.filter(t => !t.template_key).length} missing)
              </Button>
              <Button
                onClick={() => dedupeMutation.mutate()}
                disabled={dedupeMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Run Deduplication
              </Button>
              <Button
                onClick={handleArchiveBroken}
                variant="outline"
                className="text-red-600 hover:text-red-700"
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive Broken Templates
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Template Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>All Templates</CardTitle>
            <CardDescription>
              {analyzedTemplates.length} templates total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>template_key</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Embedded Q's</TableHead>
                    <TableHead className="text-center">Normalized Q's</TableHead>
                    <TableHead className="text-center">Renders OK</TableHead>
                    <TableHead className="text-center">Duplicates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                        Loading templates...
                      </TableCell>
                    </TableRow>
                  ) : analyzedTemplates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                        No templates found
                      </TableCell>
                    </TableRow>
                  ) : (
                    analyzedTemplates.map(t => {
                      const key = t.template_key || t.slug || 'unknown';
                      const dupCount = duplicateCounts[key];
                      const hasDuplicates = dupCount > 1;

                      return (
                        <TableRow key={t.id} className={hasDuplicates ? 'bg-amber-50' : ''}>
                          <TableCell className="font-mono text-xs">{t.id.substring(0, 8)}</TableCell>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded">
                              {t.template_key || t.slug || '-'}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant={t.status === 'published' ? 'default' : 'outline'}>
                              {t.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {t.embeddedQuestionCount}
                          </TableCell>
                          <TableCell className="text-center">
                            {t.normalizedQuestionCount}
                          </TableCell>
                          <TableCell className="text-center">
                            {t.rendersOk ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600 mx-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600 mx-auto" />
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {hasDuplicates && (
                              <Badge variant="outline" className="text-amber-600 border-amber-600">
                                {dupCount}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Archive Confirmation Dialog */}
        <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive Broken Templates?</DialogTitle>
              <DialogDescription>
                The following {toArchive.length} template(s) have no questions and will be archived:
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 overflow-y-auto">
              <ul className="space-y-2">
                {toArchive.map(t => (
                  <li key={t.id} className="p-2 bg-slate-50 rounded text-sm">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">ID: {t.id}</div>
                  </li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmArchive(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => archiveBrokenMutation.mutate(toArchive.map(t => t.id))}
                disabled={archiveBrokenMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive {toArchive.length} Template(s)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}