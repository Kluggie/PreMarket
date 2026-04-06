/**
 * DocumentComparisonRunDetails — internal run metadata page.
 *
 * Shows provider/model, evaluation history (with input hashes), inputs used, and
 * quality assessment for a document comparison.  This view is intentionally kept
 * separate from the mediation review so the report screen stays clean. It is never
 * included in any PDF export.
 *
 * Access control: the route sits inside the authenticated app shell so it already
 * requires a logged-in session.  Confidential hashes and the reveal-preview feature
 * are additionally gated by isOwnerView (server-side access_mode === 'owner').
 */
import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react';
import {
  getConfidencePercent,
  getReviewStageLabel,
  getReviewStatusDetails,
  STAGE1_INITIAL_REVIEW_LABEL,
} from '@/lib/aiReportUtils';
import {
  isLegacyPreSendReviewStage,
  isPreSendReviewStage,
  isSharedIntakeReviewStage,
  resolveOpportunityReviewStage,
} from '@/lib/opportunityReviewStage';

// ─── helpers ─────────────────────────────────────────────────────────────────

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function toSafeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.floor(numeric);
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function isSuccessfulEvaluationStatus(value) {
  const status = asLower(value);
  return (
    status === 'completed' ||
    status === 'succeeded' ||
    status === 'success' ||
    status === 'evaluated'
  );
}

function extractEvaluationFailureDetails(rawError) {
  if (!rawError || typeof rawError !== 'object' || Array.isArray(rawError)) return null;

  const details =
    rawError.details && typeof rawError.details === 'object' && !Array.isArray(rawError.details)
      ? rawError.details
      : {};
  const diagnostics =
    details.diagnostics &&
    typeof details.diagnostics === 'object' &&
    !Array.isArray(details.diagnostics)
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
    rawError.requestId || rawError.request_id || details.requestId || details.request_id,
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

  if (!failureCode && !message) return null;

  return {
    failureCode: failureCode || 'unknown_error',
    failureStage: failureStage || 'unknown',
    parseErrorKind: parseErrorKind || '',
    message,
    requestId: requestId || '',
  };
}

function getEvaluationRowMeta(evaluation, reviewStage) {
  const status = asLower(evaluation?.status);
  const failure = extractEvaluationFailureDetails(evaluation?.result?.error);
  const errorCode = asLower(failure?.failureCode || evaluation?.result?.error?.code);

  if (errorCode === 'not_configured') {
    return {
      label: 'Not configured',
      badgeClassName: 'bg-amber-100 text-amber-800',
      rowClassName: 'rounded-xl border border-amber-200 bg-amber-50 p-3',
      scoreLabel: '—',
    };
  }

  if (status === 'failed' || errorCode) {
    return {
      label: 'Failed',
      badgeClassName: 'bg-red-100 text-red-700',
      rowClassName: 'rounded-xl border border-red-200 bg-red-50 p-3',
      scoreLabel: '—',
    };
  }

  if (status === 'running' || status === 'queued' || status === 'evaluating') {
    return {
      label: 'Running',
      badgeClassName: 'bg-blue-100 text-blue-700',
      rowClassName: 'rounded-xl border border-blue-200 bg-blue-50 p-3',
      scoreLabel: '—',
    };
  }

  if (isSuccessfulEvaluationStatus(status)) {
    const numericScore = Number(evaluation?.score);
    return {
      label: 'Succeeded',
      badgeClassName: 'bg-green-100 text-green-700',
      rowClassName: 'rounded-xl border border-green-200 bg-green-50 p-3',
      scoreLabel: isPreSendReviewStage(reviewStage)
        ? 'shared intake'
        : Number.isFinite(numericScore)
        ? `${Math.max(0, Math.round(numericScore))}% confidence`
        : '—',
    };
  }

  return {
    label: status || 'Unknown',
    badgeClassName: 'bg-slate-100 text-slate-700',
    rowClassName: 'rounded-xl border border-slate-200 bg-slate-50 p-3',
    scoreLabel: '—',
  };
}

