import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ProposalsChart from '@/components/dashboard/ProposalsChart';
import {
    Plus,
  Send,
  Inbox,
  Users,
  Trophy,
  XCircle,
  ChevronRight,
  AlertCircle,
  FileText,
  Eye,
  BarChart3,
} from 'lucide-react';
import { proposalsClient } from '@/api/proposalsClient';
import { dashboardClient } from '@/api/dashboardClient';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', icon: FileText, label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', icon: Send, label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', icon: Inbox, label: 'Received' },
  under_verification: { color: 'bg-purple-100 text-purple-700', icon: Eye, label: 'Under Review' },
  re_evaluated: { color: 'bg-indigo-100 text-indigo-700', icon: BarChart3, label: 'Re-evaluated' },
  mutual_interest: { color: 'bg-green-100 text-green-700', icon: Users, label: 'Mutual Interest' },
  won: { color: 'bg-emerald-100 text-emerald-700', label: 'Won' },
  lost: { color: 'bg-rose-100 text-rose-700', label: 'Lost' },
  closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' },
};

function StatusBadge({ status }) {
  const config = statusConfig[String(status || '').toLowerCase()] || statusConfig.draft;
  const Icon = config.icon;

  return (
    <Badge className={`${config.color} text-[11px] px-2 py-0.5 h-5 font-medium`}>
      {Icon ? <Icon className="w-3 h-3 mr-1" /> : null}
      {config.label}
    </Badge>
  );
}

