import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Mail,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { VISIBILITY_CONFIDENTIAL, VISIBILITY_SHARED, getDocumentCounts } from '@/pages/document-comparison/documentsModel';
import { RUN_AI_MEDIATION_LABEL, RUNNING_AI_MEDIATION_LABEL } from '@/lib/aiReportUtils';

// ─────────────────────────────────────────────
//  Bundle section
// ─────────────────────────────────────────────

const MAX_BUNDLE_PREVIEW_CHARS = 1200;

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
 *   recipientName           string
 *   recipientEmail          string
 *   onRecipientNameChange   (value: string) => void
 *   onRecipientEmailChange  (value: string) => void
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
  recipientName = '',
  recipientEmail = '',
  onRecipientNameChange,
  onRecipientEmailChange,
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

  const totalChars = (confidentialBundle.text?.length || 0) + (sharedBundle.text?.length || 0);

  return (
    <div className="space-y-6" data-testid="doc-comparison-step-3">

      {/* Overview card */}
      <Card>
        <CardHeader>
          <CardTitle>Step 3: Review Package</CardTitle>
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
              label="Total chars"
              value={totalChars > 0 ? totalChars.toLocaleString() : '—'}
              Icon={CheckCircle2}
              className="text-blue-600"
            />
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

      {/* Recipient details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-500" />
            Recipient Details
          </CardTitle>
          <CardDescription>
            Who will receive the shared report? Email is required to send.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="recipient-name" className="flex items-center gap-1.5 text-sm">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Name <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <Input
                id="recipient-name"
                data-testid="recipient-name-input"
                type="text"
                placeholder="e.g. Sarah Chen"
                value={recipientName}
                onChange={(e) => onRecipientNameChange?.(e.target.value)}
                disabled={isRunning}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipient-email" className="flex items-center gap-1.5 text-sm">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Email <span className="text-slate-400 font-normal">(required to send)</span>
              </Label>
              <Input
                id="recipient-email"
                data-testid="recipient-email-input"
                type="email"
                placeholder="e.g. sarah@company.com"
                value={recipientEmail}
                onChange={(e) => onRecipientEmailChange?.(e.target.value)}
                disabled={isRunning}
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
          className="bg-blue-600 hover:bg-blue-700"
          data-testid="step2-run-evaluation-button"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {finishLabel}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              {RUN_AI_MEDIATION_LABEL}
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
