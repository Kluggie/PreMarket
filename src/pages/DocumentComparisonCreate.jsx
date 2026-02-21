import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Download,
  FileText,
  Highlighter,
  Link as LinkIcon,
  Loader2,
  Save,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHighlightLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function normalizeSpans(spans, textLength = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(spans)) return [];

  const normalized = spans
    .map((span) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeHighlightLevel(span?.level);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.floor(rawStart));
      const end = Math.floor(rawEnd);
      const boundedEnd = Number.isFinite(textLength) ? Math.min(end, textLength) : end;
      if (boundedEnd <= start) return null;

      return { start, end: boundedEnd, level };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  const merged = [];
  normalized.forEach((span) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      return;
    }

    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      return;
    }

    merged.push({ ...span });
  });

  return merged;
}

function renderHighlightedText(text, spans, containerId, allowSelection = true) {
  if (!text) {
    return (
      <div id={containerId} className="whitespace-pre-wrap text-slate-500 italic">
        No document text yet.
      </div>
    );
  }

  const normalizedSpans = normalizeSpans(spans, text.length);
  if (normalizedSpans.length === 0) {
    return (
      <div id={containerId} className={`whitespace-pre-wrap ${allowSelection ? 'select-text' : 'select-none'}`}>
        {text}
      </div>
    );
  }

  const parts = [];
  let cursor = 0;

  normalizedSpans.forEach((span) => {
    if (span.start > cursor) {
      parts.push({ text: text.substring(cursor, span.start), highlight: null });
    }
    parts.push({ text: text.substring(span.start, span.end), highlight: span.level });
    cursor = span.end;
  });

  if (cursor < text.length) {
    parts.push({ text: text.substring(cursor), highlight: null });
  }

  return (
    <div id={containerId} className={`whitespace-pre-wrap ${allowSelection ? 'select-text' : 'select-none'}`}>
      {parts.map((part, index) => (
        <span
          key={`${containerId}-${index}`}
          className={part.highlight === 'confidential' ? 'bg-red-200 text-red-900 px-1 py-0.5 rounded' : ''}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
}

function useRouteState() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const rawStep = Number(params.get('step') || 1);

    return {
      draftId: params.get('draft') || '',
      proposalId: params.get('proposalId') || '',
      token: params.get('token') || params.get('sharedToken') || '',
      step: Number.isFinite(rawStep) ? Math.min(Math.max(Math.floor(rawStep), 1), 4) : 1,
    };
  }, [location.search]);
}

function fileToMetadata(file) {
  return {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: Number(file.size || 0),
  };
}

export default function DocumentComparisonCreate() {
  const navigate = useNavigate();
  const routeState = useRouteState();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(routeState.step);
  const [comparisonId, setComparisonId] = useState(routeState.draftId);
  const [linkedProposalId, setLinkedProposalId] = useState(routeState.proposalId);
  const [editableHighlightSide, setEditableHighlightSide] = useState('a');
  const [title, setTitle] = useState('');
  const [partyALabel, setPartyALabel] = useState('Document A');
  const [partyBLabel, setPartyBLabel] = useState('Document B');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docASource, setDocASource] = useState('typed');
  const [docBSource, setDocBSource] = useState('typed');
  const [docAFiles, setDocAFiles] = useState([]);
  const [docBFiles, setDocBFiles] = useState([]);
  const [docAUrl, setDocAUrl] = useState('');
  const [docBUrl, setDocBUrl] = useState('');
  const [docASpans, setDocASpans] = useState([]);
  const [docBSpans, setDocBSpans] = useState([]);
  const [syncScroll, setSyncScroll] = useState(false);
  const [extractingUrlSide, setExtractingUrlSide] = useState(null);
  const [uploadingSide, setUploadingSide] = useState(null);
  const [uiError, setUiError] = useState('');
  const [lastSavedHash, setLastSavedHash] = useState('');
  const docAInputFileRef = useRef(null);
  const docBInputFileRef = useRef(null);
  const docAPreviewRef = useRef(null);
  const docBPreviewRef = useRef(null);
  const hydratedRef = useRef(false);

  const proposalLookup = useQuery({
    queryKey: ['document-comparison-proposal-lookup', routeState.proposalId],
    enabled: Boolean(routeState.proposalId && !routeState.draftId),
    queryFn: () => proposalsClient.getById(routeState.proposalId),
  });

  const resolvedDraftId = routeState.draftId || proposalLookup.data?.document_comparison_id || '';

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
    const permissions = draftQuery.data.permissions || {};

    hydratedRef.current = true;
    setComparisonId(comparison.id || resolvedDraftId || '');
    setLinkedProposalId(draftQuery.data.proposal?.id || routeState.proposalId || '');
    setEditableHighlightSide(permissions.editable_side === 'b' ? 'b' : 'a');
    setTitle(comparison.title || '');
    setPartyALabel(comparison.party_a_label || 'Document A');
    setPartyBLabel(comparison.party_b_label || 'Document B');
    setDocAText(comparison.doc_a_text || '');
    setDocBText(comparison.doc_b_text || '');
    setDocASource(comparison.doc_a_source || 'typed');
    setDocBSource(comparison.doc_b_source || 'typed');
    setDocAFiles(Array.isArray(comparison.doc_a_files) ? comparison.doc_a_files : []);
    setDocBFiles(Array.isArray(comparison.doc_b_files) ? comparison.doc_b_files : []);
    setDocAUrl(comparison.doc_a_url || '');
    setDocBUrl(comparison.doc_b_url || '');
    setDocASpans(normalizeSpans(comparison.doc_a_spans || [], String(comparison.doc_a_text || '').length));
    setDocBSpans(normalizeSpans(comparison.doc_b_spans || [], String(comparison.doc_b_text || '').length));

    const draftStep = Number(comparison.draft_step || routeState.step || 1);
    setStep(Math.min(Math.max(Math.floor(draftStep), 1), 4));
  }, [draftQuery.data, resolvedDraftId, routeState.proposalId, routeState.step]);

  const canEditDocAHighlights = editableHighlightSide === 'a';
  const canEditDocBHighlights = editableHighlightSide === 'b';

  const currentStateHash = useMemo(
    () =>
      JSON.stringify({
        comparisonId,
        linkedProposalId,
        step,
        title,
        partyALabel,
        partyBLabel,
        docAText,
        docBText,
        docASource,
        docBSource,
        docAFiles,
        docBFiles,
        docAUrl,
        docBUrl,
        docASpans,
        docBSpans,
        editableHighlightSide,
      }),
    [
      comparisonId,
      linkedProposalId,
      step,
      title,
      partyALabel,
      partyBLabel,
      docAText,
      docBText,
      docASource,
      docBSource,
      docAFiles,
      docBFiles,
      docAUrl,
      docBUrl,
      docASpans,
      docBSpans,
      editableHighlightSide,
    ],
  );

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent = false }) => {
      const payload = {
        title: asText(title) || 'Untitled Comparison',
        party_a_label: asText(partyALabel) || 'Document A',
        party_b_label: asText(partyBLabel) || 'Document B',
        doc_a_text: docAText,
        doc_b_text: docBText,
        doc_a_source: docASource,
        doc_b_source: docBSource,
        doc_a_files: docAFiles,
        doc_b_files: docBFiles,
        doc_a_url: asText(docAUrl) || null,
        doc_b_url: asText(docBUrl) || null,
        draft_step: Math.min(Math.max(Number(stepToSave || step || 1), 1), 4),
        proposalId: linkedProposalId || routeState.proposalId || null,
        createProposal: !(linkedProposalId || routeState.proposalId),
      };

      if (editableHighlightSide === 'a') {
        payload.doc_a_spans = normalizeSpans(docASpans, docAText.length);
      } else {
        payload.doc_b_spans = normalizeSpans(docBSpans, docBText.length);
      }

      if (routeState.token) {
        payload.sharedToken = routeState.token;
      }

      const response = await documentComparisonsClient.saveDraft(comparisonId || null, payload);
      const comparison = response?.comparison || response;
      const permissions = response?.permissions || null;

      if (!comparison?.id) {
        throw new Error('Failed to save draft');
      }

      setComparisonId(comparison.id);
      if (comparison.proposal_id && !linkedProposalId) {
        setLinkedProposalId(comparison.proposal_id);
      }
      if (permissions?.editable_side === 'a' || permissions?.editable_side === 'b') {
        setEditableHighlightSide(permissions.editable_side);
      }

      setLastSavedHash(currentStateHash);
      if (!silent) {
        toast.success('Draft saved');
      }

      queryClient.invalidateQueries(['proposals']);
      return comparison.id;
    },
    onError: (error) => {
      const message = error?.message || 'Failed to save draft';
      setUiError(message);
      toast.error(message);
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const persistedId = comparisonId || (await saveDraftMutation.mutateAsync({ stepToSave: 4, silent: true }));
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
    }, 1500);

    return () => clearTimeout(timer);
  }, [comparisonId, currentStateHash, lastSavedHash, saveDraftMutation, step]);

  const progress = (step / 4) * 100;

  const resolveSelectionOffsets = (containerId, fullText) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;

    const container = document.getElementById(containerId);
    if (!container || !container.contains(range.commonAncestorContainer)) return null;

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);

    const selectedText = range.toString();
    if (!selectedText) return null;

    const start = preRange.toString().length;
    const end = start + selectedText.length;
    const boundedStart = Math.max(0, Math.min(start, fullText.length));
    const boundedEnd = Math.max(0, Math.min(end, fullText.length));
    if (boundedEnd <= boundedStart) return null;

    return {
      start: boundedStart,
      end: boundedEnd,
    };
  };

  const addHighlight = (doc) => {
    if (doc === 'a' && !canEditDocAHighlights) {
      toast.error('Document A is locked for confidentiality edits.');
      return;
    }
    if (doc === 'b' && !canEditDocBHighlights) {
      toast.error('Document B is locked for confidentiality edits.');
      return;
    }

    const selection =
      doc === 'a'
        ? resolveSelectionOffsets('comparison-preview-a', docAText)
        : resolveSelectionOffsets('comparison-preview-b', docBText);

    if (!selection) {
      toast.error('Select text first, then click Mark Hidden.');
      return;
    }

    const nextSpan = { start: selection.start, end: selection.end, level: 'confidential' };
    if (doc === 'a') {
      setDocASpans((prev) => normalizeSpans([...prev, nextSpan], docAText.length));
    } else {
      setDocBSpans((prev) => normalizeSpans([...prev, nextSpan], docBText.length));
    }

    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }
  };

  const removeHighlight = (doc, index) => {
    if (doc === 'a' && !canEditDocAHighlights) return;
    if (doc === 'b' && !canEditDocBHighlights) return;
    if (doc === 'a') {
      setDocASpans((prev) => prev.filter((_, spanIndex) => spanIndex !== index));
      return;
    }
    setDocBSpans((prev) => prev.filter((_, spanIndex) => spanIndex !== index));
  };

  const handleSyncScroll = (sourceRef, targetRef) => {
    if (!syncScroll || !sourceRef.current || !targetRef.current) {
      return;
    }

    const source = sourceRef.current;
    const target = targetRef.current;
    if (source.scrollHeight <= source.clientHeight || target.scrollHeight <= target.clientHeight) {
      return;
    }

    const percentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
    target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
  };

  const setFileForSide = (doc, metadata, text) => {
    if (doc === 'a') {
      setDocASource('uploaded');
      setDocAFiles((prev) => [...prev, metadata]);
      setDocAText(text);
      return;
    }
    setDocBSource('uploaded');
    setDocBFiles((prev) => [...prev, metadata]);
    setDocBText(text);
  };

  const handleUpload = async (doc, file) => {
    if (!file) return;
    setUiError('');
    setUploadingSide(doc);

    try {
      const text = await documentComparisonsClient.extractTextFromFile(file);
      const normalizedText = String(text || '').trim();
      if (!normalizedText) {
        throw Object.assign(new Error('No readable text was extracted from the selected file'), {
          code: 'extract_failed',
          status: 422,
        });
      }

      setFileForSide(doc, fileToMetadata(file), normalizedText);
      toast.success(`${file.name} loaded`);
    } catch (error) {
      const message =
        error?.code === 'not_configured'
          ? `${error.message}. Supported types: .txt, .md, .pdf, .docx.`
          : error?.message || 'Failed to load file';
      setUiError(message);
      toast.error(message);
    } finally {
      setUploadingSide(null);
      if (doc === 'a' && docAInputFileRef.current) docAInputFileRef.current.value = '';
      if (doc === 'b' && docBInputFileRef.current) docBInputFileRef.current.value = '';
    }
  };

  const extractUrlForSide = async (doc) => {
    const url = doc === 'a' ? docAUrl : docBUrl;
    if (!asText(url)) {
      toast.error('Enter a URL first.');
      return;
    }

    setUiError('');
    setExtractingUrlSide(doc);
    try {
      const extracted = await documentComparisonsClient.extractUrl(url);
      const text = String(extracted?.text || '');
      if (!text) {
        throw new Error('No text extracted from URL');
      }

      if (doc === 'a') {
        setDocASource('url');
        setDocAText(text);
        if (!asText(title) && extracted?.title) {
          setTitle(extracted.title);
        }
      } else {
        setDocBSource('url');
        setDocBText(text);
      }
      toast.success('URL extracted');
    } catch (error) {
      const message = error?.message || 'Failed to extract URL';
      setUiError(message);
      toast.error(message);
    } finally {
      setExtractingUrlSide(null);
    }
  };

  const jumpStep = async (nextStep) => {
    const bounded = Math.min(Math.max(Number(nextStep || 1), 1), 4);
    const savedId = await saveDraftMutation.mutateAsync({ stepToSave: bounded, silent: true });
    if (!savedId) return;
    setStep(bounded);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-12">
        <div className="mb-5">
          <Link
            to={createPageUrl('Proposals')}
            className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
          <p className="text-slate-500 mt-1">Compare two documents with confidentiality controls</p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className={`font-semibold ${step === 1 ? 'text-blue-600' : 'text-slate-400'}`}>Step {step} of 4</span>
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
            >
              <Card>
                <CardHeader>
                  <CardTitle>Step 1: Create proposal</CardTitle>
                  <CardDescription>Set the comparison title and document labels.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Comparison Title</Label>
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="e.g., Mutual NDA comparison"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Document A Label</Label>
                      <Input value={partyALabel} onChange={(event) => setPartyALabel(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Document B Label</Label>
                      <Input value={partyBLabel} onChange={(event) => setPartyBLabel(event.target.value)} />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => jumpStep(2)} className="bg-blue-600 hover:bg-blue-700">
                      Continue to Input
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="doc-step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-2 gap-16 items-stretch bg-gray-50 -mx-12 px-12 py-10">
                <div className="flex flex-col h-full space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-slate-600">{partyALabel}</h3>
                    <Badge variant="outline">{docASource}</Badge>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        ref={docAInputFileRef}
                        type="file"
                        accept=".txt,.md,.pdf,.docx"
                        className="hidden"
                        onChange={(event) => handleUpload('a', event.target.files?.[0] || null)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => docAInputFileRef.current?.click()}
                        disabled={uploadingSide === 'a'}
                      >
                        {uploadingSide === 'a' ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4 mr-2" />
                        )}
                        Upload
                      </Button>
                      <Input
                        value={docAUrl}
                        onChange={(event) => setDocAUrl(event.target.value)}
                        placeholder="https://..."
                        className="h-9"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => extractUrlForSide('a')}
                        disabled={extractingUrlSide === 'a'}
                      >
                        {extractingUrlSide === 'a' ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <LinkIcon className="w-4 h-4 mr-2" />
                        )}
                        Extract
                      </Button>
                    </div>
                    {docAFiles.length > 0 && (
                      <p className="text-xs text-slate-500">{docAFiles.length} uploaded file(s) tracked for Document A.</p>
                    )}
                  </div>
                  <Textarea
                    value={docAText}
                    onChange={(event) => {
                      setDocASource('typed');
                      setDocAText(event.target.value);
                    }}
                    placeholder="Paste or type Document A text..."
                    className="flex-1 min-h-[600px] w-full bg-white border border-gray-200 rounded-md shadow-sm resize-none text-[15px] leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 placeholder:text-gray-400 px-12 py-10"
                  />
                </div>

                <div className="flex flex-col h-full space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-semibold text-slate-600">{partyBLabel}</h3>
                    <Badge variant="outline">{docBSource}</Badge>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        ref={docBInputFileRef}
                        type="file"
                        accept=".txt,.md,.pdf,.docx"
                        className="hidden"
                        onChange={(event) => handleUpload('b', event.target.files?.[0] || null)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => docBInputFileRef.current?.click()}
                        disabled={uploadingSide === 'b'}
                      >
                        {uploadingSide === 'b' ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4 mr-2" />
                        )}
                        Upload
                      </Button>
                      <Input
                        value={docBUrl}
                        onChange={(event) => setDocBUrl(event.target.value)}
                        placeholder="https://..."
                        className="h-9"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => extractUrlForSide('b')}
                        disabled={extractingUrlSide === 'b'}
                      >
                        {extractingUrlSide === 'b' ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <LinkIcon className="w-4 h-4 mr-2" />
                        )}
                        Extract
                      </Button>
                    </div>
                    {docBFiles.length > 0 && (
                      <p className="text-xs text-slate-500">{docBFiles.length} uploaded file(s) tracked for Document B.</p>
                    )}
                  </div>
                  <Textarea
                    value={docBText}
                    onChange={(event) => {
                      setDocBSource('typed');
                      setDocBText(event.target.value);
                    }}
                    placeholder="Paste or type Document B text..."
                    className="flex-1 min-h-[600px] w-full bg-white border border-gray-200 rounded-md shadow-sm resize-none text-[15px] leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 placeholder:text-gray-400 px-12 py-10"
                  />
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => jumpStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => saveDraftMutation.mutate({ stepToSave: 2 })}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Draft
                  </Button>
                  <Button
                    onClick={() => jumpStep(3)}
                    disabled={!asText(docAText) || !asText(docBText)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Continue to Highlighting
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="doc-step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <Alert className="bg-blue-50 border-blue-200">
                <Highlighter className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  <strong>How to highlight:</strong> You can only mark your own document as hidden.
                  {canEditDocAHighlights ? ` ${partyALabel} is editable for confidentiality.` : ` ${partyALabel} is locked.`}
                  {canEditDocBHighlights ? ` ${partyBLabel} is editable for confidentiality.` : ` ${partyBLabel} is locked.`}
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-red-200 rounded" />
                    <span className="text-sm text-slate-700">Hidden</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-white border border-slate-300 rounded" />
                    <span className="text-sm text-slate-700">Visible</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncScroll((prev) => !prev)}
                  className={syncScroll ? 'bg-blue-50 border-blue-200' : ''}
                >
                  {syncScroll ? '✓ Sync Scrolling' : 'Sync Scrolling'}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-16 items-stretch bg-gray-50 -mx-12 px-12 py-10">
                <div className="flex flex-col space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400" />
                      <h3 className="text-sm font-semibold text-slate-600">{partyALabel}</h3>
                      {!canEditDocAHighlights && <Badge variant="outline">Locked</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => addHighlight('a')} disabled={!canEditDocAHighlights}>
                        <span className="w-3 h-3 bg-red-500 rounded mr-2" />
                        Mark Hidden
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!docASpans.length}
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(docASpans, null, 2)).catch(() => null);
                          toast.success('Document A highlights copied');
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-4 bg-white border border-gray-200 rounded-md shadow-sm p-12">
                    <div
                      ref={docAPreviewRef}
                      onScroll={() => handleSyncScroll(docAPreviewRef, docBPreviewRef)}
                      className="flex-1 overflow-auto text-[15px] leading-relaxed text-gray-800 min-h-[420px]"
                    >
                      {renderHighlightedText(docAText, docASpans, 'comparison-preview-a', canEditDocAHighlights)}
                    </div>

                    {docASpans.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold">Applied Highlights</Label>
                          <Badge className="bg-red-100 text-red-700 text-xs">{docASpans.length} hidden</Badge>
                        </div>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {docASpans.map((span, index) => (
                            <div
                              key={`a-span-${span.start}-${span.end}-${index}`}
                              className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="w-3 h-3 rounded flex-shrink-0 bg-red-500" />
                                <span className="text-slate-600 truncate">
                                  {docAText.substring(span.start, Math.min(span.end, span.start + 60))}
                                  {span.end - span.start > 60 ? '...' : ''}
                                </span>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => removeHighlight('a', index)} disabled={!canEditDocAHighlights}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400" />
                      <h3 className="text-sm font-semibold text-slate-600">{partyBLabel}</h3>
                      {!canEditDocBHighlights && <Badge variant="outline">Locked</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => addHighlight('b')} disabled={!canEditDocBHighlights}>
                        <span className="w-3 h-3 bg-red-500 rounded mr-2" />
                        Mark Hidden
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!docBSpans.length}
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(docBSpans, null, 2)).catch(() => null);
                          toast.success('Document B highlights copied');
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-4 bg-white border border-gray-200 rounded-md shadow-sm p-12">
                    <div
                      ref={docBPreviewRef}
                      onScroll={() => handleSyncScroll(docBPreviewRef, docAPreviewRef)}
                      className="flex-1 overflow-auto text-[15px] leading-relaxed text-gray-800 min-h-[420px]"
                    >
                      {renderHighlightedText(docBText, docBSpans, 'comparison-preview-b', canEditDocBHighlights)}
                    </div>

                    {docBSpans.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold">Applied Highlights</Label>
                          <Badge className="bg-red-100 text-red-700 text-xs">{docBSpans.length} hidden</Badge>
                        </div>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {docBSpans.map((span, index) => (
                            <div
                              key={`b-span-${span.start}-${span.end}-${index}`}
                              className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="w-3 h-3 rounded flex-shrink-0 bg-red-500" />
                                <span className="text-slate-600 truncate">
                                  {docBText.substring(span.start, Math.min(span.end, span.start + 60))}
                                  {span.end - span.start > 60 ? '...' : ''}
                                </span>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => removeHighlight('b', index)} disabled={!canEditDocBHighlights}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-6">
                <Button variant="outline" onClick={() => jumpStep(2)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Input
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => saveDraftMutation.mutate({ stepToSave: 3 })}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Draft
                  </Button>
                  <Button onClick={() => jumpStep(4)} className="bg-blue-600 hover:bg-blue-700">
                    Continue to Evaluation
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="doc-step-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Step 4: Review & Evaluate</CardTitle>
                  <CardDescription>Review your comparison before running AI evaluation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="font-medium">{title || 'Untitled Comparison'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{partyALabel} Length</span>
                      <span className="font-medium">{docAText.length} characters</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{partyBLabel} Length</span>
                      <span className="font-medium">{docBText.length} characters</span>
                    </div>
                  </div>

                  <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-center">
                    <p className="text-3xl font-bold text-red-700">{docASpans.length + docBSpans.length}</p>
                    <p className="text-sm text-red-600 mt-1">Hidden Spans</p>
                  </div>

                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Confidentiality Guarantee:</strong> Hidden content will never be quoted in the AI report.
                      The AI reads it for analysis but returns redacted insights only.
                    </AlertDescription>
                  </Alert>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => jumpStep(3)}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Highlighting
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => saveDraftMutation.mutate({ stepToSave: 4 })}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                      <Button
                        onClick={() => evaluateMutation.mutate()}
                        disabled={evaluateMutation.isPending || !asText(docAText) || !asText(docBText)}
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
