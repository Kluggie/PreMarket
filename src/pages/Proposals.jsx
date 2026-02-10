import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
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
} from "@/components/ui/dropdown-menu";
import DeleteDraftDialog from '../components/proposal/DeleteDraftDialog';
import {
  Plus, Search, Filter, Send, Inbox, FileText, BarChart3,
  ChevronRight, Clock, CheckCircle2, AlertTriangle, Eye, Users, MoreVertical, Trash2, X
} from 'lucide-react';
import { toast } from 'sonner';

const NO_SHARED_WORKSPACE_LINK_MESSAGE =
  'No shared workspace link found. Ask the sender to share again.';

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isProposalOwner(proposal, user) {
  if (!proposal || !user) return false;

  const userId = String(user?.id || '').trim();
  const ownerUserId = String(proposal?.party_a_user_id || proposal?.created_by_user_id || '').trim();
  if (userId && ownerUserId && userId === ownerUserId) {
    return true;
  }

  const userEmail = normalizeEmail(user?.email);
  const ownerEmail = normalizeEmail(proposal?.party_a_email);
  return Boolean(userEmail && ownerEmail && userEmail === ownerEmail);
}

async function getActiveShareLinkForRecipient(proposalId) {
  const normalizedProposalId = String(proposalId || '').trim();
  if (!normalizedProposalId) {
    return {
      ok: false,
      message: 'Proposal ID is required'
    };
  }

  try {
    const result = await base44.functions.invoke('GetActiveShareLinkForRecipient', {
      proposalId: normalizedProposalId
    });
    const data = result?.data;
    if (data?.ok && data?.token) {
      return {
        ok: true,
        token: data.token
      };
    }
    return {
      ok: false,
      message: data?.message || NO_SHARED_WORKSPACE_LINK_MESSAGE
    };
  } catch (error) {
    const message =
      error?.data?.message ||
      error?.response?.data?.message ||
      error?.message ||
      NO_SHARED_WORKSPACE_LINK_MESSAGE;
    return {
      ok: false,
      message
    };
  }
}

const StatusBadge = ({ status }) => {
  const config = {
    draft: { color: 'bg-slate-100 text-slate-700', icon: FileText },
    sent: { color: 'bg-blue-100 text-blue-700', icon: Send },
    received: { color: 'bg-amber-100 text-amber-700', icon: Inbox },
    under_verification: { color: 'bg-purple-100 text-purple-700', icon: Eye },
    re_evaluated: { color: 'bg-indigo-100 text-indigo-700', icon: BarChart3 },
    mutual_interest: { color: 'bg-green-100 text-green-700', icon: Users },
    revealed: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    closed: { color: 'bg-slate-100 text-slate-600', icon: Clock },
    withdrawn: { color: 'bg-red-100 text-red-700', icon: AlertTriangle }
  };
  const { color, icon: Icon } = config[status] || config.draft;
  const label = status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return (
    <Badge className={`${color} font-medium`}>
      <Icon className="w-3 h-3 mr-1" />
      {label}
    </Badge>
  );
};

