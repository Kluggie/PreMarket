import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProposalsChart from '../components/dashboard/ProposalsChart';
import {
  Plus, FileText, Inbox, Send, Clock, CheckCircle2, AlertTriangle,
  ArrowRight, Eye, Users, BarChart3, TrendingUp, ChevronRight
} from 'lucide-react';

const StatusBadge = ({ status }) => {
  const config = {
    draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
    sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent' },
    received: { color: 'bg-amber-100 text-amber-700', label: 'Received' },
    under_verification: { color: 'bg-purple-100 text-purple-700', label: 'Under Review' },
    re_evaluated: { color: 'bg-indigo-100 text-indigo-700', label: 'Re-evaluated' },
    mutual_interest: { color: 'bg-green-100 text-green-700', label: 'Mutual Interest' },
    revealed: { color: 'bg-emerald-100 text-emerald-700', label: 'Revealed' },
    closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
    withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' }
  };
  const { color, label } = config[status] || config.draft;
  return <Badge className={`${color} font-medium`}>{label}</Badge>;
};

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('sent');

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const { data: allUserProposals = [], isLoading: loadingAll } = useQuery({
    queryKey: ['proposals', 'all', user?.email],
    queryFn: async () => {
      const sent = await base44.entities.Proposal.filter({ party_a_email: user?.email }, '-created_date', 10);
      const received = await base44.entities.Proposal.filter({ party_b_email: user?.email }, '-created_date', 10);
      return { sent, received };
    },
    enabled: !!user?.email
  });

  const sentProposals = allUserProposals?.sent?.filter(p => p.status !== 'draft') || [];
  const receivedProposals = allUserProposals?.received || [];
  
  const loadingSent = loadingAll;
  const loadingReceived = loadingAll;

  const stats = [
    { 
      label: 'Proposals Sent', 
      value: sentProposals.length, 
      icon: Send, 
      color: 'from-blue-500 to-blue-600',
      change: '+2 this week'
    },
    { 
      label: 'Proposals Received', 
      value: receivedProposals.length, 
      icon: Inbox, 
      color: 'from-indigo-500 to-indigo-600',
      change: '+1 this week'
    },
    { 
      label: 'Active Reviews', 
      value: [...sentProposals, ...receivedProposals].filter(p => 
        ['sent', 'received', 'under_verification'].includes(p.status)
      ).length, 
      icon: Eye, 
      color: 'from-amber-500 to-amber-600',
      change: '3 pending'
    },
    { 
      label: 'Mutual Interest', 
      value: [...sentProposals, ...receivedProposals].filter(p => 
        ['mutual_interest', 'revealed'].includes(p.status)
      ).length, 
      icon: Users, 
      color: 'from-green-500 to-green-600',
      change: '100% match rate'
    }
  ];

  const ProposalCard = ({ proposal, type }) => (
    <Link to={createPageUrl(`ProposalDetail?id=${proposal.id}`)}>
      <motion.div
        whileHover={{ y: -2 }}
        className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">
              {proposal.title || 'Untitled Proposal'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {proposal.template_name || 'Custom Template'}
            </p>
          </div>
          <StatusBadge status={proposal.status} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-slate-500">
            {type === 'sent' ? (
              <span>To: {proposal.party_b_email || 'Not specified'}</span>
            ) : (
              <span>From: {proposal.party_a_email}</span>
            )}
          </div>
          {proposal.latest_score && (
            <div className="flex items-center gap-1">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <span className="font-semibold text-blue-600">{proposal.latest_score}%</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <span className="text-xs text-slate-400">
            {new Date(proposal.created_date).toLocaleDateString()}
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </div>
      </motion.div>
    </Link>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome back, {user?.full_name?.split(' ')?.[0] || 'there'}
            </h1>
            <p className="text-slate-500 mt-1">Here's what's happening with your proposals.</p>
          </div>
          <Link to={createPageUrl('CreateProposal')}>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Proposal
            </Button>
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-500">{stat.label}</p>
                      <p className="text-3xl font-bold text-slate-900 mt-1">{stat.value}</p>
                      <p className="text-xs text-slate-400 mt-2">{stat.change}</p>
                    </div>
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                      <stat.icon className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Analytics Chart */}
        <div className="mb-8">
          <ProposalsChart sentProposals={sentProposals} receivedProposals={receivedProposals} />
        </div>

        {/* Proposals Tabs */}
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                    <div className="h-5 bg-slate-200 rounded w-3/4 mb-3" />
                    <div className="h-4 bg-slate-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : sentProposals.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200">
                <CardContent className="py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <Send className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No proposals sent yet</h3>
                  <p className="text-slate-500 mb-6">Create your first proposal to start pre-qualifying.</p>
                  <Link to={createPageUrl('CreateProposal')}>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Proposal
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sentProposals.map(proposal => (
                  <ProposalCard key={proposal.id} proposal={proposal} type="sent" />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="received">
            {loadingReceived ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                    <div className="h-5 bg-slate-200 rounded w-3/4 mb-3" />
                    <div className="h-4 bg-slate-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : receivedProposals.length === 0 ? (
              <Card className="border-dashed border-2 border-slate-200">
                <CardContent className="py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <Inbox className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No proposals received</h3>
                  <p className="text-slate-500">When someone sends you a proposal, it will appear here.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {receivedProposals.map(proposal => (
                  <ProposalCard key={proposal.id} proposal={proposal} type="received" />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}