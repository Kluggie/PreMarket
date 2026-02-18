import React, { useState, useEffect } from 'react';
import { authClient } from '@/api/authClient';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { legacyClient } from '@/api/legacyClient';
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

function readSnapshotIdFromAccess(row) {
  const details = parseObjectValue(row?.details);
  const data = parseObjectValue(row?.data);
  return String(
    row?.snapshot_id ||
    row?.snapshotId ||
    details?.snapshotId ||
    details?.snapshot_id ||
    data?.snapshotId ||
    data?.snapshot_id ||
    ''
  ).trim();
}

function readSnapshotTokenFromAccess(row) {
  const details = parseObjectValue(row?.details);
  const data = parseObjectValue(row?.data);
  const raw = row?.token || details?.token || data?.token || null;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function readSnapshotSourceProposalId(snapshot, accessRow) {
  const snapshotData = parseObjectValue(snapshot?.snapshotData || snapshot?.snapshot_data || snapshot?.data?.snapshotData || snapshot?.data?.snapshot_data);
  const snapshotMeta = parseObjectValue(snapshot?.snapshotMeta || snapshot?.snapshot_meta || snapshot?.data?.snapshotMeta || snapshot?.data?.snapshot_meta);
  const proposalMeta = parseObjectValue(snapshotData?.proposal);
  const accessDetails = parseObjectValue(accessRow?.details);
  const accessData = parseObjectValue(accessRow?.data);
  return String(
    snapshot?.sourceProposalId ||
    snapshot?.source_proposal_id ||
    snapshotMeta?.sourceProposalId ||
    snapshotMeta?.source_proposal_id ||
    proposalMeta?.sourceProposalId ||
    accessRow?.sourceProposalId ||
    accessRow?.source_proposal_id ||
    accessDetails?.sourceProposalId ||
    accessData?.sourceProposalId ||
    ''
  ).trim();
}

function readSnapshotVersion(snapshot, accessRow) {
  const snapshotMeta = parseObjectValue(snapshot?.snapshotMeta || snapshot?.snapshot_meta || snapshot?.data?.snapshotMeta || snapshot?.data?.snapshot_meta);
  const raw = Number(
    snapshot?.version ??
    snapshot?.snapshot_version ??
    snapshot?.snapshotVersion ??
    snapshotMeta?.version ??
    accessRow?.version ??
    accessRow?.snapshot_version ??
    0
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
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
      legacyClient.entities.ShareLink
        .filter({ proposal_id: normalizedProposalId, recipient_email: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      legacyClient.entities.ShareLink
        .filter({ proposalId: normalizedProposalId, recipientEmail: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      legacyClient.entities.ShareLink
        .filter({ proposal_id: normalizedProposalId, recipientEmail: recipientEmail }, '-created_date', 10)
        .catch(() => []),
      legacyClient.entities.ShareLink
        .filter({ proposalId: normalizedProposalId, recipient_email: recipientEmail }, '-created_date', 10)
        .catch(() => [])
    ]);

    const activeRows = buckets
      .flat()
      .filter((row) => {
        const status = String(row?.status || '').trim().toLowerCase();
        if (status && status !== 'active') return false;

        const expiresAt = row?.expires_at || row?.expiresAt || row?.data?.expires_at || row?.data?.expiresAt;
        if (expiresAt) {
          const expiry = new Date(expiresAt).getTime();
          if (Number.isFinite(expiry) && expiry < Date.now()) return false;
        }
        return true;
      });
    activeRows.sort((a, b) => {
      const versionA = Number(a?.snapshot_version ?? a?.snapshotVersion ?? a?.version ?? a?.data?.snapshot_version ?? 0);
      const versionB = Number(b?.snapshot_version ?? b?.snapshotVersion ?? b?.version ?? b?.data?.snapshot_version ?? 0);
      if (Number.isFinite(versionA) && Number.isFinite(versionB) && versionA !== versionB) {
        return versionB - versionA;
      }
      return new Date(b?.created_date || 0).getTime() - new Date(a?.created_date || 0).getTime();
    });
    const activeRow = activeRows[0];

    const token = activeRow?.token || activeRow?.data?.token || null;
    if (!token) {
      return { ok: false, message: NO_SHARED_WORKSPACE_LINK_MESSAGE };
    }

    const snapshotId = activeRow?.snapshot_id || activeRow?.snapshotId || activeRow?.data?.snapshot_id || activeRow?.data?.snapshotId || null;
    const versionRaw = Number(activeRow?.snapshot_version ?? activeRow?.snapshotVersion ?? activeRow?.version ?? activeRow?.data?.snapshot_version ?? 0);
    return {
      ok: true,
      token: String(token),
      snapshotId: snapshotId ? String(snapshotId) : null,
      version: Number.isFinite(versionRaw) && versionRaw > 0 ? Math.floor(versionRaw) : null
    };
  };

  try {
    const result = await legacyClient.functions.invoke('GetActiveShareLinkForRecipient', {
      proposalId: normalizedProposalId
    });
    const data = result?.data;
    if (data?.ok && data?.token) {
      return {
        ok: true,
        token: data.token,
        snapshotId: data.snapshotId || null,
        version: Number.isFinite(Number(data.version)) ? Number(data.version) : null
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
      const sent = await legacyClient.entities.Proposal.filter({ party_a_email: user?.email }, '-created_date').catch(() => []);
      const received = await legacyClient.entities.Proposal.filter({ party_b_email: user?.email }, '-created_date').catch(() => []);

      const snapshotAccessRows = user?.id
        ? (
            await Promise.all([
              legacyClient.entities.SnapshotAccess.filter({ user_id: user.id }, '-created_date', 300).catch(() => []),
              legacyClient.entities.SnapshotAccess.filter({ userId: user.id }, '-created_date', 300).catch(() => [])
            ])
          ).flat()
        : [];
      const snapshotAccessMap = new Map();
      snapshotAccessRows.forEach((row) => {
        const snapshotId = readSnapshotIdFromAccess(row);
        if (!snapshotId) return;
        const nextTime = new Date(row?.lastOpenedAt || row?.last_opened_at || row?.created_date || 0).getTime();
        const existing = snapshotAccessMap.get(snapshotId);
        const existingTime = existing
          ? new Date(existing?.lastOpenedAt || existing?.last_opened_at || existing?.created_date || 0).getTime()
          : 0;
        if (!existing || nextTime >= existingTime) {
          snapshotAccessMap.set(snapshotId, row);
        }
      });

      const snapshotIds = Array.from(snapshotAccessMap.keys());
      const snapshotRows = (
        await Promise.all(
          snapshotIds.map((snapshotId) =>
            legacyClient.entities.ProposalSnapshot.filter({ id: snapshotId }, '-created_date', 1).catch(() => [])
          )
        )
      ).flat();
      const snapshotById = new Map(
        snapshotRows
          .map((row) => [String(row?.id || '').trim(), row])
          .filter(([id]) => Boolean(id))
      );

      const snapshotReceived = snapshotIds.map((snapshotId) => {
        const accessRow = snapshotAccessMap.get(snapshotId);
        const snapshot = snapshotById.get(snapshotId) || null;
        const snapshotData = parseObjectValue(snapshot?.snapshotData || snapshot?.snapshot_data || snapshot?.data?.snapshotData || snapshot?.data?.snapshot_data);
        const snapshotMeta = parseObjectValue(snapshot?.snapshotMeta || snapshot?.snapshot_meta || snapshot?.data?.snapshotMeta || snapshot?.data?.snapshot_meta);
        const snapshotProposal = parseObjectValue(snapshotData?.proposal);

        const sourceProposalId = readSnapshotSourceProposalId(snapshot, accessRow) || String(accessRow?.sourceProposalId || accessRow?.source_proposal_id || '').trim();
        const version = readSnapshotVersion(snapshot, accessRow);
        const lastOpenedAt = accessRow?.lastOpenedAt || accessRow?.last_opened_at || accessRow?.created_date || null;
        const createdAt = snapshot?.createdAt || snapshot?.created_at || snapshot?.created_date || lastOpenedAt || new Date().toISOString();
        const token = readSnapshotTokenFromAccess(accessRow);

        return {
          id: `snapshot_${snapshotId}`,
          sourceProposalId: sourceProposalId || null,
          snapshotId,
          snapshotVersion: version,
          title: snapshotMeta?.title || snapshotProposal?.title || 'Shared Proposal Snapshot',
          template_name: snapshotMeta?.templateName || snapshotProposal?.templateName || 'Shared Snapshot',
          party_a_email: snapshotMeta?.senderEmail || 'Shared sender',
          party_b_email: user?.email || 'Recipient',
          created_date: lastOpenedAt || createdAt,
          snapshot_created_at: createdAt,
          status: 'received',
          _fromSnapshotAccess: true,
          _sharedToken: token,
          _lastOpenedAt: lastOpenedAt
        };
      });

      const sharedContextEntries = readSharedContextEntries(user?.email);
      const contextFallbackRows = sharedContextEntries
        .filter((entry) => String(entry?.snapshotId || '').trim().length === 0)
        .map((entry) => ({
          id: `context_${entry?.proposalId || entry?.proposal_id || Math.random().toString(36).slice(2, 7)}`,
          sourceProposalId: entry?.proposalId || entry?.proposal_id || null,
          title: entry?.proposalTitle || entry?.title || 'Shared Proposal',
          template_name: entry?.templateName || 'Shared Workspace',
          party_a_email: entry?.partyAEmail || entry?.senderEmail || 'Shared sender',
          party_b_email: user?.email || 'Recipient',
          created_date: entry?.loadedAt || new Date().toISOString(),
          status: 'received',
          _fromSharedContext: true,
          _sharedToken: entry?.token || null
        }));

      return { sent, received: dedupeById([...received, ...snapshotReceived, ...contextFallbackRows]) };
    },
    enabled: !!user?.email
  });

  const { data: documentComparisons = [], isLoading: loadingComparisons } = useQuery({
    queryKey: ['documentComparisons'],
    queryFn: async () => {
      if (!user) return [];
      return await legacyClient.entities.DocumentComparison.filter({ 
        created_by_user_id: user.id 
      }, '-updated_date');
    },
    enabled: !!user,
  });

  const { data: sendBackMeta = { countsByProposal: {}, latestByProposal: {} } } = useQuery({
    queryKey: ['proposals', 'sendBackMeta', user?.email],
    queryFn: async () => {
      if (!user?.email) {
        return { countsByProposal: {}, latestByProposal: {} };
      }

      const currentUserEmail = normalizeEmail(user.email);
      const rows = await legacyClient.entities.ProposalResponse
        .filter({ claim_type: 'recipient_counterproposal' }, '-created_date', 250)
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

  const receivedProposals = dedupedReceived
    .filter((proposal) => {
      const status = String(proposal?.status || '').trim().toLowerCase();
      if (status === 'draft') return false;
      if (proposal?._fromSharedContext || proposal?._fromSnapshotAccess) return true;
      return !isProposalOwner(proposal, user);
    })
    .map((proposal) => ({
      ...proposal,
      _listType: 'received'
    }));

  const receivedIdSet = new Set(
    receivedProposals
      .map((proposal) => String(proposal?.id || '').trim())
      .filter(Boolean)
  );

  const ownerSentProposals = dedupedSent
    .filter((proposal) => {
      const proposalId = String(proposal?.id || '').trim();
      const status = String(proposal?.status || '').trim().toLowerCase();
      if (!proposalId || status === 'draft') return false;
      if (!isProposalOwner(proposal, user)) return false;
      if (receivedIdSet.has(proposalId)) return false;
      return true;
    })
    .map((proposal) => ({
      ...proposal,
      _listType: 'sent'
    }));

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

  const draftProposals = dedupedSent.filter((proposal) => {
    const proposalId = String(proposal?.id || '').trim();
    const status = String(proposal?.status || '').trim().toLowerCase();
    if (!proposalId || status !== 'draft') return false;
    if (!isProposalOwner(proposal, user)) return false;
    if (receivedIdSet.has(proposalId)) return false;
    return true;
  }).map((proposal) => ({
    ...proposal,
    _listType: 'draft'
  }));

  const allProposals = [...sentProposals, ...receivedProposals, ...draftProposals].sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );

  const getFilteredProposals = () => {
    let proposals = activeTab === 'sent' ? sentProposals : 
                   activeTab === 'received' ? receivedProposals :
                   activeTab === 'drafts' ? draftProposals :
                   allProposals;

    if (statusFilter !== 'all') {
      proposals = proposals.filter((proposal) => {
        const listType = proposal?._listType || (isProposalOwner(proposal, user) ? 'sent' : 'received');
        const directionalStatus = listType === 'draft'
          ? 'draft'
          : (listType === 'received' ? 'received' : 'sent');
        const rawStatus = String(proposal?.status || '').trim().toLowerCase();
        return rawStatus === statusFilter || directionalStatus === statusFilter;
      });
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
      const responses = await legacyClient.entities.ProposalResponse.filter({ proposal_id: proposalId });
      const reports = await legacyClient.entities.EvaluationReport.filter({ proposal_id: proposalId });
      const attachments = await legacyClient.entities.Attachment.filter({ proposal_id: proposalId });
      
      await Promise.all([
        ...responses.map(r => legacyClient.entities.ProposalResponse.delete(r.id)),
        ...reports.map(r => legacyClient.entities.EvaluationReport.delete(r.id)),
        ...attachments.map(a => legacyClient.entities.Attachment.delete(a.id))
      ]);
      
      await legacyClient.entities.Proposal.delete(proposalId);
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
    const listType = proposal?._listType || (isProposalOwner(proposal, user) ? 'sent' : 'received');
    const isSent = listType === 'sent' || listType === 'sent_reviewed';
    const isRecipientWorkspaceItem = listType === 'received' || listType === 'sent_reviewed';
    const isDraft = listType === 'draft';
    const directionalStatus = isDraft ? 'draft' : (isRecipientWorkspaceItem ? 'received' : 'sent');
    const rawStatus = String(proposal?.status || '').trim().toLowerCase();
    const showRawStatus =
      Boolean(rawStatus) &&
      rawStatus !== directionalStatus &&
      !['sent', 'received', 'draft'].includes(rawStatus);
    const sourceProposalId = proposal?.sourceProposalId || proposal?.id;
    
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

      if (isRecipientWorkspaceItem) {
        if (proposal?._sharedToken) {
          navigate(
            createPageUrl(
              `SharedReport?token=${encodeURIComponent(proposal._sharedToken)}&mode=workspace`
            )
          );
          return;
        }

        const shareLink = await getActiveShareLinkForRecipient(sourceProposalId);
        if (shareLink.ok) {
          navigate(
            createPageUrl(
              `SharedReport?token=${encodeURIComponent(shareLink.token)}&mode=workspace`
            )
          );
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
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span>{proposal.template_name}</span>
              <span>•</span>
              <span>
                {proposal?._isReviewedVersion
                  ? `To: ${proposal.party_a_email || 'Original proposer'}`
                  : (isSent ? `To: ${proposal.party_b_email || 'Not specified'}` : `From: ${proposal.party_a_email}`)}
              </span>
              {proposal?.snapshotVersion && (
                <>
                  <span>•</span>
                  <span>Version {proposal.snapshotVersion}</span>
                </>
              )}
              {proposal?._lastOpenedAt && (
                <>
                  <span>•</span>
                  <span>Opened {new Date(proposal._lastOpenedAt).toLocaleDateString()}</span>
                </>
              )}
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
              Drafts ({draftProposals.length})
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
