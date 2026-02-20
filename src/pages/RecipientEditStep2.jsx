import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, Save } from 'lucide-react';

function useSharedToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('sharedToken') || params.get('token') || '';
  }, [location.search]);
}

export default function RecipientEditStep2() {
  const navigate = useNavigate();
  const { proposalId } = useParams();
  const sharedToken = useSharedToken();
  const [title, setTitle] = useState('');
  const [docBText, setDocBText] = useState('');

  const proposalQuery = useQuery({
    queryKey: ['recipient-edit-proposal', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getById(proposalId),
  });

  const comparisonId = proposalQuery.data?.document_comparison_id || '';

  const comparisonQuery = useQuery({
    queryKey: ['recipient-edit-comparison', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = comparisonQuery.data?.comparison || null;

  React.useEffect(() => {
    if (!comparison) return;
    setTitle(comparison.title || '');
    setDocBText(comparison.doc_b_text || '');
  }, [comparison]);

  const saveMutation = useMutation({
    mutationFn: () =>
      documentComparisonsClient.update(comparisonId, {
        title,
        doc_b_text: docBText,
        draft_step: 2,
        status: 'draft',
      }),
    onSuccess: () => {
      comparisonQuery.refetch();
    },
  });

  const step3Url = sharedToken
    ? createPageUrl(
        `proposals/${encodeURIComponent(proposalId || '')}/recipient-edit/highlighting?sharedToken=${encodeURIComponent(sharedToken)}`,
      )
    : createPageUrl(`proposals/${encodeURIComponent(proposalId || '')}/recipient-edit/highlighting`);

  const backTarget = sharedToken
    ? createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}`)
    : createPageUrl('Proposals');

  if (proposalQuery.isLoading || comparisonQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-slate-700">Loading recipient draft...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (proposalQuery.error || comparisonQuery.error || !proposalQuery.data || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">
              {proposalQuery.error?.message ||
                comparisonQuery.error?.message ||
                'Unable to load recipient draft.'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-5">
        <Button variant="ghost" onClick={() => navigate(backTarget)} className="px-0">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {sharedToken ? 'Back to Shared Report' : 'Back to Proposals'}
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
            <p className="text-slate-500 mt-1">{title || 'Recipient Draft'}</p>
          </div>
          <Badge className="bg-slate-100 text-slate-700">Draft</Badge>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold text-blue-600">Step 2 of 4</span>
            <span className="text-slate-500">50% complete</span>
          </div>
          <Progress value={50} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Step 2: Content Input</CardTitle>
            <CardDescription>Document A is read-only. Update Document B and save your draft.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>{comparison.party_a_label}</Label>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 whitespace-pre-wrap text-sm text-slate-700 max-h-64 overflow-auto">
                {comparison.doc_a_text || 'No text available.'}
              </div>
            </div>
            <div className="space-y-1">
              <Label>{comparison.party_b_label}</Label>
              <Textarea rows={12} value={docBText} onChange={(event) => setDocBText(event.target.value)} />
            </div>
            {saveMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertDescription className="text-red-800">{saveMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button
            onClick={async () => {
              await saveMutation.mutateAsync();
              navigate(step3Url);
            }}
            disabled={saveMutation.isPending}
          >
            Continue to Highlighting
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
