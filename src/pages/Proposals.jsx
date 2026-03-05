import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { proposalsClient } from '@/api/proposalsClient';
import { dashboardClient } from '@/api/dashboardClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  Users,
  Eye,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trophy,
} from 'lucide-react';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', icon: FileText, label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', icon: Send, label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', icon: Inbox, label: 'Received' },
  under_verification: { color: 'bg-purple-100 text-purple-700', icon: Eye, label: 'Under Review' },
  re_evaluated: { color: 'bg-indigo-100 text-indigo-700', icon: BarChart3, label: 'Re-evaluated' },
  mutual_interest: { color: 'bg-green-100 text-green-700', icon: Users, label: 'Mutual Interest' },
  won: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Won' },
  lost: { color: 'bg-rose-100 text-rose-700', icon: AlertTriangle, label: 'Lost' },
  closed: { color: 'bg-slate-100 text-slate-600', icon: Clock, label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', icon: AlertTriangle, label: 'Withdrawn' },
  archived: { color: 'bg-slate-100 text-slate-500', icon: Archive, label: 'Archived' },
};

const TAB_VALUES = new Set(['all', 'sent', 'received', 'drafts', 'mutual_interest', 'closed', 'archived']);

function normalizeTabValue(value) {
  const nextValue = String(value || '').trim().toLowerCase();
  if (!TAB_VALUES.has(nextValue)) {
    return 'all';
  }
  return nextValue;
}

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  const config = statusConfig[key] || statusConfig.draft;
  const Icon = config.icon;

  return (
    <Badge className={`${config.color} font-medium`}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function ProposalRow({ proposal, onOpen, onArchive, onUnarchive }) {
  const listType = proposal.list_type || 'sent';
  const directional = proposal.directional_status || proposal.status || listType;
  const iconConfig = statusConfig[String(directional).toLowerCase()] || statusConfig.sent;
  const Icon = iconConfig.icon;
  const hasSharedReportLink = Boolean(proposal.shared_report_token);
  const sharedReportStatus = String(proposal.shared_report_status || '').trim().toLowerCase();
  const sharedReportDate = proposal.shared_report_last_updated_at || proposal.shared_report_sent_at || null;
  const isArchived = Boolean(proposal.archived_at);
  const isOwner = listType !== 'received';

  return (
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
            <h3 className="font-medium text-slate-900 truncate">{proposal.title || 'Untitled Proposal'}</h3>
            <StatusBadge status={directional} />
            {isArchived && (
              <Badge variant="outline" className="text-xs text-slate-500">
                <Archive className="w-3 h-3 mr-1" />
                Archived
              </Badge>
            )}
            {hasSharedReportLink ? (
              <Badge variant="outline" className="text-xs capitalize">
                Link {sharedReportStatus || 'active'}
              </Badge>
            ) : null}
            {proposal.status && proposal.status !== directional ? (
              <Badge variant="outline" className="text-xs">
                {proposal.status.replace(/_/g, ' ')}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>{proposal.template_name || 'Custom Template'}</span>
            {listType === 'received' ? (
              <span>From: {proposal.party_a_email || 'Hidden'}</span>
            ) : (
              <span>To: {proposal.party_b_email || 'Not specified'}</span>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-xs text-slate-400">
            {sharedReportDate
              ? new Date(sharedReportDate).toLocaleDateString()
              : proposal.created_date
                ? new Date(proposal.created_date).toLocaleDateString()
                : ''}
          </p>
          <ChevronRight className="w-4 h-4 text-slate-400 mt-2 ml-auto" />
        </div>
      </button>

      {isOwner && (
        <div className="pr-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="w-4 h-4 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {isArchived ? (
                <DropdownMenuItem
                  onClick={() => onUnarchive && onUnarchive(proposal)}
                  className="gap-2 cursor-pointer"
                >
                  <ArchiveRestore className="w-4 h-4" />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => onArchive && onArchive(proposal)}
                  className="gap-2 cursor-pointer text-slate-600"
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);

  const normalizedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const urlTab = normalizeTabValue(params.get('tab'));
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [location.search, activeTab]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [activeTab, statusFilter, normalizedSearch]);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['proposals-list', activeTab, statusFilter, normalizedSearch, cursor],
    queryFn: () =>
      proposalsClient.listWithMeta({
        tab: activeTab,
        status: statusFilter,
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
      queryClient.invalidateQueries(['proposals-list']);
      queryClient.invalidateQueries(['dashboard-summary']);
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to archive');
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (proposal) => proposalsClient.unarchive(proposal.id),
    onSuccess: () => {
      toast.success('Restored');
      queryClient.invalidateQueries(['proposals-list']);
      queryClient.invalidateQueries(['dashboard-summary']);
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to restore');
    },
  });

  const proposals = data?.proposals || [];
  const page = data?.page || { hasMore: false, nextCursor: null };

  // Counts are null while loading so we can show '…' instead of misleading '0'.
  const tabCounts = useMemo(() => {
    if (summaryLoading || !summary) return null;
    return {
      all: summary.totalCount || 0,
      sent: summary.sentCount || 0,
      received: summary.receivedCount || 0,
      drafts: summary.draftsCount || 0,
      mutual_interest: summary.mutualInterestCount || 0,
      closed: summary.closedCount || 0,
    };
  }, [summary, summaryLoading]);

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
        navigate(
          createPageUrl(
            `DocumentComparisonDetail?id=${encodeURIComponent(
              proposal.document_comparison_id,
            )}&tab=report`,
          ),
        );
        return;
      }

      if ((proposal.list_type || '').toLowerCase() === 'draft') {
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

    if ((proposal.list_type || '').toLowerCase() === 'draft') {
      navigate(createPageUrl(`CreateProposal?draft=${encodeURIComponent(proposal.id)}`));
      return;
    }

    navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`));
  };

  const handleTabChange = (nextTab) => {
    const normalizedTab = normalizeTabValue(nextTab);
    setActiveTab(normalizedTab);

    const params = new URLSearchParams(location.search || '');
    if (normalizedTab === 'all') {
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

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposals</h1>
            <p className="text-slate-500 mt-1">Track sent and received proposal activity.</p>
          </div>
          <Link to="/templates">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Proposal
            </Button>
          </Link>
        </div>

        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative md:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by title, template, or party email"
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="mutual_interest">Mutual Interest</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="all" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              All ({tabCount('all')})
            </TabsTrigger>
            <TabsTrigger value="sent" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Sent ({tabCount('sent')})
            </TabsTrigger>
            <TabsTrigger value="received" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Received ({tabCount('received')})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Drafts ({tabCount('drafts')})
            </TabsTrigger>
            <TabsTrigger value="mutual_interest" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Mutual Interest ({tabCount('mutual_interest')})
            </TabsTrigger>
            <TabsTrigger value="closed" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Trophy className="w-3 h-3 mr-1" />
              Closed ({tabCount('closed')})
            </TabsTrigger>
            <TabsTrigger value="archived" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Archive className="w-3 h-3 mr-1" />
              Archived
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <Card className="border-0 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="py-12 text-center text-slate-500">Loading proposals...</div>
                ) : isError ? (
                  <div className="py-16 px-6 text-center space-y-3">
                    {(Number(error?.status) === 401 || error?.code === 'unauthorized') ? (
                      <>
                        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                        <p className="text-amber-800 font-medium">Session expired</p>
                        <p className="text-sm text-slate-500">
                          Your session has expired or is invalid. Please sign in again to see your proposals.
                        </p>
                        <Button variant="outline" onClick={() => navigateToLogin()}>
                          Sign in again
                        </Button>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                        <p className="text-red-600 font-medium">Failed to load proposals</p>
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
                    <p className="text-slate-600 font-medium">No proposals found</p>
                    <p className="text-sm text-slate-500">
                      {activeTab === 'drafts'
                        ? 'Create your first proposal to get started.'
                        : activeTab === 'archived'
                          ? 'No archived proposals.'
                          : activeTab === 'closed'
                            ? 'No closed (Won/Lost) proposals yet.'
                            : `No ${activeTab} proposals yet.`}
                    </p>
                    {activeTab === 'drafts' && (
                      <Link to="/templates">
                        <Button className="bg-blue-600 hover:bg-blue-700 mt-2">
                          Create New Proposal
                        </Button>
                      </Link>
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
    </div>
  );
}
