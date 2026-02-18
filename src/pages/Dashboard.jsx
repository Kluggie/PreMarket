import React, { useState, useEffect } from 'react';
import { authClient } from '@/api/authClient';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProposalsChart from '../components/dashboard/ProposalsChart';
import { toast } from 'sonner';
import {
  Plus, FileText, Inbox, Send, Clock, CheckCircle2, AlertTriangle,
  ArrowRight, Eye, Users, BarChart3, TrendingUp, ChevronRight
} from 'lucide-react';

const NO_SHARED_WORKSPACE_LINK_MESSAGE =
  'No shared workspace link found. Ask the sender to share again.';
const RECEIVED_RECORD_ACTION = 'shared_proposal_received';

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

function dedupeById(records = []) {
  const byId = new Map();
  records.forEach((record, index) => {
    const key = String(record?.id || `row_${index}`).trim();
    if (!key || byId.has(key)) return;
    byId.set(key, record);
  });
  return Array.from(byId.values());
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildReviewedTitle(title, reviewedCount) {
  const safeTitle = title || 'Untitled Proposal';
  if (reviewedCount > 1) {
    return `${safeTitle} - reviewed (${reviewedCount})`;
  }
  return `${safeTitle} - reviewed`;
}

function readSharedContextEntries(currentUserEmail) {
  if (typeof window === 'undefined') return [];
  const normalizedCurrentEmail = normalizeEmail(currentUserEmail);
  if (!normalizedCurrentEmail) return [];

  const entriesByProposalId = new Map();
  const addFromEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const currentUserEmail = normalizeEmail(entry.currentUserEmail || null);
    const recipientEmail = normalizeEmail(entry.recipientEmail || null);
    const matchesCurrentUser =
      (currentUserEmail && currentUserEmail === normalizedCurrentEmail) ||
      (!currentUserEmail && recipientEmail && recipientEmail === normalizedCurrentEmail);
    if (!matchesCurrentUser) return;

    const rawId = entry.proposalId || entry.proposal_id || null;
    const proposalId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!proposalId) return;

    const existing = entriesByProposalId.get(proposalId);
    const nextTime = new Date(entry?.loadedAt || 0).getTime();
    const existingTime = existing ? new Date(existing?.loadedAt || 0).getTime() : 0;
    if (!existing || nextTime >= existingTime) {
      entriesByProposalId.set(proposalId, entry);
    }
  };

  try {
    const singleRaw = window.localStorage.getItem('sharedReportContext');
    if (singleRaw) {
      addFromEntry(JSON.parse(singleRaw));
    }
  } catch {
    // Ignore malformed local context.
  }

  try {
    const historyRaw = window.localStorage.getItem('sharedReportContextHistory');
    if (historyRaw) {
      const history = JSON.parse(historyRaw);
      if (Array.isArray(history)) {
        history.forEach(addFromEntry);
      }
    }
  } catch {
    // Ignore malformed local history.
  }

  return Array.from(entriesByProposalId.values());
}

function parseObjectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') return parseJsonValue(value) || {};
  return {};
}

function readReceivedRecordEntries(rows = []) {
  const byProposalId = new Map();

  rows.forEach((row) => {
    const action = String(row?.action || '').trim().toLowerCase();
    if (action !== RECEIVED_RECORD_ACTION) return;

    const details = parseObjectValue(row?.details);
    const proposalId = String(
      row?.entity_id ||
      row?.proposal_id ||
      details?.proposalId ||
      details?.proposal_id ||
      ''
    ).trim();
    if (!proposalId) return;

    const entry = {
      proposalId,
      token: details?.token || null,
      proposalTitle: details?.proposalTitle || null,
      templateName: details?.templateName || null,
      partyAEmail: details?.partyAEmail || details?.senderEmail || null,
      senderEmail: details?.senderEmail || details?.partyAEmail || null,
      recipientEmail: normalizeEmail(details?.recipientEmail || row?.user_email || null),
      currentUserEmail: normalizeEmail(row?.user_email || null),
      loadedAt: details?.openedAt || details?.firstOpenedAt || row?.created_date || null
    };

    const existing = byProposalId.get(proposalId);
    const existingTime = existing ? new Date(existing?.loadedAt || 0).getTime() : 0;
    const nextTime = new Date(entry?.loadedAt || 0).getTime();
    if (!existing || nextTime >= existingTime) {
      byProposalId.set(proposalId, entry);
    }
  });

  return Array.from(byProposalId.values());
}

