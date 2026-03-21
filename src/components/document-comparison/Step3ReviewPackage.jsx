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

// ─────────────────────────────────────────────
//  Bundle section
// ─────────────────────────────────────────────

const MAX_BUNDLE_PREVIEW_CHARS = 1200;

// ─────────────────────────────────────────────
//  AI capacity estimation
// ─────────────────────────────────────────────

// Quality heuristic for AI review capacity bands.
// The mediation model (gemini-2.5-pro) has a very large context window, so these
// bands do NOT reflect the model's hard input limit. They are app-level quality
// bands: larger packages can reduce depth, nuance, and consistency of the review
// even when they are well within the model's technical capacity.
const AI_LIMIT_WORDS = 20_000;

const CAPACITY_BANDS = [
  { label: 'Very Light', labelColor: 'text-emerald-600', filledColor: 'bg-emerald-400' },
  { label: 'Light',      labelColor: 'text-emerald-600', filledColor: 'bg-emerald-400' },
  { label: 'Balanced',   labelColor: 'text-blue-600',    filledColor: 'bg-blue-400'    },
  { label: 'Heavy',      labelColor: 'text-amber-600',   filledColor: 'bg-amber-500'   },
  { label: 'Near Limit', labelColor: 'text-red-600',     filledColor: 'bg-red-500'     },
];

function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function getCapacityIndex(totalWords) {
  const pct = totalWords / AI_LIMIT_WORDS;
  if (pct < 0.20) return 0; // Very Light
  if (pct < 0.40) return 1; // Light
  if (pct < 0.60) return 2; // Balanced
  if (pct < 0.80) return 3; // Heavy
  return 4;                  // Near Limit
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
            : 'These documents will be compiled into the bundle the AI evaluates.'}
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
 *   isFinishing             boolean
 *   finishStage             'idle' | 'saving' | 'evaluating'
 *   exceedsAnySizeLimit     boolean
 *   saveDraftPending        boolean
 *   onBack                  () => void
 *   onRunEvaluation         () => void
 */
export default function Step3ReviewPackage({
  documents = [],
  confidentialBundle = { text: '', html: '<p></p>', json: null, source: 'typed', files: [] },
  sharedBundle = { text: '', html: '<p></p>', json: null, source: 'typed', files: [] },
  isFinishing = false,
  finishStage = 'idle',
  exceedsAnySizeLimit = false,
  saveDraftPending = false,
  onBack,
  onRunEvaluation,
  runActionLabel = '',
  runActionTestId = 'step2-run-evaluation-button',
  actionButtonClassName = 'bg-blue-600 hover:bg-blue-700',
  footerNote = null,
}) {
  const counts = getDocumentCounts(documents);
  const confidentialDocs = documents.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((d) => d.visibility === VISIBILITY_SHARED);

  const hasContent = Boolean(confidentialBundle.text || sharedBundle.text);
  const isRunning = isFinishing || saveDraftPending;

  const finishLabel = finishStage === 'evaluating'
    ? RUNNING_AI_MEDIATION_LABEL
    : finishStage === 'saving'
      ? 'Saving…'
      : RUN_AI_MEDIATION_LABEL;
  const resolvedRunActionLabel = isRunning ? finishLabel : runActionLabel || RUN_AI_MEDIATION_LABEL;

  const totalWords = countWords(confidentialBundle.text) + countWords(sharedBundle.text);
  const capacityIndex = getCapacityIndex(totalWords);
  const capacityBand = CAPACITY_BANDS[capacityIndex];
  const showCapacityWarning = capacityIndex >= 3;

  return (
    <div className="space-y-6" data-testid="doc-comparison-step-3">

      {/* Overview card */}
      <Card>
        <CardHeader>
          <CardTitle>Final Review Before Mediation</CardTitle>
          <CardDescription>
            Review the compiled Shared and Confidential bundles before running AI mediation.
            This is exactly what the mediation review will use.
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
              label="Word size"
              value={totalWords > 0 ? totalWords.toLocaleString() : '—'}
              Icon={Type}
              className="text-blue-600"
            />
          </div>

          {/* AI capacity meter */}
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  AI review capacity
                </span>
                <Info
                  className="w-3.5 h-3.5 text-slate-400 cursor-help"
                  title="An estimate of how much content the AI must process during mediation. Larger packages may reduce the depth of analysis."
                />
              </div>
              <span className={`text-xs font-bold ${capacityBand.labelColor}`}>
                {capacityBand.label}
              </span>
            </div>
            <div
              className="flex gap-1"
              role="meter"
              aria-label={`AI review capacity: ${capacityBand.label}`}
              aria-valuenow={capacityIndex + 1}
              aria-valuemin={1}
              aria-valuemax={5}
            >
              {CAPACITY_BANDS.map((band, i) => (
                <div
                  key={band.label}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= capacityIndex ? band.filledColor : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Higher context usage can reduce how much detail the AI can consider comfortably.
            </p>
            {showCapacityWarning && (
              <>
                <p className="text-xs text-amber-700 font-medium">
                  This package is becoming large for highest-quality review.
                </p>
                <p className="text-xs text-amber-600">
                  Larger packages may reduce depth and consistency of review.
                </p>
              </>
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
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isRunning}
          data-testid="step3-back-button"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Editor
        </Button>
        <Button
          type="button"
          onClick={onRunEvaluation}
          disabled={isRunning || exceedsAnySizeLimit || !hasContent}
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
