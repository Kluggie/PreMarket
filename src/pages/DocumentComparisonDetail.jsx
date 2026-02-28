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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Copy,
  Download,
  FileText,
  Loader2,
  Send,
  Sparkles,
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
  const failureCode = asLower(
    rawError.failure_code || details.failure_code || rawError.code || details.code,
  );
  const failureStage = asLower(
    rawError.failure_stage || details.failure_stage || rawError.stage || details.stage,
  );
  const message = asText(rawError.message) || 'Evaluation failed';
  const requestId = asText(
    rawError.requestId ||
      rawError.request_id ||
      details.requestId ||
      details.request_id,
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
    message,
    requestId: requestId || '',
    httpStatus: Number.isFinite(httpStatus) && httpStatus > 0 ? httpStatus : null,
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
    return 'Vertex returned an invalid response format. Please retry.';
  }
  if (code === 'vertex_generic_output') {
    return 'Vertex returned a generic report. Please retry with richer shared content.';
  }
  if (code === 'db_write_failed') {
    return 'Evaluation could not be saved. Please retry.';
  }
  if (code === 'not_configured') {
    return 'Vertex AI integration is not configured.';
  }
  return 'Evaluation failed. Please retry from the editor.';
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
      timelineTitle: 'AI Not Configured',
    };
  }

  if (status === 'failed' || errorCode) {
    return {
      label: 'Failed',
      badgeClassName: 'bg-red-100 text-red-700',
      rowClassName: 'rounded-xl border border-red-200 bg-red-50 p-3',
      scoreLabel: '—',
      timelineTitle: 'Evaluation Failed',
    };
  }

  if (status === 'running' || status === 'queued' || status === 'evaluating') {
    return {
      label: 'Running',
      badgeClassName: 'bg-blue-100 text-blue-700',
      rowClassName: 'rounded-xl border border-blue-200 bg-blue-50 p-3',
      scoreLabel: '—',
      timelineTitle: 'Evaluation Running',
    };
  }

  if (isSuccessfulEvaluationStatus(status)) {
    const numericScore = Number(evaluation?.score);
    return {
      label: 'Succeeded',
      badgeClassName: 'bg-green-100 text-green-700',
      rowClassName: 'rounded-xl border border-green-200 bg-green-50 p-3',
      scoreLabel: Number.isFinite(numericScore) ? `${Math.max(0, Math.round(numericScore))}% confidence` : '—',
      timelineTitle: 'Evaluation Complete',
    };
  }

  return {
    label: status || 'Unknown',
    badgeClassName: 'bg-slate-100 text-slate-700',
    rowClassName: 'rounded-xl border border-slate-200 bg-slate-50 p-3',
    scoreLabel: '—',
    timelineTitle: 'Evaluation Update',
  };
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function toSummaryLines(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return asText(entry);
      }
      if (entry && typeof entry === 'object') {
        return asText(entry.text || entry.title || '');
      }
      return '';
    })
    .filter(Boolean);
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

function useComparisonId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

