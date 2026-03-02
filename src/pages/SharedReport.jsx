import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import { sanitizeEditorHtml } from '@/components/document-comparison/editorSanitization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Save,
  Send,
  Upload,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_PREVIEW_CHARS = 500;
const TOTAL_WORKFLOW_STEPS = 3;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampStep(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 0), TOTAL_WORKFLOW_STEPS);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function textToHtml(value) {
  const normalized = String(value || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '<p></p>';
  }

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function previewSnippet(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= MAX_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function formatFileSize(bytes) {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0 B';
  }
  if (numeric < 1024) {
    return `${numeric} B`;
  }
  if (numeric < 1024 * 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`;
  }
  return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToMetadata(file) {
  return {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: Number(file.size || 0),
  };
}

function parseDocJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (String(value.type || '').trim().toLowerCase() !== 'doc') {
    return null;
  }
  if (!Array.isArray(value.content)) {
    return null;
  }
  return value;
}

function getTokenFromRoute(paramsToken, locationSearch) {
  const pathToken = asText(paramsToken);
  if (pathToken) return pathToken;
  const search = new URLSearchParams(locationSearch || '');
  return asText(search.get('token'));
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function coercePayloadToDocument(payload, fallbackLabel, fallbackText = '') {
  const safePayload = normalizePayload(payload);
  const directText = asText(safePayload.text);
  const notesText = asText(safePayload.notes);
  const text = directText || notesText || asText(fallbackText) || htmlToText(asText(safePayload.html));
  const html = sanitizeEditorHtml(asText(safePayload.html) || textToHtml(text));
  const json = parseDocJson(safePayload.json);
  const source = asText(safePayload.source) || 'typed';
  const files = Array.isArray(safePayload.files) ? safePayload.files : [];
  return {
    label: asText(safePayload.label) || fallbackLabel,
    text,
    html,
    json,
    source,
    files,
  };
}

function buildSharedPayloadFromState(state) {
  return {
    label: SHARED_LABEL,
    text: String(state.docBText || ''),
    html: sanitizeEditorHtml(state.docBHtml || textToHtml(state.docBText || '')),
    json: state.docBJson || null,
    source: asText(state.docBSource) || 'typed',
    files: Array.isArray(state.docBFiles) ? state.docBFiles : [],
  };
}

function buildConfidentialPayloadFromState(state) {
  const text = String(state.docAText || '');
  return {
    label: CONFIDENTIAL_LABEL,
    text,
    notes: text,
    html: sanitizeEditorHtml(state.docAHtml || textToHtml(text)),
    json: state.docAJson || null,
    source: asText(state.docASource) || 'typed',
    files: Array.isArray(state.docAFiles) ? state.docAFiles : [],
  };
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function toFriendlyLoadError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This shared link has expired.';
  if (code === 'token_inactive') return 'This shared link has been revoked.';
  if (code === 'max_uses_reached') return 'This shared link has reached its view limit.';
  if (code === 'token_not_found') return 'This shared link is invalid.';
  if (code === 'request_timeout') return 'Loading timed out. Please refresh and try again.';
  return error?.message || 'Unable to load this shared report.';
}

function toFriendlySaveError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This link has expired. Draft cannot be saved.';
  if (code === 'token_inactive') return 'This link is no longer active.';
  if (code === 'edit_not_allowed') return 'You do not have permission to edit Shared Information.';
  if (code === 'confidential_edit_not_allowed') {
    return 'You do not have permission to edit Confidential Information.';
  }
  if (code === 'payload_too_large') return 'Draft is too large to save.';
  return error?.message || 'Unable to save draft.';
}

function toFriendlyEvaluateError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') {
    return 'This shared link has expired.';
  }
  if (code === 'token_inactive') {
    return 'This shared link has been revoked.';
  }
  if (code === 'max_uses_reached') {
    return 'This shared link has reached its usage limit.';
  }
  if (code === 'reevaluation_not_allowed') {
    return 'This link does not allow evaluation.';
  }
  if (code === 'not_configured') {
    return 'Evaluation is not configured in this environment yet.';
  }
  return error?.message || 'Unable to run evaluation.';
}

function toFriendlySendBackError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') {
    return 'This shared link has expired.';
  }
  if (code === 'token_inactive') {
    return 'This shared link has been revoked.';
  }
  if (code === 'max_uses_reached') {
    return 'This shared link has reached its usage limit.';
  }
  if (code === 'send_back_not_allowed') {
    return 'This link does not allow sending updates back.';
  }
  if (code === 'draft_required') {
    return 'Save a draft before sending back.';
  }
  return error?.message || 'Unable to send back updates.';
}

function renderAiReport(report) {
  const recommendation = asText(report?.recommendation);
  const executiveSummary = asText(report?.executive_summary);
  const sections = Array.isArray(report?.sections) ? report.sections : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Read-only</Badge>
        {recommendation ? (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 capitalize">{recommendation}</Badge>
        ) : null}
      </div>
      {executiveSummary ? <p className="text-sm text-slate-700">{executiveSummary}</p> : null}
      {sections.length > 0 ? (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div key={`${section?.heading || section?.key || 'section'}-${index}`} className="rounded-lg border p-3">
              <p className="font-semibold text-sm text-slate-900 mb-2">
                {section?.heading || section?.key || `Section ${index + 1}`}
              </p>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {(Array.isArray(section?.bullets) ? section.bullets : []).map((line, lineIndex) => (
                  <li key={`${index}-${lineIndex}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No report sections available.</p>
      )}
    </div>
  );
}

