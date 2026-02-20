import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ArrowRight,
  Save,
  Sparkles,
  AlertTriangle,
  FileText,
  CheckCircle2,
} from 'lucide-react';

function useRouteState() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const requestedStep = Number(params.get('step') || 1);
    return {
      draftId: params.get('draft') || '',
      proposalId: params.get('proposalId') || '',
      step: Number.isFinite(requestedStep) ? Math.min(Math.max(requestedStep, 1), 4) : 1,
    };
  }, [location.search]);
}

function normalizeSpans(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      start: Number(row.start),
      end: Number(row.end),
      level: row.level || 'confidential',
    }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start);
}

export default function DocumentComparisonCreate() {
  const navigate = useNavigate();
  const routeState = useRouteState();
  const [step, setStep] = useState(routeState.step);
  const [comparisonId, setComparisonId] = useState(routeState.draftId || '');
  const [title, setTitle] = useState('Document Comparison Draft');
  const [partyALabel, setPartyALabel] = useState('Document A');
  const [partyBLabel, setPartyBLabel] = useState('Document B');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docBSpanStart, setDocBSpanStart] = useState('');
  const [docBSpanEnd, setDocBSpanEnd] = useState('');
  const [docBSpans, setDocBSpans] = useState([]);

  const { data: existingPayload, isLoading } = useQuery({
    queryKey: ['document-comparison-draft', routeState.draftId],
    enabled: Boolean(routeState.draftId),
    queryFn: () => documentComparisonsClient.getById(routeState.draftId),
  });

  React.useEffect(() => {
    const comparison = existingPayload?.comparison;
    if (!comparison) return;

    setComparisonId(comparison.id);
    setTitle(comparison.title || 'Document Comparison Draft');
    setPartyALabel(comparison.party_a_label || 'Document A');
    setPartyBLabel(comparison.party_b_label || 'Document B');
    setDocAText(comparison.doc_a_text || '');
    setDocBText(comparison.doc_b_text || '');
    setDocBSpans(normalizeSpans(comparison.doc_b_spans || []));
    setStep(Math.min(Math.max(Number(comparison.draft_step || routeState.step || 1), 1), 4));
  }, [existingPayload, routeState.step]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title,
        party_a_label: partyALabel,
        party_b_label: partyBLabel,
        doc_a_text: docAText,
        doc_b_text: docBText,
        doc_b_spans: docBSpans,
        draft_step: step,
        proposalId: routeState.proposalId || null,
        createProposal: !routeState.proposalId,
      };

      if (comparisonId) {
        return documentComparisonsClient.update(comparisonId, payload);
      }

      return documentComparisonsClient.create(payload);
    },
    onSuccess: (comparison) => {
      if (!comparisonId && comparison?.id) {
        setComparisonId(comparison.id);
      }
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      let id = comparisonId;

      if (!id) {
        const created = await saveMutation.mutateAsync();
        id = created?.id || '';
      }

      if (!id) {
        throw new Error('Could not create comparison draft');
      }

      return documentComparisonsClient.evaluate(id, {});
    },
    onSuccess: (result) => {
      if (result?.comparison?.id) {
        setComparisonId(result.comparison.id);
      }
    },
  });

  const stepProgress = (step / 4) * 100;

  const handleAddSpan = () => {
    const start = Number(docBSpanStart);
    const end = Number(docBSpanEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    setDocBSpans((prev) =>
      normalizeSpans([
        ...prev,
        {
          start,
          end,
          level: 'confidential',
        },
      ]),
    );
    setDocBSpanStart('');
    setDocBSpanEnd('');
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(createPageUrl('Templates'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Templates
          </Button>
          <Badge className="bg-indigo-100 text-indigo-700">Step {step} of 4</Badge>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Document Comparison</CardTitle>
            <CardDescription>
              Restore baseline 4-step workflow: create, inputs, confidentiality, evaluation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={stepProgress} className="h-2" />
          </CardContent>
        </Card>

        {isLoading ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-slate-500">Loading draft...</CardContent>
          </Card>
        ) : null}

        {!isLoading && step === 1 ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Step 1: Create draft</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Party A label</Label>
                  <Input value={partyALabel} onChange={(event) => setPartyALabel(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Party B label</Label>
                  <Input value={partyBLabel} onChange={(event) => setPartyBLabel(event.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && step === 2 ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Step 2: Input documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>{partyALabel}</Label>
                <Textarea rows={8} value={docAText} onChange={(event) => setDocAText(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{partyBLabel}</Label>
                <Textarea rows={8} value={docBText} onChange={(event) => setDocBText(event.target.value)} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && step === 3 ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Step 3: Confidentiality highlights</CardTitle>
              <CardDescription>Mark redaction spans for {partyBLabel} using character offsets.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Start index"
                  value={docBSpanStart}
                  onChange={(event) => setDocBSpanStart(event.target.value)}
                />
                <Input
                  placeholder="End index"
                  value={docBSpanEnd}
                  onChange={(event) => setDocBSpanEnd(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={handleAddSpan}>
                  Add Span
                </Button>
              </div>

              {docBSpans.length === 0 ? (
                <p className="text-sm text-slate-500">No spans marked yet.</p>
              ) : (
                <div className="space-y-2">
                  {docBSpans.map((span, index) => (
                    <div
                      key={`span-${span.start}-${span.end}-${index}`}
                      className="flex items-center justify-between p-2 rounded border border-slate-200"
                    >
                      <p className="text-sm text-slate-700">
                        {span.start} - {span.end} ({span.level})
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDocBSpans((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && step === 4 ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Step 4: Run evaluation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Persist your draft and generate a comparison report.
              </p>
              {evaluateMutation.data?.evaluation ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-700" />
                  <AlertDescription className="text-green-800">
                    {evaluateMutation.data.evaluation.summary ||
                      `Evaluation generated for ${title}.`}
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {saveMutation.error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{saveMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {evaluateMutation.error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{evaluateMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
            </Button>
            {comparisonId ? (
              <Link to={createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(comparisonId)}`)}>
                <Button variant="outline">
                  <FileText className="w-4 h-4 mr-2" />
                  Open Detail
                </Button>
              </Link>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep((prev) => Math.max(prev - 1, 1))} disabled={step === 1}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>
            {step < 4 ? (
              <Button onClick={() => setStep((prev) => Math.min(prev + 1, 4))}>
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={() => evaluateMutation.mutate()} disabled={evaluateMutation.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {evaluateMutation.isPending ? 'Running...' : 'Run Evaluation'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
