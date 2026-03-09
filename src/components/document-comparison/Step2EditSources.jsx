import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Lock,
  Save,
  Users,
} from 'lucide-react';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import {
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
  VISIBILITY_UNCLASSIFIED,
} from '@/pages/document-comparison/documentsModel';

// ─────────────────────────────────────────────
//  Sidebar document list
// ─────────────────────────────────────────────

function VisibilityIcon({ visibility, size = 'w-3.5 h-3.5' }) {
  if (visibility === VISIBILITY_CONFIDENTIAL) {
    return <Lock className={`${size} text-rose-500 flex-shrink-0`} />;
  }
  if (visibility === VISIBILITY_SHARED) {
    return <Users className={`${size} text-emerald-500 flex-shrink-0`} />;
  }
  return <AlertTriangle className={`${size} text-amber-500 flex-shrink-0`} />;
}

function VisibilityBadge({ visibility }) {
  if (visibility === VISIBILITY_CONFIDENTIAL) {
    return (
      <Badge variant="outline" className="text-xs text-rose-700 border-rose-300 bg-rose-50 flex items-center gap-1">
        <Lock className="w-2.5 h-2.5" />
        Confidential
      </Badge>
    );
  }
  if (visibility === VISIBILITY_SHARED) {
    return (
      <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50 flex items-center gap-1">
        <Users className="w-2.5 h-2.5" />
        Shared
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
      Unclassified
    </Badge>
  );
}

function SidebarGroup({ label, docs, activeDocId, onSelectDoc, visibilityIcon }) {
  if (docs.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </p>
      {docs.map((doc) => (
        <button
          key={doc.id}
          type="button"
          onClick={() => onSelectDoc(doc.id)}
          className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
            ${activeDocId === doc.id
              ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'text-slate-700 hover:bg-slate-100 border border-transparent'}`}
          data-doc-id={doc.id}
        >
          {visibilityIcon}
          <span className="truncate flex-1">{doc.title || 'Untitled'}</span>
          {doc.importStatus === 'importing' && (
            <Loader2 className="w-3 h-3 animate-spin text-blue-400 flex-shrink-0" />
          )}
        </button>
      ))}
    </div>
  );
}

function DocumentSidebar({ documents, activeDocId, onSelectDoc }) {
  const confidentialDocs = documents.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((d) => d.visibility === VISIBILITY_SHARED);
  const unclassifiedDocs = documents.filter((d) => d.visibility === VISIBILITY_UNCLASSIFIED);

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Documents
      </p>
      <SidebarGroup
        label="Confidential"
        docs={confidentialDocs}
        activeDocId={activeDocId}
        onSelectDoc={onSelectDoc}
        visibilityIcon={<Lock className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />}
      />
      <SidebarGroup
        label="Shared"
        docs={sharedDocs}
        activeDocId={activeDocId}
        onSelectDoc={onSelectDoc}
        visibilityIcon={<Users className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
      />
      {unclassifiedDocs.length > 0 && (
        <SidebarGroup
          label="Unclassified"
          docs={unclassifiedDocs}
          activeDocId={activeDocId}
          onSelectDoc={onSelectDoc}
          visibilityIcon={<AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
        />
      )}
      {documents.length === 0 && (
        <p className="text-xs text-slate-400 italic px-2">No documents.</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main Step 2 component
// ─────────────────────────────────────────────

/**
 * Step2EditSources
 *
 * Props:
 *   documents               SourceDocument[]
 *   activeDocId             string | null
 *   onSelectDoc             (id: string) => void
 *   onDocumentContentChange (id, { text, html, json }) => void
 *   editorRef               React.RefObject   — for the active editor
 *   limits                  { perDocumentCharacterLimit, warningCharacterThreshold }
 *   isLoadingDraft          boolean
 *   loadError               Error | null
 *   onRetryLoad             () => void
 *   fullscreenDocId         string | null
 *   onToggleFullscreen      (id: string) => void
 *   saveDraftPending        boolean
 *   exceedsAnySizeLimit     boolean
 *   onSaveDraft             () => void
 *   onBack                  () => void   — back to Step 1
 *   onContinue              () => void   — advance to Step 3
 *
 *   // Coach panel — rendered as children so the parent can pass its own coach UI
 *   coachPanel              React.ReactNode
 *
 *   // Size warning info
 *   totalNearLimit          boolean
 *   activeDocNearLimit      boolean
 *   activeDocOverLimit      boolean
 */
export default function Step2EditSources({
  documents = [],
  activeDocId = null,
  onSelectDoc,
  onDocumentContentChange,
  editorRef,
  limits,
  isLoadingDraft = false,
  loadError = null,
  onRetryLoad,
  fullscreenDocId = null,
  onToggleFullscreen,
  saveDraftPending = false,
  exceedsAnySizeLimit = false,
  onSaveDraft,
  onBack,
  onContinue,
  coachPanel = null,
  totalNearLimit = false,
  activeDocNearLimit = false,
  activeDocOverLimit = false,
  // Coach-integration props for editor focus / selection rewriting
  focusEditorRequest = null,
  replaceSelectionRequest = null,
  onReplaceSelectionApplied,
  onSelectionChange,
}) {
  const activeDoc = documents.find((d) => d.id === activeDocId) || null;
  const isFullscreen = Boolean(fullscreenDocId && fullscreenDocId === activeDocId);
  const totalOverLimit = exceedsAnySizeLimit;
  const limitTextClass = activeDocOverLimit
    ? 'text-red-700'
    : activeDocNearLimit
      ? 'text-amber-700'
      : 'text-slate-400';

  const activeCharacters = activeDoc?.text?.length || 0;
  const activeWords = (activeDoc?.text || '').trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-5" data-testid="doc-comparison-step-2">

      {/* Size warning */}
      {(activeDocNearLimit || activeDocOverLimit || totalNearLimit) && (
        <Alert className={totalOverLimit || activeDocOverLimit ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}>
          <AlertTriangle className={`h-4 w-4 ${totalOverLimit || activeDocOverLimit ? 'text-red-700' : 'text-amber-700'}`} />
          <AlertDescription className={totalOverLimit || activeDocOverLimit ? 'text-red-800' : 'text-amber-800'}>
            {totalOverLimit || activeDocOverLimit
              ? 'Content is over the safety limit. Reduce text before saving or evaluating.'
              : `Approaching the input limit. Keep each document under ${limits?.perDocumentCharacterLimit?.toLocaleString()} characters.`}
          </AlertDescription>
        </Alert>
      )}

      {/* Coach panel (passed by parent) */}
      {coachPanel}

      {/* Loading / error states */}
      {isLoadingDraft && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-8 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading editor…</span>
        </div>
      )}

      {!isLoadingDraft && loadError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
          <p className="text-sm font-semibold text-amber-900">Couldn&apos;t load the editor.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onRetryLoad}>Retry</Button>
            <Button size="sm" variant="outline" onClick={onBack}>Back to Step 1</Button>
          </div>
        </div>
      )}

      {!isLoadingDraft && !loadError && (
        <div className="flex gap-5 items-start">

          {/* Sidebar */}
          {!isFullscreen && (
            <aside className="w-52 flex-shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm self-stretch min-h-[520px]">
              <DocumentSidebar
                documents={documents}
                activeDocId={activeDocId}
                onSelectDoc={onSelectDoc}
              />
            </aside>
          )}

          {/* Main editor area */}
          <div className={isFullscreen
            ? 'fixed inset-5 z-50 bg-white rounded-2xl shadow-2xl border border-slate-300 p-4 overflow-auto flex flex-col gap-2'
            : 'flex-1 min-w-0 space-y-3'}>

            {activeDoc ? (
              <>
                {/* Document title bar + visibility */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <VisibilityIcon visibility={activeDoc.visibility} size="w-4 h-4" />
                    <h3 className="text-sm font-semibold text-slate-800 truncate">
                      {activeDoc.title || 'Untitled'}
                    </h3>
                    <VisibilityBadge visibility={activeDoc.visibility} />
                    {activeDoc.source === 'uploaded' && (
                      <Badge variant="outline" className="text-xs">uploaded</Badge>
                    )}
                  </div>
                  <span className={`text-xs ${limitTextClass} flex-shrink-0`}>
                    {activeCharacters.toLocaleString()} chars · {activeWords.toLocaleString()} words
                  </span>
                </div>

                <DocumentRichEditor
                  key={activeDocId}          /* re-mount when switching docs */
                  label={activeDoc.title || 'Document'}
                  content={activeDoc.json || activeDoc.html}
                  placeholder={`Edit ${activeDoc.title || 'document'}…`}
                  minHeightClassName={isFullscreen ? 'min-h-[70vh]' : 'min-h-[560px]'}
                  scrollContainerClassName={isFullscreen ? 'h-[72vh]' : 'h-[560px]'}
                  isFullscreen={isFullscreen}
                  maxCharacters={limits?.perDocumentCharacterLimit}
                  onToggleFullscreen={() => onToggleFullscreen && onToggleFullscreen(activeDocId)}
                  editorRef={editorRef}
                  shouldFocus={focusEditorRequest?.side != null}
                  focusRequestId={focusEditorRequest?.id || 0}
                  jumpToTextRequest={
                    focusEditorRequest?.jumpText
                      ? { id: focusEditorRequest.id, text: focusEditorRequest.jumpText }
                      : null
                  }
                  replaceSelectionRequest={
                    replaceSelectionRequest?.id ? replaceSelectionRequest : null
                  }
                  onReplaceSelectionApplied={onReplaceSelectionApplied}
                  onSelectionChange={onSelectionChange}
                  data-testid="active-doc-editor"
                  onChange={({ html, text, json }) => {
                    if (activeDocId) {
                      onDocumentContentChange(activeDocId, { html, text, json });
                    }
                  }}
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 min-h-[560px] gap-3 text-slate-400">
                <FileText className="w-8 h-8 opacity-30" />
                <p className="text-sm">Select a document from the list to edit it.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      {!isLoadingDraft && !loadError && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            onClick={onBack}
            data-testid="step2-back-button"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Sources
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onSaveDraft}
              disabled={saveDraftPending || exceedsAnySizeLimit}
              data-testid="step2-save-draft-button"
            >
              {saveDraftPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {saveDraftPending ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button
              type="button"
              onClick={onContinue}
              disabled={saveDraftPending || exceedsAnySizeLimit}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="step2-continue-button"
            >
              {saveDraftPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Review Package
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
