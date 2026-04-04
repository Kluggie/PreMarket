import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import {
  applyUpdatedProposalToCaches,
  invalidateProposalThreadQueries,
} from '@/lib/proposalThreadCache';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ComparisonDetailTabs,
} from '@/components/document-comparison/ComparisonDetailTabs';
import RequestAgreementConfirmDialog from '@/components/proposal/RequestAgreementConfirmDialog';
import { getReviewStageLabel } from '@/lib/aiReportUtils';
import { resolveOpportunityReviewStage } from '@/lib/opportunityReviewStage';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  Plus,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AGREED_LABEL,
  CONTINUE_NEGOTIATING_LABEL,
  getAgreementActionLabel,
  getOutcomeHelperText,
  getOutcomeToastMessage,
  getPendingAgreementMessage,
  shouldShowContinueNegotiating,
  shouldConfirmRequestAgreement,
} from '@/lib/proposalOutcomeUi';
import { getProposalThreadUiState } from '@/lib/proposalThreadStatusUi';
import { buildActivityTimelineItems } from '@/lib/activityTimeline';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return EMAIL_RE.test(asText(value));
}

function newRecipientRow() {
  return { id: `r_${Math.random().toString(36).slice(2)}`, name: '', email: '', emailError: '' };
}

function getActiveRows(rows) {
  return rows.filter((r) => asText(r.email) !== '' || asText(r.name) !== '');
}

function validateRows(rows) {
  return rows.map((row) => {
    const email = asText(row.email);
    if (!email) return { ...row, emailError: '' };
    if (!isValidEmail(email)) return { ...row, emailError: 'Invalid email address' };
    return { ...row, emailError: '' };
  });
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function hasObjectContent(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function isSuccessfulEvaluationStatus(value) {
  const status = asLower(value);
  return status === 'completed' || status === 'succeeded' || status === 'success' || status === 'evaluated';
}

function extractEvaluationFailureDetails(rawError) {
  if (!rawError || typeof rawError !== 'object' || Array.isArray(rawError)) {
    return null;
  }

  const details =
    rawError.details && typeof rawError.details === 'object' && !Array.isArray(rawError.details)
      ? rawError.details
      : {};
  const diagnostics =
    details.diagnostics && typeof details.diagnostics === 'object' && !Array.isArray(details.diagnostics)
      ? details.diagnostics
      : {};
  const failureCode = asLower(
    rawError.failure_code || details.failure_code || rawError.code || details.code,
  );
  const failureStage = asLower(
    rawError.failure_stage || details.failure_stage || rawError.stage || details.stage,
  );
  const message = asText(rawError.message) || 'Review failed';
  const requestId = asText(
    rawError.requestId ||
      rawError.request_id ||
      details.requestId ||
      details.request_id,
  );
  const parseErrorKind = asLower(
    rawError.parse_error_kind ||
      rawError.parseErrorKind ||
      details.parse_error_kind ||
      details.parseErrorKind ||
      diagnostics.parse_error_kind ||
      diagnostics.parseErrorKind ||
      diagnostics.reason_code,
  );
  const httpStatus = Number(
    rawError.http_status ||
      rawError.statusCode ||
      details.http_status ||
      details.statusCode ||
      0,
  );

  if (!failureCode && !message) {
    return null;
  }

  return {
    failureCode: failureCode || 'unknown_error',
    failureStage: failureStage || 'unknown',
    parseErrorKind: parseErrorKind || '',
    message,
    requestId: requestId || '',
    httpStatus: Number.isFinite(httpStatus) && httpStatus > 0 ? httpStatus : null,
  };
}

function toStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => asText(entry)).filter(Boolean);
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
  return normalizeSharedHistoryEntries(entries)
    .map((entry) => {
      const roundLabel = entry.roundNumber ? `Round ${entry.roundNumber} - ` : '';
      return `${roundLabel}${entry.label}\n\n${entry.text || ''}`;
    })
    .join('\n\n---\n\n')
    .trim();
}

function extractConfidentialityWarnings(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      hasWarnings: false,
      sectionRedacted: [],
      sectionRegenerated: [],
      retriesUsed: {},
    };
  }

  const warnings =
    result.warnings && typeof result.warnings === 'object' && !Array.isArray(result.warnings)
      ? result.warnings
      : {};
  const sectionRedacted = toStringList(warnings.confidentiality_section_redacted);
  const sectionRegenerated = toStringList(warnings.confidentiality_section_regenerated);
  const retriesUsed =
    warnings.retries_used && typeof warnings.retries_used === 'object' && !Array.isArray(warnings.retries_used)
      ? warnings.retries_used
      : {};
  const completionStatus = asLower(result.completion_status || result.completionStatus);

  return {
    hasWarnings:
      completionStatus === 'completed_with_warnings' ||
      sectionRedacted.length > 0 ||
      sectionRegenerated.length > 0,
    sectionRedacted,
    sectionRegenerated,
    retriesUsed,
  };
}

