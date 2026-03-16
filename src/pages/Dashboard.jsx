import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ProposalsChart from '@/components/dashboard/ProposalsChart';
import { formatRecipientShort } from '@/lib/recipientUtils';
import {
  AGREEMENT_REQUESTED_LABEL,
} from '@/lib/proposalOutcomeUi';
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

const DASHBOARD_WON_LABEL = 'Won';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', icon: FileText, label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', icon: Send, label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', icon: Inbox, label: 'Received' },
  under_review: { color: 'bg-purple-100 text-purple-700', icon: Eye, label: 'Under Review' },
  ai_review: { color: 'bg-indigo-100 text-indigo-700', icon: BarChart3, label: 'AI Review' },
  mutual_interest: { color: 'bg-green-100 text-green-700', icon: Users, label: 'Mutual Interest' },
  won: { color: 'bg-emerald-100 text-emerald-700', label: DASHBOARD_WON_LABEL },
  lost: { color: 'bg-rose-100 text-rose-700', label: 'Lost' },
  closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' },
};

function getCompactStatusKey(proposal) {
  const normalizedStatus = String(proposal?.status || '').toLowerCase();
  if (proposal?.thread_bucket === 'drafts') return 'draft';
  if (normalizedStatus === 'won' || normalizedStatus === 'lost') return normalizedStatus;
  if (String(proposal?.review_status || '').toLowerCase() === 're_evaluated') return 'ai_review';
  if (proposal?.review_status) return 'under_review';
  if (proposal?.is_mutual_interest) return 'mutual_interest';
  return String(proposal?.latest_direction || '').toLowerCase() || 'draft';
}

function StatusBadge({ proposal }) {
  const config = statusConfig[getCompactStatusKey(proposal)] || statusConfig.draft;
  const Icon = config.icon;

  return (
    <Badge className={`${config.color} text-[0.6875rem] px-2 py-0.5 h-5 font-medium`}>
      {Icon ? <Icon className="w-3 h-3 mr-1" /> : null}
      {config.label}
    </Badge>
  );
}

function ActionBadge({ proposal }) {
  if (proposal?.win_confirmation_requested) {
    return (
      <Badge className="bg-amber-100 text-amber-700 text-[0.6875rem] px-2 py-0.5 h-5 font-medium">
        <Trophy className="w-3 h-3 mr-1" />
        Pending Win
      </Badge>
    );
  }

  if (proposal?.needs_response) {
    return (
      <Badge className="bg-rose-100 text-rose-700 text-[0.6875rem] px-2 py-0.5 h-5 font-medium">
        Needs Reply
      </Badge>
    );
  }

  if (proposal?.waiting_on_other_party) {
    return (
      <Badge className="bg-slate-100 text-slate-700 text-[0.6875rem] px-2 py-0.5 h-5 font-medium">
        Waiting
      </Badge>
    );
  }

  return null;
}

