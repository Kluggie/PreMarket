import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, ArrowRight, FileText, Highlighter, Loader2, Save, X } from 'lucide-react';
import { toast } from 'sonner';

const normalizeHighlightLevel = (level) => {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') return 'confidential';
  return null;
};

const normalizeHighlights = (spans, textLength) => {
  if (!Array.isArray(spans)) return [];
  const normalized = spans
    .map((span) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeHighlightLevel(span?.level);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.min(Math.floor(rawStart), textLength));
      const end = Math.max(0, Math.min(Math.floor(rawEnd), textLength));
      if (end <= start) return null;

      return { start, end, level };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

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
};

function renderHighlightedText(text, spans, docId) {
  if (!text) return <div id={docId} className="text-slate-500 italic">No text available.</div>;
  if (!Array.isArray(spans) || spans.length === 0) {
    return <div id={docId} className="whitespace-pre-wrap select-text">{text}</div>;
  }

  const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
  const parts = [];
  let lastIndex = 0;

  sortedSpans.forEach((span) => {
    if (span.start > lastIndex) {
      parts.push({ text: text.substring(lastIndex, span.start), highlight: null });
    }
    parts.push({ text: text.substring(span.start, span.end), highlight: span.level });
    lastIndex = span.end;
  });

  if (lastIndex < text.length) {
    parts.push({ text: text.substring(lastIndex), highlight: null });
  }

  return (
    <div id={docId} className="whitespace-pre-wrap select-text">
      {parts.map((part, idx) => (
        <span
          key={`highlight-part-${idx}`}
          className={part.highlight === 'confidential' ? 'bg-red-200 text-red-900 px-1 py-0.5 rounded' : ''}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
}

export default function RecipientEditStep3() {
  const navigate = useNavigate();
  const location = useLocation();
  const { proposalId } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [title, setTitle] = useState('Recipient Draft');
  const [partyALabel, setPartyALabel] = useState('Document A');
  const [partyBLabel, setPartyBLabel] = useState('Document B');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docASpans, setDocASpans] = useState([]);
  const [docBSpans, setDocBSpans] = useState([]);
  const [syncScroll, setSyncScroll] = useState(false);

  const docAPreviewRef = useRef(null);
  const docBPreviewRef = useRef(null);

  const sharedToken = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('sharedToken') || params.get('token');
  }, [location.search]);

  const step2Url = useMemo(() => {
    if (!proposalId) return createPageUrl('Proposals');
    const base = `proposals/${encodeURIComponent(proposalId)}/recipient-edit`;
    return sharedToken
      ? createPageUrl(`${base}?sharedToken=${encodeURIComponent(sharedToken)}`)
      : createPageUrl(base);
  }, [proposalId, sharedToken]);

  useEffect(() => {
    if (!proposalId) {
      setLoadError('Missing draft proposal id');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadDraft = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const proposalRows = await base44.entities.Proposal.filter({ id: proposalId }, '-created_date', 1);
        const draftProposal = proposalRows?.[0] || null;
        if (!draftProposal) {
          throw new Error('Draft proposal not found');
        }
        if (String(draftProposal?.proposal_type || '').toLowerCase() !== 'document_comparison') {
          throw new Error('Draft proposal is not a document comparison');
        }

        const comparisonId = draftProposal?.document_comparison_id || draftProposal?.documentComparisonId;
        if (!comparisonId) {
          throw new Error('Draft proposal is missing document comparison id');
        }

        const comparisonRows = await base44.entities.DocumentComparison.filter({ id: comparisonId }, '-created_date', 1);
        const draftComparison = comparisonRows?.[0] || null;
        if (!draftComparison) {
          throw new Error('Draft comparison not found');
        }

        if (cancelled) return;
        const normalizedDocASpans = normalizeHighlights(
          draftComparison?.doc_a_spans_json || [],
          String(draftComparison?.doc_a_plaintext || '').length
        );
        const normalizedDocBSpans = normalizeHighlights(
          draftComparison?.doc_b_spans_json || [],
          String(draftComparison?.doc_b_plaintext || '').length
        );

        setProposal(draftProposal);
        setComparison(draftComparison);
        setTitle(draftProposal?.title || draftComparison?.title || 'Recipient Draft');
        setPartyALabel(draftComparison?.party_a_label || 'Document A');
        setPartyBLabel(draftComparison?.party_b_label || 'Document B');
        setDocAText(String(draftComparison?.doc_a_plaintext || ''));
        setDocBText(String(draftComparison?.doc_b_plaintext || ''));
        setDocASpans(normalizedDocASpans);
        setDocBSpans(normalizedDocBSpans);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadDraft();
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  const handleSyncScroll = (sourceRef, targetRef) => {
    if (!syncScroll || !sourceRef.current || !targetRef.current) return;
    const source = sourceRef.current;
    const target = targetRef.current;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) return;
    const ratio = source.scrollTop / sourceRange;
    target.scrollTop = ratio * targetRange;
  };

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
    if (!selectedText || selectedText.length === 0) return null;

    const start = preRange.toString().length;
    const end = start + selectedText.length;
    const boundedStart = Math.max(0, Math.min(start, fullText.length));
    const boundedEnd = Math.max(0, Math.min(end, fullText.length));
    if (boundedEnd <= boundedStart) return null;

    return {
      start: boundedStart,
      end: boundedEnd
    };
  };

  const getSelectionForDocB = () => resolveSelectionOffsets('recipient-preview-b', docBText);

  const addDocBHighlight = () => {
    const selection = getSelectionForDocB();
    if (!selection) {
      toast.error('Select text in Document B first.');
      return;
    }

    const normalized = normalizeHighlights(
      [...docBSpans, { start: selection.start, end: selection.end, level: 'confidential' }],
      docBText.length
    );
    setDocBSpans(normalized);
    window.getSelection()?.removeAllRanges();
  };

  const removeDocBHighlight = (index) => {
    setDocBSpans(docBSpans.filter((_, idx) => idx !== index));
  };

  const handleSaveDraft = async () => {
    if (!proposal?.id || !comparison?.id) return;
    setSaving(true);
    try {
      const result = await base44.functions.invoke('SaveRecipientEditHighlights', {
        proposalId: proposal.id,
        docBSpans
      });
      const payload = result?.data && typeof result.data === 'object' ? result.data : {};
      if (!payload?.ok) {
        throw new Error(payload?.message || 'Failed to save highlights');
      }
      const savedSpans = normalizeHighlights(payload?.docBSpans || docBSpans, docBText.length);
      setDocBSpans(savedSpans);
      toast.success('Draft highlights saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save draft: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-[1400px] mx-auto px-12">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-slate-700">Loading recipient highlighting draft...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-[1400px] mx-auto px-12">
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-red-700 font-medium mb-2">Unable to open recipient highlighting</p>
              <p className="text-sm text-slate-600 mb-4">{loadError}</p>
              <Button variant="outline" onClick={() => navigate(step2Url)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Step 2
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-12">
        <div className="mb-5">
          <Button variant="ghost" onClick={() => navigate(step2Url)} className="mb-2 px-0">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Step 2
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
              <p className="text-slate-500 mt-1">{title}</p>
            </div>
            <Badge className="bg-slate-100 text-slate-700">Draft</Badge>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="font-semibold text-blue-600">Step 3 of 4</span>
            <span className="text-slate-500">75% complete</span>
          </div>
          <Progress value={75} className="h-3" />
        </div>

        <Alert className="bg-blue-50 border-blue-200 mb-6">
          <Highlighter className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Highlight confidential text in <strong>{partyBLabel}</strong>. <strong>{partyALabel}</strong> is read-only.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 mb-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <CardTitle className="text-base">{partyALabel}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Locked</Badge>
                  <Button variant="outline" size="sm" disabled title="Party A is read-only in recipient flow">
                    Mark Hidden
                  </Button>
                </div>
              </div>
              <CardDescription>Party A is visible but cannot be modified.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                ref={docAPreviewRef}
                onScroll={() => handleSyncScroll(docAPreviewRef, docBPreviewRef)}
                className="h-[420px] overflow-auto bg-white border border-slate-200 rounded-md p-5 text-sm leading-relaxed text-slate-800"
              >
                {renderHighlightedText(docAText, docASpans, 'recipient-preview-a')}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Applied Highlights</span>
                  <Badge className="bg-red-100 text-red-700 text-xs">{docASpans.length} hidden</Badge>
                </div>
                {docASpans.length === 0 ? (
                  <p className="text-xs text-slate-500">No highlights on Document A.</p>
                ) : (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {docASpans.map((span, idx) => (
                      <div key={`doca-span-${idx}`} className="text-sm bg-slate-50 p-2 rounded border border-slate-200">
                        <span className="text-slate-600">
                          {docAText.substring(span.start, Math.min(span.end, span.start + 60))}
                          {span.end - span.start > 60 ? '...' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <CardTitle className="text-base">{partyBLabel}</CardTitle>
                </div>
                <Button variant="outline" size="sm" onClick={addDocBHighlight}>
                  <span className="w-3 h-3 bg-red-500 rounded mr-2" />
                  Mark Hidden
                </Button>
              </div>
              <CardDescription>Select text in Document B, then click “Mark Hidden”.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                ref={docBPreviewRef}
                onScroll={() => handleSyncScroll(docBPreviewRef, docAPreviewRef)}
                className="h-[420px] overflow-auto bg-white border border-slate-200 rounded-md p-5 text-sm leading-relaxed text-slate-800"
              >
                {renderHighlightedText(docBText, docBSpans, 'recipient-preview-b')}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Applied Highlights</span>
                  <Badge className="bg-red-100 text-red-700 text-xs">{docBSpans.length} hidden</Badge>
                </div>
                {docBSpans.length === 0 ? (
                  <p className="text-xs text-slate-500">No highlights on Document B yet.</p>
                ) : (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {docBSpans.map((span, idx) => (
                      <div key={`docb-span-${idx}`} className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded border border-slate-200">
                        <span className="text-slate-600 truncate pr-2">
                          {docBText.substring(span.start, Math.min(span.end, span.start + 60))}
                          {span.end - span.start > 60 ? '...' : ''}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => removeDocBHighlight(idx)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => navigate(step2Url)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Content Input
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Draft
            </Button>
            <Button disabled title="Step 4 is coming next">
              Continue to Evaluation
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