export default function Proposals() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const { data: allUserProposals = [], isLoading: loadingAll } = useQuery({
    queryKey: ['proposals', 'all', user?.email],
    queryFn: async () => {
      const sent = await base44.entities.Proposal.filter({ party_a_email: user?.email }, '-created_date');
      const received = await base44.entities.Proposal.filter({ party_b_email: user?.email }, '-created_date');
      return { sent, received };
    },
    enabled: !!user?.email
  });

  const { data: documentComparisons = [], isLoading: loadingComparisons } = useQuery({
    queryKey: ['documentComparisons'],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.DocumentComparison.filter({ 
        created_by_user_id: user.id 
      }, '-updated_date');
    },
    enabled: !!user,
  });

  const sentProposals = allUserProposals?.sent?.filter(p => p.status !== 'draft') || [];
  const receivedProposals = allUserProposals?.received || [];
  const draftProposals = allUserProposals?.sent?.filter(p => p.status === 'draft') || [];
  const draftComparisons = documentComparisons.filter(c => c.status === 'draft');

  const allProposals = [...sentProposals, ...receivedProposals, ...draftProposals].sort(
    (a, b) => new Date(b.created_date) - new Date(a.created_date)
  );

  const getFilteredProposals = () => {
    let proposals = activeTab === 'sent' ? sentProposals : 
                   activeTab === 'received' ? receivedProposals :
                   activeTab === 'drafts' ? draftProposals :
                   allProposals;

    if (statusFilter !== 'all') {
      proposals = proposals.filter(p => p.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      proposals = proposals.filter(p => 
        p.title?.toLowerCase().includes(query) ||
        p.template_name?.toLowerCase().includes(query) ||
        p.party_a_email?.toLowerCase().includes(query) ||
        p.party_b_email?.toLowerCase().includes(query)
      );
    }

    return proposals;
  };

  const filteredProposals = getFilteredProposals();
  const isLoading = loadingAll || loadingComparisons;

  const deleteDraftMutation = useMutation({
    mutationFn: async (proposalId) => {
      const responses = await base44.entities.ProposalResponse.filter({ proposal_id: proposalId });
      const reports = await base44.entities.EvaluationReport.filter({ proposal_id: proposalId });
      const attachments = await base44.entities.Attachment.filter({ proposal_id: proposalId });
      
      await Promise.all([
        ...responses.map(r => base44.entities.ProposalResponse.delete(r.id)),
        ...reports.map(r => base44.entities.EvaluationReport.delete(r.id)),
        ...attachments.map(a => base44.entities.Attachment.delete(a.id))
      ]);
      
      await base44.entities.Proposal.delete(proposalId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['proposals']);
      toast.success('Draft deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete draft');
    }
  });

  const ProposalRow = ({ proposal }) => {
    const isSent = isProposalOwner(proposal, user);
    const isDraft = proposal.status === 'draft';
    
    const handleClick = async () => {
      if (isDraft) {
        // Route based on proposal type
        if (proposal.proposal_type === 'document_comparison' && proposal.document_comparison_id) {
          navigate(createPageUrl(`DocumentComparisonCreate?draft=${proposal.document_comparison_id}&proposalId=${proposal.id}&step=${proposal.draft_step || 1}`));
        } else {
          navigate(createPageUrl(`CreateProposal?draft=${proposal.id}`));
        }
        return;
      }

      if (!isSent) {
        const shareLink = await getActiveShareLinkForRecipient(proposal.id);
        if (shareLink.ok) {
          navigate(createPageUrl(`SharedReport?token=${encodeURIComponent(shareLink.token)}`));
          return;
        }

        toast.error(shareLink.message || NO_SHARED_WORKSPACE_LINK_MESSAGE);
        return;
      }

      navigate(createPageUrl(`ProposalDetail?id=${proposal.id}`));
    };
    
    return (
      <motion.div
        whileHover={{ backgroundColor: 'rgb(248, 250, 252)' }}
        className="p-4 border-b border-slate-100 flex items-center gap-4 cursor-pointer"
        onClick={handleClick}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            {isDraft ? (
              <FileText className="w-5 h-5 text-slate-600" />
            ) : isSent ? (
              <Send className="w-5 h-5 text-blue-600" />
            ) : (
              <Inbox className="w-5 h-5 text-amber-600" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-slate-900 truncate">
                {proposal.title || 'Untitled Proposal'}
              </h3>
              <StatusBadge status={proposal.status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span>{proposal.template_name}</span>
              <span>•</span>
              <span>
                {isSent ? `To: ${proposal.party_b_email || 'Not specified'}` : `From: ${proposal.party_a_email}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {proposal.latest_score && (
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-600">{proposal.latest_score}%</p>
                <p className="text-xs text-slate-500">Match Score</p>
              </div>
            )}
            <div className="text-right">
              <p className="text-sm text-slate-500">
                {new Date(proposal.created_date).toLocaleDateString()}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </div>
        </div>
        
        {isDraft && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                className="text-red-600 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('This will permanently delete this draft. Continue?')) {
                    deleteDraftMutation.mutate(proposal.id);
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Draft
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposals</h1>
            <p className="text-slate-500 mt-1">Manage all your pre-qualification proposals.</p>
          </div>
          <Link to={createPageUrl('Templates')}>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Proposal
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input 
                  placeholder="Search proposals..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="under_verification">Under Verification</SelectItem>
                  <SelectItem value="mutual_interest">Mutual Interest</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Tabs & List */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-4">
            <TabsTrigger value="all" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              All ({allProposals.length})
            </TabsTrigger>
            <TabsTrigger value="sent" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Send className="w-4 h-4 mr-2" />
              Sent ({sentProposals.length})
            </TabsTrigger>
            <TabsTrigger value="received" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Inbox className="w-4 h-4 mr-2" />
              Received ({receivedProposals.length})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Drafts ({draftProposals.length + draftComparisons.length})
            </TabsTrigger>
          </TabsList>

          <Card className="border-0 shadow-sm overflow-hidden">
            {isLoading ? (
              <CardContent className="p-0">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="p-4 border-b border-slate-100 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-slate-200" />
                      <div className="flex-1">
                        <div className="h-5 bg-slate-200 rounded w-48 mb-2" />
                        <div className="h-4 bg-slate-100 rounded w-32" />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            ) : filteredProposals.length === 0 ? (
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No proposals found</h3>
                <p className="text-slate-500 mb-6">
                  {searchQuery || statusFilter !== 'all' 
                    ? 'Try adjusting your filters.'
                    : 'Create your first proposal to get started.'
                  }
                </p>
                {!searchQuery && statusFilter === 'all' && (
                  <Link to={createPageUrl('CreateProposal')}>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Proposal
                    </Button>
                  </Link>
                )}
              </CardContent>
            ) : (
              <CardContent className="p-0">

                
                {filteredProposals.map(proposal => (
                  <ProposalRow key={proposal.id} proposal={proposal} />
                ))}
              </CardContent>
            )}
          </Card>
        </Tabs>
      </div>
    </div>
  );
}