function CompactProposalRow({ proposal, onOpen }) {
  const recipientLabel = formatRecipientShort(
    proposal.party_b_name,
    proposal.counterparty_email || proposal.party_b_email || proposal.party_a_email,
  );
  const lastUpdated = proposal.last_activity_at || proposal.updated_date || proposal.created_date;
  const templateName = proposal.template_name || 'Custom Template';

  return (
    <button
      type="button"
      onClick={() => onOpen(proposal)}
      className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-slate-900 truncate">{proposal.title || 'Untitled Opportunity'}</h4>
          <StatusBadge proposal={proposal} />
          <ActionBadge proposal={proposal} />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 min-w-0">
          <span className="truncate">{templateName}</span>
          <span className="truncate">• With: {recipientLabel}</span>
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

function getProposalSortTime(proposal) {
  return new Date(
    proposal?.last_activity_at || proposal?.updated_date || proposal?.created_date || 0,
  ).getTime();
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

function AgreementRequestsCard({ proposals, onOpen, onReviewAll }) {
  if (!proposals || proposals.length === 0) {
    return null;
  }

  const displayed = proposals.slice(0, 3);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-900">{AGREEMENT_REQUESTED_LABEL}</p>
          <p className="text-sm text-amber-800">
            {proposals.length} opportunit{proposals.length === 1 ? 'y' : 'ies'} need you to confirm the agreement before they can be marked as {DASHBOARD_WON_LABEL.toLowerCase()}.
          </p>
        </div>
        <Button variant="outline" size="sm" className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100" onClick={onReviewAll}>
          Review Requests
        </Button>
      </div>
      <div className="rounded-lg border border-amber-200 divide-y divide-amber-100 bg-white">
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

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryErrorObj,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
    retry: 2,
  });

  const { data: allProposals = [], isLoading: loadingProposals, isError: proposalsError, error: proposalsErrorObj, refetch: refetchProposals } = useQuery({
    queryKey: ['dashboard-proposals-all'],
    queryFn: () => proposalsClient.list({ tab: 'all', limit: 50 }),
  });
  const {
    data: agreementRequests = [],
    isLoading: agreementRequestsLoading,
  } = useQuery({
    queryKey: ['dashboard-proposals-agreement-requests'],
    queryFn: () => proposalsClient.list({ tab: 'all', status: 'win_confirmation_requested', limit: 10 }),
  });
  const primaryStats = useMemo(
    () => [
      {
        label: 'Sent',
        value: summary?.sentCount ?? 0,
        icon: Send,
        color: 'from-blue-500 to-blue-600',
      },
      {
        label: 'Received',
        value: summary?.receivedCount ?? 0,
        icon: Inbox,
        color: 'from-indigo-500 to-indigo-600',
      },
      {
        label: 'Mutual Interest',
        value: summary?.mutualInterestCount ?? 0,
        icon: Users,
        color: 'from-green-500 to-green-600',
      },
      {
        label: DASHBOARD_WON_LABEL,
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
    ],
    [summary],
  );

  // Bucket proposals for Action Required (first-match-wins dedupe)
  const bucketedProposals = useMemo(() => {
    const sorted = [...allProposals].sort(
      (a, b) => getProposalSortTime(b) - getProposalSortTime(a),
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
      (proposal) => proposal.thread_bucket === 'drafts',
    );
    const needsResponse = takeBucket(
      (proposal) =>
        proposal.thread_bucket === 'inbox' &&
        proposal.needs_response &&
        !proposal.win_confirmation_requested,
    );
    const waitingOnOtherParty = takeBucket(
      (proposal) => proposal.thread_bucket === 'inbox' && proposal.waiting_on_other_party,
    );
    const needsReview = takeBucket(
      (proposal) => proposal.thread_bucket === 'inbox' && Boolean(proposal.review_status),
    );

    return { drafts, needsResponse, waitingOnOtherParty, needsReview };
  }, [allProposals]);

  // Recent proposals (last 5 updated)
  const recentProposals = useMemo(() => {
    return [...allProposals].sort((a, b) => getProposalSortTime(b) - getProposalSortTime(a)).slice(0, 5);
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
      const resumeStep = Number(proposal.resume_step || proposal.draft_step || 1);
      const normalizedResumeStep = Number.isFinite(resumeStep)
        ? Math.max(1, Math.min(3, Math.floor(resumeStep)))
        : 1;

      if (normalizedResumeStep >= 3) {
        navigate(
          createPageUrl(
            `DocumentComparisonDetail?id=${encodeURIComponent(
              proposal.document_comparison_id,
            )}&tab=report`,
          ),
        );
        return;
      }

      if (proposal.thread_bucket === 'drafts' || (proposal.list_type || '').toLowerCase() === 'draft') {
        navigate(
          createPageUrl(
            `DocumentComparisonCreate?draft=${encodeURIComponent(
              proposal.document_comparison_id,
            )}&proposalId=${encodeURIComponent(proposal.id)}&step=${encodeURIComponent(
              normalizedResumeStep,
            )}`,
          ),
        );
        return;
      }

      navigate(createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`));
      return;
    }

    if (proposal.thread_bucket === 'drafts' || (proposal.list_type || '').toLowerCase() === 'draft') {
      navigate(createPageUrl(`CreateOpportunity?draft=${encodeURIComponent(proposal.id)}`));
      return;
    }

    navigate(createPageUrl(`OpportunityDetail?id=${encodeURIComponent(proposal.id)}`));
  };
  const handleReviewAgreementRequests = () => {
    navigate(createPageUrl('Opportunities?tab=all&status=win_confirmation_requested'));
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Here&apos;s what&apos;s happening with your opportunities.</p>
          </div>
          <Link to={createPageUrl('DocumentComparisonCreate')}>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Opportunity
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {primaryStats.map((stat) => (
            <Card key={stat.label} className={`border-0 shadow-sm${summaryError ? ' opacity-60' : ''}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{stat.label}</p>
                    <p className="text-3xl font-bold text-slate-900 mt-1" title={summaryError ? (summaryErrorObj?.message || 'Could not load stats') : undefined}>
                      {summaryLoading ? '...' : summaryError ? '—' : stat.value}
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
        {summaryError && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-6">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Summary stats could not be loaded. Your opportunities are unaffected — <button type="button" className="underline font-medium" onClick={() => refetchSummary()}>retry</button>.</span>
          </div>
        )}

        <div className="mb-8">
          <ProposalsChart />
        </div>

        {loadingProposals ? (
          <div className="text-sm text-slate-500">Loading opportunities...</div>
        ) : proposalsError ? (
          <Card className="border-dashed border-2 border-red-200 bg-red-50">
            <CardContent className="py-10 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <p className="text-red-700 font-medium">Failed to load opportunities</p>
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

                {agreementRequestsLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Loading agreement requests...
                  </div>
                ) : (
                  <AgreementRequestsCard
                    proposals={agreementRequests}
                    onOpen={handleOpenProposal}
                    onReviewAll={handleReviewAgreementRequests}
                  />
                )}

                {bucketedProposals.needsResponse.length > 0 ? (
                  <ActionRequiredBucket
                    title="Needs your response"
                    proposals={bucketedProposals.needsResponse}
                    onOpen={handleOpenProposal}
                  />
                ) : null}

                {bucketedProposals.drafts.length > 0 ? (
                  <ActionRequiredBucket
                    title="Drafts not sent"
                    proposals={bucketedProposals.drafts}
                    onOpen={handleOpenProposal}
                  />
                ) : null}

                {bucketedProposals.waitingOnOtherParty.length > 0 ? (
                  <ActionRequiredBucket
                    title="Waiting on other party"
                    proposals={bucketedProposals.waitingOnOtherParty}
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
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Recent Opportunities</h2>

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