async function getActiveShareLinkForRecipient(proposalId) {
  const normalizedProposalId = String(proposalId || '').trim();
  if (!normalizedProposalId) {
    return {
      ok: false,
      message: 'Proposal ID is required'
    };
  }

  const isLocalhost = () => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  };
  const isMissingDeployment = (value) =>
    String(value || '').toLowerCase().includes('deployment does not exist');

  const resolveFromShareLinks = async () => {
    const me = await authClient.me().catch(() => null);
    const recipientEmail = normalizeEmail(me?.email);
    if (!recipientEmail) {
      return { ok: false, message: NO_SHARED_WORKSPACE_LINK_MESSAGE };
    }

    const buckets = await Promise.all([
      base44.entities.ShareLink
        .filter({ proposal_id: normalizedProposalId, recipient_email: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      base44.entities.ShareLink
        .filter({ proposalId: normalizedProposalId, recipientEmail: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      base44.entities.ShareLink
        .filter({ proposal_id: normalizedProposalId, recipientEmail: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      base44.entities.ShareLink
        .filter({ proposalId: normalizedProposalId, recipient_email: recipientEmail }, '-created_date', 10)
        .catch(() => [])
    ]);

    const activeRow = buckets
      .flat()
      .find((row) => {
        const status = String(row?.status || '').trim().toLowerCase();
        if (status && status !== 'active') return false;

        const expiresAt = row?.expires_at || row?.expiresAt || row?.data?.expires_at || row?.data?.expiresAt;
        if (expiresAt) {
          const expiry = new Date(expiresAt).getTime();
          if (Number.isFinite(expiry) && expiry < Date.now()) return false;
        }
        return true;
      });

    const token = activeRow?.token || activeRow?.data?.token || null;
    if (!token) {
      return { ok: false, message: NO_SHARED_WORKSPACE_LINK_MESSAGE };
    }

    return { ok: true, token: String(token) };
  };

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

    const responseMessage = typeof data === 'string' ? data : (data?.message || data?.error || '');
    if (isLocalhost() && isMissingDeployment(responseMessage)) {
      return resolveFromShareLinks();
    }

    return {
      ok: false,
      message: responseMessage || NO_SHARED_WORKSPACE_LINK_MESSAGE
    };
  } catch (error) {
    const message = String(
      error?.data?.message ||
      error?.response?.data?.message ||
      error?.data ||
      error?.response?.data ||
      error?.message ||
      NO_SHARED_WORKSPACE_LINK_MESSAGE
    );
    if (isLocalhost() && isMissingDeployment(message)) {
      return resolveFromShareLinks();
    }

    return {
      ok: false,
      message
    };
  }
}

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
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('sent');
  const queryClient = useQueryClient();

  useEffect(() => {
    authClient.me().then(setUser);
  }, []);

  useEffect(() => {
    const handleSharedContextUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['proposals', 'all'] });
    };

    window.addEventListener('shared-report-context-updated', handleSharedContextUpdated);
    return () => {
      window.removeEventListener('shared-report-context-updated', handleSharedContextUpdated);
    };
  }, [queryClient]);

  const { data: allUserProposals = [], isLoading: loadingAll } = useQuery({
    queryKey: ['proposals', 'all', user?.email],
    queryFn: async () => {
      const sent = await base44.entities.Proposal.filter({ party_a_email: user?.email }, '-created_date', 10).catch(() => []);
      const received = await base44.entities.Proposal.filter({ party_b_email: user?.email }, '-created_date', 10).catch(() => []);
      const receivedRecords = user?.id
        ? await base44.entities.AuditLog.filter({ user_id: user.id, action: RECEIVED_RECORD_ACTION }, '-created_date', 200).catch(() => [])
        : [];
      const sharedContextEntries = readSharedContextEntries(user?.email);
      const receivedRecordEntries = readReceivedRecordEntries(receivedRecords);
      const sharedContextByProposalId = new Map(
        sharedContextEntries
          .map((entry) => {
            const proposalId = String(entry?.proposalId || entry?.proposal_id || '').trim();
            return proposalId ? [proposalId, entry] : null;
          })
          .filter(Boolean)
      );
      const workspaceContextByProposalId = new Map(
        receivedRecordEntries
          .map((entry) => {
            const proposalId = String(entry?.proposalId || entry?.proposal_id || '').trim();
            return proposalId ? [proposalId, entry] : null;
          })
          .filter(Boolean)
      );

      sharedContextByProposalId.forEach((entry, proposalId) => {
        const existing = workspaceContextByProposalId.get(proposalId);
        const existingTime = existing ? new Date(existing?.loadedAt || 0).getTime() : 0;
        const nextTime = new Date(entry?.loadedAt || 0).getTime();
        if (!existing || nextTime >= existingTime) {
          workspaceContextByProposalId.set(proposalId, { ...existing, ...entry });
        }
      });

      const proposalIdsFromWorkspaceContext = Array.from(workspaceContextByProposalId.keys());
      const workspaceProposalIdSet = new Set(proposalIdsFromWorkspaceContext);

      const mergedReceived = dedupeById(received).map((proposal) => {
        const proposalId = String(proposal?.id || '').trim();
        if (!proposalId || !workspaceProposalIdSet.has(proposalId)) return proposal;
        const contextEntry = workspaceContextByProposalId.get(proposalId) || {};
        return {
          ...proposal,
          _fromSharedContext: true,
          _sharedToken: contextEntry?.token || null
        };
      });

      if (proposalIdsFromWorkspaceContext.length === 0) {
        return { sent, received: mergedReceived };
      }

      const existingReceivedIds = new Set(
        mergedReceived
          .map((proposal) => String(proposal?.id || '').trim())
          .filter(Boolean)
      );

      const missingIds = proposalIdsFromWorkspaceContext.filter((proposalId) => !existingReceivedIds.has(proposalId));
      if (missingIds.length === 0) {
        return { sent, received: mergedReceived };
      }

      const proposalsFromSharedContext = (
        await Promise.all(
          missingIds.map((proposalId) =>
            base44.entities.Proposal.filter({ id: proposalId }, '-created_date', 1).catch(() => [])
          )
        )
      ).flat().map((proposal) => ({
        ...proposal,
        _fromSharedContext: true,
        _sharedToken: workspaceContextByProposalId.get(String(proposal?.id || '').trim())?.token || null
      }));

      const fetchedProposalIdSet = new Set(
        proposalsFromSharedContext
          .map((proposal) => String(proposal?.id || '').trim())
          .filter(Boolean)
      );
      const syntheticRows = missingIds
        .filter((proposalId) => !fetchedProposalIdSet.has(proposalId))
        .map((proposalId) => {
          const contextEntry = workspaceContextByProposalId.get(proposalId) || {};
          return {
            id: proposalId,
            sourceProposalId: proposalId,
            title: contextEntry?.proposalTitle || contextEntry?.title || 'Shared Proposal',
            template_name: contextEntry?.templateName || 'Shared Workspace',
            party_a_email: contextEntry?.partyAEmail || contextEntry?.senderEmail || 'Shared sender',
            party_b_email: user?.email || 'Recipient',
            created_date: contextEntry?.loadedAt || new Date().toISOString(),
            status: 'received',
            _fromSharedContext: true,
            _sharedToken: contextEntry?.token || null
          };
        });

      return { sent, received: dedupeById([...mergedReceived, ...proposalsFromSharedContext, ...syntheticRows]) };
    },
    enabled: !!user?.email
  });

  const { data: sendBackMeta = { countsByProposal: {}, latestByProposal: {} } } = useQuery({
    queryKey: ['dashboard', 'sendBackMeta', user?.email],
    queryFn: async () => {
      if (!user?.email) {
        return { countsByProposal: {}, latestByProposal: {} };
      }

      const currentUserEmail = normalizeEmail(user.email);
      const rows = await base44.entities.ProposalResponse
        .filter({ claim_type: 'recipient_counterproposal' }, '-created_date', 100)
        .catch(() => []);

      const countsByProposal = {};
      const latestByProposal = {};

      rows.forEach((row) => {
        const proposalId = String(
          row?.proposal_id ||
          row?.proposalId ||
          row?.data?.proposal_id ||
          row?.data?.proposalId ||
          ''
        ).trim();
        if (!proposalId) return;

        const payload = parseJsonValue(row?.value);
        const source = String(payload?.source || '').trim().toLowerCase();
        if (source && source !== 'shared_report_send_back') return;

        const actorEmail = normalizeEmail(payload?.actorEmail || '');
        if (actorEmail && actorEmail !== currentUserEmail) return;

        countsByProposal[proposalId] = (countsByProposal[proposalId] || 0) + 1;

        const existing = latestByProposal[proposalId];
        const nextTime = new Date(row?.created_date || 0).getTime();
        const existingTime = existing ? new Date(existing?.created_date || 0).getTime() : 0;
        if (!existing || nextTime > existingTime) {
          latestByProposal[proposalId] = row;
        }
      });

      return { countsByProposal, latestByProposal };
    },
    enabled: !!user?.email
  });

  const sentSource = allUserProposals?.sent || [];
  const receivedSource = allUserProposals?.received || [];

  const dedupedSent = dedupeById(sentSource);
  const dedupedReceived = dedupeById(receivedSource);

  const receivedProposals = dedupedReceived.filter((proposal) => {
    const status = String(proposal?.status || '').trim().toLowerCase();
    if (status === 'draft') return false;
    if (proposal?._fromSharedContext) return true;
    return !isProposalOwner(proposal, user);
  });

  const receivedIdSet = new Set(
    receivedProposals
      .map((proposal) => String(proposal?.id || '').trim())
      .filter(Boolean)
  );

  const ownerSentProposals = dedupedSent.filter((proposal) => {
    const proposalId = String(proposal?.id || '').trim();
    const status = String(proposal?.status || '').trim().toLowerCase();
    if (!proposalId || status === 'draft') return false;
    if (!isProposalOwner(proposal, user)) return false;
    if (receivedIdSet.has(proposalId)) return false;
    return true;
  });

  const reviewedSentProposals = receivedProposals
    .map((proposal) => {
      const proposalId = String(proposal?.id || '').trim();
      if (!proposalId) return null;

      const reviewedCount = Number(sendBackMeta?.countsByProposal?.[proposalId] || 0);
      if (reviewedCount <= 0) return null;

      const latestReviewRow = sendBackMeta?.latestByProposal?.[proposalId] || null;
      return {
        ...proposal,
        id: `${proposalId}__reviewed`,
        sourceProposalId: proposalId,
        status: 'sent',
        title: buildReviewedTitle(proposal?.title, reviewedCount),
        reviewedCount,
        created_date: latestReviewRow?.created_date || proposal?.updated_date || proposal?.created_date,
        _listType: 'sent_reviewed',
        _isReviewedVersion: true
      };
    })
    .filter(Boolean);

  const sentProposals = [...ownerSentProposals, ...reviewedSentProposals].sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );
  
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

  const handleOpenProposal = async (proposal, type) => {
    if (type === 'received' || proposal?._listType === 'sent_reviewed') {
      const sourceProposalId = proposal?.sourceProposalId || proposal?.id;
      const shareLink = await getActiveShareLinkForRecipient(sourceProposalId);
      if (shareLink.ok) {
        navigate(
          createPageUrl(
            `ProposalDetail?id=${encodeURIComponent(sourceProposalId)}&sharedToken=${encodeURIComponent(shareLink.token)}&role=recipient`
          )
        );
        return;
      }

      if (proposal?._sharedToken) {
        navigate(
          createPageUrl(
            `ProposalDetail?id=${encodeURIComponent(sourceProposalId)}&sharedToken=${encodeURIComponent(proposal._sharedToken)}&role=recipient`
          )
        );
        return;
      }
      toast.error(shareLink.message || NO_SHARED_WORKSPACE_LINK_MESSAGE);
      return;
    }

    navigate(createPageUrl(`ProposalDetail?id=${proposal.id}`));
  };

  const ProposalCard = ({ proposal, type }) => (
    (() => {
      const listType = proposal?._listType || (type === 'received' ? 'received' : 'sent');
      const directionalStatus = listType === 'received' ? 'received' : 'sent';
      const rawStatus = String(proposal?.status || '').trim().toLowerCase();
      const showRawStatus =
        Boolean(rawStatus) &&
        rawStatus !== directionalStatus &&
        !['sent', 'received', 'draft'].includes(rawStatus);

      return (
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
          onClick={() => {
            handleOpenProposal(proposal, type);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleOpenProposal(proposal, type);
            }
          }}
        >
          <div>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">
                    {proposal.title || 'Untitled Proposal'}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {proposal.template_name || 'Custom Template'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={directionalStatus} />
                  {showRawStatus && (
                    <Badge variant="outline" className="text-xs">
                      {rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                  )}
                  {proposal?._isReviewedVersion && (
                    <Badge className="bg-emerald-100 text-emerald-700">Reviewed</Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  {proposal?._isReviewedVersion ? (
                    <span>To: {proposal.party_a_email || 'Original proposer'}</span>
                  ) : type === 'sent' ? (
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
          </div>
        </motion.div>
      );
    })()
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

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link to={createPageUrl('Proposals')}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <FileText className="w-8 h-8 text-blue-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-2">Proposals</h3>
                  <p className="text-sm text-slate-500">
                    {sentProposals.length} sent • {receivedProposals.length} received
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link to={createPageUrl('DocumentComparisonCreate')}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <FileText className="w-8 h-8 text-purple-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-2">Document Comparison</h3>
                  <p className="text-sm text-slate-500">
                    Compare documents with confidentiality controls
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
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
