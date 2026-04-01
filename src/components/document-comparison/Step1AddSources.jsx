import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  PenLine,
  Save,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
  VISIBILITY_UNCLASSIFIED,
  allDocumentsClassified,
  getDocumentCounts,
} from '@/pages/document-comparison/documentsModel';

// ─────────────────────────────────────────────
//  Visibility badge / selector
// ─────────────────────────────────────────────
function VisibilitySelector({ docId, visibility, onSetVisibility }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSetVisibility(docId, VISIBILITY_CONFIDENTIAL)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border
          ${visibility === VISIBILITY_CONFIDENTIAL
            ? 'bg-rose-100 text-rose-700 border-rose-400'
            : 'bg-white text-slate-500 border-slate-200 hover:border-rose-300 hover:text-rose-600'}`}
        title="Mark as Confidential – not visible to recipient"
      >
        <Lock className="w-3 h-3" />
        Confidential
      </button>
      <button
        type="button"
        onClick={() => onSetVisibility(docId, VISIBILITY_SHARED)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border
          ${visibility === VISIBILITY_SHARED
            ? 'bg-emerald-100 text-emerald-700 border-emerald-400'
            : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'}`}
        title="Mark as Shared – included in recipient-facing output"
      >
        <Users className="w-3 h-3" />
        Shared
      </button>
    </div>
  );
}

function importStatusBadge(doc) {
  if (doc.importStatus === 'importing') {
    return (
      <span className="text-xs text-blue-700 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Importing…
      </span>
    );
  }
  if (doc.importStatus === 'imported') {
    return (
      <span className="text-xs text-emerald-700 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Imported
      </span>
    );
  }
  if (doc.importStatus === 'error') {
    return (
      <span className="text-xs text-red-700 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Import error
      </span>
    );
  }
  if (doc.source === 'typed') {
    return <span className="text-xs text-slate-400">Typed</span>;
  }
  return null;
}