function getEvaluationInputMeta(evaluation) {
  const trace =
    evaluation?.result?.input_trace &&
    typeof evaluation.result.input_trace === 'object' &&
    !Array.isArray(evaluation.result.input_trace)
      ? evaluation.result.input_trace
      : {};

  return {
    inputSharedHash: asText(
      evaluation?.input_shared_hash || trace.shared_hash || trace.input_shared_hash,
    ),
    inputConfHash: asText(
      evaluation?.input_conf_hash || trace.confidential_hash || trace.input_conf_hash,
    ),
    inputSharedLen:
      toSafeInteger(evaluation?.input_shared_len) ??
      toSafeInteger(trace.shared_length) ??
      toSafeInteger(trace.input_shared_len),
    inputConfLen:
      toSafeInteger(evaluation?.input_conf_len) ??
      toSafeInteger(trace.confidential_length) ??
      toSafeInteger(trace.input_conf_len),
    inputVersion:
      toSafeInteger(evaluation?.input_version) ?? toSafeInteger(trace.input_version),
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
    provider:
      asLower(providerRaw) === 'vertex' ? 'vertex' : providerRaw ? 'fallback' : 'unknown',
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

// ─── component ────────────────────────────────────────────────────────────────

export default function DocumentComparisonRunDetails() {
  const comparisonId = useComparisonId();
  const [showInputPreview, setShowInputPreview] = useState(false);
  const [selectedFailureEntry, setSelectedFailureEntry] = useState(null);

  const comparisonQuery = useQuery({
    queryKey: ['document-comparison-run-details', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = comparisonQuery.data?.comparison || null;
  const permissions = comparisonQuery.data?.permissions || null;
  const proposal = comparisonQuery.data?.proposal || null;
  const isOwnerView = asLower(permissions?.access_mode) === 'owner';

  const evaluationsQuery = useQuery({
    queryKey: [
      'document-comparison-run-details-evaluations',
      comparisonId,
      proposal?.id || 'none',
    ],
    enabled: Boolean(proposal?.id && comparison?.id === comparisonId),
    queryFn: () => proposalsClient.getEvaluations(proposal.id),
  });

  const evaluationHistory = Array.isArray(evaluationsQuery.data) ? evaluationsQuery.data : [];
  const latestEvaluation = evaluationHistory[0] || null;
  const latestProviderMeta = latestEvaluation
    ? getEvaluationProviderMeta(latestEvaluation)
    : getEvaluationProviderMeta({ result: comparison?.evaluation_result || {} });

  const report = comparison?.public_report || comparison?.evaluation_result?.report || {};
  const reviewStage = resolveOpportunityReviewStage(report, {
    source: latestEvaluation?.source,
  });
  const isOneSidedReview = isPreSendReviewStage(reviewStage);
  const isSharedIntake = isSharedIntakeReviewStage(reviewStage);
  const isLegacyPreSend = isLegacyPreSendReviewStage(reviewStage);
  const reviewLabel = getReviewStageLabel(reviewStage);
  const reviewStatus = getReviewStatusDetails(report);
  const comparisonStatus = asLower(comparison?.status);
  const isEvaluationSucceeded =
    comparisonStatus === 'evaluated' &&
    Boolean(report && typeof report === 'object' && !Array.isArray(report) && Object.keys(report).length > 0);

  const confidentialWordCount = String(comparison?.doc_a_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const sharedWordCount = String(comparison?.doc_b_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;

  const rawInputTrace =
    comparison?.evaluation_result?.input_trace &&
    typeof comparison?.evaluation_result?.input_trace === 'object' &&
    !Array.isArray(comparison?.evaluation_result?.input_trace)
      ? comparison.evaluation_result.input_trace
      : null;

  const evaluatedInputTrace = {
    source: asText(rawInputTrace?.source) || 'unknown',
    confidentialLength: toSafeNumber(
      rawInputTrace?.confidential_length,
      String(comparison?.doc_a_text || '').length,
    ),
    sharedLength: toSafeNumber(
      rawInputTrace?.shared_length,
      String(comparison?.doc_b_text || '').length,
    ),
    confidentialWords: toSafeNumber(rawInputTrace?.confidential_words, confidentialWordCount),
    sharedWords: toSafeNumber(rawInputTrace?.shared_words, sharedWordCount),
    confidentialHash: asText(rawInputTrace?.confidential_hash),
    sharedHash: asText(rawInputTrace?.shared_hash),
  };

  const similarityScore = isEvaluationSucceeded
    ? Number(
        comparison?.evaluation_result?.score ??
          report?.similarity_score ??
          latestEvaluation?.score ??
          0,
      )
    : null;

  // ── error / loading states ──────────────────────────────────────────────────

  if (!comparisonId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-6">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900">Missing comparison id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (comparisonQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-6">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="py-8 flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (comparisonQuery.error || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-6">
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-900">
              {comparisonQuery.error?.message || 'Comparison not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-4xl mx-auto px-6 space-y-6">

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          <Link
            to={createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(comparisonId)}&tab=report`)}
            className="inline-flex items-center text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {`Back to ${reviewLabel}`}
          </Link>
        </div>

        {/* Page header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-slate-500" />
            <h1 className="text-2xl font-bold text-slate-900">Run Details</h1>
          </div>
          <p className="text-sm text-slate-500">
            Internal {reviewLabel} run metadata for <span className="font-medium text-slate-700">{comparison.title}</span>.
            This page is not included in PDF exports or shared reports.
          </p>
        </div>

        {/* Provider / model */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Provider</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            <span className="font-mono">
              {latestProviderMeta.provider}
              {latestProviderMeta.model ? ` · ${latestProviderMeta.model}` : ''}
            </span>
            {latestProviderMeta.provider !== 'vertex' && latestProviderMeta.reason ? (
              <span className="text-slate-500 ml-1">({latestProviderMeta.reason})</span>
            ) : null}
          </CardContent>
        </Card>

        {/* Mediation history */}
        {evaluationHistory.length > 0 ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{`${reviewLabel} History (${evaluationHistory.length})`}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {evaluationHistory.map((evaluation, index) => {
                  const rowMeta = getEvaluationRowMeta(evaluation, reviewStage);
                  const rowFailure = extractEvaluationFailureDetails(evaluation?.result?.error);
                  const rowInputMeta = getEvaluationInputMeta(evaluation);
                  const rowProviderMeta = getEvaluationProviderMeta(evaluation);
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
                          <p className="text-xs text-slate-500">
                            Provider:{' '}
                            <span className="font-mono text-slate-700">
                              {rowProviderMeta.provider}
                              {rowProviderMeta.model ? ` · ${rowProviderMeta.model}` : ''}
                            </span>
                            {rowProviderMeta.provider !== 'vertex' && rowProviderMeta.reason ? (
                              <span className="text-slate-500"> ({rowProviderMeta.reason})</span>
                            ) : null}
                          </p>
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
        ) : evaluationsQuery.isLoading ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="py-5 flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {`Loading ${reviewLabel} history…`}
            </CardContent>
          </Card>
        ) : null}

        {/* Failure details inline panel */}
        {selectedFailureEntry ? (
          <Card className="border border-red-200 bg-red-50 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-red-800">{`${reviewLabel} Failure Details`}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-700 hover:text-red-900"
                  onClick={() => setSelectedFailureEntry(null)}
                >
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-slate-500">Failure code</p>
                <p className="font-mono text-slate-900">
                  {asText(selectedFailureEntry.failure?.failureCode) || 'unknown_error'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Failure message</p>
                <p className="text-slate-900">
                  {asText(selectedFailureEntry.failure?.message) || `${reviewLabel} failed`}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Failure stage</p>
                <p className="font-mono text-slate-900">
                  {asText(selectedFailureEntry.failure?.failureStage) || 'unknown'}
                </p>
              </div>
              {selectedFailureEntry.failure?.requestId ? (
                <div>
                  <p className="text-slate-500">Request ID</p>
                  <p className="font-mono text-slate-900">{selectedFailureEntry.failure.requestId}</p>
                </div>
              ) : null}
              <div>
                <p className="text-slate-500">Timestamp</p>
                <p className="text-slate-900">{formatDateTime(selectedFailureEntry.createdDate)}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Inputs Used — only for owners */}
        {isOwnerView ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Inputs Used</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Source:{' '}
                <span className="font-medium text-slate-900">{evaluatedInputTrace.source}</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">{CONFIDENTIAL_LABEL}</p>
                  <p className="text-slate-600">
                    {evaluatedInputTrace.confidentialWords} words •{' '}
                    {evaluatedInputTrace.confidentialLength} chars
                  </p>
                  <p className="text-slate-500 font-mono text-xs">
                    hash: {evaluatedInputTrace.confidentialHash || '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">{SHARED_LABEL}</p>
                  <p className="text-slate-600">
                    {evaluatedInputTrace.sharedWords} words •{' '}
                    {evaluatedInputTrace.sharedLength} chars
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
                  onClick={() => setShowInputPreview((c) => !c)}
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

        {/* Quality Assessment */}
        {isEvaluationSucceeded ? (
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
              {isSharedIntake ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-slate-500">Review Type</p>
                    <p className="text-xl font-semibold text-slate-900">{reviewLabel}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">{STAGE1_INITIAL_REVIEW_LABEL}</p>
                    <p className="text-xl font-semibold text-slate-900">{reviewStatus.label}</p>
                  </div>
                </div>
              ) : isLegacyPreSend ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-slate-500">Review Type</p>
                    <p className="text-xl font-semibold text-slate-900">{reviewLabel}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Readiness to Send</p>
                    <p className="text-xl font-semibold text-slate-900">{reviewStatus.label}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-slate-500 mb-2">Overall Confidence</p>
                  <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-3 bg-slate-500 rounded-full"
                      style={{ width: `${getConfidencePercent(report, similarityScore)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Empty state */}
        {!isEvaluationSucceeded && evaluationHistory.length === 0 && !evaluationsQuery.isLoading ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="py-6 text-slate-600 text-sm">
              {`No ${reviewLabel} data yet. Run the review from the editor first.`}
            </CardContent>
          </Card>
        ) : null}

      </div>
    </div>
  );
}