function CompactProposalRow({ proposal, onOpen }) {
  const listType = proposal.list_type || 'sent';
  const directional = proposal.directional_status || proposal.status || listType;
  const counterparty =
    listType === 'received' ? proposal.party_a_email : proposal.party_b_email;
  const lastUpdated = proposal.updated_date || proposal.created_date;
  const templateName = proposal.template_name || 'Custom Template';

  return (
    <button
      type="button"
      onClick={() => onOpen(proposal)}
      className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-slate-900 truncate">{proposal.title || 'Untitled Proposal'}</h4>
          <StatusBadge status={directional} />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 min-w-0">
          <span className="truncate">{templateName}</span>
          {counterparty ? <span className="truncate">• To: {counterparty}</span> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-slate-400">
          {lastUpdated ? new Date(lastUpdated).toLocaleDateString() : ''}
        </p>
        <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />
      </div>
    </button>
  );
}

function ActionRequiredBucket({ title, proposals, onOpen }) {
  if (!proposals || proposals.length === 0) {
    return null;
  }

  const displayed = proposals.slice(0, 3);

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 px-1">{title}</h3>
      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
        {displayed.map((proposal) => (
          <div key={proposal.id}>
            <CompactProposalRow proposal={proposal} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
  });

  const { data: allProposals = [], isLoading: loadingProposals, isError: proposalsError, error: proposalsErrorObj, refetch: refetchProposals } = useQuery({
    queryKey: ['dashboard-proposals-all'],
    queryFn: () => proposalsClient.list({ tab: 'all', limit: 50 }),
  });
  const stats = useMemo(
    () => [
      {
        label: 'Proposals Sent',
        value: summary?.sentCount ?? 0,
        icon: Send,
        color: 'from-blue-500 to-blue-600',
      },
      {
        label: 'Proposals Received',
        value: summary?.receivedCount ?? 0,
        icon: Inbox,
        color: 'from-indigo-500 to-indigo-600',
      },
      {
        label: 'Won',
        value: summary?.wonCount ?? 0,
        icon: Trophy,
        color: 'from-emerald-500 to-emerald-600',
      },
      {
        label: 'Lost',
        value: summary?.lostCount ?? 0,
        icon: XCircle,
        color: 'from-rose-500 to-rose-600',
      },
      {
        label: 'Mutual Interest',
        value: summary?.mutualInterestCount ?? 0,
        icon: Users,
        color: 'from-green-500 to-green-600',
      },
    ],
    [summary],
  );

  // Bucket proposals for Action Required (first-match-wins dedupe)
  const bucketedProposals = useMemo(() => {
    const sorted = [...allProposals].sort(
      (a, b) => new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date),
    );
    const seen = new Set();

    const takeBucket = (predicate) => {
      const matched = [];
      for (const proposal of sorted) {
        const proposalId = String(proposal.id || '').trim();
        if (!proposalId || seen.has(proposalId)) {
          continue;
        }
        if (predicate(proposal)) {
          matched.push(proposal);
          seen.add(proposalId);
        }
      }
      return matched;
    };

    const drafts = takeBucket(
      (proposal) => proposal.list_type === 'draft' || proposal.directional_status === 'draft',
    );
    const waitingOnRecipient = takeBucket(
      (proposal) => proposal.list_type === 'sent' && proposal.directional_status === 'sent',
    );
    const needsReview = takeBucket(
      (proposal) =>
        proposal.directional_status === 'under_verification' ||
        proposal.directional_status === 're_evaluated',
    );
    const mutualInterest = takeBucket(
      (proposal) => proposal.directional_status === 'mutual_interest',
    );

    return { drafts, waitingOnRecipient, needsReview, mutualInterest };
  }, [allProposals]);

  // Recent proposals (last 5 updated)
  const recentProposals = useMemo(() => {
    return [...allProposals].sort((a, b) => new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date)).slice(0, 5);
  }, [allProposals]);
  const handleOpenProposal = (proposal) => {
    if (!proposal?.id) {
      return;
    }

    if (proposal.shared_report_token) {
      navigate(createPageUrl(`shared-report/${encodeURIComponent(proposal.shared_report_token)}`));
      return;
    }

    if (
      String(proposal.proposal_type || '').toLowerCase() === 'document_comparison' &&
      proposal.document_comparison_id
    ) {
      if ((proposal.list_type || '').toLowerCase() === 'draft') {
        navigate(
          createPageUrl(
            `DocumentComparisonCreate?draft=${encodeURIComponent(
              proposal.document_comparison_id,
            )}&proposalId=${encodeURIComponent(proposal.id)}&step=${encodeURIComponent(
              proposal.draft_step || 1,
            )}`,
          ),
        );
        return;
      }

      navigate(createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`));
      return;
    }

    if ((proposal.list_type || '').toLowerCase() === 'draft') {
      navigate(createPageUrl(`CreateProposal?draft=${encodeURIComponent(proposal.id)}`));
      return;
    }

    if ((proposal.list_type || '').toLowerCase() === 'received') {
      navigate(createPageUrl('Proposals?tab=received'));
      return;
    }

    navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`));
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Here&apos;s what&apos;s happening with your proposals.</p>
          </div>
          <Link to={createPageUrl('CreateProposal')}>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Proposal
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{stat.label}</p>
                    <p className="text-3xl font-bold text-slate-900 mt-1">
                      {summaryLoading ? '...' : stat.value}
                    </p>
                  </div>
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}
                  >
                    <stat.icon className="w-5 h-5 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mb-8">
          <ProposalsChart />
        </div>

        {loadingProposals ? (
          <div className="text-sm text-slate-500">Loading proposals...</div>
        ) : proposalsError ? (
          <Card className="border-dashed border-2 border-red-200 bg-red-50">
            <CardContent className="py-10 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <p className="text-red-700 font-medium">Failed to load proposals</p>
              <p className="text-sm text-red-600">{proposalsErrorObj?.message || 'An unexpected error occurred.'}</p>
              <Button variant="outline" size="sm" onClick={() => refetchProposals()} className="mt-2">
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <Card className="border border-slate-200 shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Action Required</h2>

                {bucketedProposals.drafts.length > 0 ? (
                  <ActionRequiredBucket
                    title="Drafts not sent"
                    proposals={bucketedProposals.drafts}
                    onOpen={handleOpenProposal}
                  />
                ) : null}

                {bucketedProposals.waitingOnRecipient.length > 0 ? (
                  <ActionRequiredBucket
                    title="Waiting on recipient"
                    proposals={bucketedProposals.waitingOnRecipient}
                    onOpen={handleOpenProposal}
                  />
                ) : null}

                {bucketedProposals.needsReview.length > 0 ? (
                  <ActionRequiredBucket
                    title="Needs review / verify"
                    proposals={bucketedProposals.needsReview}
                    onOpen={handleOpenProposal}
                  />
                ) : null}

                {bucketedProposals.mutualInterest.length > 0 ? (
                  <ActionRequiredBucket
                    title="Mutual interest ready"
                    proposals={bucketedProposals.mutualInterest}
                    onOpen={handleOpenProposal}
                  />
                ) : null}
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Recent Proposals</h2>

                {recentProposals.length > 0 ? (
                  <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                    {recentProposals.map((proposal) => (
                      <CompactProposalRow key={proposal.id} proposal={proposal} onOpen={handleOpenProposal} />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
