import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  ArrowRight,
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

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

function useProposalId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function getEvaluationProviderMeta(evaluation) {
  const result =
    evaluation?.result && typeof evaluation.result === 'object' && !Array.isArray(evaluation.result)
      ? evaluation.result
      : {};
  const providerRaw = asText(
    evaluation?.evaluation_provider ||
      evaluation?.provider ||
      result.evaluation_provider ||
      result.provider,
  );
  const model = asText(
    evaluation?.evaluation_model ||
      evaluation?.evaluation_provider_model ||
      result.evaluation_model ||
      result.evaluation_provider_model ||
      result.model,
  );
  const reason = asText(
    evaluation?.evaluation_provider_reason ||
      result.evaluation_provider_reason ||
      result.fallbackReason,
  );
  return {
    provider: asLower(providerRaw) === 'vertex' ? 'vertex' : providerRaw ? 'fallback' : 'unknown',
    model: model || null,
    reason: reason || null,
  };
}

function renderDocumentReadOnly({ text, html }) {
  const safeText = String(text || '').trim();
  const safeHtml = asText(html);

  if (!safeText && !safeHtml) {
    return <p className="text-sm text-slate-500 italic">No text available.</p>;
  }

  if (safeHtml) {
    return (
      <div
        className="text-sm text-slate-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return <div className="whitespace-pre-wrap text-sm text-slate-800">{safeText}</div>;
}

function getStatusLabel(status) {
  const normalized = String(status || 'draft').toLowerCase();
  switch (normalized) {
    case 'under_verification':
      return 'Under Verification';
    case 're_evaluated':
      return 'Re-evaluated';
    case 'mutual_interest':
      return 'Mutual Interest';
    default:
      return normalized
        .split('_')
        .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
        .join(' ');
  }
}

function getStatusClass(status) {
  const normalized = String(status || 'draft').toLowerCase();
  if (normalized === 'draft') return 'bg-slate-100 text-slate-700';
  if (normalized === 'sent') return 'bg-blue-100 text-blue-700';
  if (normalized === 'received') return 'bg-amber-100 text-amber-700';
  if (normalized === 'under_verification' || normalized === 're_evaluated') {
    return 'bg-indigo-100 text-indigo-700';
  }
  if (normalized === 'mutual_interest' || normalized === 'revealed') return 'bg-green-100 text-green-700';
  if (normalized === 'closed') return 'bg-slate-100 text-slate-600';
  if (normalized === 'withdrawn') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
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

async function downloadProposalInfoPdf(proposal, comparison) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 40;
  const right = 40;
  const maxWidth = pageWidth - left - right;
  const lineHeight = 16;
  let y = 44;

  const writeLine = (text, options = {}) => {
    const value = String(text || '');
    const fontSize = Number(options.fontSize || 11);
    const style = options.bold ? 'bold' : 'normal';
    pdf.setFont('helvetica', style);
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(value, maxWidth);

    lines.forEach((line) => {
      if (y > pageHeight - 50) {
        pdf.addPage();
        y = 44;
      }
      pdf.text(line, left, y);
      y += lineHeight;
    });
  };

  writeLine(proposal?.title || 'Proposal', { fontSize: 20, bold: true });
  y += 6;
  writeLine(`Status: ${getStatusLabel(proposal?.status)}`);
  writeLine(`Created: ${formatDateTime(proposal?.created_date)}`);
  writeLine(`Updated: ${formatDateTime(proposal?.updated_date)}`);
  writeLine(`Party A: ${proposal?.party_a_email || 'Not specified'}`);
  writeLine(`Party B: ${proposal?.party_b_email || 'Not specified'}`);
  y += 8;

  if (comparison) {
    writeLine(CONFIDENTIAL_LABEL, { bold: true });
    writeLine(comparison.doc_a_text || '');
    y += 8;
    writeLine(SHARED_LABEL, { bold: true });
    writeLine(comparison.doc_b_text || '');
  } else {
    writeLine('No linked document comparison content was found for this proposal.');
  }

  const filenameBase = String(proposal?.title || 'proposal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'proposal';
  pdf.save(`${filenameBase}-info.pdf`);
}

export default function ProposalDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const proposalId = useProposalId();
  const [activeTab, setActiveTab] = useState('overview');

  const detailQuery = useQuery({
    queryKey: ['proposal-detail', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getDetail(proposalId),
  });

  const proposal = detailQuery.data?.proposal || null;
  const responses = detailQuery.data?.responses || [];
  const evaluations = detailQuery.data?.evaluations || [];
  const sharedLinks = detailQuery.data?.sharedLinks || [];

  const comparisonQuery = useQuery({
    queryKey: ['proposal-linked-comparison', proposal?.document_comparison_id || 'none'],
    enabled: Boolean(proposal?.document_comparison_id),
    queryFn: () => documentComparisonsClient.getById(proposal.document_comparison_id),
  });

  const comparison = comparisonQuery.data?.comparison || null;
  const confidentialLength = String(comparison?.doc_a_text || '').length;
  const sharedLength = String(comparison?.doc_b_text || '').length;
  const confidentialWordCount = String(comparison?.doc_a_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const sharedWordCount = String(comparison?.doc_b_text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
  const latestEvaluation = evaluations[0] || null;
  const latestProviderMeta = getEvaluationProviderMeta(latestEvaluation);
  const latestResult = latestEvaluation?.result || {};
  const reportSections = Array.isArray(latestResult?.report?.sections)
    ? latestResult.report.sections
    : Array.isArray(latestResult?.sections)
      ? latestResult.sections
      : [];

  const runEvaluationMutation = useMutation({
    mutationFn: () => proposalsClient.evaluate(proposalId, {}),
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      queryClient.invalidateQueries(['proposal-linked-comparison', proposal?.document_comparison_id || 'none']);
      queryClient.invalidateQueries(['proposals']);
      toast.success('Evaluation completed');
    },
    onError: (error) => {
      toast.error(error?.message || 'Evaluation failed');
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => {
      const recipient = asText(proposal?.party_b_email);
      const payload = await sharedLinksClient.create({
        proposalId,
        recipientEmail: recipient || null,
        maxUses: 50,
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: true,
        canSendBack: true,
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
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      toast.success('Share link generated and copied');
      window.alert(`Shared link:\n\n${payload.url}`);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to generate share link');
    },
  });

  const downloadProposalMutation = useMutation({
    mutationFn: () => downloadProposalInfoPdf(proposal, comparison),
    onSuccess: () => {
      toast.success('Proposal info PDF downloaded');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to download proposal info PDF');
    },
  });

  const downloadAiReportMutation = useMutation({
    mutationFn: async () => {
      if (!proposal?.document_comparison_id) {
        const notConfigured = new Error('AI report PDF renderer is not configured');
        notConfigured.code = 'not_configured';
        notConfigured.status = 501;
        throw notConfigured;
      }
      return documentComparisonsClient.downloadPdf(proposal.document_comparison_id);
    },
    onSuccess: () => {
      toast.success('AI report PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'AI report PDF renderer is not configured');
    },
  });

  if (!proposalId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900">Missing proposal id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6 text-slate-500">Loading proposal...</div>
      </div>
    );
  }

  if (detailQuery.error || !proposal) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-900">
              {detailQuery.error?.message || 'Proposal not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 space-y-6">
        <Link to={createPageUrl('Proposals')} className="inline-flex items-center text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Proposals
        </Link>

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6 items-start">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="pt-6 space-y-5">
              <h1 className="text-5xl font-bold text-slate-900 leading-tight break-words">{proposal.title}</h1>
              <div className="h-px bg-slate-200" />
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Status</span>
                  <Badge className={getStatusClass(proposal.status)}>{getStatusLabel(proposal.status)}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Created</span>
                  <span className="text-slate-800">{formatDate(proposal.created_date)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Total Characters</span>
                  <Badge variant="outline">{confidentialLength + sharedLength}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 uppercase tracking-wide font-semibold">Last Updated</span>
                  <span className="text-slate-800">{formatDate(proposal.updated_date)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => downloadProposalMutation.mutate()} disabled={downloadProposalMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Download Proposal Info PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (proposal.proposal_type === 'document_comparison' && proposal.document_comparison_id) {
                    navigate(
                      createPageUrl(
                        `DocumentComparisonCreate?draft=${encodeURIComponent(proposal.document_comparison_id)}&proposalId=${encodeURIComponent(proposal.id)}&step=2`,
                      ),
                    );
                    return;
                  }
                  navigate(createPageUrl(`CreateProposal?draft=${encodeURIComponent(proposal.id)}&step=4`));
                }}
              >
                <ArrowRight className="w-4 h-4 mr-2" />
                Edit Proposal
              </Button>
              <Button onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending}>
                <Send className="w-4 h-4 mr-2" />
                Share Updated Version
              </Button>
              <Button variant="outline" onClick={() => downloadAiReportMutation.mutate()} disabled={downloadAiReportMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Download AI Report PDF
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
                  {evaluations.length > 0 && <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>}
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
                          <p className="font-semibold text-slate-900">{proposal.party_a_email || 'Not specified'}</p>
                          <Badge variant="outline" className="mt-3">You</Badge>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                          <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Party B (Recipient)</p>
                          <p className="font-semibold text-slate-900">{proposal.party_b_email || 'Not specified'}</p>
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
                        {proposal.document_comparison_id && (
                          <Button
                            variant="outline"
                            className="w-full justify-center"
                            onClick={() =>
                              navigate(
                                createPageUrl(
                                  `DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`,
                                ),
                              )
                            }
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Open Comparison
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
                            <p className="text-slate-500">{formatDateTime(proposal.created_date)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">Last Updated</p>
                            <p className="text-slate-500">{formatDateTime(proposal.updated_date)}</p>
                          </div>
                        </div>
                        {latestEvaluation && (
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
                              <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">Latest Evaluation</p>
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
                    <p className="text-slate-500">Read-only content for confidential and shared information documents.</p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-700 font-semibold">
                          <FileText className="w-4 h-4" />
                          {comparison?.party_a_label || CONFIDENTIAL_LABEL}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline">{comparison?.doc_a_source || 'typed'}</Badge>
                          <Badge variant="outline">{confidentialWordCount} words</Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[280px] overflow-auto">
                        {renderDocumentReadOnly({
                          text: comparison?.doc_a_text || '',
                          html: comparison?.doc_a_html || '',
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-700 font-semibold">
                          <FileText className="w-4 h-4" />
                          {comparison?.party_b_label || SHARED_LABEL}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline">{comparison?.doc_b_source || 'typed'}</Badge>
                          <Badge variant="outline">{sharedWordCount} words</Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[280px] overflow-auto">
                        {renderDocumentReadOnly({
                          text: comparison?.doc_b_text || '',
                          html: comparison?.doc_b_html || '',
                        })}
                      </div>
                    </div>

                    {!comparison && (
                      <Alert className="bg-slate-50 border-slate-200">
                        <AlertDescription className="text-slate-700">
                          No linked document comparison data was found for this proposal.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="report" className="mt-6 space-y-6">
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Evaluation History ({evaluations.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {evaluations.length > 0 ? (
                      <div className="space-y-3">
                        {evaluations.map((evaluation, index) => {
                          const providerMeta = getEvaluationProviderMeta(evaluation);
                          return (
                            <div
                              key={evaluation.id || `evaluation-${index}`}
                              className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 p-3"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                  <Badge className="bg-green-100 text-green-700">succeeded</Badge>
                                  <span className="text-slate-700">{formatDateTime(evaluation.created_date)}</span>
                                  {index === 0 && <Badge variant="outline">Latest</Badge>}
                                </div>
                                <p className="text-xs text-slate-500">
                                  Provider:{' '}
                                  <span className="font-mono text-slate-700">
                                    {providerMeta.provider}
                                    {providerMeta.model ? ` · ${providerMeta.model}` : ''}
                                  </span>
                                  {providerMeta.provider !== 'vertex' && providerMeta.reason ? (
                                    <span className="text-slate-500"> ({providerMeta.reason})</span>
                                  ) : null}
                                </p>
                              </div>
                              <span className="text-blue-600 font-semibold">{Number(evaluation.score || 0)}% confidence</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-slate-500">No evaluations recorded yet.</p>
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
                        <p className="text-slate-500">{CONFIDENTIAL_LABEL} Words</p>
                        <p className="text-4xl font-bold text-slate-900">{confidentialWordCount}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">{SHARED_LABEL} Words</p>
                        <p className="text-4xl font-bold text-slate-900">{sharedWordCount}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 mb-2">Overall Confidence</p>
                      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-3 bg-slate-500 rounded-full"
                          style={{
                            width: `${Math.max(0, Math.min(Number(latestEvaluation?.score || latestResult?.score || 0), 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle>Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Badge variant="outline" className="capitalize">
                      {latestResult?.recommendation || 'unknown fit'}
                    </Badge>
                    <p className="text-sm text-slate-600">
                      Provider:{' '}
                      <span className="font-mono text-slate-800">
                        {latestProviderMeta.provider}
                        {latestProviderMeta.model ? ` · ${latestProviderMeta.model}` : ''}
                      </span>
                      {latestProviderMeta.provider !== 'vertex' && latestProviderMeta.reason ? (
                        <span className="text-slate-500"> ({latestProviderMeta.reason})</span>
                      ) : null}
                    </p>
                    {asText(latestResult?.summary || latestEvaluation?.summary) ? (
                      <p className="text-slate-700">{latestResult?.summary || latestEvaluation?.summary}</p>
                    ) : (
                      <p className="text-slate-600">Run evaluation to generate the AI report output.</p>
                    )}
                    {reportSections.length > 0 && (
                      <div className="space-y-4">
                        {reportSections.map((section, sectionIndex) => (
                          <div key={`${section.key || section.heading || 'section'}-${sectionIndex}`} className="rounded-xl border border-slate-200 p-4">
                            <p className="font-semibold text-slate-900 mb-2">{section.heading || section.title || `Section ${sectionIndex + 1}`}</p>
                            <ul className="list-disc pl-5 space-y-1 text-slate-700">
                              {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                                <li key={`${sectionIndex}-${lineIndex}`}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => runEvaluationMutation.mutate()} disabled={runEvaluationMutation.isPending}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runEvaluationMutation.isPending ? 'Running Evaluation...' : evaluations.length > 0 ? 'Re-run Evaluation' : 'Run Evaluation'}
                  </Button>
                  {proposal.document_comparison_id && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate(
                          createPageUrl(
                            `DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`,
                          ),
                        )
                      }
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Open Comparison
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!latestResult || Object.keys(latestResult).length === 0) {
                        toast.error('No AI report payload to download yet');
                        return;
                      }
                      triggerJsonDownload('proposal-ai-report.json', latestResult);
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download AI Report JSON
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