function toFailureBannerMessage(failure) {
  const code = asLower(failure?.failureCode);
  if (code === 'vertex_timeout' || code === 'vertex_rate_limited' || code === 'vertex_unavailable') {
    return 'Vertex temporarily unavailable. Please retry.';
  }
  if (code === 'vertex_unauthorized') {
    return 'Vertex auth failed. Check service account configuration.';
  }
  if (code === 'vertex_bad_request') {
    return 'Invalid request. Adjust inputs and retry.';
  }
  if (code === 'empty_inputs') {
    return 'Nothing to evaluate. Please add content first.';
  }
  if (code === 'vertex_invalid_response') {
    const parseKind = asLower(failure?.parseErrorKind);
    if (parseKind === 'truncated_output') {
      return 'Vertex output was truncated. Please retry.';
    }
    if (parseKind === 'empty_output') {
      return 'Vertex returned empty output. Please retry.';
    }
    if (parseKind === 'schema_validation_error') {
      return 'Vertex output missed required report fields. Please retry.';
    }
    if (parseKind === 'json_parse_error') {
      return 'Vertex output was not valid JSON. Please retry.';
    }
    if (parseKind === 'confidential_leak_detected') {
      return 'Some sections were omitted due to confidentiality policy. Your report is otherwise complete.';
    }
    if (parseKind === 'vertex_timeout') {
      return 'Vertex request timed out. Please retry.';
    }
    if (parseKind === 'vertex_http_error') {
      return 'Vertex request failed upstream. Please retry.';
    }
    return 'Vertex returned an invalid response format. Please retry.';
  }
  if (code === 'vertex_generic_output') {
    return 'Vertex returned a generic report. Please retry with richer shared content.';
  }
  if (code === 'db_write_failed') {
    return 'This review could not be saved. Please retry.';
  }
  if (code === 'not_configured') {
    return 'Vertex AI integration is not configured.';
  }
  return 'This review could not be completed. Please retry from the editor.';
}

