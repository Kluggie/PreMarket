import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_PREVIEW_CHARS = 500;
const TOTAL_STEPS = 3;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampStep(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(numeric), 1), TOTAL_STEPS);
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

function useRouteState() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');

    return {
      draftId: params.get('draft') || '',
      proposalId: params.get('proposalId') || '',
      token: params.get('token') || params.get('sharedToken') || '',
      step: clampStep(params.get('step') || 1),
    };
  }, [location.search]);
}

export default function DocumentComparisonCreate() {
  const navigate = useNavigate();
  const routeState = useRouteState();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(routeState.step);
  const [comparisonId, setComparisonId] = useState(routeState.draftId);
  const [linkedProposalId, setLinkedProposalId] = useState(routeState.proposalId);

  const [title, setTitle] = useState('');
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
  const [uiError, setUiError] = useState('');
  const [fullscreenSide, setFullscreenSide] = useState(null);
  const [lastSavedHash, setLastSavedHash] = useState('');

  const docAInputFileRef = useRef(null);
  const docBInputFileRef = useRef(null);
  const hydratedRef = useRef(false);

  const proposalLookup = useQuery({
    queryKey: ['document-comparison-proposal-lookup', routeState.proposalId],
    enabled: Boolean(routeState.proposalId && !routeState.draftId),
    queryFn: () => proposalsClient.getById(routeState.proposalId),
  });

  const resolvedDraftId = routeState.draftId || comparisonId || proposalLookup.data?.document_comparison_id || '';

  const draftQuery = useQuery({
    queryKey: ['document-comparison-draft', resolvedDraftId, routeState.token],
    enabled: Boolean(resolvedDraftId),
    queryFn: () =>
      routeState.token
        ? documentComparisonsClient.getByIdWithToken(resolvedDraftId, routeState.token)
        : documentComparisonsClient.getById(resolvedDraftId),
  });

  useEffect(() => {
    if (!draftQuery.data?.comparison) {
      return;
    }

    const comparison = draftQuery.data.comparison;

    hydratedRef.current = true;
    setComparisonId(comparison.id || resolvedDraftId || '');
    setLinkedProposalId(draftQuery.data.proposal?.id || routeState.proposalId || '');

    setTitle(comparison.title || '');

    const nextDocAText = String(comparison.doc_a_text || '');
    const nextDocBText = String(comparison.doc_b_text || '');

    setDocAText(nextDocAText);
    setDocBText(nextDocBText);
    setDocAHtml(asText(comparison.doc_a_html) || textToHtml(nextDocAText));
    setDocBHtml(asText(comparison.doc_b_html) || textToHtml(nextDocBText));
    setDocAJson(parseDocJson(comparison.doc_a_json));
    setDocBJson(parseDocJson(comparison.doc_b_json));

    setDocASource(comparison.doc_a_source || 'typed');
    setDocBSource(comparison.doc_b_source || 'typed');
    setDocAFiles(Array.isArray(comparison.doc_a_files) ? comparison.doc_a_files : []);
    setDocBFiles(Array.isArray(comparison.doc_b_files) ? comparison.doc_b_files : []);

    setDocAPreviewSnippet(previewSnippet(nextDocAText));
    setDocBPreviewSnippet(previewSnippet(nextDocBText));

    const draftStep = Math.max(
      clampStep(comparison.draft_step || 1),
      clampStep(routeState.step || 1),
    );
    setStep(draftStep);
  }, [draftQuery.data, resolvedDraftId, routeState.proposalId, routeState.step]);

  useEffect(() => {
    if (!fullscreenSide) {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFullscreenSide(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreenSide]);

  const currentStateHash = useMemo(
    () =>
      JSON.stringify({
        comparisonId,
        linkedProposalId,
        step,
        title,
        docAText,
        docBText,
        docAHtml,
        docBHtml,
        docAJson,
        docBJson,
        docASource,
        docBSource,
        docAFiles,
        docBFiles,
      }),
    [
      comparisonId,
      linkedProposalId,
      step,
      title,
      docAText,
      docBText,
      docAHtml,
      docBHtml,
      docAJson,
      docBJson,
      docASource,
      docBSource,
      docAFiles,
      docBFiles,
    ],
  );

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent = false }) => {
      const payload = {
        title: asText(title) || 'Untitled Comparison',
        party_a_label: CONFIDENTIAL_LABEL,
        party_b_label: SHARED_LABEL,
        doc_a_text: docAText,
        doc_b_text: docBText,
        doc_a_html: docAHtml,
        doc_b_html: docBHtml,
        doc_a_json: docAJson,
        doc_b_json: docBJson,
        doc_a_source: docASource,
        doc_b_source: docBSource,
        doc_a_files: docAFiles,
        doc_b_files: docBFiles,
        draft_step: clampStep(stepToSave || step || 1),
        proposalId: linkedProposalId || routeState.proposalId || null,
        createProposal: !(linkedProposalId || routeState.proposalId),
      };

      if (routeState.token) {
        payload.token = routeState.token;
      }

      const response = await documentComparisonsClient.saveDraft(comparisonId || null, payload);
      const comparison = response?.comparison || response;

      if (!comparison?.id) {
        throw new Error('Failed to save draft');
      }

      setComparisonId(comparison.id);
      if (comparison.proposal_id && !linkedProposalId) {
        setLinkedProposalId(comparison.proposal_id);
      }

      setLastSavedHash(currentStateHash);
      if (!silent) {
        toast.success('Draft saved');
      }

      queryClient.invalidateQueries(['proposals']);
      return comparison.id;
    },
    onError: (error, variables) => {
      if (variables?.nonBlocking) {
        return;
      }
      const message = error?.message || 'Failed to save draft';
      setUiError(message);
      toast.error(message);
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const persistedId = comparisonId || (await saveDraftMutation.mutateAsync({ stepToSave: 3, silent: true }));
      if (!persistedId) {
        throw new Error('Unable to save comparison before evaluation');
      }

      return documentComparisonsClient.evaluate(persistedId, {});
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries(['proposals']);
      queryClient.invalidateQueries(['document-comparison-draft', comparisonId, routeState.token]);
      const proposalId = result?.proposal?.id || linkedProposalId || routeState.proposalId;
      if (proposalId) {
        navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposalId)}`));
        return;
      }

      const id = result?.comparison?.id || comparisonId;
      if (id) {
        navigate(createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(id)}`));
      }
    },
    onError: (error) => {
      const message = error?.message || 'Evaluation failed';
      setUiError(message);
      toast.error(message);
    },
  });

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    if (!comparisonId) {
      return;
    }
    if (currentStateHash === lastSavedHash) {
      return;
    }

    const timer = setTimeout(() => {
      saveDraftMutation.mutate({ stepToSave: step, silent: true });
    }, 1200);

    return () => clearTimeout(timer);
  }, [comparisonId, currentStateHash, lastSavedHash, saveDraftMutation, step]);

  const progress = (step / TOTAL_STEPS) * 100;

  const hasAnyDocumentContent = Boolean(asText(docAText) || asText(docBText));
  const hasBothDocumentContents = Boolean(asText(docAText) && asText(docBText));
  const isStep2LoadingDraft = step === 2 && Boolean(resolvedDraftId) && draftQuery.isLoading;
  const step2LoadError = step === 2 && Boolean(resolvedDraftId) ? draftQuery.error : null;

  const applyImportedContent = (side, file, extracted) => {
    const text = asText(extracted?.text) || htmlToText(extracted?.html || '');
    const html = asText(extracted?.html) || textToHtml(text);

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
      return;
    }

    setDocBText(text);
    setDocBHtml(html);
    setDocBJson(null);
    setDocBSource('uploaded');
    setDocBFiles([fileToMetadata(file)]);
    setDocBPreviewSnippet(previewSnippet(text || htmlToText(html)));
  };

  const importForSide = async (side) => {
    const selectedFile = side === 'a' ? docASelectedFile : docBSelectedFile;
    if (!selectedFile) {
      toast.error('Select a .docx or .pdf file first.');
      return;
    }

    setUiError('');
    setImportingSide(side);

    try {
      const extracted = await documentComparisonsClient.extractDocumentFromFile(selectedFile);
      applyImportedContent(side, selectedFile, extracted);
      toast.success(`${selectedFile.name} imported`);
    } catch (error) {
      const message = error?.message || 'Failed to import file';
      setUiError(message);
      toast.error(message);
    } finally {
      setImportingSide(null);
    }
  };

  const jumpStep = async (nextStep) => {
    const bounded = clampStep(nextStep || 1);
    if (saveDraftMutation.isPending) {
      return;
    }

    if (bounded === 2 && !comparisonId) {
      try {
        const createdId = await saveDraftMutation.mutateAsync({
          stepToSave: bounded,
          silent: true,
        });
        if (!createdId) {
          throw new Error('Failed to create comparison draft');
        }
      } catch (error) {
        const message = error?.message || "Couldn't open editor yet. Please retry.";
        setUiError(message);
        toast.error("Couldn't open editor yet. Please retry.");
        return;
      }

      setStep(bounded);
      return;
    }

    try {
      await saveDraftMutation.mutateAsync({
        stepToSave: bounded,
        silent: true,
        nonBlocking: true,
      });
    } catch {
      if (bounded === 2) {
        toast("Couldn't save import step yet - your changes will be saved when you hit Save in the editor.");
      }
    }
    setStep(bounded);
  };

  const retryStep2Load = () => {
    setUiError('');
    setFullscreenSide(null);
    setStep(2);
    if (resolvedDraftId) {
      queryClient.invalidateQueries({ queryKey: ['document-comparison-draft', resolvedDraftId, routeState.token] });
    }
  };

  const renderImportPanel = ({ side, label, selectedFile, setSelectedFile, preview, source, files, fileRef }) => {
    const isImporting = importingSide === side;

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
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>

            <Button
              type="button"
              onClick={() => importForSide(side)}
              disabled={!selectedFile || isImporting}
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
        </CardContent>
      </Card>
    );
  };

  const renderEditorPanel = (side) => {
    const isA = side === 'a';
    const label = isA ? CONFIDENTIAL_LABEL : SHARED_LABEL;
    const source = isA ? docASource : docBSource;

    const panelModeClass =
      fullscreenSide === side
        ? 'fixed inset-5 z-50 bg-white rounded-2xl shadow-2xl border border-slate-300 p-4 overflow-auto'
        : fullscreenSide
          ? 'hidden'
          : 'space-y-3';

    return (
      <div className={panelModeClass}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
            <Badge variant="outline">{source}</Badge>
          </div>
        </div>

        <DocumentRichEditor
          label={label}
          content={isA ? docAJson || docAHtml : docBJson || docBHtml}
          placeholder={`Edit ${label}...`}
          minHeightClassName={fullscreenSide === side ? 'min-h-[70vh]' : 'min-h-[560px]'}
          isFullscreen={fullscreenSide === side}
          onToggleFullscreen={() => setFullscreenSide((prev) => (prev === side ? null : side))}
          onChange={({ html, text, json }) => {
            if (isA) {
              setDocAText(text);
              setDocAHtml(html);
              setDocAJson(json);
              return;
            }

            setDocBText(text);
            setDocBHtml(html);
            setDocBJson(json);
          }}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 xl:px-12">
        <div className="mb-5">
          <Link
            to={createPageUrl('Proposals')}
            className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
          <p className="text-slate-500 mt-1">
            Compare confidential and shared information with a recipient-safe workflow.
          </p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className={`font-semibold ${step === 1 ? 'text-blue-600' : 'text-slate-400'}`}>Step {step} of 3</span>
            <span className="text-slate-500">{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        {(draftQuery.isLoading || proposalLookup.isLoading) && (
          <Card>
            <CardContent className="py-8 text-slate-500">Loading comparison draft...</CardContent>
          </Card>
        )}

        {uiError && (
          <Alert className="bg-red-50 border-red-200 mb-4">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{uiError}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="doc-step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle>Step 1: Upload and Import</CardTitle>
                  <CardDescription>
                    Upload DOCX or PDF files and import extracted content before editing.
                    {' '}
                    Uploads are optional - you can also type directly in the editor.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2 max-w-xl">
                    <Label>Comparison Title</Label>
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="e.g., Mutual NDA comparison"
                    />
                    {!asText(title) ? (
                      <p className="text-xs text-slate-500">
                        Optional for now. If left empty, this will save as "Untitled Comparison".
                      </p>
                    ) : null}
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

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => saveDraftMutation.mutate({ stepToSave: 1 })}
                  disabled={saveDraftMutation.isPending}
                >
                  {saveDraftMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  onClick={() => jumpStep(2)}
                  disabled={saveDraftMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saveDraftMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Continue to Editor
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <DocumentComparisonEditorErrorBoundary
              onRetry={retryStep2Load}
              onBackToStep1={() => setStep(1)}
            >
              <motion.div
                key="doc-step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {isStep2LoadingDraft ? (
                  <Card>
                    <CardContent className="py-10 text-slate-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading editor...
                    </CardContent>
                  </Card>
                ) : null}

                {step2LoadError ? (
                  <Card className="border border-amber-200 bg-amber-50">
                    <CardHeader>
                      <CardTitle>We couldn&apos;t load the editor yet.</CardTitle>
                      <CardDescription>
                        Please retry loading this draft, or return to Step 1.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-3">
                      <Button onClick={retryStep2Load}>
                        Retry
                      </Button>
                      <Button variant="outline" onClick={() => setStep(1)}>
                        Back to Step 1
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {!isStep2LoadingDraft && !step2LoadError && !comparisonId ? (
                  <Card className="border border-amber-200 bg-amber-50">
                    <CardHeader>
                      <CardTitle>We couldn&apos;t load the editor yet.</CardTitle>
                      <CardDescription>
                        Create the comparison draft first, then continue to editing.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-3">
                      <Button onClick={() => jumpStep(2)} disabled={saveDraftMutation.isPending}>
                        {saveDraftMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        Retry
                      </Button>
                      <Button variant="outline" onClick={() => setStep(1)}>
                        Back to Step 1
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {!isStep2LoadingDraft && !step2LoadError && comparisonId ? (
                  <>
                    {fullscreenSide && (
                      <button
                        type="button"
                        aria-label="Close full screen editor"
                        className="fixed inset-0 bg-slate-900/45 z-40"
                        onClick={() => setFullscreenSide(null)}
                      />
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                      {renderEditorPanel('a')}
                      {renderEditorPanel('b')}
                    </div>

                    <div className="flex justify-between pt-2">
                      <Button variant="outline" onClick={() => jumpStep(1)}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Upload
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => saveDraftMutation.mutate({ stepToSave: 2 })}>
                          <Save className="w-4 h-4 mr-2" />
                          Save Draft
                        </Button>
                        <Button
                          onClick={() => jumpStep(3)}
                          disabled={!hasAnyDocumentContent}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          Continue to Review
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </motion.div>
            </DocumentComparisonEditorErrorBoundary>
          )}

          {step === 3 && (
            <motion.div
              key="doc-step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Step 3: Review & Evaluate</CardTitle>
                  <CardDescription>Review imported and edited content before running AI evaluation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="font-medium">{title || 'Untitled Comparison'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{CONFIDENTIAL_LABEL} Length</span>
                      <span className="font-medium">{docAText.length} characters</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{SHARED_LABEL} Length</span>
                      <span className="font-medium">{docBText.length} characters</span>
                    </div>
                  </div>

                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Safety rule:</strong> Recipient-facing outputs are limited to {SHARED_LABEL}. {CONFIDENTIAL_LABEL} remains private.
                    </AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-700 mb-2">{CONFIDENTIAL_LABEL}</p>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-48 overflow-auto">
                        {previewSnippet(docAText) || 'No content'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-700 mb-2">{SHARED_LABEL}</p>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-48 overflow-auto">
                        {previewSnippet(docBText) || 'No content'}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => jumpStep(2)}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Editor
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => saveDraftMutation.mutate({ stepToSave: 3 })}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                      <Button
                        onClick={() => evaluateMutation.mutate()}
                        disabled={evaluateMutation.isPending || !hasBothDocumentContents}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        {evaluateMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        Run Evaluation
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
