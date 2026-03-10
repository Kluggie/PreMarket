import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import ComparisonWorkflowShell from '@/components/document-comparison/ComparisonWorkflowShell';

function useSharedToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('sharedToken') || params.get('token') || '';
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
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    .sort((a, b) => a.start - b.start);
}

export default function RecipientEditStep3() {
  const navigate = useNavigate();
  const { proposalId } = useParams();
  const sharedToken = useSharedToken();
  const [spanStart, setSpanStart] = useState('');
  const [spanEnd, setSpanEnd] = useState('');
  const [docBSpans, setDocBSpans] = useState([]);

  const proposalQuery = useQuery({
    queryKey: ['recipient-edit-proposal-step3', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getById(proposalId),
  });

  const comparisonId = proposalQuery.data?.document_comparison_id || '';

  const comparisonQuery = useQuery({
    queryKey: ['recipient-edit-comparison-step3', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = comparisonQuery.data?.comparison || null;

  React.useEffect(() => {
    if (!comparison) return;
    setDocBSpans(normalizeSpans(comparison.doc_b_spans || []));
  }, [comparison]);

  const saveMutation = useMutation({
    mutationFn: () =>
      documentComparisonsClient.update(comparisonId, {
        doc_b_spans: docBSpans,
        draft_step: 3,
        status: 'draft',
      }),
    onSuccess: () => {
      comparisonQuery.refetch();
    },
  });

  const addSpan = () => {
    const start = Number(spanStart);
    const end = Number(spanEnd);
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
    setSpanStart('');
    setSpanEnd('');
  };

  const backTarget = sharedToken
    ? createPageUrl(
        `proposals/${encodeURIComponent(proposalId || '')}/recipient-edit?sharedToken=${encodeURIComponent(sharedToken)}`,
      )
    : createPageUrl(`proposals/${encodeURIComponent(proposalId || '')}/recipient-edit`);

  const doneTarget = sharedToken
    ? createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}`)
    : createPageUrl('Proposals');

  if (proposalQuery.isLoading || comparisonQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-6">
        <ComparisonWorkflowShell
          title="Highlight Confidential Content"
          step={3}
          totalSteps={4}
          progress={75}
          backSlot={
            <button
              type="button"
              onClick={() => navigate(backTarget)}
              className="inline-flex items-center text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Step 2
            </button>
          }
        >
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-slate-700">Loading recipient highlighting draft...</p>
            </CardContent>
          </Card>
        </ComparisonWorkflowShell>
      </div>
    );
  }

  if (proposalQuery.error || comparisonQuery.error || !proposalQuery.data || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-6">
        <ComparisonWorkflowShell
          title="Highlight Confidential Content"
          step={3}
          totalSteps={4}
          progress={75}
          backSlot={
            <button
              type="button"
              onClick={() => navigate(backTarget)}
              className="inline-flex items-center text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Step 2
            </button>
          }
        >
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">
              {proposalQuery.error?.message ||
                comparisonQuery.error?.message ||
                'Unable to load highlighting draft.'}
            </AlertDescription>
          </Alert>
        </ComparisonWorkflowShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <ComparisonWorkflowShell
        title="Highlight Confidential Content"
        subtitle={comparison.title || ''}
        step={3}
        totalSteps={4}
        progress={75}
        backSlot={
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            className="inline-flex items-center text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Step 2
          </button>
        }
        saveStatusLabel={saveMutation.isPending ? 'Saving…' : saveMutation.isSuccess ? 'Saved' : undefined}
      >

        <Card>
          <CardHeader>
            <CardTitle>Document B Highlighting</CardTitle>
            <CardDescription>
              Mark confidential spans by character offset to preserve redaction behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 whitespace-pre-wrap text-sm text-slate-700 max-h-64 overflow-auto">
              {comparison.doc_b_text || 'No Document B text available.'}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Start index</Label>
                <Input value={spanStart} onChange={(event) => setSpanStart(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End index</Label>
                <Input value={spanEnd} onChange={(event) => setSpanEnd(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={addSpan}>
                  Add Span
                </Button>
              </div>
            </div>

            {docBSpans.length === 0 ? (
              <p className="text-sm text-slate-500">No highlighted spans yet.</p>
            ) : (
              <div className="space-y-2">
                {docBSpans.map((span, index) => (
                  <div
                    key={`recipient-span-${span.start}-${span.end}-${index}`}
                    className="flex items-center justify-between rounded border border-slate-200 p-2"
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

        {saveMutation.error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{saveMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {saveMutation.data ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-700" />
            <AlertDescription className="text-green-800">Highlight draft saved.</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Highlights'}
          </Button>
          <Button
            onClick={async () => {
              await saveMutation.mutateAsync();
              navigate(doneTarget);
            }}
            disabled={saveMutation.isPending}
          >
            Finish
          </Button>
        </div>
      </ComparisonWorkflowShell>
    </div>
  );
}
