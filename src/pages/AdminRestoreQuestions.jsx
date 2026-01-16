import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, CheckCircle2, RefreshCw, Database, ArrowRight } from 'lucide-react';

export default function AdminRestoreQuestions() {
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState(null);

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['all-templates-restore'],
    queryFn: () => base44.entities.Template.list()
  });

  const { data: allVersions = [], refetch: refetchVersions } = useQuery({
    queryKey: ['all-template-versions'],
    queryFn: () => base44.entities.TemplateVersion.list()
  });

  const { data: allQuestions = [], refetch: refetchQuestions } = useQuery({
    queryKey: ['all-template-questions-restore'],
    queryFn: () => base44.entities.TemplateQuestion.list()
  });

  // Build restoration status
  const restorationStatus = templates.map(t => {
    // Use active_version_id first, then fallback to is_current
    const version = t.active_version_id 
      ? allVersions.find(v => v.id === t.active_version_id)
      : allVersions.find(v => v.template_id === t.id && v.is_current);
    
    const normalizedCount = version 
      ? allQuestions.filter(q => q.template_version_id === version.id).length 
      : 0;
    const embeddedCount = t.questions?.length || 0;
    
    return {
      template_id: t.id,
      name: t.name,
      template_key: t.template_key || t.slug,
      status: t.status,
      version_id: version?.id || 'none',
      version_number: version?.version_number || 1,
      active_version_id: t.active_version_id || 'none',
      normalized_count: normalizedCount,
      embedded_count: embeddedCount,
      needs_restore: normalizedCount === 0 && embeddedCount > 0
    };
  });

  const needsRestoreCount = restorationStatus.filter(s => s.needs_restore).length;

  const runRestore = async (templateId = null) => {
    setRestoring(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('migrateTemplateQuestions', {
        template_id: templateId
      });
      setResult(response.data);
      refetchTemplates();
      refetchVersions();
      refetchQuestions();
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Restore Template Questions</h1>
          <p className="text-slate-600 mt-2">
            Restore missing questions from embedded backup data to normalized TemplateQuestion records.
          </p>
        </div>

        <Card className="border-0 shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              Restoration Overview
            </CardTitle>
            <CardDescription>
              {needsRestoreCount === 0 ? (
                'All templates have questions restored.'
              ) : (
                `${needsRestoreCount} template${needsRestoreCount > 1 ? 's need' : ' needs'} question restoration.`
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="text-2xl font-bold text-slate-900">{templates.length}</div>
                <div className="text-sm text-slate-600">Total Templates</div>
              </div>
              <div className="p-4 bg-amber-50 rounded-lg">
                <div className="text-2xl font-bold text-amber-900">{needsRestoreCount}</div>
                <div className="text-sm text-amber-600">Need Restore</div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-900">
                  {templates.length - needsRestoreCount}
                </div>
                <div className="text-sm text-green-600">Restored</div>
              </div>
            </div>

            {needsRestoreCount > 0 && (
              <div className="flex gap-3">
                <Button
                  onClick={() => runRestore()}
                  disabled={restoring}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {restoring ? (
                    'Restoring...'
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Restore All Missing Questions
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    refetchTemplates();
                    refetchVersions();
                    refetchQuestions();
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Status
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm mb-6">
          <CardHeader>
            <CardTitle>Template Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active Ver</TableHead>
                  <TableHead className="text-right">Embedded</TableHead>
                  <TableHead className="text-right">Normalized</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {restorationStatus.map((status) => (
                  <TableRow key={status.template_id}>
                    <TableCell className="font-medium">{status.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-slate-100 px-2 py-1 rounded">
                        {status.template_key || 'none'}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.status === 'published' ? 'default' : 'outline'}>
                        {status.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                        {status.active_version_id !== 'none' ? status.active_version_id.slice(0, 8) : 'none'}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">{status.embedded_count}</TableCell>
                    <TableCell className="text-right">
                      <span className={status.normalized_count === 0 && status.embedded_count > 0 ? 'text-red-600 font-bold' : ''}>
                        {status.normalized_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {status.needs_restore ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runRestore(status.template_id)}
                          disabled={restoring}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Restore
                        </Button>
                      ) : status.normalized_count > 0 ? (
                        <Badge variant="outline" className="text-green-600">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-400">
                          No Data
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {result && (
          <Card className={`border-0 shadow-sm ${result.success ? 'border-green-200' : 'border-red-200'}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.success ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Restoration Complete
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    Restoration Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.success ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.templates_processed}
                      </div>
                      <div className="text-sm text-slate-600">Templates Processed</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.versions_created}
                      </div>
                      <div className="text-sm text-slate-600">Versions Created</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.questions_created}
                      </div>
                      <div className="text-sm text-slate-600">Questions Restored</div>
                    </div>
                  </div>

                  {result.migration_log.details && result.migration_log.details.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-semibold text-slate-900">Details:</h3>
                      {result.migration_log.details.map((detail, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                          <span className="text-sm text-slate-700">{detail.template_name}</span>
                          <Badge variant={detail.status === 'success' ? 'default' : 'outline'}>
                            {detail.status === 'success' 
                              ? `${detail.questions_migrated} questions` 
                              : detail.reason
                            }
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.migration_log.errors && result.migration_log.errors.length > 0 && (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
                      <h3 className="font-semibold text-red-900 mb-2">Errors:</h3>
                      {result.migration_log.errors.map((error, idx) => (
                        <div key={idx} className="text-sm text-red-700">
                          {error.template_name}: {error.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-red-700">{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}