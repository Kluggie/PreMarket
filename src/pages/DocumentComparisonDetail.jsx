import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Download,
  FileText,
  MessageSquare,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDate(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function normalizeHighlightLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function normalizeSpans(spans, textLength) {
  if (!Array.isArray(spans)) return [];
  return spans
    .map((span) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeHighlightLevel(span?.level);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;
      const start = Math.max(0, Math.min(rawStart, textLength));
      const end = Math.max(0, Math.min(rawEnd, textLength));
      if (end <= start) return null;
      return { start, end, level };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function renderHighlightedReadOnlyText(text, spans) {
  if (!text) {
    return <p className="text-sm text-slate-500 italic">No text available.</p>;
  }

  const normalizedSpans = normalizeSpans(spans, text.length);
  if (!normalizedSpans.length) {
    return <div className="whitespace-pre-wrap font-mono text-sm text-slate-800">{text}</div>;
  }

  const segments = [];
  let cursor = 0;
  normalizedSpans.forEach((span) => {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), highlight: false });
    }
    segments.push({ text: text.slice(span.start, span.end), highlight: true });
    cursor = span.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }

  return (
    <div className="whitespace-pre-wrap font-mono text-sm text-slate-800">
      {segments.map((segment, index) => (
        <span
          key={`segment-${index}`}
          className={segment.highlight ? 'bg-red-200 text-red-900 px-0.5 rounded' : ''}
        >
          {segment.text}
        </span>
      ))}
    </div>
  );
}

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
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DocumentComparisonDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const comparisonId = useComparisonId();
  const [activeTab, setActiveTab] = useState('overview');

  const comparisonQuery = useQuery({
    queryKey: ['document-comparison-detail', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = comparisonQuery.data?.comparison || null;
  const proposal = comparisonQuery.data?.proposal || null;
  const hiddenCount = Number(comparison?.doc_a_spans?.length || 0) + Number(comparison?.doc_b_spans?.length || 0);

  const evaluationsQuery = useQuery({
    queryKey: ['document-comparison-proposal-evaluations', proposal?.id || 'none'],
    enabled: Boolean(proposal?.id),
    queryFn: () => proposalsClient.getEvaluations(proposal.id),
  });

  const report = comparison?.public_report || comparison?.evaluation_result?.report || {};
  const evaluationHistory = Array.isArray(evaluationsQuery.data) ? evaluationsQuery.data : [];
  const hasReport = Boolean(
    (report && typeof report === 'object' && Object.keys(report).length > 0) || evaluationHistory.length > 0,
  );

  const runEvaluationMutation = useMutation({
    mutationFn: () => documentComparisonsClient.evaluate(comparisonId, {}),
    onSuccess: () => {
      queryClient.invalidateQueries(['document-comparison-detail', comparisonId]);
      if (proposal?.id) {
        queryClient.invalidateQueries(['document-comparison-proposal-evaluations', proposal.id]);
      }
      queryClient.invalidateQueries(['proposals']);
      toast.success('Evaluation completed');
    },
    onError: (error) => {
      toast.error(error?.message || 'Evaluation failed');
    },
  });

  const downloadReportMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadJson(comparisonId),
    onSuccess: (payload) => {
      triggerJsonDownload(payload.filename || 'comparison-report.json', payload.report || {});
      toast.success('Report JSON downloaded');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download report JSON');
    },
  });

  const downloadInputsMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadInputs(comparisonId),
    onSuccess: (payload) => {
      triggerJsonDownload(payload.filename || 'comparison-inputs.json', payload.inputs || {});
      toast.success('Inputs JSON downloaded');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download inputs JSON');
    },
  });

  const downloadPdfMutation = useMutation({
    mutationFn: () => documentComparisonsClient.downloadPdf(comparisonId),
    onSuccess: () => {
      toast.success('PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'PDF download unavailable');
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!proposal?.id) {
        throw new Error('Proposal linkage is required before sharing');
      }

      const defaultRecipient = asText(proposal?.party_b_email);
      const recipientEmail =
        window.prompt('Recipient email for the updated shared workspace link:', defaultRecipient || '') || '';

      const payload = await sharedLinksClient.create({
        proposalId: proposal.id,
        recipientEmail: asText(recipientEmail) || null,
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: true,
        canSendBack: true,
        maxUses: 50,
      });

      if (!payload?.url) {
        throw new Error('Share link could not be created');
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.url).catch(() => null);
      }

      return payload;
    },
    onSuccess: (payload) => {
      toast.success('Share link generated and copied');
      if (payload?.url) {
        window.alert(`Shared link:\n\n${payload.url}`);
      }
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to generate share link');
    },
  });

  if (!comparisonId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900">Missing comparison id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (comparisonQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6 text-slate-500">Loading comparison...</div>
      </div>
    );
  }

  if (comparisonQuery.error || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-900">
              {comparisonQuery.error?.message || 'Comparison not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const latestEvaluation = evaluationHistory[0] || null;
  const recommendation =
    asText(report?.recommendation) ||
    asText(comparison?.evaluation_result?.recommendation) ||
    asText(latestEvaluation?.summary) ||
    'unknown fit';
  const similarityScore = Number(
    comparison?.evaluation_result?.score ??
      report?.similarity_score ??
      latestEvaluation?.score ??
      0,
  );

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 space-y-6">
        <Link
          to={createPageUrl('Proposals')}
          className="inline-flex items-center text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Proposals
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6 items-start">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="pt-6 space-y-5">
              <h1 className="text-5xl font-bold text-slate-900 leading-tight break-words">{comparison.title}</h1>
              <div className="h-px bg-slate-200" />
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Status</span>
                  <Badge variant="outline">{comparison.status}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Created</span>
                  <span className="text-slate-800">{formatDate(comparison.created_date)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Hidden Spans</span>
                  <Badge variant="outline">{hiddenCount}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Last Updated</span>
                  <span className="text-slate-800">{formatDate(comparison.updated_date)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => runEvaluationMutation.mutate()} disabled={runEvaluationMutation.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {runEvaluationMutation.isPending ? 'Running Evaluation...' : 'Run Evaluation'}
              </Button>
              <Button variant="outline" onClick={() => downloadReportMutation.mutate()} disabled={downloadReportMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Download Report JSON
              </Button>
              <Button variant="outline" onClick={() => downloadInputsMutation.mutate()} disabled={downloadInputsMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Download Inputs JSON
              </Button>
              <Button onClick={() => shareMutation.mutate()} disabled={!proposal?.id || shareMutation.isPending}>
                <Send className="w-4 h-4 mr-2" />
                Share Updated Version
              </Button>
              {proposal?.id && (
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`))}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Open Proposal Detail
                </Button>
              )}
              <Button variant="outline" onClick={() => downloadPdfMutation.mutate()} disabled={downloadPdfMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Download AI Report PDF
              </Button>
              <Button variant="outline" onClick={() => navigate(createPageUrl(`DocumentComparisonCreate?draft=${encodeURIComponent(comparison.id)}&step=1`))}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Edit Proposal
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-white border border-slate-200 p-1">
                <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  <FileText className="w-4 h-4 mr-2" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="report" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  AI Report
                  {hasReport && <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-6 space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
                  <Card className="border border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle>Parties</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                          <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Party A (Proposer)</p>
                          <p className="font-semibold text-slate-900">{proposal?.party_a_email || 'Not specified'}</p>
                          <Badge variant="outline" className="mt-3">You</Badge>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                          <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Party B (Recipient)</p>
                          <p className="font-semibold text-slate-900">{proposal?.party_b_email || 'Not specified'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <Card className="border border-slate-200 shadow-sm">
                      <CardHeader>
                        <CardTitle>Quick Actions</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <Button variant="outline" className="w-full justify-center" disabled>
                          <MessageSquare className="w-4 h-4 mr-2" />
                          Add Comment
                        </Button>
                        <Button variant="outline" className="w-full justify-center" disabled>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Document
                        </Button>
                        {proposal?.id && (
                          <Button
                            variant="outline"
                            className="w-full justify-center"
                            onClick={() => navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`))}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Open Proposal Detail
                          </Button>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border border-slate-200 shadow-sm">
                      <CardHeader>
                        <CardTitle>Activity Timeline</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">Proposal Created</p>
                            <p className="text-slate-500">{formatDateTime(comparison.created_date)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">Last Updated</p>
                            <p className="text-slate-500">{formatDateTime(comparison.updated_date)}</p>
                          </div>
                        </div>
                        {latestEvaluation && (
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
                              <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">Evaluation Complete</p>
                              <p className="text-slate-500">{formatDateTime(latestEvaluation.created_date)}</p>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Complete Proposal Details</CardTitle>
                    <p className="text-slate-500">Read-only document content with hidden highlights.</p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-700 font-semibold">
                          <FileText className="w-4 h-4" />
                          {comparison.party_a_label}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline">{comparison.doc_a_source || 'typed'}</Badge>
                          <Badge className="bg-red-100 text-red-700">{comparison.doc_a_spans?.length || 0} hidden</Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[280px] overflow-auto">
                        {renderHighlightedReadOnlyText(comparison.doc_a_text || '', comparison.doc_a_spans || [])}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-700 font-semibold">
                          <FileText className="w-4 h-4" />
                          {comparison.party_b_label}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline">{comparison.doc_b_source || 'typed'}</Badge>
                          <Badge className="bg-red-100 text-red-700">{comparison.doc_b_spans?.length || 0} hidden</Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[280px] overflow-auto">
                        {renderHighlightedReadOnlyText(comparison.doc_b_text || '', comparison.doc_b_spans || [])}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="report" className="mt-6 space-y-6">
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Evaluation History ({evaluationHistory.length || (hasReport ? 1 : 0)})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {evaluationHistory.length > 0 ? (
                      <div className="space-y-3">
                        {evaluationHistory.map((evaluation, index) => (
                          <div
                            key={evaluation.id || `evaluation-${index}`}
                            className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 p-3"
                          >
                            <div className="flex items-center gap-3">
                              <Badge className="bg-green-100 text-green-700">succeeded</Badge>
                              <span className="text-slate-700">{formatDateTime(evaluation.created_date)}</span>
                              {index === 0 && <Badge variant="outline">Latest</Badge>}
                            </div>
                            <span className="text-blue-600 font-semibold">{Number(evaluation.score || 0)}% confidence</span>
                          </div>
                        ))}
                      </div>
                    ) : hasReport ? (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-slate-700">
                        Report available for this comparison.
                      </div>
                    ) : (
                      <p className="text-slate-500">No evaluation history yet.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <p className="text-slate-500">Party A Completeness</p>
                        <p className="text-4xl font-bold text-slate-900">{Math.max(0, 100 - (comparison.doc_a_spans?.length || 0) * 5)}%</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Party B Completeness</p>
                        <p className="text-4xl font-bold text-slate-900">{Math.max(0, 100 - (comparison.doc_b_spans?.length || 0) * 5)}%</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 mb-2">Overall Confidence</p>
                      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-3 bg-slate-500 rounded-full" style={{ width: `${Math.max(0, Math.min(similarityScore, 100))}%` }} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Badge variant="outline" className="capitalize">{recommendation}</Badge>
                    {Array.isArray(report.sections) && report.sections.length > 0 ? (
                      <div className="space-y-4">
                        {report.sections.map((section, index) => (
                          <div key={`${section.key || section.heading || 'section'}-${index}`} className="rounded-xl border border-slate-200 p-4">
                            <p className="font-semibold text-slate-900 mb-2">{section.heading || section.key || `Section ${index + 1}`}</p>
                            <ul className="list-disc pl-5 space-y-1 text-slate-700">
                              {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                                <li key={`${index}-${lineIndex}`}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-600">Run evaluation to generate the AI report output.</p>
                    )}
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => runEvaluationMutation.mutate()} disabled={runEvaluationMutation.isPending}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runEvaluationMutation.isPending ? 'Running Evaluation...' : 'Run Evaluation'}
                  </Button>
                  <Button variant="outline" onClick={() => downloadReportMutation.mutate()} disabled={downloadReportMutation.isPending}>
                    <Download className="w-4 h-4 mr-2" />
                    Download Report JSON
                  </Button>
                  <Button variant="outline" onClick={() => downloadInputsMutation.mutate()} disabled={downloadInputsMutation.isPending}>
                    <Download className="w-4 h-4 mr-2" />
                    Download Inputs JSON
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
