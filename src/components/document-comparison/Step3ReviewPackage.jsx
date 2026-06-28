import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Info,
  Loader2,
  Lock,
  Sparkles,
  Type,
  Users,
} from 'lucide-react';
import { VISIBILITY_CONFIDENTIAL, VISIBILITY_SHARED, getDocumentCounts } from '@/pages/document-comparison/documentsModel';
import { RUN_AI_MEDIATION_LABEL, RUNNING_AI_MEDIATION_LABEL } from '@/lib/aiReportUtils';
import {
  buildBundleOnlyContextEstimate,
  buildMediationContextEstimate,
  estimateTokensFromText,
} from '@/lib/mediationContextLoad.js';

// ─────────────────────────────────────────────
//  Bundle section
// ─────────────────────────────────────────────

const MAX_BUNDLE_PREVIEW_CHARS = 1200;

function formatTokenCount(value) {
  const numeric = Number(value || 0);
  return `~${Math.max(0, Math.round(numeric)).toLocaleString()} tokens`;
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${Math.max(0, Math.round(numeric * 100))}%`;
}

function BundleSection({ label, icon, colorClass, borderClass, bgClass, sourceDocs, bundleText }) {
  const [expanded, setExpanded] = useState(false);

  const preview = bundleText
    ? expanded
      ? bundleText
      : bundleText.slice(0, MAX_BUNDLE_PREVIEW_CHARS)
    : '';

  const isTruncated = bundleText.length > MAX_BUNDLE_PREVIEW_CHARS;

  return (
    <Card className={`border ${borderClass} ${bgClass}`}>
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className={`text-base ${colorClass}`}>{label} Bundle</CardTitle>
          <Badge variant="outline" className={`text-xs ${colorClass} border-current`}>
            {sourceDocs.length} document{sourceDocs.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <CardDescription>
          {sourceDocs.length === 0
            ? 'No documents in this bundle.'
            : 'These documents will be compiled into the visible bundle preview for this review.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Source document list */}
        {sourceDocs.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Source documents
            </p>
            <ul className="space-y-1">
              {sourceDocs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  {doc.title || 'Untitled'}
                  {doc.source === 'uploaded' && (
                    <span className="text-xs text-slate-400">(uploaded)</span>
                  )}
                  {doc.text ? (
                    <span className="text-xs text-slate-400">
                      {doc.text.length.toLocaleString()} chars
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">No documents in this bundle.</p>
        )}

        {/* Compiled text preview */}
        {bundleText ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Compiled content preview
            </p>
            <div className="relative rounded-lg border border-slate-200 bg-white p-3">
              <pre
                className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto"
                data-testid={`bundle-preview-${label.toLowerCase()}`}
              >
                {preview}
              </pre>
              {isTruncated && !expanded && (
                <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-white rounded-b-lg" />
              )}
            </div>
            {isTruncated && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show less' : 'Show full content'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No content yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
//  Main Step 3 component
// ─────────────────────────────────────────────

/**
 * Step3ReviewPackage
 *
 * Props:
 *   documents               SourceDocument[]
 *   confidentialBundle      { text, html, json, source, files }  (compiled)
 *   sharedBundle            { text, html, json, source, files }   (compiled)
 *   reviewContextEstimate   optional later-round AI context estimate
 *   isFinishing             boolean
 *   finishStage             'idle' | 'saving' | 'evaluating'
 *   exceedsAnySizeLimit     boolean
 *   saveDraftPending        boolean
 *   evaluationFailureMessage string
 *   onBack                  () => void
 *   onRunEvaluation         () => void
 */
export default function Step3ReviewPackage({
  documents = [],
  confidentialBundle = { text: '', html: '<p></p>', json: null, source: 'typed', files: [] },
  sharedBundle = { text: '', html: '<p></p>', json: null, source: 'typed', files: [] },
  reviewContextEstimate = null,
  isFinishing = false,
  finishStage = 'idle',
  exceedsAnySizeLimit = false,
  saveDraftPending = false,
  onBack,
  onRunEvaluation,
  actionSlot = null,
  runActionLabel = '',
  runActionTestId = 'step2-run-evaluation-button',
  runActionDisabled = false,
  showRunAction = true,
  runActionDisabledMessage = '',
  actionButtonClassName = 'bg-blue-600 hover:bg-blue-700',
  footerNote = null,
  evaluationFailureMessage = '',
  backLabel = 'Back to Editor',
}) {
  const counts = getDocumentCounts(documents);
  const confidentialDocs = documents.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((d) => d.visibility === VISIBILITY_SHARED);

  const hasContent = Boolean(confidentialBundle.text || sharedBundle.text);
  const isRunning = isFinishing || saveDraftPending;
  const diagnosticMode = Boolean(import.meta?.env?.DEV || import.meta?.env?.MODE === 'test');

  const finishLabel = finishStage === 'evaluating'
    ? RUNNING_AI_MEDIATION_LABEL
    : finishStage === 'saving'
      ? 'Saving…'
      : RUN_AI_MEDIATION_LABEL;
  const resolvedRunActionLabel = isRunning ? finishLabel : runActionLabel || RUN_AI_MEDIATION_LABEL;

  const liveVisibleSharedTokens = estimateTokensFromText(sharedBundle.text || '');
  const liveVisibleConfidentialTokens = estimateTokensFromText(confidentialBundle.text || '');
  const resolvedReviewContextEstimate = reviewContextEstimate
    ? buildMediationContextEstimate({
      ...reviewContextEstimate,
      visibleSharedText: sharedBundle.text || '',
      visibleConfidentialText: confidentialBundle.text || '',
      directSharedTokens: Math.max(
        0,
        Number(reviewContextEstimate.directSharedTokens || 0) +
          (liveVisibleSharedTokens - Number(reviewContextEstimate.visibleSharedTokens || 0)),
      ),
      directConfidentialTokens: Math.max(
        0,
        Number(reviewContextEstimate.directConfidentialTokens || 0) +
          (liveVisibleConfidentialTokens - Number(reviewContextEstimate.visibleConfidentialTokens || 0)),
      ),
      estimatorMode: reviewContextEstimate.estimatorMode || 'workspace_preflight_live',
    })
    : buildBundleOnlyContextEstimate({
      sharedText: sharedBundle.text || '',
      confidentialText: confidentialBundle.text || '',
    });
  const capacityBand = resolvedReviewContextEstimate.capacityBand;
  const usageRatio = Number(resolvedReviewContextEstimate.usageRatio || 0);
  const usagePercent = Math.min(100, Math.max(4, usageRatio * 100));
  const showCapacityWarning = usageRatio >= 0.5;
  const showNearLimitWarning = usageRatio >= 0.75;

  return (
    <div className="space-y-6" data-testid="doc-comparison-step-3">

      {/* Overview card */}
      <Card>
        <CardHeader>
          <CardTitle>Final Review Before Mediation</CardTitle>
          <CardDescription>
            Review the visible Shared and Confidential bundles before running AI mediation.
            AI context load below also estimates prior-round summaries and retrieved negotiation history when available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <OverviewStat
              label="Total documents"
              value={counts.total}
              Icon={FileText}
              className="text-slate-700"
            />
            <OverviewStat
              label="Confidential"
              value={counts.confidential}
              Icon={Lock}
              className="text-rose-600"
            />
            <OverviewStat
              label="Shared"
              value={counts.shared}
              Icon={Users}
              className="text-emerald-600"
            />
            <OverviewStat
              label="Current bundle size"
              value={
                resolvedReviewContextEstimate.currentBundleWords > 0
                  ? `${resolvedReviewContextEstimate.currentBundleWords.toLocaleString()}w`
                  : '—'
              }
              Icon={Type}
              className="text-blue-600"
            />
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <ContextStat
                label="Current bundle size"
                value={`${resolvedReviewContextEstimate.currentBundleWords.toLocaleString()} words`}
                helper={formatTokenCount(resolvedReviewContextEstimate.currentBundleEstimatedTokens)}
              />
              <ContextStat
                label="Prior rounds considered"
                value={
                  resolvedReviewContextEstimate.includedPriorRounds > 0
                    ? resolvedReviewContextEstimate.includedPriorRounds.toLocaleString()
                    : 'None'
                }
                helper={
                  resolvedReviewContextEstimate.priorRoundTokens > 0
                    ? `${formatTokenCount(resolvedReviewContextEstimate.priorRoundTokens)} already sit inside the review bundle`
                    : 'No prior-round bundle text is currently included'
                }
              />
              <ContextStat
                label="Retrieved context chunks"
                value={
                  resolvedReviewContextEstimate.retrievedChunkCount > 0
                    ? resolvedReviewContextEstimate.retrievedChunkCount.toLocaleString()
                    : 'None'
                }
                helper={
                  resolvedReviewContextEstimate.retrievedContextTokens > 0
                    ? formatTokenCount(resolvedReviewContextEstimate.retrievedContextTokens)
                    : 'No retrieved negotiation history is currently estimated'
                }
              />
              <ContextStat
                label="Estimated AI context load"
                value={formatTokenCount(resolvedReviewContextEstimate.totalEstimatedInputTokens)}
                helper={`${formatPercent(resolvedReviewContextEstimate.usageRatio)} of the evaluator budget`}
              />
              <ContextStat
                label="Omitted due to capacity"
                value={
                  resolvedReviewContextEstimate.omittedDueToCapacityCount > 0
                    ? resolvedReviewContextEstimate.omittedDueToCapacityCount.toLocaleString()
                    : 'None'
                }
                helper={
                  resolvedReviewContextEstimate.omittedDueToCapacityCount > 0
                    ? resolvedReviewContextEstimate.omittedDueToCapacity.join('; ')
                    : 'Nothing is currently estimated to be omitted'
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  AI context load
                </span>
                <Info
                  className="w-3.5 h-3.5 text-slate-400 cursor-help"
                  title="AI context load estimates the full review context, including visible bundles, prior-round summaries, and retrieved negotiation history."
                />
              </div>
            </div>
            <div
              className="space-y-2"
              role="meter"
              aria-label={`AI context load: ${capacityBand.label}`}
              aria-valuenow={Math.round(Math.max(0, usageRatio) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`text-xs font-bold ${capacityBand.labelColor}`}>
                  {capacityBand.label}
                </span>
                <span className="text-xs text-slate-500">
                  {formatTokenCount(resolvedReviewContextEstimate.totalEstimatedInputTokens)} / {formatTokenCount(resolvedReviewContextEstimate.effectiveContextBudgetTokens)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${capacityBand.filledColor}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              AI context load estimates the full review context, including current bundles, prior-round summaries, and retrieved negotiation history.
            </p>
            {showCapacityWarning && (
              <>
                <p className="text-xs text-amber-700 font-medium">
                  The AI is now processing a heavier review context than the visible bundle alone suggests.
                </p>
                <p className="text-xs text-amber-600">
                  Larger context loads can reduce depth and consistency even when the visible bundle still looks small.
                </p>
              </>
            )}
            {showNearLimitWarning && (
              <p className="text-xs text-red-700 font-medium">
                Context usage is approaching the configured evaluator ceiling. Consider trimming history or splitting large updates before re-running mediation.
              </p>
            )}
            {diagnosticMode && (
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="ai-context-diagnostics">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  Context diagnostics
                </summary>
                <div className="mt-2 space-y-1">
                  <p>directBundleTokens: {(resolvedReviewContextEstimate.directSharedTokens + resolvedReviewContextEstimate.directConfidentialTokens).toLocaleString()}</p>
                  <p>priorRoundTokens: {resolvedReviewContextEstimate.priorRoundTokens.toLocaleString()}</p>
                  <p>retrievedChunkTokens: {resolvedReviewContextEstimate.retrievedContextTokens.toLocaleString()}</p>
                  <p>historySummaryTokens: {resolvedReviewContextEstimate.summaryMemoryTokens.toLocaleString()}</p>
                  <p>promptOverheadTokens: {resolvedReviewContextEstimate.promptOverheadTokens.toLocaleString()}</p>
                  <p>totalEstimatedInputTokens: {resolvedReviewContextEstimate.totalEstimatedInputTokens.toLocaleString()}</p>
                  <p>modelContextBudget: {resolvedReviewContextEstimate.effectiveContextBudgetTokens.toLocaleString()}</p>
                  <p>outputReserveTokens: {resolvedReviewContextEstimate.outputReserveTokens.toLocaleString()}</p>
                  <p>usageRatio: {resolvedReviewContextEstimate.usageRatio.toFixed(3)}</p>
                  <p>capacityLabel: {resolvedReviewContextEstimate.capacityLabel}</p>
                  <p>estimatorMode: {resolvedReviewContextEstimate.estimatorMode}</p>
                </div>
              </details>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Limit warning */}
      {exceedsAnySizeLimit && (
        <Alert className="bg-red-50 border-red-200">
          <AlertTriangle className="h-4 w-4 text-red-700" />
          <AlertDescription className="text-red-800">
            Content is over the AI size limit. Go back and reduce text before running AI mediation.
          </AlertDescription>
        </Alert>
      )}

      {evaluationFailureMessage ? (
        <Alert className="bg-red-50 border-red-200">
          <AlertTriangle className="h-4 w-4 text-red-700" />
          <AlertDescription className="text-red-800">
            {evaluationFailureMessage}
          </AlertDescription>
        </Alert>
      ) : null}

      {runActionDisabledMessage ? (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            {runActionDisabledMessage}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Privacy reminder */}
      <Alert className="bg-blue-50 border-blue-200">
        <Lock className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-xs">
          <strong>Privacy reminder:</strong> Confidential content is used during AI mediation
          but will never appear in the recipient-facing shared report.
          Only Shared content is publicly accessible.
        </AlertDescription>
      </Alert>

      {/* Bundle panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BundleSection
          label="Confidential"
          icon={<Lock className="w-5 h-5 text-rose-500" />}
          colorClass="text-rose-700"
          borderClass="border-rose-200"
          bgClass="bg-rose-50/30"
          sourceDocs={confidentialDocs}
          bundleText={confidentialBundle.text || ''}
        />
        <BundleSection
          label="Shared"
          icon={<Users className="w-5 h-5 text-emerald-500" />}
          colorClass="text-emerald-700"
          borderClass="border-emerald-200"
          bgClass="bg-emerald-50/30"
          sourceDocs={sharedDocs}
          bundleText={sharedBundle.text || ''}
        />
      </div>

      {/* Empty state warning */}
      {!hasContent && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-800">
            Both bundles are empty. Go back to Step 2 and add content before running AI mediation.
          </AlertDescription>
        </Alert>
      )}

      {footerNote}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isRunning}
          data-testid="step3-back-button"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {backLabel}
        </Button>
        {actionSlot || (
          showRunAction ? (
            <Button
              type="button"
              onClick={onRunEvaluation}
              disabled={isRunning || exceedsAnySizeLimit || !hasContent || runActionDisabled}
              className={actionButtonClassName}
              data-testid={runActionTestId}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {resolvedRunActionLabel}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {resolvedRunActionLabel}
                </>
              )}
            </Button>
          ) : (
            <div />
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Shared sub-component
// ─────────────────────────────────────────────

function OverviewStat({ label, value, Icon, className }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-4 px-2 gap-1 text-center">
      <Icon className={`w-5 h-5 ${className}`} />
      <span className={`text-2xl font-bold ${className}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

function ContextStat({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}
