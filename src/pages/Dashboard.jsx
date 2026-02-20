import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProposalsChart from '@/components/dashboard/ProposalsChart';
import {
  Plus,
  Send,
  Inbox,
  Eye,
  Users,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { proposalsClient } from '@/api/proposalsClient';
import { dashboardClient } from '@/api/dashboardClient';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', label: 'Received' },
  under_verification: { color: 'bg-purple-100 text-purple-700', label: 'Under Review' },
  re_evaluated: { color: 'bg-indigo-100 text-indigo-700', label: 'Re-evaluated' },
  mutual_interest: { color: 'bg-green-100 text-green-700', label: 'Mutual Interest' },
  revealed: { color: 'bg-emerald-100 text-emerald-700', label: 'Revealed' },
  closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' },
};

function StatusBadge({ status }) {
  const config = statusConfig[String(status || '').toLowerCase()] || statusConfig.draft;
  return <Badge className={`${config.color} font-medium`}>{config.label}</Badge>;
}

function ProposalCard({ proposal, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(proposal)}
      className="w-full text-left bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-200 transition-all"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 truncate">{proposal.title || 'Untitled Proposal'}</h3>
          <p className="text-sm text-slate-500 mt-1 truncate">{proposal.template_name || 'Custom Template'}</p>
        </div>
        <StatusBadge status={proposal.directional_status || proposal.status} />
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
        <span className="text-xs text-slate-400">
          {proposal.created_date ? new Date(proposal.created_date).toLocaleDateString() : ''}
        </span>
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </div>
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('sent');

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => dashboardClient.getSummary(),
  });

  const { data: sentProposals = [], isLoading: loadingSent } = useQuery({
    queryKey: ['dashboard-proposals', 'sent'],
    queryFn: () => proposalsClient.list({ tab: 'sent', limit: 10 }),
  });

  const { data: receivedProposals = [], isLoading: loadingReceived } = useQuery({
    queryKey: ['dashboard-proposals', 'received'],
    queryFn: () => proposalsClient.list({ tab: 'received', limit: 10 }),
  });

  const stats = useMemo(
    () => [
      {
        label: 'Proposals Sent',
        value: summary?.sentCount ?? sentProposals.length,
        icon: Send,
        color: 'from-blue-500 to-blue-600',
      },
      {
        label: 'Proposals Received',
        value: summary?.receivedCount ?? receivedProposals.length,
        icon: Inbox,
        color: 'from-indigo-500 to-indigo-600',
      },
      {
        label: 'Active Reviews',
        value: summary?.activeReviewsCount ?? 0,
        icon: Eye,
        color: 'from-amber-500 to-amber-600',
      },
      {
        label: 'Mutual Interest',
        value: summary?.mutualInterestCount ?? 0,
        icon: Users,
        color: 'from-green-500 to-green-600',
      },
    ],
    [summary, sentProposals.length, receivedProposals.length],
  );

  const handleOpenProposal = (proposal) => {
    if (!proposal?.id) {
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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

        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link to={createPageUrl('Proposals')}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <FileText className="w-8 h-8 text-blue-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-2">Proposals</h3>
                  <p className="text-sm text-slate-500">
                    {(summary?.sentCount ?? sentProposals.length) + (summary?.receivedCount ?? receivedProposals.length)} total
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link to={createPageUrl('Templates')}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <FileText className="w-8 h-8 text-purple-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-2">Templates</h3>
                  <p className="text-sm text-slate-500">Browse and use proposal templates</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1">
            <TabsTrigger value="sent" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Send className="w-4 h-4 mr-2" />
              Sent ({sentProposals.length})
            </TabsTrigger>
            <TabsTrigger value="received" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Inbox className="w-4 h-4 mr-2" />
              Received ({receivedProposals.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sent">
            {loadingSent ? (
              <div className="text-sm text-slate-500">Loading sent proposals...</div>
            ) : sentProposals.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200">
                <CardContent className="py-12 text-center text-slate-500">No sent proposals yet.</CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sentProposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} onOpen={handleOpenProposal} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="received">
            {loadingReceived ? (
              <div className="text-sm text-slate-500">Loading received proposals...</div>
            ) : receivedProposals.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200">
                <CardContent className="py-12 text-center text-slate-500">No received proposals yet.</CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {receivedProposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} onOpen={handleOpenProposal} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