export default function DocumentComparisonDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const comparisonId = useComparisonId();
  const [activeTab, setActiveTab] = useState('overview');
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareRecipientEmail, setShareRecipientEmail] = useState('');
  const [selectedShareToken, setSelectedShareToken] = useState('');
  const [evaluationPollDeadline, setEvaluationPollDeadline] = useState(null);
  const [selectedFailureEntry, setSelectedFailureEntry] = useState(null);
  const [showInputPreview, setShowInputPreview] = useState(false);

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
  const sharedWordCount = String(comparison?.doc_b_text || '')
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
    setShareRecipientEmail((current) => current || asText(proposal?.party_b_email));
  }, [isShareDialogOpen, proposal?.party_b_email]);

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
  const reportSections = Array.isArray(report?.sections) ? report.sections : [];
  const evaluationHistory = Array.isArray(evaluationsQuery.data) ? evaluationsQuery.data : [];
  const latestEvaluation = evaluationHistory[0] || null;
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
    : `Evaluation failed. ${evaluationFailureMessage || 'Please retry from the editor.'}`;
  const hasReportData = hasObjectContent(report);
  const isEvaluationSucceeded =
    !isEvaluationRunning &&
    !isEvaluationNotConfigured &&
    !isEvaluationFailed &&
    comparisonStatus === 'evaluated' &&
    hasReportData;
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
      toast.success('Proposal details PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download proposal details PDF');
    },
  });

  const downloadAiReportMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadPdf(comparisonId),
    onSuccess: () => {
      toast.success('AI report PDF download started');
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error('AI report PDF is not configured in this environment yet.');
        return;
      }
      toast.error(error?.message || 'AI report PDF download unavailable');
    },
  });

  const createShareLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await sharedReportsClient.create({
        comparisonId,
        recipientEmail: asText(shareRecipientEmail) || null,
      });

      if (!response?.token) {
        throw new Error('Shared report link could not be created');
      }

      return response;
    },
    onSuccess: async (payload) => {
      setSelectedShareToken(payload.token);
      await queryClient.invalidateQueries({ queryKey: ['shared-reports', comparisonId] });
      toast.success('Shared report link created');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to create shared report link');
    },
  });

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

  const revokeShareLinkMutation = useMutation({
    mutationFn: (token) => sharedReportsClient.revoke(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shared-reports', comparisonId] });
      toast.success('Shared report link revoked');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to revoke shared report link');
    },
  });

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
  const overviewBullets = (() => {
    const collected = [];
    const pushUnique = (line) => {
      const normalized = asText(line);
      if (!normalized || collected.includes(normalized)) {
        return;
      }
      collected.push(normalized);
    };

    toSummaryLines(report?.summary?.top_fit_reasons).forEach(pushUnique);
    toSummaryLines(report?.summary?.top_blockers).forEach(pushUnique);
    toSummaryLines(report?.summary?.next_actions).forEach(pushUnique);

    if (collected.length === 0) {
      reportSections.forEach((section) => {
        const bullets = Array.isArray(section?.bullets) ? section.bullets : [];
        bullets.forEach(pushUnique);
      });
    }

    return collected.slice(0, 6);
  })();
  const similarityScore = isEvaluationSucceeded
    ? Number(comparison?.evaluation_result?.score ?? report?.similarity_score ?? latestEvaluation?.score ?? 0)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 space-y-6">
        <Link
          to={createPageUrl('Proposals')}
          className="inline-flex items-center text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Proposals
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
              Edit Proposal
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadProposalPdfMutation.mutate()}
              disabled={downloadProposalPdfMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              Complete Proposal Details
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadAiReportMutation.mutate()}
              disabled={downloadAiReportMutation.isPending}
            >
              <Download className="w-4 h-4 mr-2" />
              AI report
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
                  <p className="font-semibold text-slate-900">{proposal?.party_b_email || 'Not specified'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-white border border-slate-200 p-1">
              <TabsTrigger
                value="overview"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <FileText className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="report"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                AI Report
                {hasReport && <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>}
              </TabsTrigger>
              <TabsTrigger
                value="details"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <FileText className="w-4 h-4 mr-2" />
                Complete Proposal Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isEvaluationRunning ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-slate-700">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="font-medium">Evaluation is running...</span>
                        </div>
                        <p className="text-sm text-slate-500">
                          {isPollingTimedOut
                            ? 'Still processing. Refresh to check for updates.'
                            : 'This page refreshes automatically while evaluation is in progress.'}
                        </p>
                      </div>
                    ) : null}

                    {isEvaluationNotConfigured ? (
                      <Alert className="bg-amber-50 border-amber-200">
                        <AlertDescription className="text-amber-900">
                          Vertex AI integration is not configured.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {isEvaluationFailed ? (
                      <Alert className="bg-red-50 border-red-200">
                        <AlertDescription className="text-red-900">
                          {evaluationFailureBannerMessage}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && hasReport ? (
                      <>
                        <p className="text-slate-700">
                          Latest recommendation:{' '}
                          <span className="font-semibold capitalize">{recommendation || 'not provided'}</span>
                        </p>
                        {overviewBullets.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                            {overviewBullets.map((line, index) => (
                              <li key={`overview-bullet-${index}`}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-slate-600">Evaluation completed. Open AI Report for full details.</p>
                        )}
                      </>
                    ) : null}

                    {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && !hasReport ? (
                      <p className="text-sm text-slate-600">
                        No evaluation yet. Use Run Evaluation from the editor to generate it.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Activity Timeline</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">Proposal Created</p>
                        <p className="text-slate-500">{formatDateTime(comparison.created_date)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">Last Updated</p>
                        <p className="text-slate-500">{formatDateTime(comparison.updated_date)}</p>
                      </div>
                    </div>
                    {latestEvaluation && (
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center ${
                            latestEvaluationMeta.label === 'Succeeded'
                              ? 'bg-purple-100 text-purple-700'
                              : latestEvaluationMeta.label === 'Not configured'
                                ? 'bg-amber-100 text-amber-700'
                                : latestEvaluationMeta.label === 'Failed'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{latestEvaluationMeta.timelineTitle}</p>
                          <p className="text-slate-500">{formatDateTime(latestEvaluation.created_date)}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="report" className="mt-6 space-y-6">
              {isEvaluationRunning ? (
                <Card className="border border-slate-200 shadow-sm">
                  <CardContent className="py-6">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="font-medium">Evaluation in progress...</span>
                    </div>
                    <p className="text-sm text-slate-500 mt-2">
                      {isPollingTimedOut
                        ? 'Still processing. Refresh to check status.'
                        : 'Report updates automatically when processing finishes.'}
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              {isEvaluationNotConfigured ? (
                <Alert className="bg-amber-50 border-amber-200">
                  <AlertDescription className="text-amber-900">
                    Vertex AI integration is not configured. AI report not available (AI not configured).
                  </AlertDescription>
                </Alert>
              ) : null}

              {isEvaluationFailed ? (
                <Alert className="bg-red-50 border-red-200">
                  <AlertDescription className="text-red-900">
                    {evaluationFailureBannerMessage}
                  </AlertDescription>
                </Alert>
              ) : null}

              {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && !hasReport && evaluationHistory.length === 0 ? (
                <Card className="border border-slate-200 shadow-sm">
                  <CardContent className="py-6 text-slate-600">
                    No evaluation yet. Go to the editor and use Run Evaluation to generate it.
                  </CardContent>
                </Card>
              ) : null}

              {evaluationHistory.length > 0 ? (
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Evaluation History ({evaluationHistory.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {evaluationHistory.map((evaluation, index) => {
                        const rowMeta = getEvaluationRowMeta(evaluation);
                        const rowFailure = extractEvaluationFailureDetails(evaluation?.result?.error);
                        const rowInputMeta = getEvaluationInputMeta(evaluation);
                        const hasRowInputMeta =
                          Boolean(rowInputMeta.inputSharedHash) ||
                          Boolean(rowInputMeta.inputConfHash) ||
                          Number.isFinite(Number(rowInputMeta.inputSharedLen)) ||
                          Number.isFinite(Number(rowInputMeta.inputConfLen));
                        return (
                          <div
                            key={evaluation.id || `evaluation-${index}`}
                            className={rowMeta.rowClassName}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                  <Badge className={rowMeta.badgeClassName}>{rowMeta.label}</Badge>
                                  <span className="text-slate-700">{formatDateTime(evaluation.created_date)}</span>
                                  {index === 0 ? <Badge variant="outline">Latest</Badge> : null}
                                </div>
                                {rowFailure ? (
                                  <p className="text-xs text-slate-500">
                                    Failure code:{' '}
                                    <span className="font-mono text-slate-700">{rowFailure.failureCode}</span>
                                  </p>
                                ) : null}
                                {isOwnerView && hasRowInputMeta ? (
                                  <p className="text-xs text-slate-500">
                                    Inputs:{' '}
                                    <span className="font-mono text-slate-700">
                                      shared[{rowInputMeta.inputSharedLen ?? '—'}|{rowInputMeta.inputSharedHash || '—'}]
                                    </span>{' '}
                                    ·{' '}
                                    <span className="font-mono text-slate-700">
                                      conf[{rowInputMeta.inputConfLen ?? '—'}|{rowInputMeta.inputConfHash || '—'}]
                                    </span>
                                    {Number.isFinite(Number(rowInputMeta.inputVersion))
                                      ? ` · v${rowInputMeta.inputVersion}`
                                      : ''}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-semibold ${
                                    rowMeta.label === 'Succeeded' ? 'text-blue-600' : 'text-slate-600'
                                  }`}
                                >
                                  {rowMeta.scoreLabel}
                                </span>
                                {rowFailure ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setSelectedFailureEntry({
                                        evaluationId: evaluation.id || '',
                                        createdDate: evaluation.created_date || null,
                                        failure: rowFailure,
                                      })
                                    }
                                  >
                                    View details
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {hasReport && isOwnerView ? (
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Inputs Used</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-600">
                      Source: <span className="font-medium text-slate-900">{evaluatedInputTrace.source}</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-800">{CONFIDENTIAL_LABEL}</p>
                        <p className="text-slate-600">
                          {evaluatedInputTrace.confidentialWords} words • {evaluatedInputTrace.confidentialLength} chars
                        </p>
                        <p className="text-slate-500 font-mono text-xs">
                          hash: {evaluatedInputTrace.confidentialHash || '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="font-semibold text-slate-800">{SHARED_LABEL}</p>
                        <p className="text-slate-600">
                          {evaluatedInputTrace.sharedWords} words • {evaluatedInputTrace.sharedLength} chars
                        </p>
                        <p className="text-slate-500 font-mono text-xs">
                          hash: {evaluatedInputTrace.sharedHash || '—'}
                        </p>
                      </div>
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowInputPreview((current) => !current)}
                      >
                        {showInputPreview ? 'Hide preview' : 'Reveal preview'}
                      </Button>
                    </div>
                    {showInputPreview ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="font-semibold text-slate-700 mb-1">{CONFIDENTIAL_LABEL} preview</p>
                          <p className="text-slate-600 whitespace-pre-wrap">
                            {String(comparison?.doc_a_text || '').slice(0, 120) || '—'}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="font-semibold text-slate-700 mb-1">{SHARED_LABEL} preview</p>
                          <p className="text-slate-600 whitespace-pre-wrap">
                            {String(comparison?.doc_b_text || '').slice(0, 120) || '—'}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {hasReport ? (
                <>
                  <Card className="border border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Quality Assessment</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <p className="text-slate-500">{CONFIDENTIAL_LABEL} Words</p>
                          <p className="text-4xl font-bold text-slate-900">{confidentialWordCount}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">{SHARED_LABEL} Words</p>
                          <p className="text-4xl font-bold text-slate-900">{sharedWordCount}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-2">Overall Confidence</p>
                        <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-3 bg-slate-500 rounded-full"
                            style={{ width: `${Math.max(0, Math.min(Number(similarityScore || 0), 100))}%` }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Executive Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Badge variant="outline" className="capitalize">
                        {recommendation || 'No recommendation provided'}
                      </Badge>
                      {reportSections.length > 0 ? (
                        <div className="space-y-4">
                          {reportSections.map((section, index) => (
                            <div
                              key={`${section.key || section.heading || 'section'}-${index}`}
                              className="rounded-xl border border-slate-200 p-4"
                            >
                              <p className="font-semibold text-slate-900 mb-2">
                                {section.heading || section.key || `Section ${index + 1}`}
                              </p>
                              <ul className="list-disc pl-5 space-y-1 text-slate-700">
                                {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                                  <li key={`${index}-${lineIndex}`}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-600">AI report content is not available yet.</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="details" className="mt-6">
              <Card className="border border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle>Complete Proposal Details</CardTitle>
                  <p className="text-slate-500">
                    Read-only document content for both information documents.
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                      <FileText className="w-4 h-4" />
                      {comparison.party_a_label || CONFIDENTIAL_LABEL}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-h-[320px] max-h-[560px] overflow-auto">
                      {renderDocumentReadOnly({
                        text: comparison.doc_a_text || '',
                        html: comparison.doc_a_html || '',
                      })}
                    </div>
                  </div>

                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                      <FileText className="w-4 h-4" />
                      {comparison.party_b_label || SHARED_LABEL}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 min-h-[320px] max-h-[560px] overflow-auto">
                      {renderDocumentReadOnly({
                        text: comparison.doc_b_text || '',
                        html: comparison.doc_b_html || '',
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedFailureEntry)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedFailureEntry(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Evaluation Failure Details</DialogTitle>
            <DialogDescription>
              Safe diagnostic details for this evaluation attempt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-slate-500">Failure code</p>
              <p className="font-mono text-slate-900">
                {asText(selectedFailureEntry?.failure?.failureCode) || 'unknown_error'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Failure message</p>
              <p className="text-slate-900">
                {asText(selectedFailureEntry?.failure?.message) || 'Evaluation failed'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Failure stage</p>
              <p className="font-mono text-slate-900">
                {asText(selectedFailureEntry?.failure?.failureStage) || 'unknown'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Request ID</p>
              <p className="font-mono text-slate-900">
                {asText(selectedFailureEntry?.failure?.requestId) || '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Timestamp</p>
              <p className="text-slate-900">{formatDateTime(selectedFailureEntry?.createdDate)}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isShareDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsShareDialogOpen(nextOpen);
          if (!nextOpen) {
            setShareRecipientEmail('');
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
                variant="outline"
                onClick={() => createShareLinkMutation.mutate()}
                disabled={createShareLinkMutation.isPending || sendShareEmailMutation.isPending}
              >
                {createShareLinkMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                Create link
              </Button>
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

            {sharedReportsQuery.isLoading ? (
              <p className="text-sm text-slate-500">Loading shared links...</p>
            ) : null}

            {activeSharedReport ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{activeSharedReport.status || 'active'}</Badge>
                  {activeSharedReport.last_delivery?.status ? (
                    <Badge className="bg-blue-100 text-blue-700">
                      Last delivery: {activeSharedReport.last_delivery.status}
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Share URL</Label>
                  <Input readOnly value={activeSharedReport.url || ''} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => copyShareUrl(activeSharedReport.url || '')}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy link
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => sendShareEmailMutation.mutate(activeSharedReport.token)}
                    disabled={sendShareEmailMutation.isPending}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Resend email
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => revokeShareLinkMutation.mutate(activeSharedReport.token)}
                    disabled={revokeShareLinkMutation.isPending || activeSharedReport.status === 'revoked'}
                  >
                    Revoke link
                  </Button>
                </div>

                {Array.isArray(activeSharedReport.deliveries) && activeSharedReport.deliveries.length > 0 ? (
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
                  <p className="text-xs text-slate-500 pt-2">No delivery attempts yet.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No shared report link has been created yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
