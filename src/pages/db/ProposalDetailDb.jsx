import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedLinksClient } from '@/api/sharedLinksClient';

function useProposalId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

export default function ProposalDetailDb() {
  const proposalId = useProposalId();
  const navigate = useNavigate();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [latestLink, setLatestLink] = useState(null);
  const [formState, setFormState] = useState({
    title: '',
    template_name: '',
    party_b_email: '',
    summary: '',
    status: 'draft',
  });

  const {
    data: proposal,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['db-proposal', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getById(proposalId),
  });

  useEffect(() => {
    if (!proposal) {
      return;
    }

    setFormState({
      title: proposal.title || '',
      template_name: proposal.template_name || '',
      party_b_email: proposal.party_b_email || '',
      summary: proposal.summary || '',
      status: proposal.status || 'draft',
    });
  }, [proposal]);

  const updateMutation = useMutation({
    mutationFn: () =>
      proposalsClient.update(proposalId, {
        title: formState.title,
        templateName: formState.template_name,
        partyBEmail: formState.party_b_email,
        summary: formState.summary,
        status: formState.status,
      }),
    onSuccess: (updatedProposal) => {
      refetch();
      return updatedProposal;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => proposalsClient.remove(proposalId),
    onSuccess: () => {
      navigate(createPageUrl('Proposals'));
    },
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      sharedLinksClient.create({
        proposalId,
        recipientEmail: recipientEmail || proposal?.party_b_email || null,
        idempotencyKey: `${proposalId}:default-share`,
        maxUses: 50,
      }),
    onSuccess: (link) => {
      setLatestLink(link);
    },
  });

  if (!proposalId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-slate-600">Missing proposal id in URL.</p>
        </div>
      </div>
    );
  }

  if (isLoading || !proposal) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-slate-600">Loading proposal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposal Detail</h1>
            <p className="text-sm text-slate-500">View and edit the DB-backed proposal record.</p>
          </div>
          <Button variant="outline" onClick={() => navigate(createPageUrl('Proposals'))}>
            Back
          </Button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Proposal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>ID</Label>
              <p className="text-xs text-slate-500 break-all">{proposal.id}</p>
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={formState.title}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Input
                value={formState.status}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, status: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Template</Label>
              <Input
                value={formState.template_name}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, template_name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Recipient</Label>
              <Input
                value={formState.party_b_email}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, party_b_email: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Summary</Label>
              <Textarea
                value={formState.summary}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, summary: event.target.value }))
                }
              />
            </div>

            {updateMutation.error && <p className="text-sm text-red-600">{updateMutation.error.message}</p>}
            {deleteMutation.error && <p className="text-sm text-red-600">{deleteMutation.error.message}</p>}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => refetch()}>
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Shared Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="share-recipient">Recipient Email (optional)</Label>
              <Input
                id="share-recipient"
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder={proposal.party_b_email || 'recipient@example.com'}
              />
            </div>

            {shareMutation.error && <p className="text-sm text-red-600">{shareMutation.error.message}</p>}

            <Button onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending}>
              {shareMutation.isPending ? 'Creating link...' : 'Create Shared Link'}
            </Button>

            {latestLink && (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                <p className="text-xs text-slate-500 break-all">Token: {latestLink.token}</p>
                <Button
                  variant="outline"
                  onClick={() =>
                    navigate(createPageUrl(`SharedReport?token=${encodeURIComponent(latestLink.token)}`))
                  }
                >
                  Open Shared Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
