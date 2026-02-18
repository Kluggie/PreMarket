import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';

export default function ProposalsDb() {
  const navigate = useNavigate();

  const { data: proposals = [], isLoading, refetch } = useQuery({
    queryKey: ['db-proposals'],
    queryFn: () => proposalsClient.list({ limit: 100 }),
  });

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposals</h1>
            <p className="text-sm text-slate-500">DB-backed proposal list for Phase 2 migration.</p>
          </div>
          <Button onClick={() => navigate(createPageUrl('CreateProposal'))}>Create Proposal</Button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Your Proposals</CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-slate-500">Loading proposals...</p>}
            {!isLoading && proposals.length === 0 && (
              <p className="text-sm text-slate-500">No proposals yet. Create your first proposal.</p>
            )}

            <div className="space-y-3">
              {proposals.map((proposal) => (
                <button
                  key={proposal.id}
                  type="button"
                  onClick={() => navigate(createPageUrl(`ProposalDetail?id=${proposal.id}`))}
                  className="w-full text-left p-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{proposal.title || 'Untitled proposal'}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Status: {proposal.status || 'draft'}
                        {proposal.party_b_email ? ` • Recipient: ${proposal.party_b_email}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">{new Date(proposal.created_date).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