// ─────────────────────────────────────────────
//  Individual document row
// ─────────────────────────────────────────────
function DocumentRow({ doc, onRemove, onRename, onSetVisibility, onImportFile, locked = false, readOnly = false }) {
  const fileRef = useRef(null);
  const isImporting = doc.importStatus === 'importing';
  const isHistoricalRound = Boolean(doc?.isHistoricalRound);
  const readOnlyMessage = doc?.readOnlyReason || 'Previous round content is view-only and cannot be changed.';

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 bg-white shadow-sm transition-all
        ${doc.visibility === VISIBILITY_UNCLASSIFIED
          ? 'border-amber-300 bg-amber-50/40'
          : doc.visibility === VISIBILITY_CONFIDENTIAL
            ? 'border-rose-200'
            : 'border-emerald-200'}`}
      data-doc-id={doc.id}
    >
      {/* Row: name + source type label + remove */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className={`w-4 h-4 flex-shrink-0 ${
            doc.visibility === VISIBILITY_CONFIDENTIAL ? 'text-rose-500' :
            doc.visibility === VISIBILITY_SHARED ? 'text-emerald-500' :
            'text-slate-400'
          }`} />
          {locked ? (
            <span className="h-7 text-sm font-medium px-1 flex items-center">{doc.title || 'Untitled Document'}</span>
          ) : (
            <Input
              className="h-7 text-sm font-medium border-transparent shadow-none bg-transparent hover:border-slate-200 focus:border-slate-300 px-1 focus-visible:ring-0 focus-visible:ring-offset-0"
              value={doc.title}
              onChange={(e) => onRename(doc.id, e.target.value)}
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  onRename(doc.id, 'Untitled Document');
                }
              }}
              aria-label="Document title"
            />
          )}
          {isHistoricalRound ? (
            <Badge variant="outline" className="text-[10px] border-slate-300 bg-slate-100 text-slate-700">
              Previous Round
            </Badge>
          ) : null}
          {readOnly ? (
            <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700">
              Read-only
            </Badge>
          ) : null}
          <div className="ml-1 flex-shrink-0">
            {importStatusBadge(doc)}
          </div>
        </div>
        {!locked && (
          <button
            type="button"
            className="text-slate-400 hover:text-red-600 transition-colors flex-shrink-0 mt-0.5"
            onClick={() => onRemove(doc.id)}
            aria-label="Remove document"
            title="Remove document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Row: import file (only for non-typed, or all to allow re-import) */}
      {doc.source === 'typed' ? (
        <p className={`text-xs italic ${readOnly ? 'text-amber-700' : 'text-slate-400'}`}>
          {readOnly ? readOnlyMessage : 'Typed document — edit in Step 2.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = '';
              if (file) {
                onImportFile(doc.id, file);
              }
            }}
          />
          {doc.files.length > 0 && (
            <span className="text-xs text-slate-500 truncate max-w-[200px]">
              {doc.files[0]?.filename || 'Uploaded file'}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isImporting || readOnly}
            onClick={() => fileRef.current?.click()}
            className="h-7 text-xs"
          >
            {isImporting ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Upload className="w-3 h-3 mr-1" />
            )}
            {isImporting ? 'Importing…' : 'Re-import'}
          </Button>
          {readOnly && (
            <span className="text-xs text-amber-700">{readOnlyMessage}</span>
          )}
        </div>
      )}

      {/* Import error */}
      {doc.importStatus === 'error' && doc.importError && (
        <p className="text-xs text-red-700">{doc.importError}</p>
      )}

      {/* Row: visibility selector */}
      {locked ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 w-24 flex-shrink-0">
            Visibility:
          </span>
          <Badge
            variant="outline"
            className={doc.visibility === VISIBILITY_CONFIDENTIAL
              ? 'text-rose-700 border-rose-300 bg-rose-50'
              : 'text-emerald-700 border-emerald-300 bg-emerald-50'}
          >
            {doc.visibility === VISIBILITY_CONFIDENTIAL ? (
              <><Lock className="w-2.5 h-2.5 mr-1" /> Confidential</>
            ) : (
              <><Users className="w-2.5 h-2.5 mr-1" /> Shared</>
            )}
          </Badge>
          {readOnly ? (
            <span className="text-xs text-amber-700">{readOnlyMessage}</span>
          ) : null}
        </div>
      ) : (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 w-24 flex-shrink-0">
          Visibility:
        </span>
        <VisibilitySelector
          docId={doc.id}
          visibility={doc.visibility}
          onSetVisibility={onSetVisibility}
        />
        {doc.visibility === VISIBILITY_UNCLASSIFIED && (
          <span className="text-xs text-amber-600 font-medium ml-1">
            — choose before continuing
          </span>
        )}
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main Step 1 component
// ─────────────────────────────────────────────

/**
 * Step1AddSources
 *
 * Used by BOTH the proposer (DocumentComparisonCreate) and the recipient
 * (SharedReport step 1).  Role-specific differences are driven by props:
 *
 *   showAddActions    boolean     – show Upload Files / Create Typed buttons (default true)
 *   showDocumentRows  boolean     – show the document list (default true)
 *   contentSlot       ReactNode   – rendered in place of the document list when
 *                                   showDocumentRows=false  (recipient import panels)
 *   showBack          boolean     – show a Back button in the footer (default false)
 *   onBack            fn          – callback for Back button
 *
 * Core proposer props (all still supported):
 *   title           string
 *   onTitleChange   (value: string) => void
 *   counterpartyName string
 *   onCounterpartyNameChange (value: string) => void
 *   documents       SourceDocument[]
 *   onAddFiles      (files: FileList) => void
 *   onAddTyped      () => void
 *   onRemoveDoc     (id: string) => void
 *   onRenameDoc     (id: string, title: string) => void
 *   onSetVisibility (id: string, visibility: string) => void
 *   onImportFile    (id: string, file: File) => void
 *   saveDraftPending  boolean
 *   onSaveDraft     () => void
 *   onContinue      () => void
 */
export default function Step1AddSources({
  title = '',
  onTitleChange,
  counterpartyName = '',
  onCounterpartyNameChange = () => {},
  documents = [],
  onAddFiles,
  onAddTyped,
  onRemoveDoc,
  onRenameDoc,
  onSetVisibility,
  onImportFile,
  saveDraftPending = false,
  onSaveDraft,
  onContinue,
  // ── Recipient-mode / slot props ─────────────────────────
  showAddActions = true,
  showDocumentRows = true,
  contentSlot = null,
  showBack = false,
  onBack,
  showCounterpartyNameField = true,
  lockedDocIds = [],
  readOnlyDocIds = [],
}) {
  const uploadRef = useRef(null);
  const counts = getDocumentCounts(documents);
  const canContinue = allDocumentsClassified(documents);
  const hasUnclassified = counts.unclassified > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Step 1: Add Sources</CardTitle>
          <CardDescription>
            Upload or create documents, then mark each as{' '}
            <span className="font-semibold text-rose-600">Confidential</span> or{' '}
            <span className="font-semibold text-emerald-600">Shared</span> before editing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Comparison title + counterparty name */}
          <div className={showCounterpartyNameField ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'max-w-xl'}>
            <div className="space-y-1.5">
              <Label htmlFor="comparison-title-input">Comparison Title</Label>
              <Input
                id="comparison-title-input"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="e.g., Mutual NDA comparison"
                data-testid="comparison-title-input"
              />
            </div>
            {showCounterpartyNameField ? (
              <div className="space-y-1.5">
                <Label htmlFor="counterparty-name-input">Counterparty Name</Label>
                <Input
                  id="counterparty-name-input"
                  value={counterpartyName}
                  onChange={(e) => onCounterpartyNameChange(e.target.value)}
                  placeholder="e.g., Harbor Retail Group"
                  data-testid="counterparty-name-input"
                />
              </div>
            ) : null}
          </div>

          {/* Action bar — hidden in recipient mode */}
          {showAddActions && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={uploadRef}
                type="file"
                accept=".docx,.pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onAddFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => uploadRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Files
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onAddTyped}
              >
                <PenLine className="w-4 h-4 mr-2" />
                Create Typed Document
              </Button>
            </div>
          )}

          {/* Summary badges — only in proposer mode */}
          {showDocumentRows && documents.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{counts.total} document{counts.total !== 1 ? 's' : ''}</Badge>
              {counts.confidential > 0 && (
                <Badge variant="outline" className="text-rose-700 border-rose-300 bg-rose-50">
                  <Lock className="w-2.5 h-2.5 mr-1" />
                  {counts.confidential} confidential
                </Badge>
              )}
              {counts.shared > 0 && (
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
                  <Users className="w-2.5 h-2.5 mr-1" />
                  {counts.shared} shared
                </Badge>
              )}
              {counts.unclassified > 0 && (
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                  <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                  {counts.unclassified} unclassified
                </Badge>
              )}
            </div>
          )}

          {/* Document list (proposer) OR contentSlot (recipient) */}
          {showDocumentRows ? (
            documents.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center text-slate-400">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No documents yet.</p>
                <p className="text-xs mt-1">Upload a file or create a typed document to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onRemove={onRemoveDoc}
                    onRename={onRenameDoc}
                    onSetVisibility={onSetVisibility}
                    onImportFile={onImportFile}
                    locked={lockedDocIds.includes(doc.id)}
                    readOnly={readOnlyDocIds.includes(doc.id)}
                  />
                ))}
              </div>
            )
          ) : (
            contentSlot || null
          )}

          {/* Validation notice */}
          {hasUnclassified && (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">
                All documents must be classified as <strong>Confidential</strong> or <strong>Shared</strong> before you can continue.
              </AlertDescription>
            </Alert>
          )}

          {/* Privacy note */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 flex gap-3 items-start">
            <Lock className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-slate-600 space-y-0.5">
              <p className="font-semibold">Confidential vs Shared</p>
              <p>
                <span className="text-rose-600 font-medium">Confidential</span> documents are used
                internally during AI evaluation but are never included in the recipient-facing
                shared report.{' '}
                <span className="text-emerald-600 font-medium">Shared</span> documents may appear
                in the public output.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        {showBack ? (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={saveDraftPending}
            data-testid="step1-back-button"
          >
            <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onSaveDraft}
          disabled={saveDraftPending || documents.length === 0}
          data-testid="step1-save-draft-button"
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
          disabled={saveDraftPending || !canContinue}
          className="bg-blue-600 hover:bg-blue-700"
          data-testid="step1-continue-button"
          title={!canContinue ? 'Classify all documents before continuing' : undefined}
        >
          {saveDraftPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Continue to Editor
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
        </div>
      </div>
    </div>
  );
}
