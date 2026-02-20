import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { dashboardClient } from '@/api/dashboardClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  CheckCircle2,
  BarChart3,
} from 'lucide-react';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', icon: FileText, label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', icon: Send, label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', icon: Inbox, label: 'Received' },
  under_verification: { color: 'bg-purple-100 text-purple-700', icon: Eye, label: 'Under Review' },
  re_evaluated: { color: 'bg-indigo-100 text-indigo-700', icon: BarChart3, label: 'Re-evaluated' },
  mutual_interest: { color: 'bg-green-100 text-green-700', icon: Users, label: 'Mutual Interest' },
  revealed: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Revealed' },
  closed: { color: 'bg-slate-100 text-slate-600', icon: Clock, label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', icon: AlertTriangle, label: 'Withdrawn' },
};

const TAB_VALUES = new Set(['all', 'sent', 'received', 'drafts']);

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

function ProposalRow({ proposal, onOpen }) {
  const listType = proposal.list_type || 'sent';
  const directional = proposal.directional_status || proposal.status || listType;
  const iconConfig = statusConfig[String(directional).toLowerCase()] || statusConfig.sent;
  const Icon = iconConfig.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(proposal)}
      className="w-full text-left p-4 border-b border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-colors"
    >
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h3 className="font-medium text-slate-900 truncate">{proposal.title || 'Untitled Proposal'}</h3>
          <StatusBadge status={directional} />
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

      <div className="text-right">
        <p className="text-xs text-slate-400">
          {proposal.created_date ? new Date(proposal.created_date).toLocaleDateString() : ''}
        </p>
        <ChevronRight className="w-4 h-4 text-slate-400 mt-2 ml-auto" />
      </div>
    </button>
  );
}

export default function Proposals() {
  const navigate = useNavigate();
  const location = useLocation();
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

  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
  });

  const { data, isLoading } = useQuery({
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

  const proposals = data?.proposals || [];
  const page = data?.page || { hasMore: false, nextCursor: null };

  const tabCounts = {
    all: (summary?.sentCount || 0) + (summary?.receivedCount || 0) + (summary?.draftsCount || 0),
    sent: summary?.sentCount || 0,
    received: summary?.receivedCount || 0,
    drafts: summary?.draftsCount || 0,
  };

  const handleOpenProposal = (proposal) => {
    if (!proposal?.id) {
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

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposals</h1>
            <p className="text-slate-500 mt-1">Track sent and received proposal activity.</p>
          </div>
          <Link to={createPageUrl('CreateProposal')}>
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
                  <SelectItem value="under_verification">Under Review</SelectItem>
                  <SelectItem value="mutual_interest">Mutual Interest</SelectItem>
                  <SelectItem value="revealed">Revealed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6 flex-wrap">
            <TabsTrigger value="all" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              All ({tabCounts.all})
            </TabsTrigger>
            <TabsTrigger value="sent" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Sent ({tabCounts.sent})
            </TabsTrigger>
            <TabsTrigger value="received" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Received ({tabCounts.received})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Drafts ({tabCounts.drafts})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <Card className="border-0 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="py-12 text-center text-slate-500">Loading proposals...</div>
                ) : proposals.length === 0 ? (
                  <div className="py-16 text-center text-slate-500">No proposals match this filter.</div>
                ) : (
                  <div>
                    {proposals.map((proposal) => (
                      <ProposalRow key={proposal.id} proposal={proposal} onOpen={handleOpenProposal} />
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
