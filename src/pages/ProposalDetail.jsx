import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import {
  applyUpdatedProposalToCaches,
  invalidateProposalThreadQueries,
  removeProposalFromCaches,
} from '@/lib/proposalThreadCache';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  History,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ComparisonAiReportTab } from '@/components/document-comparison/ComparisonDetailTabs';
import RequestAgreementConfirmDialog from '@/components/proposal/RequestAgreementConfirmDialog';
import {
  getRunAiMediationLabel,
  MEDIATION_REVIEW_LABEL,
} from '@/lib/aiReportUtils';
import { buildDocumentComparisonReportHref } from '@/lib/notificationTargets';
import {
  AGREED_LABEL,
  getAgreementActionLabel,
  getVisibleProposalStatusLabel,
  shouldConfirmRequestAgreement,
} from '@/lib/proposalOutcomeUi';
import { getStarterLimitErrorCopy } from '@/lib/starterLimitErrorCopy';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

function useProposalId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function renderDocumentReadOnly({ text, html }) {
  const safeText = String(text || '').trim();
  const safeHtml = asText(html);

  if (!safeText && !safeHtml) {
    return <p className="text-sm text-slate-500 italic">No text available.</p>;
  }

  if (safeHtml) {
    return (
      <div
        className="text-sm text-slate-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return <div className="whitespace-pre-wrap text-sm text-slate-800">{safeText}</div>;
}

function normalizeSharedHistoryEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      id: String(entry?.id || ''),
      label: asText(entry?.visibility_label) || asText(entry?.label) || 'Shared Information',
      authorLabel: asText(entry?.author_label) || 'Unknown',
      roundNumber: Number(entry?.round_number || 0) || null,
      text: asText(entry?.text),
      html: asText(entry?.html),
      source: asText(entry?.source) || 'typed',
    }))
    .filter((entry) => entry.label || entry.text || entry.html);
}

function buildSharedHistoryText(entries) {
  const normalizedEntries = normalizeSharedHistoryEntries(entries);
  return normalizedEntries
    .map((entry) => {
      const roundLabel = entry.roundNumber ? `Round ${entry.roundNumber} - ` : '';
      const content = entry.text || '';
      return `${roundLabel}${entry.label}\n\n${content}`;
    })
    .join('\n\n---\n\n')
    .trim();
}

function getStatusLabel(status) {
  const normalized = String(status || 'draft').toLowerCase();
  if (normalized === 'needs_reply') return 'Needs Reply';
  if (normalized === 'under_review') return 'Under Review';
  if (normalized === 'waiting_on_counterparty') return 'Waiting on Counterparty';
  if (normalized === 'closed_won') return 'Closed: Won';
  if (normalized === 'closed_lost') return 'Closed: Lost';
  const visibleStatusLabel = getVisibleProposalStatusLabel(normalized);
  if (visibleStatusLabel) {
    return visibleStatusLabel;
  }
  switch (normalized) {
    case 'under_verification':
      return 'Under Verification';
    case 're_evaluated':
      return 'Re-evaluated';
    case 'mutual_interest':
      return 'Mutual Interest';
    default:
      return normalized
        .split('_')
        .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
        .join(' ');
  }
}

function getStatusClass(status) {
  const normalized = String(status || 'draft').toLowerCase();
  if (normalized === 'draft') return 'bg-slate-100 text-slate-700';
  if (normalized === 'needs_reply') return 'bg-rose-100 text-rose-700';
  if (normalized === 'under_review') return 'bg-violet-100 text-violet-700';
  if (normalized === 'waiting_on_counterparty') return 'bg-slate-100 text-slate-700';
  if (normalized === 'closed_won') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'closed_lost') return 'bg-rose-100 text-rose-700';
  if (normalized === 'sent') return 'bg-blue-100 text-blue-700';
  if (normalized === 'received') return 'bg-amber-100 text-amber-700';
  if (normalized === 'under_verification' || normalized === 're_evaluated') {
    return 'bg-indigo-100 text-indigo-700';
  }
  if (normalized === 'won') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'lost') return 'bg-rose-100 text-rose-700';
  if (normalized === 'mutual_interest' || normalized === 'revealed') return 'bg-green-100 text-green-700';
  if (normalized === 'closed') return 'bg-slate-100 text-slate-600';
  if (normalized === 'withdrawn') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
}

function formatHistoryLabel(value) {
  return asText(value)
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
}

