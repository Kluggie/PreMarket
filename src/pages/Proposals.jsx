import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { proposalsClient } from '@/api/proposalsClient';
import { dashboardClient } from '@/api/dashboardClient';
import { isStarterOpportunityLimitReached } from '@/lib/starterPlanLimits';
import { StarterUpgradeModal } from '@/components/StarterUpgradeModal';
import { buildDocumentComparisonReportHref } from '@/lib/notificationTargets';
import { formatRecipientLabel, PRIVATE_SENDER_LABEL } from '@/lib/recipientUtils';
import {
  getAgreementActionLabel,
} from '@/lib/proposalOutcomeUi';
import { buildCompactProposalSubtitle } from '@/lib/proposalThreadContextUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Search,
  Send,
  Inbox,
  FileText,
  ChevronRight,
  Clock,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Eye,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trophy,
  Trash2,
  XCircle,
} from 'lucide-react';

const PRIMARY_STATUS_BADGE_CONFIG = {
  needs_reply: {
    color: 'bg-rose-100 text-rose-700',
    icon: AlertCircle,
    label: 'Needs Reply',
  },
  under_review: {
    color: 'bg-violet-100 text-violet-700',
    icon: Eye,
    label: 'Under Review',
  },
  draft: {
    color: 'bg-slate-100 text-slate-700',
    icon: FileText,
    label: 'Draft',
  },
  waiting_on_counterparty: {
    color: 'bg-slate-100 text-slate-700',
    icon: Clock,
    label: 'Waiting on Counterparty',
  },
  closed_won: {
    color: 'bg-emerald-100 text-emerald-700',
    icon: CheckCircle2,
    label: 'Closed: Won',
  },
  closed_lost: {
    color: 'bg-rose-100 text-rose-700',
    icon: XCircle,
    label: 'Closed: Lost',
  },
};

const TAB_ALIASES = {
  all: 'inbox',
  sent: 'inbox',
  received: 'inbox',
  mutual_interest: 'inbox',
};
const TAB_VALUES = new Set(['inbox', 'drafts', 'closed', 'archived']);
const STATUS_FILTER_VALUES = new Set([
  'all',
  'needs_reply',
  'under_review',
  'waiting_on_counterparty',
  'win_confirmation_requested',
]);
const STATUS_FILTER_ALIASES = {
  agreement_requested: 'win_confirmation_requested',
  needs_response: 'needs_reply',
  waiting_on_other_party: 'waiting_on_counterparty',
  waiting: 'waiting_on_counterparty',
  pending_win: 'win_confirmation_requested',
};
const ORIGIN_FILTER_VALUES = new Set([
  'all',
  'started_by_you',
  'started_by_counterparty',
]);
const ORIGIN_FILTER_ALIASES = {
  you: 'started_by_you',
  me: 'started_by_you',
  started_by_me: 'started_by_you',
  counterparty: 'started_by_counterparty',
  other: 'started_by_counterparty',
  started_by_other: 'started_by_counterparty',
};

function normalizeTabValue(value) {
  const nextValue = String(value || '').trim().toLowerCase();
  if (TAB_VALUES.has(nextValue)) {
    return nextValue;
  }
  return TAB_ALIASES[nextValue] || 'inbox';
}

function normalizeStatusFilterValue(value) {
  const nextValue = String(value || '').trim().toLowerCase();
  const aliasedValue = STATUS_FILTER_ALIASES[nextValue] || nextValue;
  return STATUS_FILTER_VALUES.has(aliasedValue) ? aliasedValue : 'all';
}

function normalizeOriginFilterValue(value) {
  const nextValue = String(value || '').trim().toLowerCase();
  const aliasedValue = ORIGIN_FILTER_ALIASES[nextValue] || nextValue;
  return ORIGIN_FILTER_VALUES.has(aliasedValue) ? aliasedValue : 'all';
}

