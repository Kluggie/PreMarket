import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ComparisonDetailTabs,
} from '@/components/document-comparison/ComparisonDetailTabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
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
  const message = asText(rawError.message) || 'AI mediation failed';
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
    return 'AI mediation could not be saved. Please retry.';
  }
  if (code === 'not_configured') {
    return 'Vertex AI integration is not configured.';
  }
  return 'AI mediation could not be completed. Please retry from the editor.';
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
      timelineTitle: 'AI Mediation Unavailable',
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
  const [shareRecipientEmail, setShareRecipientEmail] = useState('');
  const [selectedShareToken, setSelectedShareToken] = useState('');
  const [isShareLinkInitializedForOpen, setIsShareLinkInitializedForOpen] = useState(false);
  const [evaluationPollDeadline, setEvaluationPollDeadline] = useState(null);


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
  const isOwnerView = asLower(permissions?.access_mode) === 'owner';
  const proposal = comparisonQuery.data?.proposal || null;
  const confidentialWordCount = String(comparison?.doc_a_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const sharedWordCount = String(liveSharedText || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;

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
    // Pre-fill the share dialog with the most authoritative recipient email we have:
    // 1) Whatever the user already typed (preserve it)
    // 2) The linked proposal's party_b_email
    // 3) The comparison's own recipient_email (set in Step 3)
    setShareRecipientEmail(
      (current) =>
        current ||
        asText(proposal?.party_b_email) ||
        asText(comparison?.recipient_email),
    );
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
    : `AI mediation could not be completed. ${evaluationFailureMessage || 'Please retry from the editor.'}`;
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

  const downloadAiReportMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadPdf(comparisonId),
    onSuccess: () => {
      toast.success('AI mediation review PDF download started');
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error('AI mediation review PDF is not configured in this environment yet.');
        return;
      }
      toast.error(error?.message || 'AI mediation review PDF download unavailable');
    },
  });

  const createShareLinkMutation = useMutation({
    mutationFn: async (options = {}) => {
      const recipientEmail = asText(options?.recipientEmail) || asText(shareRecipientEmail) || null;
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
    createShareLinkMutation.mutate({ silent: true, recipientEmail: asText(shareRecipientEmail) || null });
  }, [
    comparisonId,
    createShareLinkMutation,
    createShareLinkMutation.isPending,
    isShareDialogOpen,
    isShareLinkInitializedForOpen,
    shareRecipientEmail,
    sharedReports.length,
    sharedReportsQuery.isFetching,
    sharedReportsQuery.isLoading,
  ]);

  const sendShareEmailMutation = useMutation({
    mutationFn: async (token) => {
      let workingToken = asText(token);
      if (!workingToken) {
        const created = await sharedReportsClient.create({
          comparisonId,
          recipientEmail: asText(shareRecipientEmail) || null,
        });
        workingToken = asText(created?.token);
      }

      if (!workingToken) {
        throw new Error('Shared report link could not be created');
      }

      return sharedReportsClient.send(workingToken, {
        recipientEmail: asText(shareRecipientEmail) || null,
      });
    },
    onSuccess: async (payload) => {
      if (payload?.token) {
        setSelectedShareToken(payload.token);
      }
      await queryClient.invalidateQueries({ queryKey: ['shared-reports', comparisonId] });
      toast.success('Shared report email sent');
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
  const timelineItems = [
    {
      id: 'created',
      kind: 'file',
      tone: 'info',
      title: 'Opportunity Created',
      timestamp: formatDateTime(comparison.created_date),
    },
    {
      id: 'updated',
      kind: 'clock',
      tone: 'neutral',
      title: 'Last Updated',
      timestamp: formatDateTime(comparison.updated_date),
    },
    ...(latestEvaluation
      ? [
          {
            id: 'latest-evaluation',
            kind: 'sparkles',
            tone: timelineTone,
            title: latestEvaluationMeta.timelineTitle,
            timestamp: formatDateTime(latestEvaluation.created_date),
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 space-y-6">
        <Link
          to={createPageUrl('Opportunities')}
          className="inline-flex items-center text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Opportunities
        </Link>

        <div className="space-y-6 min-w-0">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="pt-6">
              <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight break-words">
                {comparison.title}
              </h1>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
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
            <Button
              variant="outline"
              onClick={() => downloadProposalPdfMutation.mutate()}
              disabled={downloadProposalPdfMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Opportunity Details PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadAiReportMutation.mutate()}
              disabled={downloadAiReportMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              Download AI Mediation Review PDF
            </Button>
            <Button onClick={() => setIsShareDialogOpen(true)} disabled={!proposal?.id}>
              <Send className="w-4 h-4 mr-2" />
              Share
            </Button>
          </div>

          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Parties</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                    Party A (Proposer)
                  </p>
                  <p className="font-semibold text-slate-900">{proposal?.party_a_email || 'Not specified'}</p>
                  <Badge variant="outline" className="mt-3">
                    You
                  </Badge>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                    Party B (Recipient)
                  </p>
                  {(proposal?.party_b_name || comparison?.recipient_name) && (
                    <p className="font-semibold text-slate-900">
                      {proposal?.party_b_name || comparison?.recipient_name}
                    </p>
                  )}
                  <p className={proposal?.party_b_name || comparison?.recipient_name ? 'text-sm text-slate-600 mt-0.5' : 'font-semibold text-slate-900'}>
                    {proposal?.party_b_email || comparison?.recipient_email || 'Not specified'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

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
              noReportMessage: 'No mediation review yet. Go to the editor and use Run AI Mediation to generate it.',
              runDetailsHref: createPageUrl(`DocumentComparisonRunDetails?id=${encodeURIComponent(comparisonId)}`),
              report,
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

      <Dialog
        open={isShareDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsShareDialogOpen(nextOpen);
          if (!nextOpen) {
            setShareRecipientEmail('');
            setIsShareLinkInitializedForOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Shared Report</DialogTitle>
            <DialogDescription>
              Share one recipient-safe report link. Confidential information stays private and never appears in email content.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shared-report-recipient">Recipient email (optional)</Label>
              <Input
                id="shared-report-recipient"
                type="email"
                placeholder="recipient@example.com"
                value={shareRecipientEmail}
                onChange={(event) => setShareRecipientEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => sendShareEmailMutation.mutate(activeSharedReport?.token || '')}
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
                <Label>Share URL</Label>
                <Input
                  readOnly
                  value={activeShareUrl}
                  placeholder={isShareLinkPanelLoading ? 'Creating shared link...' : 'Shared link unavailable'}
                />
                {!activeSharedReport && isShareLinkPanelLoading ? (
                  <p className="text-xs text-slate-500">Preparing shared link...</p>
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