function getEvaluationRowMeta(evaluation) {
  const status = asLower(evaluation?.status);
  const failure = extractEvaluationFailureDetails(evaluation?.result?.error);
  const errorCode = asLower(failure?.failureCode || evaluation?.result?.error?.code);

  if (errorCode === 'not_configured') {
    return {
      label: 'Not configured',
      badgeClassName: 'bg-amber-100 text-amber-800',
      rowClassName: 'rounded-xl border border-amber-200 bg-amber-50 p-3',
      scoreLabel: '—',
      timelineTitle: 'Review Unavailable',
    };
  }

  if (status === 'failed' || errorCode) {
    return {
      label: 'Failed',
      badgeClassName: 'bg-red-100 text-red-700',
      rowClassName: 'rounded-xl border border-red-200 bg-red-50 p-3',
      scoreLabel: '—',
      timelineTitle: 'AI Mediation Failed',
    };
  }

  if (status === 'running' || status === 'queued' || status === 'evaluating') {
    return {
      label: 'Running',
      badgeClassName: 'bg-blue-100 text-blue-700',
      rowClassName: 'rounded-xl border border-blue-200 bg-blue-50 p-3',
      scoreLabel: '—',
      timelineTitle: 'AI Mediation Running',
    };
  }

  if (isSuccessfulEvaluationStatus(status)) {
    const numericScore = Number(evaluation?.score);
    return {
      label: 'Succeeded',
      badgeClassName: 'bg-green-100 text-green-700',
      rowClassName: 'rounded-xl border border-green-200 bg-green-50 p-3',
      scoreLabel: Number.isFinite(numericScore) ? `${Math.max(0, Math.round(numericScore))}% confidence` : '—',
      timelineTitle: 'AI Mediation Ready',
    };
  }

  return {
    label: status || 'Unknown',
    badgeClassName: 'bg-slate-100 text-slate-700',
    rowClassName: 'rounded-xl border border-slate-200 bg-slate-50 p-3',
    scoreLabel: '—',
    timelineTitle: 'AI Mediation Update',
  };
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function getOpportunityStatusClass(statusKey, status) {
  const normalizedKey = asLower(statusKey);
  const normalizedStatus = asLower(status);

  if (normalizedStatus === 'won' || normalizedKey === 'closed_won') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  }
  if (normalizedStatus === 'lost' || normalizedKey === 'closed_lost') {
    return 'bg-rose-100 text-rose-700 border-rose-200';
  }
  if (normalizedKey === 'waiting_on_counterparty') {
    return 'bg-amber-100 text-amber-700 border-amber-200';
  }
  if (normalizedKey === 'needs_reply') {
    return 'bg-blue-100 text-blue-700 border-blue-200';
  }
  if (normalizedKey === 'under_review') {
    return 'bg-violet-100 text-violet-700 border-violet-200';
  }
  if (normalizedStatus === 'under_verification' || normalizedStatus === 're_evaluated') {
    return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function toSafeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
}

function getEvaluationInputMeta(evaluation) {
  const trace =
    evaluation?.result?.input_trace &&
    typeof evaluation.result.input_trace === 'object' &&
    !Array.isArray(evaluation.result.input_trace)
      ? evaluation.result.input_trace
      : {};

  return {
    inputSharedHash: asText(evaluation?.input_shared_hash || trace.shared_hash || trace.input_shared_hash),
    inputConfHash: asText(evaluation?.input_conf_hash || trace.confidential_hash || trace.input_conf_hash),
    inputSharedLen:
      toSafeInteger(evaluation?.input_shared_len) ??
      toSafeInteger(trace.shared_length) ??
      toSafeInteger(trace.input_shared_len),
    inputConfLen:
      toSafeInteger(evaluation?.input_conf_len) ??
      toSafeInteger(trace.confidential_length) ??
      toSafeInteger(trace.input_conf_len),
    inputVersion: toSafeInteger(evaluation?.input_version) ?? toSafeInteger(trace.input_version),
  };
}

function getEvaluationProviderMeta(evaluation) {
  const result =
    evaluation?.result && typeof evaluation.result === 'object' && !Array.isArray(evaluation.result)
      ? evaluation.result
      : {};
  const providerRaw = asText(
    evaluation?.evaluation_provider ||
      evaluation?.provider ||
      result.evaluation_provider ||
      result.provider,
  );
  const model = asText(
    evaluation?.evaluation_model ||
      evaluation?.evaluation_provider_model ||
      result.evaluation_model ||
      result.evaluation_provider_model ||
      result.model,
  );
  const reason = asText(
    evaluation?.evaluation_provider_reason ||
      result.evaluation_provider_reason ||
      result.fallbackReason,
  );
  return {
    provider: asLower(providerRaw) === 'vertex' ? 'vertex' : providerRaw ? 'fallback' : 'unknown',
    model: model || null,
    reason: reason || null,
  };
}

function useComparisonId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

function parseDetailTab(search) {
  const params = new URLSearchParams(search || '');
  const requested = asLower(params.get('tab'));
  if (requested === 'report' || requested === 'details') {
    return requested;
  }
  return 'report';
}

export default function DocumentComparisonDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const comparisonId = useComparisonId();
  const initialTab = useMemo(() => parseDetailTab(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareRecipients, setShareRecipients] = useState(() => [newRecipientRow()]);
  const [selectedShareToken, setSelectedShareToken] = useState('');
  const [isShareLinkInitializedForOpen, setIsShareLinkInitializedForOpen] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [evaluationPollDeadline, setEvaluationPollDeadline] = useState(null);
  const [requestAgreementDialogOpen, setRequestAgreementDialogOpen] = useState(false);


  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, comparisonId]);

  const comparisonQuery = useQuery({
    queryKey: ['document-comparison-detail', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
    placeholderData: undefined,
    refetchInterval: (query) => {
      const status = asText(query.state.data?.comparison?.status).toLowerCase();
      const isRunning = status === 'running' || status === 'queued' || status === 'evaluating';
      if (!isRunning) {
        return false;
      }
      if (typeof evaluationPollDeadline === 'number' && Date.now() > evaluationPollDeadline) {
        return false;
      }
      return 2000;
    },
    refetchIntervalInBackground: true,
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
  const loadedComparisonId = asText(comparison?.id);
  const hasMismatchedComparisonPayload =
    Boolean(loadedComparisonId) &&
    Boolean(comparisonId) &&
    loadedComparisonId !== comparisonId;
  const permissions = comparisonQuery.data?.permissions || null;
  const viewerRole =
    asLower(permissions?.access_mode) === 'recipient' || asLower(permissions?.access_mode) === 'token'
      ? 'party_b'
      : 'party_a';
  const proposal = comparisonQuery.data?.proposal || null;
  const activityHistory = Array.isArray(comparisonQuery.data?.activityHistory)
    ? comparisonQuery.data.activityHistory
    : [];
  const confidentialWordCount = String(comparison?.doc_a_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const sharedWordCount = String(liveSharedText || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;

  const proposalDetailQuery = useQuery({
    queryKey: ['document-comparison-linked-proposal-detail', proposal?.id || 'none'],
    enabled: Boolean(proposal?.id) && asLower(permissions?.access_mode) !== 'token',
    queryFn: () => proposalsClient.getById(proposal.id),
    placeholderData: proposal || null,
  });
  const proposalThread = proposalDetailQuery.data || proposal || null;

  const evaluationsQuery = useQuery({
    queryKey: ['document-comparison-proposal-evaluations', comparisonId, proposal?.id || 'none'],
    enabled: Boolean(proposal?.id && comparison?.id === comparisonId),
    queryFn: () => proposalsClient.getEvaluations(proposal.id),
    placeholderData: undefined,
  });

  const sharedReportsQuery = useQuery({
    queryKey: ['shared-reports', comparisonId],
    enabled: Boolean(isShareDialogOpen && comparisonId),
    queryFn: () => sharedReportsClient.list({ comparisonId }),
  });

  const sharedReports = Array.isArray(sharedReportsQuery.data?.sharedReports)
    ? sharedReportsQuery.data.sharedReports
    : [];

  useEffect(() => {
    if (!isShareDialogOpen) {
      return;
    }
    // Pre-fill the first recipient row with the most authoritative email we have,
    // but only if the row is still blank (preserve any user edits).
    const prefill = asText(proposal?.party_b_email) || asText(comparison?.recipient_email);
    if (!prefill) return;
    setShareRecipients((current) => {
      if (current.length === 1 && !asText(current[0].email) && !asText(current[0].name)) {
        return [{ ...current[0], email: prefill }];
      }
      return current;
    });
  }, [isShareDialogOpen, proposal?.party_b_email, comparison?.recipient_email]);

  useEffect(() => {
    if (selectedShareToken) {
      return;
    }
    if (sharedReports.length > 0 && sharedReports[0]?.token) {
      setSelectedShareToken(sharedReports[0].token);
    }
  }, [selectedShareToken, sharedReports]);

  const activeSharedReport = useMemo(() => {
    if (!sharedReports.length) {
      return null;
    }

    if (selectedShareToken) {
      const matched = sharedReports.find((item) => item.token === selectedShareToken);
      if (matched) {
        return matched;
      }
    }

    return sharedReports[0] || null;
  }, [selectedShareToken, sharedReports]);

  const report = comparison?.public_report || comparison?.evaluation_result?.report || {};
  const reviewStage = resolveOpportunityReviewStage(report, {
    source: evaluationsQuery.data?.[0]?.source,
  });
  const reviewLabel = getReviewStageLabel(reviewStage);
  const evaluationHistory = Array.isArray(evaluationsQuery.data) ? evaluationsQuery.data : [];
  const latestEvaluation = evaluationHistory[0] || null;
  const comparisonWarningMeta = extractConfidentialityWarnings(comparison?.evaluation_result);
  const latestEvaluationWarningMeta = extractConfidentialityWarnings(latestEvaluation?.result);
  const activeWarningMeta = latestEvaluationWarningMeta.hasWarnings
    ? latestEvaluationWarningMeta
    : comparisonWarningMeta;
  const latestProviderMeta = latestEvaluation
    ? getEvaluationProviderMeta(latestEvaluation)
    : getEvaluationProviderMeta({ result: comparison?.evaluation_result || {} });
  const latestHistoryFailure = extractEvaluationFailureDetails(latestEvaluation?.result?.error);
  const comparisonFailure = extractEvaluationFailureDetails(comparison?.evaluation_result?.error);
  const latestFailureDetails = latestHistoryFailure || comparisonFailure;
  const latestEvaluationMeta = getEvaluationRowMeta(latestEvaluation);
  const comparisonStatus = asLower(comparison?.status);
  const comparisonErrorCode = asLower(
    comparisonFailure?.failureCode || comparison?.evaluation_result?.error?.code,
  );
  const latestHistoryErrorCode = asLower(
    latestHistoryFailure?.failureCode || latestEvaluation?.result?.error?.code,
  );
  const isEvaluationNotConfigured =
    comparisonErrorCode === 'not_configured' || latestHistoryErrorCode === 'not_configured';
  const hasLatestHistoryFailure = latestEvaluationMeta.label === 'Failed';
  const isEvaluationRunning =
    comparisonStatus === 'running' || comparisonStatus === 'queued' || comparisonStatus === 'evaluating';
  const isEvaluationFailed =
    !isEvaluationNotConfigured &&
    (comparisonStatus === 'failed' ||
      Boolean(comparison?.evaluation_result?.error && typeof comparison?.evaluation_result?.error === 'object') ||
      hasLatestHistoryFailure);
  const evaluationFailureMessage =
    asText(latestFailureDetails?.message) ||
    asText(comparison?.evaluation_result?.error?.message) ||
    asText(latestEvaluation?.result?.error?.message);
  const evaluationFailureBannerMessage = latestFailureDetails
    ? `${toFailureBannerMessage(latestFailureDetails)}${
        latestFailureDetails.requestId ? ` (requestId: ${latestFailureDetails.requestId})` : ''
      }`
    : `${reviewLabel} could not be completed. ${evaluationFailureMessage || 'Please retry from the editor.'}`;
  const hasReportData = hasObjectContent(report);
  const isEvaluationSucceeded =
    !isEvaluationRunning &&
    !isEvaluationNotConfigured &&
    !isEvaluationFailed &&
    comparisonStatus === 'evaluated' &&
    hasReportData;
  const showConfidentialityWarning = isEvaluationSucceeded && activeWarningMeta.hasWarnings;
  const confidentialityWarningMessage = 'Some sections were omitted due to confidentiality policy. Your report is otherwise complete.';
  const confidentialityWarningDetails =
    activeWarningMeta.sectionRedacted.length > 0
      ? `Redacted: ${activeWarningMeta.sectionRedacted.join(', ')}`
      : activeWarningMeta.sectionRegenerated.length > 0
        ? `Regenerated: ${activeWarningMeta.sectionRegenerated.join(', ')}`
        : '';
  const hasReport = isEvaluationSucceeded;
  const rawInputTrace =
    comparison?.evaluation_result?.input_trace &&
    typeof comparison?.evaluation_result?.input_trace === 'object' &&
    !Array.isArray(comparison?.evaluation_result?.input_trace)
      ? comparison.evaluation_result.input_trace
      : null;
  const evaluatedInputTrace = {
    source: asText(rawInputTrace?.source) || 'unknown',
    confidentialLength: toSafeNumber(rawInputTrace?.confidential_length, String(comparison?.doc_a_text || '').length),
    sharedLength: toSafeNumber(rawInputTrace?.shared_length, String(comparison?.doc_b_text || '').length),
    confidentialWords: toSafeNumber(rawInputTrace?.confidential_words, confidentialWordCount),
    sharedWords: toSafeNumber(rawInputTrace?.shared_words, sharedWordCount),
    confidentialHash: asText(rawInputTrace?.confidential_hash),
    sharedHash: asText(rawInputTrace?.shared_hash),
  };
  const isPollingTimedOut =
    isEvaluationRunning &&
    typeof evaluationPollDeadline === 'number' &&
    Date.now() > evaluationPollDeadline;
  const proposalOutcome = proposalThread?.outcome || {};
  const proposalOutcomeState = asLower(proposalOutcome.state || proposalThread?.status);
  const isWon = proposalOutcomeState === 'won';
  const isLost = proposalOutcomeState === 'lost';
  const isClosed = isWon || isLost;
  const proposalThreadStatus = getProposalThreadUiState(proposalThread || {});
  const primaryStatusKey = proposalThreadStatus.primaryStatusKey;
  const primaryStatusLabel = proposalThreadStatus.primaryStatusLabel;
  const baseOutcomeActionDisabled = proposalDetailQuery.isLoading;
  const pendingOutcomeMessage = getPendingAgreementMessage(proposalOutcome, 'opportunity');
  const outcomeHelperText = getOutcomeHelperText(proposalOutcome, 'opportunity');

  useEffect(() => {
    if (!comparisonId) {
      setEvaluationPollDeadline(null);
      return;
    }
    if (isEvaluationRunning) {
      setEvaluationPollDeadline((current) => {
        if (typeof current === 'number' && current > Date.now()) {
          return current;
        }
        return Date.now() + 60000;
      });
      return;
    }
    setEvaluationPollDeadline(null);
  }, [comparisonId, isEvaluationRunning]);

  const downloadProposalPdfMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadProposalPdf(comparisonId),
    onSuccess: () => {
      toast.success('Opportunity details PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download opportunity details PDF');
    },
  });

  const downloadAiMediationReviewPdfMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadPdf(comparisonId, { format: 'web-parity' }),
    onSuccess: () => {
      toast.success(`${reviewLabel} PDF download started`);
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error(`${reviewLabel} PDF is not configured in this environment yet.`);
        return;
      }
      toast.error(error?.message || `${reviewLabel} PDF download unavailable`);
    },
  });

  const markOutcomeMutation = useMutation({
    mutationFn: (nextOutcome) => proposalsClient.markOutcome(asText(proposalThread?.id), nextOutcome),
    onSuccess: async (updatedProposal) => {
      applyUpdatedProposalToCaches(queryClient, updatedProposal);
      toast.success(getOutcomeToastMessage(updatedProposal));
      await invalidateProposalThreadQueries(queryClient, {
        proposalId: updatedProposal?.id || proposalThread?.id || null,
        documentComparisonId: updatedProposal?.document_comparison_id || comparisonId || null,
      });
      await Promise.all([
        comparisonQuery.refetch(),
        proposalDetailQuery.refetch(),
      ]);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update outcome');
    },
  });
  const outcomeActionDisabled =
    baseOutcomeActionDisabled ||
    markOutcomeMutation.isPending;

  const createShareLinkMutation = useMutation({
    mutationFn: async (options = {}) => {
      const recipientEmail = asText(options?.recipientEmail) || null;
      const response = await sharedReportsClient.create({
        comparisonId,
        recipientEmail,
      });

      if (!response?.token) {
        throw new Error('Shared report link could not be created');
      }

      return response;
    },
    onSuccess: async (payload, variables) => {
      setSelectedShareToken(payload.token);
      await queryClient.invalidateQueries({ queryKey: ['shared-reports', comparisonId] });
      if (!variables?.silent) {
        toast.success('Shared report link created');
      }
    },
    onError: (error, variables) => {
      if (!variables?.silent) {
        toast.error(error?.message || 'Failed to create shared report link');
      }
    },
  });

  useEffect(() => {
    if (!isShareDialogOpen) {
      setIsShareLinkInitializedForOpen(false);
      return;
    }

    if (isShareLinkInitializedForOpen) {
      return;
    }

    if (!comparisonId || sharedReportsQuery.isLoading || sharedReportsQuery.isFetching || createShareLinkMutation.isPending) {
      return;
    }

    if (sharedReports.length > 0) {
      setIsShareLinkInitializedForOpen(true);
      return;
    }

    setIsShareLinkInitializedForOpen(true);
    createShareLinkMutation.mutate({ silent: true, recipientEmail: null });
  }, [
    comparisonId,
    createShareLinkMutation,
    createShareLinkMutation.isPending,
    isShareDialogOpen,
    isShareLinkInitializedForOpen,
    sharedReports.length,
    sharedReportsQuery.isFetching,
    sharedReportsQuery.isLoading,
  ]);

  const sendShareEmailMutation = useMutation({
    mutationFn: async (token) => {
      let workingToken = asText(token);
      const activeRecipients = getActiveRows(shareRecipients).filter((r) => asText(r.email));
      const primaryEmail = activeRecipients[0]?.email || null;

      if (!workingToken) {
        const created = await sharedReportsClient.create({
          comparisonId,
          recipientEmail: primaryEmail,
        });
        workingToken = asText(created?.token);
      }

      if (!workingToken) {
        throw new Error('Shared report link could not be created');
      }

      // Send per-recipient, catching individual failures so a single bad address
      // does not abort the whole batch.
      const groups = activeRecipients.length > 0 ? activeRecipients : [{ name: '', email: null }];
      const results = [];
      for (const recipient of groups) {
        try {
          const result = await sharedReportsClient.send(workingToken, {
            recipientEmail: recipient.email,
          });
          results.push({
            name: recipient.name || '',
            email: recipient.email,
            status: 'sent',
            error: null,
            token: result.token,
          });
        } catch (err) {
          results.push({
            name: recipient.name || '',
            email: recipient.email,
            status: 'failed',
            error: asText(err?.message) || 'Send failed',
            token: null,
          });
        }
      }
      const lastSent = [...results].reverse().find((r) => r.status === 'sent') || null;
      return { results, lastSent, count: results.length };
    },
    onSuccess: async (payload) => {
      if (payload?.lastSent?.token) {
        setSelectedShareToken(payload.lastSent.token);
      }
      setSendResults(payload.results);
      await queryClient.invalidateQueries({ queryKey: ['shared-reports', comparisonId] });
      const sent = payload.results.filter((r) => r.status === 'sent').length;
      const failed = payload.results.filter((r) => r.status === 'failed').length;
      if (sent > 0 && failed === 0) {
        toast.success(sent > 1 ? `Accepted for sending to ${sent} recipients` : 'Email accepted by provider');
      } else if (sent > 0 && failed > 0) {
        toast.warning(`Accepted for ${sent} recipient${sent > 1 ? 's' : ''}; ${failed} failed`);
      } else {
        toast.error('Failed to send to all recipients');
      }
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error('Email delivery is not configured in this environment yet.');
        return;
      }
      toast.error(error?.message || 'Failed to send shared report email');
    },
  });
  const isShareLinkPanelLoading =
    sharedReportsQuery.isLoading || sharedReportsQuery.isFetching || createShareLinkMutation.isPending;
  const activeShareUrl = asText(activeSharedReport?.url);

  async function copyShareUrl(url) {
    const normalized = asText(url);
    if (!normalized) {
      toast.error('Share URL is not available yet');
      return;
    }

    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard is not available in this browser');
      return;
    }

    try {
      await navigator.clipboard.writeText(normalized);
      toast.success('Share link copied');
    } catch {
      toast.error('Unable to copy share link');
    }
  }

  if (!comparisonId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900">Missing comparison id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (comparisonQuery.isLoading || hasMismatchedComparisonPayload) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="py-8 flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading comparison...
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (comparisonQuery.error || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-900">
              {comparisonQuery.error?.message || 'Comparison not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const recommendation =
    asText(report?.recommendation) ||
    asText(comparison?.evaluation_result?.recommendation) ||
    asText(latestEvaluation?.summary);
  const timelineTone =
    latestEvaluationMeta.label === 'Succeeded'
      ? 'success'
      : latestEvaluationMeta.label === 'Not configured'
        ? 'warning'
        : latestEvaluationMeta.label === 'Failed'
          ? 'danger'
          : 'neutral';
  const timelineItems = buildActivityTimelineItems({
    activityHistory,
    createdAt: comparison.created_date,
    updatedAt: comparison.updated_date,
    hasLatestEvaluation: Boolean(latestEvaluation),
    latestEvaluationTone: timelineTone,
    latestEvaluationTitle: latestEvaluationMeta.timelineTitle,
    latestEvaluationTimestamp: latestEvaluation?.created_date,
    formatDateTime,
  });
  const proposerDisplay = proposalThread?.party_a_email || 'Not specified';
  const recipientDisplay =
    [proposalThread?.party_b_name || comparison?.recipient_name, proposalThread?.party_b_email || comparison?.recipient_email]
      .filter(Boolean)
      .join(' · ') || 'Not specified';
  const handleAgreementAction = () => {
    if (shouldConfirmRequestAgreement(proposalOutcome)) {
      setRequestAgreementDialogOpen(true);
      return;
    }

    markOutcomeMutation.mutate('won');
  };
  const handleRequestAgreementConfirm = () => {
    setRequestAgreementDialogOpen(false);
    markOutcomeMutation.mutate('won');
  };
  const handleContinueNegotiating = () => {
    markOutcomeMutation.mutate('continue_negotiating');
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <RequestAgreementConfirmDialog
        open={requestAgreementDialogOpen}
        onOpenChange={setRequestAgreementDialogOpen}
        onConfirm={handleRequestAgreementConfirm}
        isPending={markOutcomeMutation.isPending}
      />
      <div className="max-w-[1400px] mx-auto px-6 space-y-6">
        {viewerRole === 'party_a' ? (
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                createPageUrl(
                  `DocumentComparisonCreate?draft=${encodeURIComponent(comparison.id)}&step=2`,
                ),
              )
            }
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Edit Opportunity
          </Button>
        ) : null}

        <div className="space-y-4 min-w-0">
          {/* ── Header: title + right utility actions ─────────────────────── */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-slate-900 leading-tight break-words">{comparison.title}</h1>
              <p className="mt-1.5 text-sm text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <span className="font-medium text-slate-600">From:</span>{' '}
                  {proposerDisplay}
                  {viewerRole === 'party_a' ? (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500 font-medium">You</span>
                  ) : null}
                </span>
                <span className="text-slate-300" aria-hidden>·</span>
                <span>
                  <span className="font-medium text-slate-600">To:</span>{' '}
                  {recipientDisplay}
                  {viewerRole === 'party_b' ? (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500 font-medium">You</span>
                  ) : null}
                </span>
                {proposalThread?.id ? (
                  <>
                    <span className="text-slate-300" aria-hidden>·</span>
                    <Badge className={getOpportunityStatusClass(primaryStatusKey, proposalThread?.status)}>
                      {primaryStatusLabel}
                    </Badge>
                  </>
                ) : null}
              </p>
            </div>

            {/* Right: share + export utilities */}
            <div className="flex shrink-0 items-center gap-2">
              {viewerRole === 'party_a' ? (
                <Button onClick={() => setIsShareDialogOpen(true)} disabled={!proposal?.id}>
                  <Send className="w-4 h-4 mr-2" />
                  Share
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={downloadProposalPdfMutation.isPending && downloadAiMediationReviewPdfMutation.isPending}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => downloadProposalPdfMutation.mutate()}
                    disabled={downloadProposalPdfMutation.isPending}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Opportunity PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => downloadAiMediationReviewPdfMutation.mutate()}
                    disabled={downloadAiMediationReviewPdfMutation.isPending}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {`${reviewLabel} PDF`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {pendingOutcomeMessage ? (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertDescription className="text-amber-900">{pendingOutcomeMessage}</AlertDescription>
            </Alert>
          ) : null}

          {proposalThread?.id && asLower(permissions?.access_mode) !== 'token' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {isClosed ? (
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold text-sm border ${isWon ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}`}>
                    {isWon ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {isWon ? AGREED_LABEL : 'Lost'}
                  </div>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={
                        outcomeActionDisabled ||
                        !proposalOutcome?.can_mark_won ||
                        Boolean(proposalOutcome?.requested_by_current_user)
                      }
                      onClick={handleAgreementAction}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                      {getAgreementActionLabel(proposalOutcome)}
                    </Button>
                    {shouldShowContinueNegotiating(proposalOutcome) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                        disabled={
                          outcomeActionDisabled || !proposalOutcome?.can_continue_negotiating
                        }
                        onClick={handleContinueNegotiating}
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        {CONTINUE_NEGOTIATING_LABEL}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-600 border-rose-200 hover:bg-rose-50"
                      disabled={outcomeActionDisabled || !proposalOutcome?.can_mark_lost}
                      onClick={() => markOutcomeMutation.mutate('lost')}
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />
                      Mark as Lost
                    </Button>
                  </>
                )}
              </div>

              {outcomeHelperText ? (
                <p className="text-sm text-slate-500">{outcomeHelperText}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2">
          <ComparisonDetailTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            hasReportBadge={hasReport}
            aiReportProps={{
              isEvaluationRunning,
              isPollingTimedOut,
              isEvaluationNotConfigured,
              showConfidentialityWarning,
              confidentialityWarningMessage,
              confidentialityWarningDetails,
              isEvaluationFailed,
              evaluationFailureBannerMessage,
              hasReport,
              hasEvaluations: evaluationHistory.length > 0,
              noReportMessage: `No ${reviewLabel} yet. Go to the editor and run the latest review to generate it.`,
              runDetailsHref: createPageUrl(`DocumentComparisonRunDetails?id=${encodeURIComponent(comparisonId)}`),
              report,
              reviewStage,
              recommendation,
              timelineItems,
            }}
            proposalDetailsProps={{
              description: 'Read-only confidential information plus cumulative authored shared history.',
              leftLabel: comparison.party_a_label || CONFIDENTIAL_LABEL,
              rightLabel: comparison.party_b_label || SHARED_LABEL,
              leftText: comparison.doc_a_text || '',
              leftHtml: comparison.doc_a_html || '',
              rightText: liveSharedText || '',
              rightHtml: comparison.doc_b_html || '',
              documents: sharedHistoryEntries.length > 0
                ? [
                    {
                      label: comparison.party_a_label || CONFIDENTIAL_LABEL,
                      text: comparison.doc_a_text || '',
                      html: comparison.doc_a_html || '',
                      badges: [comparison.doc_a_source || 'typed'],
                    },
                    ...sharedHistoryEntries.map((entry) => ({
                      label:
                        entry.roundNumber
                          ? `Round ${entry.roundNumber} - ${entry.label}`
                          : entry.label,
                      text: entry.text || '',
                      html: entry.html || '',
                      badges: [entry.authorLabel, entry.source || 'typed'],
                    })),
                  ]
                : undefined,
            }}
          />
          </div>
        </div>
      </div>

      <Dialog
        open={isShareDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsShareDialogOpen(nextOpen);
          if (!nextOpen) {
            setShareRecipients([newRecipientRow()]);
            setIsShareLinkInitializedForOpen(false);
            setSendResults(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Shared Report</DialogTitle>
            <DialogDescription>
              Send recipient-safe report links by email. Confidential information stays private and never appears in email content.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── Recipient rows ───────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-x-2 mb-1">
                <p className="text-xs font-medium text-slate-500 pl-1">Name (optional)</p>
                <p className="text-xs font-medium text-slate-500 pl-1">Email</p>
                <span />
              </div>
              {shareRecipients.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[1fr_1.4fr_auto] gap-x-2 items-start">
                  <Input
                    type="text"
                    placeholder="Name"
                    value={row.name}
                    onChange={(e) =>
                      setShareRecipients((prev) =>
                        prev.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)),
                      )
                    }
                  />
                  <div className="space-y-1">
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={row.email}
                      className={row.emailError ? 'border-red-400 focus-visible:ring-red-400' : ''}
                      onChange={(e) =>
                        setShareRecipients((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, email: e.target.value, emailError: '' } : r,
                          ),
                        )
                      }
                    />
                    {row.emailError ? (
                      <p className="text-xs text-red-600">{row.emailError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label="Remove recipient"
                    className="mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    disabled={shareRecipients.length === 1}
                    onClick={() =>
                      setShareRecipients((prev) => prev.filter((r) => r.id !== row.id))
                    }
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mt-1"
                onClick={() => setShareRecipients((prev) => [...prev, newRecipientRow()])}
              >
                <Plus className="w-4 h-4" />
                Add recipient
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  const validated = validateRows(shareRecipients);
                  const hasErrors = validated.some((r) => r.emailError);
                  if (hasErrors) {
                    setShareRecipients(validated);
                    return;
                  }
                  setSendResults(null);
                  sendShareEmailMutation.mutate(activeSharedReport?.token || '');
                }}
                disabled={createShareLinkMutation.isPending || sendShareEmailMutation.isPending}
              >
                {sendShareEmailMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send email
              </Button>
            </div>

            {sendResults && sendResults.length > 0 ? (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {sendResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                    <div
                      className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${
                        r.status === 'sent' ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 leading-snug">
                        {r.status === 'sent' ? 'Accepted' : 'Failed'}
                        {r.name ? (
                          <span className="font-normal text-slate-500"> · {r.name}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{r.email || '\u2014'}</p>
                      {r.status === 'sent' ? (
                        <p className="text-xs text-slate-400 mt-0.5">Accepted for delivery by email provider</p>
                      ) : null}
                      {r.status === 'failed' && r.error ? (
                        <p className="text-xs text-red-600 mt-0.5">{r.error}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {activeSharedReport?.status || (isShareLinkPanelLoading ? 'initializing' : 'pending')}
                </Badge>
                {activeSharedReport?.last_delivery?.status ? (
                  <Badge className="bg-blue-100 text-blue-700">
                    Last delivery: {activeSharedReport.last_delivery.status}
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Private report link</Label>
                <Input
                  readOnly
                  value={activeShareUrl}
                  placeholder={isShareLinkPanelLoading ? 'Creating link...' : 'Link unavailable'}
                />
                <p className="text-xs text-slate-500">
                  Token-protected link — anyone with this link can view the report. Only invited recipients can respond or add information.
                </p>
                {!activeSharedReport && isShareLinkPanelLoading ? (
                  <p className="text-xs text-slate-500">Preparing link...</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => copyShareUrl(activeShareUrl)}
                  disabled={!activeShareUrl}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy link
                </Button>
              </div>

              {Array.isArray(activeSharedReport?.deliveries) && activeSharedReport.deliveries.length > 0 ? (
                <div className="space-y-1 pt-2">
                  {activeSharedReport.deliveries.map((delivery) => (
                    <p key={delivery.id} className="text-xs text-slate-600">
                      {delivery.status} • {delivery.sent_to_email || 'recipient'} •{' '}
                      {formatDateTime(delivery.sent_at || delivery.created_at)}
                      {delivery.last_error ? ` • ${delivery.last_error}` : ''}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 pt-2">
                  {isShareLinkPanelLoading ? 'Preparing delivery details...' : 'No delivery attempts yet.'}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