function normalizeComparisonPreview(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    partyALabel: value.partyALabel || value.party_a_label || null,
    partyBLabel: value.partyBLabel || value.party_b_label || null,
    docAText: value.docAText || value.doc_a_text || '',
    docAHtml: value.docAHtml || value.doc_a_html || '',
    docASource: value.docASource || value.doc_a_source || null,
    docBText: value.docBText || value.doc_b_text || '',
    docBHtml: value.docBHtml || value.doc_b_html || '',
    docBSource: value.docBSource || value.doc_b_source || null,
  };
}

function renderPayloadReadOnly(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0) {
    return null;
  }

  return (
    <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700 overflow-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function OutcomeActionButton({ tooltip, children, ...buttonProps }) {
  const button = <Button {...buttonProps}>{children}</Button>;
  if (!tooltip || !buttonProps.disabled) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function triggerJsonDownload(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function downloadProposalInfoPdf(proposal, comparison, sharedHistoryEntries = []) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 40;
  const right = 40;
  const maxWidth = pageWidth - left - right;
  const lineHeight = 16;
  let y = 44;

  const writeLine = (text, options = {}) => {
    const value = String(text || '');
    const fontSize = Number(options.fontSize || 11);
    const style = options.bold ? 'bold' : 'normal';
    pdf.setFont('helvetica', style);
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(value, maxWidth);

    lines.forEach((line) => {
      if (y > pageHeight - 50) {
        pdf.addPage();
        y = 44;
      }
      pdf.text(line, left, y);
      y += lineHeight;
    });
  };

  writeLine(proposal?.title || 'Opportunity', { fontSize: 20, bold: true });
  y += 6;
  writeLine(`Status: ${getStatusLabel(proposal?.status)}`);
  writeLine(`Created: ${formatDateTime(proposal?.created_date)}`);
  writeLine(`Updated: ${formatDateTime(proposal?.updated_date)}`);
  writeLine(`Party A: ${proposal?.is_private_mode && !proposal?.party_a_email ? 'Private sender' : (proposal?.party_a_email || 'Not specified')}`);
  writeLine(`Party B: ${[proposal?.party_b_name, proposal?.party_b_email].filter(Boolean).join(' · ') || 'Not specified'}`);
  y += 8;

  if (comparison) {
    const sharedHistoryText = buildSharedHistoryText(sharedHistoryEntries);
    writeLine(CONFIDENTIAL_LABEL, { bold: true });
    writeLine(comparison.doc_a_text || '');
    y += 8;
    writeLine(SHARED_LABEL, { bold: true });
    writeLine(sharedHistoryText || comparison.doc_b_text || '');
  } else {
    writeLine('No linked document comparison content was found for this opportunity.');
  }

  const filenameBase = String(proposal?.title || 'proposal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'proposal';
  pdf.save(`${filenameBase}-info.pdf`);
}

export default function ProposalDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const proposalId = useProposalId();
  const [activeTab, setActiveTab] = useState('proposal');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [requestAgreementDialogOpen, setRequestAgreementDialogOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['proposal-detail', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getDetail(proposalId),
  });

  const proposal = detailQuery.data?.proposal || null;
  const evaluations = detailQuery.data?.evaluations || [];
  const detailVersions = detailQuery.data?.versions || [];
  const shouldRedirectToCanonicalComparison =
    asLower(proposal?.proposal_type) === 'document_comparison' &&
    Boolean(asText(proposal?.document_comparison_id));

  useEffect(() => {
    if (!shouldRedirectToCanonicalComparison) {
      return;
    }

    navigate(buildDocumentComparisonReportHref(proposal.document_comparison_id), { replace: true });
  }, [navigate, proposal?.document_comparison_id, shouldRedirectToCanonicalComparison]);

  const comparisonQuery = useQuery({
    queryKey: ['proposal-linked-comparison', proposal?.document_comparison_id || 'none'],
    enabled: Boolean(proposal?.document_comparison_id),
    queryFn: () => documentComparisonsClient.getById(proposal.document_comparison_id),
  });

  const comparison = comparisonQuery.data?.comparison || null;
  const sharedHistoryEntries = useMemo(
    () => normalizeSharedHistoryEntries(comparisonQuery.data?.sharedHistory?.entries),
    [comparisonQuery.data?.sharedHistory?.entries],
  );
  const liveSharedText = useMemo(
    () => buildSharedHistoryText(sharedHistoryEntries) || String(comparison?.doc_b_text || ''),
    [comparison?.doc_b_text, sharedHistoryEntries],
  );
  const versionHistory = useMemo(() => {
    if (detailVersions.length > 0) {
      return detailVersions;
    }
    if (!proposal) {
      return [];
    }

    const actorRole = asLower(proposal.last_thread_actor_role);
    const actorLabel =
      actorRole === 'party_a'
        ? 'Proposer'
        : actorRole === 'party_b'
          ? 'Counterparty'
          : 'System';
    const actorEmail =
      actorRole === 'party_b'
        ? proposal.party_b_email || null
        : actorRole === 'party_a'
          ? proposal.party_a_email || null
          : null;

    return [
      {
        id: `live-${proposal.id}`,
        version_number: 1,
        is_latest_version: true,
        read_only: false,
        actor_role: actorRole || null,
        actor_label: actorLabel,
        actor_email: actorEmail,
        milestone: proposal.last_thread_activity_type || 'live',
        milestone_label: 'Current Live Version',
        event_type: proposal.last_thread_activity_type || null,
        status: proposal.status || 'draft',
        created_date: proposal.last_thread_activity_at || proposal.updated_date || proposal.created_date,
        has_document_snapshot: Boolean(comparison),
        snapshot_proposal: proposal,
        snapshot_document_comparison: comparison
          ? {
              party_a_label: comparison.partyALabel || comparison.party_a_label || null,
              party_b_label: comparison.partyBLabel || comparison.party_b_label || null,
              doc_a_text: comparison.docAText || comparison.doc_a_text || '',
              doc_a_html: comparison.docAHtml || comparison.doc_a_html || '',
              doc_a_source: comparison.docASource || comparison.doc_a_source || null,
              doc_b_text: comparison.docBText || comparison.doc_b_text || '',
              doc_b_html: comparison.docBHtml || comparison.doc_b_html || '',
              doc_b_source: comparison.docBSource || comparison.doc_b_source || null,
            }
          : null,
      },
    ];
  }, [comparison, detailVersions, proposal]);
  const selectedVersion = useMemo(
    () =>
      versionHistory.find((entry) => String(entry?.id || '') === String(selectedVersionId || '')) ||
      versionHistory[0] ||
      null,
    [selectedVersionId, versionHistory],
  );
  const selectedVersionProposal = selectedVersion?.snapshot_proposal || proposal;
  const selectedVersionComparison = normalizeComparisonPreview(
    selectedVersion?.snapshot_document_comparison || (selectedVersion?.is_latest_version ? comparison : null),
  );
  const viewingHistoricalVersion = activeTab === 'history' && Boolean(selectedVersion?.read_only);

  useEffect(() => {
    if (versionHistory.length === 0) {
      if (selectedVersionId) {
        setSelectedVersionId('');
      }
      return;
    }

    const hasSelectedVersion = versionHistory.some(
      (entry) => String(entry?.id || '') === String(selectedVersionId || ''),
    );
    if (!hasSelectedVersion) {
      setSelectedVersionId(String(versionHistory[0].id || ''));
    }
  }, [selectedVersionId, versionHistory]);
  const confidentialLength = String(comparison?.doc_a_text || '').length;
  const sharedLength = String(liveSharedText || '').length;
  const confidentialWordCount = String(comparison?.doc_a_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const sharedWordCount = String(liveSharedText || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const latestEvaluation = evaluations[0] || null;
  const latestResult = latestEvaluation?.result || {};
  // Primary source: comparison.public_report — this is exactly what SharedReport's
  // buildLatestReport() reads, so the proposer and recipient always see the same
  // stored object rendered through the same ComparisonAiReportTab component.
  // Fallback to proposalEvaluations.result.report for proposals without a linked
  // comparison (legacy / standard proposals).
  const comparisonPublicReport =
    comparison?.public_report &&
    typeof comparison.public_report === 'object' &&
    !Array.isArray(comparison.public_report) &&
    Object.keys(comparison.public_report).length > 0
      ? comparison.public_report
      : null;
  const latestResultReport =
    latestResult?.report &&
    typeof latestResult.report === 'object' &&
    !Array.isArray(latestResult.report) &&
    Object.keys(latestResult.report).length > 0
      ? latestResult.report
      : null;
  const latestReportData = comparisonPublicReport || latestResultReport || latestResult;
  const suggestedAdditionsCount =
    Array.isArray(latestReportData?.missing) ? latestReportData.missing.length
    : Array.isArray(latestResult?.report?.missing) ? latestResult.report.missing.length
    : 0;

  const runEvaluationMutation = useMutation({
    mutationFn: () => {
      // When a document comparison is linked, run evaluation via the comparison
      // pipeline (vertex-evaluation-v2 full path).  This stores publicReport in
      // the exact same format that SharedReport reads — ensuring the mediation review
      // renders identically for proposer and recipient.
      if (proposal?.document_comparison_id) {
        return documentComparisonsClient.evaluate(proposal.document_comparison_id, {});
      }
      return proposalsClient.evaluate(proposalId, {});
    },
    onSuccess: async () => {
      await invalidateProposalThreadQueries(queryClient, {
        proposalId,
        documentComparisonId: proposal?.document_comparison_id || null,
      });
      toast.success('AI mediation review ready');
    },
    onError: (error) => {
      toast.error(
        getStarterLimitErrorCopy(error, 'evaluation') ||
          error?.message ||
          'AI mediation could not be completed',
      );
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      const recipient = asText(proposal?.party_b_email);
      const payload = await sharedLinksClient.create({
        proposalId,
        recipientEmail: recipient || null,
        maxUses: 50,
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: true,
        canSendBack: true,
      });

      if (!payload?.url) {
        throw new Error('Share link could not be created');
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.url).catch(() => null);
      }
      return payload;
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      toast.success('Share link generated and copied');
      window.alert(`Shared link:\n\n${payload.url}`);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to generate share link');
    },
  });

  const downloadProposalMutation = useMutation({
    mutationFn: () => downloadProposalInfoPdf(proposal, comparison, sharedHistoryEntries),
    onSuccess: () => {
      toast.success('Opportunity info PDF downloaded');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download opportunity info PDF');
    },
  });

  const downloadAiMediationReviewPdfMutation = useMutation({
    mutationFn: async () => {
      if (!proposal?.document_comparison_id) {
        const notConfigured = new Error('AI mediation review PDF is not configured');
        notConfigured.code = 'not_configured';
        notConfigured.status = 501;
        throw notConfigured;
      }
      return documentComparisonsClient.downloadPdf(proposal.document_comparison_id, { format: 'web-parity' });
    },
    onSuccess: () => {
      toast.success('AI mediation review PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'AI mediation review PDF is not configured');
    },
  });

  const markOutcomeMutation = useMutation({
    mutationFn: (status) => proposalsClient.markOutcome(proposalId, status),
    onSuccess: async (updatedProposal) => {
      applyUpdatedProposalToCaches(queryClient, updatedProposal);
      const outcomeState = String(updatedProposal?.outcome?.state || updatedProposal?.status || '').toLowerCase();
      if (outcomeState === 'pending_won') {
        toast.success('Agreement Requested');
      } else if (String(updatedProposal?.status || '').toLowerCase() === 'won') {
        toast.success('Marked as Agreed');
      } else {
        toast.success('Marked as Lost');
      }
      await invalidateProposalThreadQueries(queryClient, {
        proposalId,
        documentComparisonId: updatedProposal?.document_comparison_id || proposal?.document_comparison_id || null,
      });
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update outcome');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => proposalsClient.archive(proposalId),
    onSuccess: async (updatedProposal) => {
      applyUpdatedProposalToCaches(queryClient, updatedProposal);
      toast.success('Archived');
      await invalidateProposalThreadQueries(queryClient, {
        proposalId,
        documentComparisonId: updatedProposal?.document_comparison_id || proposal?.document_comparison_id || null,
      });
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to archive opportunity');
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => proposalsClient.unarchive(proposalId),
    onSuccess: async (updatedProposal) => {
      applyUpdatedProposalToCaches(queryClient, updatedProposal);
      toast.success('Restored');
      await invalidateProposalThreadQueries(queryClient, {
        proposalId,
        documentComparisonId: updatedProposal?.document_comparison_id || proposal?.document_comparison_id || null,
      });
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to restore opportunity');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => proposalsClient.remove(proposalId),
    onSuccess: async () => {
      removeProposalFromCaches(queryClient, proposalId);
      toast.success(proposal?.sent_at ? 'Deleted from your workspace' : 'Draft deleted');
      await invalidateProposalThreadQueries(queryClient, {
        proposalId,
        documentComparisonId: proposal?.document_comparison_id || null,
      });
      navigate(createPageUrl('Opportunities'));
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to delete opportunity');
    },
  });

  if (shouldRedirectToCanonicalComparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-6">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              Opening the canonical AI Mediation Review experience for this live opportunity.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!proposalId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900">Missing opportunity id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6 text-slate-500">Loading opportunity...</div>
      </div>
    );
  }

  if (detailQuery.error || !proposal) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-900">
              {detailQuery.error?.message || 'Opportunity not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const outcome = proposal.outcome || {};
  const outcomeState = asLower(outcome.state || proposal.status);
  const isWon = outcomeState === 'won';
  const isLost = outcomeState === 'lost';
  const isClosed = isWon || isLost;
  const canArchive = Boolean(outcome.actor_role);
  const outcomeActionDisabled = markOutcomeMutation.isPending;
  const archiveActionDisabled =
    archiveMutation.isPending || unarchiveMutation.isPending || deleteMutation.isPending;
  const deleteDialogTitle = proposal.sent_at ? 'Delete Opportunity From Your Workspace?' : 'Delete Draft Opportunity?';
  const deleteDialogDescription = proposal.sent_at
    ? 'This will hide the opportunity from your workspace only. It will remain available to the counterparty and stay intact for shared history.'
    : 'This will permanently delete this unsent draft and any linked draft-only comparison data. This action cannot be undone.';
  const pendingOutcomeMessage = outcome.requested_by_counterparty
    ? 'The counterparty requested agreement on this proposal. Confirm the agreement or mark it lost.'
    : outcome.requested_by_current_user
      ? `You requested agreement on this proposal. It becomes ${AGREED_LABEL.toLowerCase()} only after the counterparty confirms the agreement.`
      : '';
  const primaryStatusKey = asLower(proposal.primary_status_key || proposal.status);
  const primaryStatusLabel = asText(proposal.primary_status_label) || getStatusLabel(primaryStatusKey);

  // Derive party display strings
  const proposerDisplay = proposal.is_private_mode && !proposal.party_a_email
    ? 'Private sender'
    : asText(proposal.party_a_email) || 'Not specified';
  const recipientParts = [proposal.party_b_name, proposal.party_b_email].filter(Boolean);
  const recipientDisplay = recipientParts.length > 0 ? recipientParts.join(' · ') : 'Not specified';
  const handleAgreementAction = () => {
    if (shouldConfirmRequestAgreement(outcome)) {
      setRequestAgreementDialogOpen(true);
      return;
    }

    markOutcomeMutation.mutate('won');
  };
  const handleRequestAgreementConfirm = () => {
    setRequestAgreementDialogOpen(false);
    markOutcomeMutation.mutate('won');
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <RequestAgreementConfirmDialog
        open={requestAgreementDialogOpen}
        onOpenChange={setRequestAgreementDialogOpen}
        onConfirm={handleRequestAgreementConfirm}
        isPending={markOutcomeMutation.isPending}
      />
      <div className="max-w-[1400px] mx-auto px-6 space-y-4">
        <Link to={createPageUrl('Opportunities')} className="inline-flex items-center text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Opportunities
        </Link>

        {/* ── Title + party metadata ───────────────────────────────────── */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 leading-tight break-words">{proposal.title}</h1>
          <p className="mt-1.5 text-sm text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="font-medium text-slate-600">Proposer:</span>{' '}
              {proposerDisplay}
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500 font-medium">You</span>
            </span>
            <span className="text-slate-300" aria-hidden>·</span>
            <span>
              <span className="font-medium text-slate-600">Recipient:</span>{' '}
              {recipientDisplay}
            </span>
            <span className="text-slate-300" aria-hidden>·</span>
            <Badge className={`${getStatusClass(primaryStatusKey)} text-xs`}>{primaryStatusLabel}</Badge>
          </p>
        </div>

        {/* ── Primary action row ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary actions */}
          <Button
            onClick={() => {
              if (proposal.proposal_type === 'document_comparison' && proposal.document_comparison_id) {
                navigate(
                  createPageUrl(
                    `DocumentComparisonCreate?draft=${encodeURIComponent(proposal.document_comparison_id)}&proposalId=${encodeURIComponent(proposal.id)}&step=2`,
                  ),
                );
                return;
              }
              navigate(createPageUrl(`CreateOpportunity?draft=${encodeURIComponent(proposal.id)}&step=4`));
            }}
            disabled={isClosed || viewingHistoricalVersion}
          >
            <ArrowRight className="w-4 h-4 mr-2" />
            Edit Opportunity
          </Button>
          <Button
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending || isClosed || viewingHistoricalVersion}
          >
            <Send className="w-4 h-4 mr-2" />
            Share
          </Button>

          {/* Divider */}
          <div className="h-6 w-px bg-slate-200 mx-1" aria-hidden />

          {/* Secondary utility actions */}
          <Button variant="outline" onClick={() => downloadProposalMutation.mutate()} disabled={downloadProposalMutation.isPending}>
            <Download className="w-4 h-4 mr-2" />
            Opportunity PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadAiMediationReviewPdfMutation.mutate()}
            disabled={downloadAiMediationReviewPdfMutation.isPending}
          >
            <Download className="w-4 h-4 mr-2" />
            AI Mediation Review PDF
          </Button>

          {/* Archive / Delete — lower-emphasis, pushed right with margin */}
          <div className="flex items-center gap-2 ml-auto">
            {canArchive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (proposal.archived_at) {
                    unarchiveMutation.mutate();
                    return;
                  }
                  archiveMutation.mutate();
                }}
                disabled={archiveActionDisabled}
                className="text-slate-500 hover:text-slate-700"
              >
                {proposal.archived_at ? (
                  <ArchiveRestore className="w-4 h-4 mr-1.5" />
                ) : (
                  <Archive className="w-4 h-4 mr-1.5" />
                )}
                {proposal.archived_at ? 'Unarchive' : 'Archive'}
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" disabled={deleteMutation.isPending}>
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{deleteDialogTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{deleteDialogDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* ── Main content (full width) ────────────────────────────────── */}
        <div className="space-y-5">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-white border border-slate-200 p-1">
              <TabsTrigger value="proposal" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                <FileText className="w-4 h-4 mr-2" />
                Opportunity
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                <History className="w-4 h-4 mr-2" />
                Version History
                {versionHistory.length > 0 ? (
                  <Badge className="ml-2 bg-slate-100 text-slate-700 text-xs">{versionHistory.length}</Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="report" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                <BarChart3 className="w-4 h-4 mr-2" />
                {MEDIATION_REVIEW_LABEL}
                {evaluations.length > 0 && <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>}
              </TabsTrigger>
            </TabsList>


              <TabsContent value="report" className="mt-6 space-y-5">

                {/* Outcome row */}
                {pendingOutcomeMessage ? (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertDescription className="text-amber-900">{pendingOutcomeMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <TooltipProvider>
                  <div className="flex flex-wrap items-center gap-3">
                    {isClosed ? (
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold text-sm border ${isWon ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}`}>
                        {isWon ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {isWon ? AGREED_LABEL : 'Lost'}
                        {proposal.closed_at ? <span className="text-xs opacity-70 ml-1">· {formatDate(proposal.closed_at)}</span> : null}
                      </div>
                    ) : null}

                    {!isClosed ? (
                      <>
                        <OutcomeActionButton
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={
                            outcomeActionDisabled ||
                            !outcome.can_mark_won ||
                            Boolean(outcome.requested_by_current_user)
                          }
                          tooltip={
                            outcome.requested_by_current_user
                              ? 'Waiting for the counterparty to confirm the agreement.'
                              : outcome.eligibility_reason_won || outcome.eligibility_reason
                          }
                          onClick={handleAgreementAction}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                          {getAgreementActionLabel(outcome)}
                        </OutcomeActionButton>
                        <OutcomeActionButton
                          size="sm"
                          variant="outline"
                          className="text-rose-600 border-rose-200 hover:bg-rose-50"
                          disabled={outcomeActionDisabled || !outcome.can_mark_lost}
                          tooltip={outcome.eligibility_reason_lost || outcome.eligibility_reason}
                          onClick={() => markOutcomeMutation.mutate('lost')}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1.5" />
                          Mark as Lost
                        </OutcomeActionButton>
                      </>
                    ) : null}
                  </div>
                </TooltipProvider>

                {/* Shared AI mediation review — same ComparisonAiReportTab used by recipient Step 0 and Step 3.
                   Only the data changes; the layout is structurally identical across all roles.
                   latestReportData = comparison.public_report (primary) so proposer reads the
                   same stored object that SharedReport reads via buildLatestReport(). */}
                <ComparisonAiReportTab
                  isEvaluationRunning={runEvaluationMutation.isPending}
                  isPollingTimedOut={false}
                  isEvaluationNotConfigured={false}
                  showConfidentialityWarning={false}
                  confidentialityWarningMessage=""
                  confidentialityWarningDetails=""
                  isEvaluationFailed={false}
                  evaluationFailureBannerMessage=""
                  hasReport={Boolean(comparisonPublicReport) || evaluations.length > 0}
                  hasEvaluations={evaluations.length > 0}
                  noReportMessage="Run AI Mediation to generate the mediation review."
                  runDetailsHref={
                    proposal.document_comparison_id
                      ? createPageUrl(`DocumentComparisonRunDetails?id=${encodeURIComponent(proposal.document_comparison_id)}`)
                      : ''
                  }
                  report={latestReportData}
                  recommendation={asText(
                    comparisonPublicReport?.recommendation ||
                    latestResult?.recommendation ||
                    latestReportData?.recommendation,
                  )}
                  timelineItems={evaluations.map((ev, i) => ({
                    id: `eval-${ev.id || i}`,
                    kind: 'sparkles',
                    tone: 'success',
                    title: i === 0 ? 'Latest Mediation Review' : `Mediation Review ${evaluations.length - i}`,
                    timestamp: formatDateTime(ev.created_date || ''),
                  }))}
                />


                {/* Action buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button onClick={() => runEvaluationMutation.mutate()} disabled={runEvaluationMutation.isPending || isClosed}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {getRunAiMediationLabel({
                      isPending: runEvaluationMutation.isPending,
                      hasExisting: evaluations.length > 0,
                    })}
                  </Button>
                  {proposal.document_comparison_id && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate(
                          createPageUrl(
                            `DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`,
                          ),
                        )
                      }
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Open Comparison
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!latestResult || Object.keys(latestResult).length === 0) {
                        toast.error('No AI mediation review payload is available to download yet');
                        return;
                      }
                      triggerJsonDownload('proposal-ai-mediation-review.json', latestResult);
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download AI Mediation Review JSON
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="proposal" className="mt-6">
                <div className="space-y-8">
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-blue-900">
                      You are viewing the current live version of this opportunity thread. Older versions are available in
                      Version History as read-only snapshots.
                    </AlertDescription>
                  </Alert>

                  {comparison ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            {comparison?.party_a_label || CONFIDENTIAL_LABEL}
                          </h2>
                          <div className="flex gap-2">
                            <Badge variant="outline">{comparison?.doc_a_source || 'typed'}</Badge>
                            <Badge variant="outline">{confidentialWordCount} words</Badge>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[400px] overflow-auto">
                          {renderDocumentReadOnly({
                            text: comparison?.doc_a_text || '',
                            html: comparison?.doc_a_html || '',
                          })}
                        </div>
                      </div>

                      <div className="border-t border-slate-200" />

                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            {comparison?.party_b_label || SHARED_LABEL}
                          </h2>
                          <div className="flex gap-2">
                            <Badge variant="outline">{comparison?.doc_b_source || 'typed'}</Badge>
                            <Badge variant="outline">{sharedWordCount} words</Badge>
                          </div>
                        </div>
                        <div className="space-y-4">
                          {(sharedHistoryEntries.length > 0 ? sharedHistoryEntries : [
                            {
                              id: 'live-shared-fallback',
                              label: comparison?.party_b_label || SHARED_LABEL,
                              text: comparison?.doc_b_text || '',
                              html: comparison?.doc_b_html || '',
                              source: comparison?.doc_b_source || 'typed',
                              roundNumber: null,
                              authorLabel: 'Proposer',
                            },
                          ]).map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-xl border border-slate-200 bg-white p-4 max-h-[400px] overflow-auto"
                            >
                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                <Badge variant="outline">
                                  {entry.roundNumber ? `Round ${entry.roundNumber}` : 'Current'}
                                </Badge>
                                <Badge variant="outline">{entry.authorLabel}</Badge>
                                <Badge variant="outline">{entry.source || 'typed'}</Badge>
                              </div>
                              {renderDocumentReadOnly({
                                text: entry.text || '',
                                html: entry.html || '',
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <Alert className="bg-slate-50 border-slate-200">
                      <AlertDescription className="text-slate-700">
                        No linked document comparison data was found for this proposal.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="history" className="mt-6">
                <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                  <Card className="border border-slate-200 shadow-sm">
                    <CardContent className="pt-6 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Version History</p>
                        <p className="text-sm text-slate-500">
                          Latest first. Historical versions stay read-only.
                        </p>
                      </div>

                      {versionHistory.length === 0 ? (
                        <p className="text-sm text-slate-500">No version history is available yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {versionHistory.map((version) => {
                            const isSelected = String(version?.id || '') === String(selectedVersion?.id || '');
                            return (
                              <button
                                key={version.id}
                                type="button"
                                onClick={() => setSelectedVersionId(String(version.id || ''))}
                                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                                  isSelected
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">
                                      Version {version.version_number}
                                    </span>
                                    {version.is_latest_version ? (
                                      <Badge className="bg-emerald-100 text-emerald-700">Current</Badge>
                                    ) : (
                                      <Badge variant="outline">Read-only</Badge>
                                    )}
                                  </div>
                                  <span className={`text-xs ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                                    {formatDateTime(version.created_date)}
                                  </span>
                                </div>
                                <div className={`mt-2 space-y-1 text-sm ${isSelected ? 'text-slate-200' : 'text-slate-600'}`}>
                                  <p>{version.actor_label || 'System'}{version.actor_email ? ` · ${version.actor_email}` : ''}</p>
                                  <p>{version.milestone_label || formatHistoryLabel(version.milestone) || 'Snapshot'}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border border-slate-200 shadow-sm">
                    <CardContent className="pt-6 space-y-6">
                      {selectedVersion ? (
                        <>
                          <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-semibold text-slate-900">
                              Version {selectedVersion.version_number}
                            </h2>
                            <Badge className={getStatusClass(selectedVersion.status)}>
                              {getStatusLabel(selectedVersion.status)}
                            </Badge>
                            {selectedVersion.is_latest_version ? (
                              <Badge className="bg-emerald-100 text-emerald-700">Latest Version</Badge>
                            ) : (
                              <Badge variant="outline">Read-only snapshot</Badge>
                            )}
                          </div>

                          {selectedVersion.read_only ? (
                            <Alert className="bg-amber-50 border-amber-200">
                              <AlertDescription className="text-amber-900">
                                Historical versions are read-only. Switch back to the latest version to edit or share the live proposal.
                              </AlertDescription>
                            </Alert>
                          ) : null}

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actor</p>
                              <p className="mt-2 text-sm font-medium text-slate-900">
                                {selectedVersion.actor_label || 'System'}
                              </p>
                              {selectedVersion.actor_email ? (
                                <p className="text-sm text-slate-500">{selectedVersion.actor_email}</p>
                              ) : null}
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Captured</p>
                              <p className="mt-2 text-sm font-medium text-slate-900 inline-flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" />
                                {formatDateTime(selectedVersion.created_date)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Snapshot Event</p>
                              <p className="mt-2 text-sm font-medium text-slate-900">
                                {selectedVersion.milestone_label || formatHistoryLabel(selectedVersion.milestone) || 'Snapshot'}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-lg font-semibold text-slate-900">
                                {selectedVersionProposal?.title || proposal?.title || 'Proposal'}
                              </h3>
                              <Badge variant="outline">
                                {selectedVersionProposal?.template_name || 'Custom Template'}
                              </Badge>
                            </div>
                            {asText(selectedVersionProposal?.summary) ? (
                              <p className="text-sm text-slate-600">{selectedVersionProposal.summary}</p>
                            ) : null}
                          </div>

                          {selectedVersionComparison ? (
                            <div className="space-y-8">
                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                                    {selectedVersionComparison.partyALabel || CONFIDENTIAL_LABEL}
                                  </h3>
                                  <div className="flex gap-2">
                                    <Badge variant="outline">{selectedVersionComparison.docASource || 'typed'}</Badge>
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[320px] overflow-auto">
                                  {renderDocumentReadOnly({
                                    text: selectedVersionComparison.docAText || '',
                                    html: selectedVersionComparison.docAHtml || '',
                                  })}
                                </div>
                              </div>

                              <div className="border-t border-slate-200" />

                              <div>
                                <div className="flex items-center justify-between mb-3">
                                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                                    {selectedVersionComparison.partyBLabel || SHARED_LABEL}
                                  </h3>
                                  <div className="flex gap-2">
                                    <Badge variant="outline">{selectedVersionComparison.docBSource || 'typed'}</Badge>
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[320px] overflow-auto">
                                  {renderDocumentReadOnly({
                                    text: selectedVersionComparison.docBText || '',
                                    html: selectedVersionComparison.docBHtml || '',
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <Alert className="bg-slate-50 border-slate-200">
                              <AlertDescription className="text-slate-700">
                                This historical snapshot does not include a preserved document comparison export. Proposal metadata is still available below.
                              </AlertDescription>
                            </Alert>
                          )}

                          {renderPayloadReadOnly(selectedVersionProposal?.payload)}
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">Select a version to inspect its read-only snapshot.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

            </Tabs>
          </div>
      </div>
    </div>
  );
}