function resolvePrimaryStatus(proposal) {
  const primaryStatusKey = String(proposal?.primary_status_key || '').trim().toLowerCase();
  if (PRIMARY_STATUS_BADGE_CONFIG[primaryStatusKey]) {
    return PRIMARY_STATUS_BADGE_CONFIG[primaryStatusKey];
  }

  if (proposal?.thread_bucket === 'drafts') {
    return PRIMARY_STATUS_BADGE_CONFIG.draft;
  }

  const normalizedStatus = String(proposal?.status || '').trim().toLowerCase();
  if (normalizedStatus === 'won') {
    return PRIMARY_STATUS_BADGE_CONFIG.closed_won;
  }
  if (normalizedStatus === 'lost') {
    return PRIMARY_STATUS_BADGE_CONFIG.closed_lost;
  }
  if (proposal?.review_status) {
    return PRIMARY_STATUS_BADGE_CONFIG.under_review;
  }
  if (proposal?.waiting_on_other_party) {
    return PRIMARY_STATUS_BADGE_CONFIG.waiting_on_counterparty;
  }
  return PRIMARY_STATUS_BADGE_CONFIG.needs_reply;
}

function PrimaryStatusBadge({ proposal }) {
  const config = resolvePrimaryStatus(proposal);
  const Icon = config.icon;

  return (
    <Badge className={`${config.color} font-medium`}>
      {Icon ? <Icon className="w-3 h-3 mr-1" /> : null}
      {String(proposal?.primary_status_label || config.label)}
    </Badge>
  );
}

function getRowIcon(proposal) {
  const primaryStatusKey = String(proposal?.primary_status_key || '').trim().toLowerCase();
  if (primaryStatusKey === 'closed_won') return CheckCircle2;
  if (primaryStatusKey === 'closed_lost') return XCircle;
  if (primaryStatusKey === 'needs_reply') return AlertCircle;
  if (primaryStatusKey === 'under_review') return Eye;
  if (proposal?.thread_bucket === 'archived') return Archive;
  if (String(proposal?.latest_direction || '').toLowerCase() === 'received') return Inbox;
  if (String(proposal?.latest_direction || '').toLowerCase() === 'sent') return Send;
  return FileText;
}

function formatUpdatedAt(value) {
  if (!value) {
    return '';
  }

  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return '';
  }

  return candidate.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatusOptions() {
  return [
    { value: 'all', label: 'All states' },
    { value: 'needs_reply', label: 'Needs Reply' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'waiting_on_counterparty', label: 'Waiting on Counterparty' },
    { value: 'win_confirmation_requested', label: 'Pending Win Confirmation' },
  ];
}

function getOriginOptions() {
  return [
    { value: 'all', label: 'All origins' },
    { value: 'started_by_you', label: 'Started by you' },
    { value: 'started_by_counterparty', label: 'Started by counterparty' },
  ];
}

function getEmptyStateCopy(activeTab, statusFilter, originFilter) {
  if (activeTab === 'drafts') {
    return {
      title: 'No draft opportunities yet.',
      description: 'Create your first opportunity to get started.',
    };
  }

  if (activeTab === 'closed') {
    return {
      title: 'No closed opportunities yet.',
      description: 'Won and lost opportunity threads will appear here.',
    };
  }

  if (activeTab === 'archived') {
    return {
      title: 'No archived opportunities.',
      description: 'Archived opportunity threads will appear here until you restore them.',
    };
  }

  if (statusFilter === 'needs_reply') {
    return {
      title: 'No opportunities need a reply.',
      description: 'When a counterparty sends back an update, it will appear here.',
    };
  }

  if (statusFilter === 'under_review') {
    return {
      title: 'No opportunities are under review.',
      description: 'Threads with in-progress review work will appear here.',
    };
  }

  if (statusFilter === 'waiting_on_counterparty') {
    return {
      title: 'Nothing is waiting right now.',
      description: 'Opportunities you sent most recently will appear here until the counterparty replies.',
    };
  }

  if (statusFilter === 'win_confirmation_requested') {
    return {
      title: 'No pending win requests.',
      description: 'Agreement requests that need your confirmation will appear here.',
    };
  }

  if (originFilter === 'started_by_you') {
    return {
      title: 'No opportunities started by you.',
      description: 'Threads you initiated will appear here.',
    };
  }

  if (originFilter === 'started_by_counterparty') {
    return {
      title: 'No opportunities started by counterparty.',
      description: 'Threads initiated by the other party will appear here.',
    };
  }

  return {
    title: 'No active opportunities in your inbox.',
    description: 'Sent and received negotiation threads will appear here.',
  };
}

