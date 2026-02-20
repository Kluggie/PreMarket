import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Download, Sparkles, AlertTriangle, FileText } from 'lucide-react';

function useComparisonId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

function triggerJsonDownload(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DocumentComparisonDetail() {
  const comparisonId = useComparisonId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: payload,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['document-comparison-detail', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = payload?.comparison || null;
  const proposal = payload?.proposal || null;

  const evaluateMutation = useMutation({
    mutationFn: () => documentComparisonsClient.evaluate(comparisonId, {}),
    onSuccess: () => {
      queryClient.invalidateQueries(['document-comparison-detail', comparisonId]);
      refetch();
    },
  });

  const downloadReportMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadJson(comparisonId),
    onSuccess: (result) => {
      triggerJsonDownload(result.filename, result.report);
    },
  });

  const downloadInputsMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadInputs(comparisonId),
    onSuccess: (result) => {
      triggerJsonDownload(result.filename, result.inputs);
    },
  });

  if (!comparisonId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing comparison id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-slate-600">Loading comparison...</p>
        </div>
      </div>
    );
  }

  if (error || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">
              {error?.message || 'Comparison not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const report = comparison.public_report || comparison.evaluation_result || {};
  const sections = Array.isArray(report.sections) ? report.sections : [];

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(createPageUrl('DocumentComparisonCreate'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Create
          </Button>
          <div className="flex items-center gap-2">
            <Badge className="bg-indigo-100 text-indigo-700">{comparison.status}</Badge>
            {proposal ? <Badge variant="outline">Proposal linked</Badge> : null}
          </div>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{comparison.title}</CardTitle>
            <CardDescription>
              {comparison.party_a_label} vs {comparison.party_b_label}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <p className="text-sm font-medium text-slate-900 mb-2">{comparison.party_a_label}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{comparison.doc_a_text || '—'}</p>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-white">
                <p className="text-sm font-medium text-slate-900 mb-2">{comparison.party_b_label}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{comparison.doc_b_text || '—'}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => evaluateMutation.mutate()} disabled={evaluateMutation.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {evaluateMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadReportMutation.mutate()}
                disabled={downloadReportMutation.isPending}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Report JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadInputsMutation.mutate()}
                disabled={downloadInputsMutation.isPending}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Inputs JSON
              </Button>
              {proposal?.id ? (
                <Link to={createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`)}>
                  <Button variant="outline">
                    <FileText className="w-4 h-4 mr-2" />
                    Open Proposal Detail
                  </Button>
                </Link>
              ) : null}
            </div>

            {evaluateMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertDescription className="text-red-800">{evaluateMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {sections.length > 0 ? (
              <div className="space-y-3">
                {sections.map((section) => (
                  <Card key={section.key || section.heading} className="border border-slate-200 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{section.heading || section.key}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                        {(Array.isArray(section.bullets) ? section.bullets : []).map((line, index) => (
                          <li key={`${section.key || 'section'}-${index}`}>{line}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No evaluation report available yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
