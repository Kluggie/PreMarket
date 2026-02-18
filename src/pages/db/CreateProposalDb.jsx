import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';

export default function CreateProposalDb() {
  const navigate = useNavigate();
  const [formState, setFormState] = useState({
    title: '',
    templateName: '',
    partyBEmail: '',
    summary: '',
  });

  const createMutation = useMutation({
    mutationFn: () =>
      proposalsClient.create({
        title: formState.title,
        templateName: formState.templateName,
        partyBEmail: formState.partyBEmail,
        summary: formState.summary,
        status: 'draft',
      }),
    onSuccess: (proposal) => {
      navigate(createPageUrl(`ProposalDetail?id=${proposal.id}`));
    },
  });

  const setField = (key, value) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Create Proposal</h1>
          <p className="text-sm text-slate-500">Create a proposal stored directly in Postgres.</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="proposal-title">Title</Label>
              <Input
                id="proposal-title"
                value={formState.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="Acquisition fit proposal"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposal-template">Template Name</Label>
              <Input
                id="proposal-template"
                value={formState.templateName}
                onChange={(event) => setField('templateName', event.target.value)}
                placeholder="M&A Overview"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposal-recipient">Recipient Email</Label>
              <Input
                id="proposal-recipient"
                value={formState.partyBEmail}
                onChange={(event) => setField('partyBEmail', event.target.value)}
                placeholder="recipient@example.com"
                type="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proposal-summary">Summary</Label>
              <Textarea
                id="proposal-summary"
                value={formState.summary}
                onChange={(event) => setField('summary', event.target.value)}
                placeholder="High-level context for this proposal"
              />
            </div>

            {createMutation.error && (
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => navigate(createPageUrl('Proposals'))}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !formState.title.trim()}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Proposal'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