function getDeleteCopy(proposal) {
  if (proposal?.sent_at) {
    return {
      title: 'Delete Opportunity From Your Workspace?',
      description:
        'This will hide the opportunity from your workspace only. It will remain available to the counterparty and stay intact for shared history.',
      confirmLabel: 'Delete',
    };
  }

  return {
    title: 'Delete Draft Opportunity?',
    description:
      'This will permanently delete this unsent draft and any linked draft-only comparison data. This action cannot be undone.',
    confirmLabel: 'Delete Draft',
  };
}

function ProposalRow({
  proposal,
  onOpen,
  onArchive,
  onUnarchive,
  onMarkOutcome,
  onContinueNegotiation,
  onDelete,
  actionsDisabled,
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const Icon = getRowIcon(proposal);
  const sharedReportDate =
    proposal.shared_report_last_updated_at ||
    proposal.last_activity_at ||
    proposal.updated_at ||
    proposal.created_at ||
    proposal.shared_report_sent_at ||
    null;
  const isArchived = proposal.thread_bucket === 'archived';
  const outcome = proposal.outcome || {};
  const outcomeState = String(outcome.state || proposal.status || '').toLowerCase();
  const isClosed = proposal.thread_bucket === 'closed' || outcomeState === 'won' || outcomeState === 'lost';
  const canArchive = Boolean(outcome.actor_role);
  const canContinueNegotiating = Boolean(outcome.can_continue_negotiating && outcomeState === 'pending_won');
  const wonActionDisabled =
    actionsDisabled || !outcome.can_mark_won || Boolean(outcome.requested_by_current_user);
  const lostActionDisabled = actionsDisabled || !outcome.can_mark_lost;
  const continueActionDisabled = actionsDisabled || !canContinueNegotiating;
  const rowSubtitle = buildCompactProposalSubtitle(proposal);
  const helperText = outcome.requested_by_current_user
    ? 'Waiting for the counterparty to confirm the agreement.'
    : outcome.requested_by_counterparty
      ? 'The counterparty requested agreement on this proposal.'
      : (!outcome.can_mark_won
          ? (outcome.eligibility_reason_won || outcome.eligibility_reason)
          : !outcome.can_mark_lost
            ? (outcome.eligibility_reason_lost || outcome.eligibility_reason)
            : null);
  const deleteCopy = getDeleteCopy(proposal);

  return (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <div className="w-full border-b border-slate-100 flex items-center hover:bg-slate-50 transition-colors">
        <button
          type="button"
          onClick={() => onOpen(proposal)}
          className="flex-1 text-left p-4 flex items-center gap-4 min-w-0"
        >
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-slate-600" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-medium text-slate-900 truncate">{proposal.title || 'Untitled Opportunity'}</h3>
              <PrimaryStatusBadge proposal={proposal} />
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
              <span>{rowSubtitle}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
              {proposal.is_private_mode && (proposal.outcome?.actor_role === 'party_b' || !proposal.counterparty_email) && !proposal.owner_user_id ? (
                <span className="flex items-center gap-1">
                  <EyeOff className="w-3 h-3" />
                  {`With: ${PRIVATE_SENDER_LABEL}`}
                </span>
              ) : (
                <span>{formatRecipientLabel(proposal.party_b_name, proposal.counterparty_email)}</span>
              )}
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <p className="text-xs text-slate-400">{formatUpdatedAt(sharedReportDate)}</p>
            <ChevronRight className="w-4 h-4 text-slate-400 mt-2 ml-auto" />
          </div>
        </button>

        <div className="pr-2 flex-shrink-0" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="w-4 h-4 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {!isClosed ? (
                <>
                  <DropdownMenuItem
                    disabled={wonActionDisabled}
                    onSelect={() => onMarkOutcome && onMarkOutcome(proposal, 'won')}
                    className="gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {getAgreementActionLabel(outcome)}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={lostActionDisabled}
                    onSelect={() => onMarkOutcome && onMarkOutcome(proposal, 'lost')}
                    className="gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    Mark as Lost
                  </DropdownMenuItem>
                  {outcomeState === 'pending_won' ? (
                    <DropdownMenuItem
                      disabled={continueActionDisabled}
                      onSelect={() => onContinueNegotiation && onContinueNegotiation(proposal)}
                      className="gap-2"
                    >
                      <Clock className="w-4 h-4" />
                      Continue Negotiating
                    </DropdownMenuItem>
                  ) : null}
                  {helperText ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="max-w-[13rem] whitespace-normal text-xs leading-relaxed text-slate-500">
                        {helperText}
                      </DropdownMenuLabel>
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                </>
              ) : null}

              {canArchive ? (
                <>
                  {isArchived ? (
                    <DropdownMenuItem
                      disabled={actionsDisabled}
                      onSelect={() => onUnarchive && onUnarchive(proposal)}
                      className="gap-2"
                    >
                      <ArchiveRestore className="w-4 h-4" />
                      Unarchive
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={actionsDisabled}
                      onSelect={() => onArchive && onArchive(proposal)}
                      className="gap-2"
                    >
                      <Archive className="w-4 h-4" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem
                disabled={actionsDisabled}
                onSelect={(event) => {
                  event.preventDefault();
                  setDeleteDialogOpen(true);
                }}
                className="gap-2 text-rose-600 focus:text-rose-700"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deleteCopy.title}</AlertDialogTitle>
          <AlertDialogDescription>{deleteCopy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onDelete && onDelete(proposal)}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {deleteCopy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function Proposals() {
  const navigate = useNavigate();
  const location = useLocation();
  const { navigateToLogin } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeTabValue(params.get('tab'));
  });
  const [statusFilter, setStatusFilter] = useState(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeStatusFilterValue(params.get('status'));
  });
  const [originFilter, setOriginFilter] = useState(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeOriginFilterValue(params.get('origin'));
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const normalizedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);
  const statusOptions = useMemo(() => getStatusOptions(), []);
  const originOptions = useMemo(() => getOriginOptions(), []);
  const emptyState = useMemo(
    () => getEmptyStateCopy(activeTab, statusFilter, originFilter),
    [activeTab, statusFilter, originFilter],
  );
  const refreshProposalQueries = () => {
    queryClient.invalidateQueries(['proposals-list']);
    queryClient.invalidateQueries(['dashboard-summary']);
    queryClient.invalidateQueries(['dashboard-activity']);
    queryClient.invalidateQueries(['dashboard-proposals-all']);
    queryClient.invalidateQueries(['dashboard-proposals-agreement-requests']);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const urlTab = normalizeTabValue(params.get('tab'));
    const urlStatus = normalizeStatusFilterValue(params.get('status'));
    const urlOrigin = normalizeOriginFilterValue(params.get('origin'));

    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
    if (urlStatus !== statusFilter) {
      setStatusFilter(urlStatus);
    }
    if (urlOrigin !== originFilter) {
      setOriginFilter(urlOrigin);
    }
  }, [location.search, activeTab, statusFilter, originFilter]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [activeTab, statusFilter, originFilter, normalizedSearch]);

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
    // Retry 2x before surfacing error — prevents transient blips from wiping counts.
    retry: 2,
  });

  const opportunityLimitReached = isStarterOpportunityLimitReached(summary?.starterUsage);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['proposals-list', activeTab, statusFilter, originFilter, normalizedSearch, cursor],
    queryFn: () =>
      proposalsClient.listWithMeta({
        tab: activeTab,
        status: statusFilter,
        origin: originFilter,
        query: normalizedSearch,
        limit: 20,
        cursor,
      }),
    keepPreviousData: true,
  });

  const archiveMutation = useMutation({
    mutationFn: (proposal) => proposalsClient.archive(proposal.id),
    onSuccess: () => {
      toast.success('Archived');
      refreshProposalQueries();
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to archive');
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (proposal) => proposalsClient.unarchive(proposal.id),
    onSuccess: () => {
      toast.success('Restored');
      refreshProposalQueries();
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to restore');
    },
  });

  const markOutcomeMutation = useMutation({
    mutationFn: ({ proposal, outcome }) => proposalsClient.markOutcome(proposal.id, outcome),
    onSuccess: (updatedProposal) => {
      const outcomeState = String(updatedProposal?.outcome?.state || updatedProposal?.status || '').toLowerCase();
      if (outcomeState === 'pending_won') {
        toast.success('Agreement Requested');
      } else if (String(updatedProposal?.status || '').toLowerCase() === 'won') {
        toast.success('Marked as Agreed');
      } else {
        toast.success('Marked as Lost');
      }
      refreshProposalQueries();
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to update outcome');
    },
  });

  const continueNegotiationMutation = useMutation({
    mutationFn: (proposal) => proposalsClient.continueNegotiation(proposal.id),
    onSuccess: () => {
      toast.success('Cleared pending agreement request');
      refreshProposalQueries();
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to continue negotiating');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (proposal) => proposalsClient.remove(proposal.id),
    onSuccess: (result, proposal) => {
      if (result?.mode === 'hard' || !proposal?.sent_at) {
        toast.success('Draft deleted');
      } else {
        toast.success('Deleted from your workspace');
      }
      refreshProposalQueries();
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to delete opportunity');
    },
  });

  const proposals = data?.proposals || [];
  const page = data?.page || { hasMore: false, nextCursor: null };

  // Counts are null while loading OR on error so we show '…' instead of misleading '0'.
  // Never fall back to 0 for server-derived counts — a silent zero is
  // indistinguishable from "data was wiped" when a user reports a bug.
  const tabCounts = useMemo(() => {
    if (summaryLoading || summaryError || !summary) return null;
    return {
      inbox: summary.inboxCount || 0,
      drafts: summary.draftsCount || 0,
      closed: summary.closedCount || 0,
      archived: summary.archivedCount || 0,
    };
  }, [summary, summaryLoading, summaryError]);

  // Display helper: shows '…' while counts are loading, never shows stale 0.
  function tabCount(key) {
    return tabCounts == null ? '\u2026' : (tabCounts[key] ?? 0);
  }

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
        navigate(buildDocumentComparisonReportHref(proposal.document_comparison_id));
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

  const handleTabChange = (nextTab) => {
    const normalizedTab = normalizeTabValue(nextTab);
    setActiveTab(normalizedTab);

    const params = new URLSearchParams(location.search || '');
    if (normalizedTab === 'inbox') {
      params.delete('tab');
    } else {
      params.set('tab', normalizedTab);
    }
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  };

  const handleStatusFilterChange = (nextStatus) => {
    const normalizedStatus = normalizeStatusFilterValue(nextStatus);
    setStatusFilter(normalizedStatus);

    const params = new URLSearchParams(location.search || '');
    if (normalizedStatus === 'all') {
      params.delete('status');
    } else {
      params.set('status', normalizedStatus);
    }
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  };

  const handleOriginFilterChange = (nextOrigin) => {
    const normalizedOrigin = normalizeOriginFilterValue(nextOrigin);
    setOriginFilter(normalizedOrigin);

    const params = new URLSearchParams(location.search || '');
    if (normalizedOrigin === 'all') {
      params.delete('origin');
    } else {
      params.set('origin', normalizedOrigin);
    }
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  };

  const handleNextPage = () => {
    if (!page?.nextCursor) {
      return;
    }

    setCursorHistory((prev) => [...prev, cursor]);
    setCursor(page.nextCursor);
  };

  const handlePreviousPage = () => {
    if (cursorHistory.length === 0) {
      return;
    }

    const nextHistory = [...cursorHistory];
    const previousCursor = nextHistory.pop() || null;
    setCursorHistory(nextHistory);
    setCursor(previousCursor);
  };

  const handleArchive = (proposal) => {
    archiveMutation.mutate(proposal);
  };

  const handleUnarchive = (proposal) => {
    unarchiveMutation.mutate(proposal);
  };

  const handleMarkOutcome = (proposal, outcome) => {
    markOutcomeMutation.mutate({ proposal, outcome });
  };

  const handleContinueNegotiation = (proposal) => {
    continueNegotiationMutation.mutate(proposal);
  };

  const handleDelete = (proposal) => {
    deleteMutation.mutate(proposal);
  };

  const actionsDisabled =
    archiveMutation.isPending ||
    unarchiveMutation.isPending ||
    markOutcomeMutation.isPending ||
    continueNegotiationMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Opportunities</h1>
            <p className="text-slate-500 mt-1">Manage live opportunity threads across inbox, drafts, closed, and archived.</p>
          </div>
          <Button
            onClick={opportunityLimitReached ? () => setShowUpgradeModal(true) : () => navigate(createPageUrl('DocumentComparisonCreate'))}
            className={`bg-blue-600 hover:bg-blue-700${opportunityLimitReached ? ' opacity-60 cursor-not-allowed' : ''}`}
            title={opportunityLimitReached ? "You've reached your monthly limit. Upgrade to create more opportunities." : undefined}
          >
            <Plus className="w-4 h-4 mr-2" />
            New Opportunity
          </Button>
        </div>

        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative md:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by title, template, counterparty, or summary"
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by state" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={originFilter} onValueChange={handleOriginFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by origin" />
                </SelectTrigger>
                <SelectContent>
                  {originOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="inbox" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Inbox ({tabCount('inbox')})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Drafts ({tabCount('drafts')})
            </TabsTrigger>
            <TabsTrigger value="closed" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Trophy className="w-3 h-3 mr-1" />
              Closed ({tabCount('closed')})
            </TabsTrigger>
            <TabsTrigger value="archived" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Archive className="w-3 h-3 mr-1" />
              Archived ({tabCount('archived')})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <Card className="border-0 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="py-12 text-center text-slate-500">Loading opportunities...</div>
                ) : isError ? (
                  <div className="py-16 px-6 text-center space-y-3">
                    {(Number(error?.status) === 401 || error?.code === 'unauthorized') ? (
                      <>
                        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                        <p className="text-amber-800 font-medium">Session expired</p>
                        <p className="text-sm text-slate-500">
                          Your session has expired or is invalid. Sign in again &mdash; your opportunities are still saved and will reappear immediately.
                        </p>
                        <Button variant="outline" onClick={() => navigateToLogin()}>
                          Sign in again
                        </Button>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                        <p className="text-red-600 font-medium">Failed to load opportunities</p>
                        <p className="text-sm text-slate-500">
                          {error?.message === 'proposals_query_failed'
                            ? 'Database connection error. Please refresh or contact support if this persists.'
                            : error?.message || 'An unexpected error occurred.'}
                        </p>
                        <Button variant="outline" onClick={() => refetch()}>
                          Retry
                        </Button>
                      </>
                    )}
                  </div>
                ) : proposals.length === 0 ? (
                  <div className="py-16 px-6 text-center space-y-3">
                    <p className="text-slate-600 font-medium">{emptyState.title}</p>
                    <p className="text-sm text-slate-500">{emptyState.description}</p>
                    {activeTab === 'drafts' && (
                      <Button
                        onClick={opportunityLimitReached ? () => setShowUpgradeModal(true) : () => navigate(createPageUrl('DocumentComparisonCreate'))}
                        className={`bg-blue-600 hover:bg-blue-700 mt-2${opportunityLimitReached ? ' opacity-60 cursor-not-allowed' : ''}`}
                        title={opportunityLimitReached ? "You've reached your monthly limit. Upgrade to create more opportunities." : undefined}
                      >
                        Create New Opportunity
                      </Button>
                    )}
                  </div>
                ) : (
                  <div>
                    {proposals.map((proposal) => (
                      <ProposalRow
                        key={proposal.id}
                        proposal={proposal}
                        onOpen={handleOpenProposal}
                        onArchive={handleArchive}
                        onUnarchive={handleUnarchive}
                        onMarkOutcome={handleMarkOutcome}
                        onContinueNegotiation={handleContinueNegotiation}
                        onDelete={handleDelete}
                        actionsDisabled={actionsDisabled}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" onClick={handlePreviousPage} disabled={cursorHistory.length === 0}>
                Previous
              </Button>
              <Button variant="outline" onClick={handleNextPage} disabled={!page?.hasMore || !page?.nextCursor}>
                Next
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <StarterUpgradeModal open={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} />
    </div>
  );
}