async function fetchWorkspaceWithTimeout(token, timeoutMs = 15000) {
  let timeoutId = null;

  try {
    return await Promise.race([
      sharedReportsClient.getRecipientWorkspace(token),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error('Loading timed out');
          timeoutError.code = 'request_timeout';
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export default function SharedReport() {
  const params = useParams();
  const location = useLocation();
  const token = useMemo(
    () => getTokenFromRoute(params.token, location.search),
    [params.token, location.search],
  );

  const [uiStep, setUiStep] = useState(null);
  const [title, setTitle] = useState('Shared Report');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docAHtml, setDocAHtml] = useState('<p></p>');
  const [docBHtml, setDocBHtml] = useState('<p></p>');
  const [docAJson, setDocAJson] = useState(null);
  const [docBJson, setDocBJson] = useState(null);
  const [docASource, setDocASource] = useState('typed');
  const [docBSource, setDocBSource] = useState('typed');
  const [docAFiles, setDocAFiles] = useState([]);
  const [docBFiles, setDocBFiles] = useState([]);
  const [docASelectedFile, setDocASelectedFile] = useState(null);
  const [docBSelectedFile, setDocBSelectedFile] = useState(null);
  const [docAPreviewSnippet, setDocAPreviewSnippet] = useState('');
  const [docBPreviewSnippet, setDocBPreviewSnippet] = useState('');
  const [importingSide, setImportingSide] = useState(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [latestEvaluatedReport, setLatestEvaluatedReport] = useState(null);

  const docAInputFileRef = useRef(null);
  const docBInputFileRef = useRef(null);
  const stepDebugEnabled = Boolean(import.meta?.env?.DEV);

  const workspaceQuery = useQuery({
    queryKey: ['shared-report-recipient-workspace', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => fetchWorkspaceWithTimeout(token),
  });

  const share = workspaceQuery.data?.share || null;
  const parent = workspaceQuery.data?.parent || null;
  const comparison = workspaceQuery.data?.comparison || null;
  const baseline = workspaceQuery.data?.baseline || {};
  const defaults = workspaceQuery.data?.defaults || {};
  const recipientDraft = workspaceQuery.data?.recipientDraft || workspaceQuery.data?.currentDraft || null;
  const latestEvaluation = workspaceQuery.data?.latestEvaluation || null;
  const latestSentRevision = workspaceQuery.data?.latestSentRevision || null;

  const canEditShared = Boolean(share?.permissions?.can_edit_shared);
  const canEditConfidential = Boolean(share?.permissions?.can_edit_confidential);
  const canReevaluate = Boolean(share?.permissions?.can_reevaluate);
  const canSendBack = Boolean(share?.permissions?.can_send_back);
  const step = clampStep(uiStep, 0);

  const setUiStepWithReason = useCallback(
    (nextStep, reason) => {
      const bounded = clampStep(nextStep, 0);
      setUiStep((current) => {
        if (stepDebugEnabled) {
          console.debug('[shared-report-step]', {
            reason: reason || 'unknown',
            from: current,
            to: bounded,
          });
        }
        if (current === bounded) {
          return current;
        }
        return bounded;
      });
    },
    [stepDebugEnabled],
  );

  const hasActiveDraft = Boolean(recipientDraft && asText(recipientDraft.status).toLowerCase() === 'draft');
  const isSentToProposer =
    Boolean(latestSentRevision && asText(latestSentRevision.status).toLowerCase() === 'sent') && !hasActiveDraft;

  useEffect(() => {
    setUiStep(null);
    setLatestEvaluatedReport(null);
  }, [token]);

  useEffect(() => {
    if (!workspaceQuery.data) return;

    const baselineSharedPayload = baseline?.shared_payload || workspaceQuery.data?.baselineShared || defaults.shared_payload || {};
    const baselineConfidentialPayload = defaults.recipient_confidential_payload || {};

    const sharedDocument = coercePayloadToDocument(
      recipientDraft?.shared_payload || baselineSharedPayload,
      SHARED_LABEL,
      String(baselineSharedPayload?.text || ''),
    );
    const confidentialDocument = coercePayloadToDocument(
      recipientDraft?.recipient_confidential_payload || baselineConfidentialPayload,
      CONFIDENTIAL_LABEL,
      String(baselineConfidentialPayload?.text || baselineConfidentialPayload?.notes || ''),
    );

    setTitle(asText(comparison?.title) || asText(parent?.title) || 'Shared Report');

    setDocAText(confidentialDocument.text);
    setDocAHtml(confidentialDocument.html);
    setDocAJson(confidentialDocument.json);
    setDocASource(confidentialDocument.source);
    setDocAFiles(confidentialDocument.files);
    setDocAPreviewSnippet(previewSnippet(confidentialDocument.text || htmlToText(confidentialDocument.html)));

    setDocBText(sharedDocument.text);
    setDocBHtml(sharedDocument.html);
    setDocBJson(sharedDocument.json);
    setDocBSource(sharedDocument.source);
    setDocBFiles(sharedDocument.files);
    setDocBPreviewSnippet(previewSnippet(sharedDocument.text || htmlToText(sharedDocument.html)));

    setUiStep((current) => {
      if (current !== null) {
        return current;
      }
      const hydratedStep = clampStep(recipientDraft?.workflow_step, 0);
      if (stepDebugEnabled) {
        console.debug('[shared-report-step]', {
          reason: 'initial_hydration',
          from: current,
          to: hydratedStep,
        });
      }
      return hydratedStep;
    });
    setDraftDirty(false);
  }, [
    workspaceQuery.data,
    baseline?.shared_payload,
    comparison?.title,
    defaults.recipient_confidential_payload,
    defaults.shared_payload,
    parent?.title,
    recipientDraft,
    stepDebugEnabled,
  ]);

  const buildDraftInput = (stepToSave = step) => ({
    shared_payload: buildSharedPayloadFromState({
      docBText,
      docBHtml,
      docBJson,
      docBSource,
      docBFiles,
    }),
    recipient_confidential_payload: buildConfidentialPayloadFromState({
      docAText,
      docAHtml,
      docAJson,
      docASource,
      docAFiles,
    }),
    workflow_step: clampStep(stepToSave, 0),
    editor_state: {
      step: clampStep(stepToSave, 0),
      mode: 'recipient_document_comparison_v1',
      updated_at: new Date().toISOString(),
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent: _silent = false } = {}) => {
      return sharedReportsClient.saveRecipientDraft(token, buildDraftInput(stepToSave));
    },
    onSuccess: async (_data, variables) => {
      setDraftDirty(false);
      if (!variables?.silent) {
        toast.success('Draft saved');
        await workspaceQuery.refetch();
      }
    },
    onError: (error) => {
      toast.error(toFriendlySaveError(error));
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      if (stepDebugEnabled) {
        console.debug('[shared-report-evaluate]', { phase: 'start', step, draftDirty });
      }
      if (draftDirty) {
        await saveDraftMutation.mutateAsync({ stepToSave: 2, silent: true });
      }
      return sharedReportsClient.evaluateRecipient(token);
    },
    onSuccess: async (result) => {
      setLatestEvaluatedReport(result?.evaluation?.public_report || null);
      setUiStepWithReason(3, 'evaluate_success');
      toast.success('Evaluation complete');
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      toast.error(toFriendlyEvaluateError(error));
    },
    onSettled: () => {
      if (stepDebugEnabled) {
        console.debug('[shared-report-evaluate]', { phase: 'end' });
      }
    },
  });

  const sendBackMutation = useMutation({
    mutationFn: () => sharedReportsClient.sendBackRecipient(token),
    onSuccess: async () => {
      toast.success('Sent to proposer');
      setDraftDirty(false);
      setUiStepWithReason(3, 'send_back_success');
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      toast.error(toFriendlySendBackError(error));
    },
  });

  const applyImportedContent = (side, file, extracted) => {
    const rawText = asText(extracted?.text) || htmlToText(extracted?.html || '');
    const html = sanitizeEditorHtml(asText(extracted?.html) || textToHtml(rawText));
    const text = rawText || htmlToText(html);

    if (!text && !html) {
      throw new Error('No readable content was extracted from the selected file');
    }

    if (side === 'a') {
      setDocAText(text);
      setDocAHtml(html);
      setDocAJson(null);
      setDocASource('uploaded');
      setDocAFiles([fileToMetadata(file)]);
      setDocAPreviewSnippet(previewSnippet(text || htmlToText(html)));
    } else {
      setDocBText(text);
      setDocBHtml(html);
      setDocBJson(null);
      setDocBSource('uploaded');
      setDocBFiles([fileToMetadata(file)]);
      setDocBPreviewSnippet(previewSnippet(text || htmlToText(html)));
    }

    setDraftDirty(true);
  };

  const importForSide = async (side) => {
    const selectedFile = side === 'a' ? docASelectedFile : docBSelectedFile;
    if (!selectedFile) {
      toast.error('Select a .docx or .pdf file first.');
      return;
    }

    setImportingSide(side);
    try {
      const extracted = await documentComparisonsClient.extractDocumentFromFile(selectedFile);
      applyImportedContent(side, selectedFile, extracted);
      toast.success(`${selectedFile.name} imported`);
    } catch (error) {
      toast.error(error?.message || 'Failed to import file');
    } finally {
      setImportingSide(null);
    }
  };

  const jumpStep = async (nextStep) => {
    const bounded = clampStep(nextStep, step);
    if (bounded === 2 && step < 2 && draftDirty) {
      try {
        await saveDraftMutation.mutateAsync({ stepToSave: 1, silent: true });
      } catch {
        return;
      }
    }
    setUiStepWithReason(bounded, 'jump_step');
  };

  const runEvaluationFromStep2 = async () => {
    if (evaluateMutation.isPending) {
      return;
    }
    if (stepDebugEnabled) {
      console.debug('[shared-report-evaluate]', { phase: 'click', fromStep: step });
    }
    setUiStepWithReason(3, 'run_evaluation_click');
    try {
      await evaluateMutation.mutateAsync();
    } catch {
      // Mutation callbacks surface user-facing errors.
    }
  };

  const progress = (clampStep(step, 0) / TOTAL_WORKFLOW_STEPS) * 100;

  const activeReport =
    latestEvaluatedReport ||
    latestEvaluation?.public_report ||
    workspaceQuery.data?.latestReport ||
    baseline?.ai_report ||
    workspaceQuery.data?.baselineAiReport ||
    {};

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing shared report token.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600 mx-auto mb-3" />
              <p className="text-slate-700">Loading shared report...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (workspaceQuery.error || !share || !parent) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{toFriendlyLoadError(workspaceQuery.error)}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const renderImportPanel = ({ side, label, selectedFile, setSelectedFile, preview, source, files, fileRef }) => {
    const isImporting = importingSide === side;
    const canEditSide = side === 'a' ? canEditConfidential : canEditShared;

    return (
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{label} (Upload/Import)</CardTitle>
          <CardDescription>Upload a DOCX or PDF and import extracted content into this document.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setSelectedFile(file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={!canEditSide}
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>

            <Button
              type="button"
              onClick={() => importForSide(side)}
              disabled={!canEditSide || !selectedFile || isImporting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Import
            </Button>

            <Badge variant="outline">{source || 'typed'}</Badge>
          </div>

          {selectedFile ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium break-all">{selectedFile.name}</p>
              <p className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No file selected.</p>
          )}

          {files.length > 0 ? (
            <p className="text-xs text-slate-500">Last imported: {files[0]?.filename || 'Unknown file'}</p>
          ) : null}

          <div className="space-y-1">
            <Label className="text-sm font-semibold">Preview</Label>
            <div className="min-h-[130px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
              {preview || 'Imported content preview will appear here.'}
            </div>
          </div>
          {!canEditSide ? <p className="text-xs text-amber-700">This section is read-only for this link.</p> : null}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 xl:px-12 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
          <p className="text-slate-500">
            Compare Shared Information and Confidential Information with recipient-safe reporting.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{title || 'Shared Report'}</CardTitle>
              <Badge variant="outline">{asText(share.status) || 'active'}</Badge>
            </div>
            <CardDescription>
              Created: {formatDateTime(parent.created_at)} • Expires: {formatDateTime(share.expires_at)}
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">Step {step} of {TOTAL_WORKFLOW_STEPS}</span>
            <span className="text-slate-500">{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        {isSentToProposer ? (
          <Alert className="bg-emerald-50 border-emerald-200">
            <AlertDescription className="text-emerald-800">
              Sent to proposer on {formatDateTime(latestSentRevision?.updated_at)}.
            </AlertDescription>
          </Alert>
        ) : null}

        {step === 0 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 0: Overview</CardTitle>
                <CardDescription>Review overview details and the latest recipient-safe report before editing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Comparison</p>
                    <p className="text-slate-800">{asText(comparison?.title) || title || 'Shared Report'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Last Updated</p>
                    <p className="text-slate-800">{formatDateTime(comparison?.updated_at || parent?.created_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Shared Information</CardTitle>
                <CardDescription>Read-only baseline shared content from the proposer.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <pre className="text-sm whitespace-pre-wrap text-slate-700">
                    {docBText || '(No shared information available)'}
                  </pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI Report</CardTitle>
                <CardDescription>Read-only latest recipient-safe report.</CardDescription>
              </CardHeader>
              <CardContent>{renderAiReport(activeReport)}</CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={() => jumpStep(1)} className="bg-blue-600 hover:bg-blue-700">
                Edit Proposal
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Upload and Import</CardTitle>
                <CardDescription>
                  Upload DOCX or PDF files and import extracted content before editing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2 max-w-xl">
                  <Label>Comparison Title</Label>
                  <Input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDraftDirty(true);
                    }}
                    placeholder="e.g., Mutual NDA comparison"
                  />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderImportPanel({
                    side: 'a',
                    label: CONFIDENTIAL_LABEL,
                    selectedFile: docASelectedFile,
                    setSelectedFile: setDocASelectedFile,
                    preview: docAPreviewSnippet,
                    source: docASource,
                    files: docAFiles,
                    fileRef: docAInputFileRef,
                  })}
                  {renderImportPanel({
                    side: 'b',
                    label: SHARED_LABEL,
                    selectedFile: docBSelectedFile,
                    setSelectedFile: setDocBSelectedFile,
                    preview: docBPreviewSnippet,
                    source: docBSource,
                    files: docBFiles,
                    fileRef: docBInputFileRef,
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setUiStepWithReason(0, 'back_to_overview')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Overview
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveDraftMutation.mutate({ stepToSave: 1 })}
                  disabled={saveDraftMutation.isPending}
                >
                  {saveDraftMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  onClick={() => jumpStep(2)}
                  disabled={saveDraftMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue to Editor
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <DocumentComparisonEditorErrorBoundary
            onRetry={() => setUiStepWithReason(2, 'editor_retry')}
            onBackToStep1={() => setUiStepWithReason(1, 'editor_error_back')}
          >
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Editor</CardTitle>
                  <CardDescription>Shared Information is prefilled from proposer baseline until you edit it.</CardDescription>
                </CardHeader>
              </Card>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{CONFIDENTIAL_LABEL}</CardTitle>
                    <CardDescription>Private to you and used in AI analysis.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentRichEditor
                      label={CONFIDENTIAL_LABEL}
                      content={docAJson || docAHtml}
                      placeholder={`Edit ${CONFIDENTIAL_LABEL}...`}
                      minHeightClassName="min-h-[500px]"
                      scrollContainerClassName="h-[500px]"
                      maxCharacters={300000}
                      data-testid="doc-a-editor"
                      onChange={({ html, text, json }) => {
                        if (!canEditConfidential) return;
                        setDocAText(text);
                        setDocAHtml(html);
                        setDocAJson(json);
                        setDocASource('typed');
                        setDraftDirty(true);
                      }}
                    />
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{SHARED_LABEL}</CardTitle>
                    <CardDescription>Visible to both sides.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentRichEditor
                      label={SHARED_LABEL}
                      content={docBJson || docBHtml}
                      placeholder={`Edit ${SHARED_LABEL}...`}
                      minHeightClassName="min-h-[500px]"
                      scrollContainerClassName="h-[500px]"
                      maxCharacters={300000}
                      data-testid="doc-b-editor"
                      onChange={({ html, text, json }) => {
                        if (!canEditShared) return;
                        setDocBText(text);
                        setDocBHtml(html);
                        setDocBJson(json);
                        setDocBSource('typed');
                        setDraftDirty(true);
                      }}
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setUiStepWithReason(1, 'back_to_upload')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Upload
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => saveDraftMutation.mutate({ stepToSave: 2 })}
                    disabled={saveDraftMutation.isPending}
                  >
                    {saveDraftMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <Button
                    type="button"
                    onClick={runEvaluationFromStep2}
                    disabled={evaluateMutation.isPending || !canReevaluate}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {evaluateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        Run Evaluation
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DocumentComparisonEditorErrorBoundary>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 3: Evaluation</CardTitle>
                <CardDescription>Run and review the latest recipient-side evaluation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => evaluateMutation.mutate()}
                    disabled={evaluateMutation.isPending || !canReevaluate}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {evaluateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {evaluateMutation.isPending ? 'Evaluating...' : 'Re-run Evaluation'}
                  </Button>

                  <Button
                    type="button"
                    onClick={() => sendBackMutation.mutate()}
                    disabled={sendBackMutation.isPending || !canSendBack || isSentToProposer}
                  >
                    {sendBackMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    {isSentToProposer ? 'Sent to proposer' : sendBackMutation.isPending ? 'Sending...' : 'Send back to proposer'}
                  </Button>

                  <Button type="button" variant="outline" onClick={() => setUiStepWithReason(2, 'edit_again')}>
                    Edit again
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI Report</CardTitle>
                <CardDescription>Latest recipient-safe report.</CardDescription>
              </CardHeader>
              <CardContent>
                {evaluateMutation.isPending ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Running evaluation...
                  </div>
                ) : (
                  renderAiReport(activeReport)
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
