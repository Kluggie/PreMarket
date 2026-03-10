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
  CheckCircle2,
  Download,
  FileText,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ComparisonAiReportTab } from '@/components/document-comparison/ComparisonDetailTabs';

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
  const [activeTab, setActiveTab] = useState('report');

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
  const latestResult = latestEvaluation?.result || {};
  // Primary source: comparison.public_report — this is exactly what SharedReport's
  // buildLatestReport() reads, so the proposer and recipient always see the same
  // stored object rendered through the same ComparisonAiReportTab component.
  // Fallback to proposalEvaluations.result.report for proposals without a linked
  // comparison (legacy / standard proposals).
  const comparisonPublicReport =
    comparison?.public_report &&
    typeof comparison.public_report === 'object' &&
    !Array.isArray(comparison.public_report) &&
    Object.keys(comparison.public_report).length > 0
      ? comparison.public_report
      : null;
  const latestResultReport =
    latestResult?.report &&
    typeof latestResult.report === 'object' &&
    !Array.isArray(latestResult.report) &&
    Object.keys(latestResult.report).length > 0
      ? latestResult.report
      : null;
  const latestReportData = comparisonPublicReport || latestResultReport || latestResult;
  const suggestedAdditionsCount =
    Array.isArray(latestReportData?.missing) ? latestReportData.missing.length
    : Array.isArray(latestResult?.report?.missing) ? latestResult.report.missing.length
    : 0;

  const runEvaluationMutation = useMutation({
    mutationFn: () => {
      // When a document comparison is linked, run evaluation via the comparison
      // pipeline (vertex-evaluation-v2 full path).  This stores publicReport in
      // the exact same format that SharedReport reads — ensuring the AI report
      // renders identically for proposer and recipient.
      if (proposal?.document_comparison_id) {
        return documentComparisonsClient.evaluate(proposal.document_comparison_id, {});
      }
      return proposalsClient.evaluate(proposalId, {});
    },
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

  const markOutcomeMutation = useMutation({
    mutationFn: (status) => proposalsClient.close(proposalId, status),
    onSuccess: (updatedProposal) => {
      const label = String(updatedProposal?.status || '').toLowerCase() === 'won' ? 'Won' : 'Lost';
      toast.success(`Marked as ${label}`);
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      queryClient.invalidateQueries(['proposals-list']);
      queryClient.invalidateQueries(['dashboard-summary']);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update outcome');
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

              {/* Report metadata — only shown once there's been at least one evaluation */}
              {evaluations.length > 0 && (
                <>
                  <div className="h-px bg-slate-200" />
                  <div className="space-y-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">AI Report</p>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Recommendation</span>
                      <Badge className="capitalize bg-slate-100 text-slate-700 border-slate-200">
                        {latestResult?.recommendation || '—'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Status</span>
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Complete</Badge>
                    </div>
                    {suggestedAdditionsCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Suggested Additions</span>
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                          {suggestedAdditionsCount} item{suggestedAdditionsCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    )}
                    {latestEvaluation && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Last Run</span>
                        <span className="text-slate-700 text-xs">{formatDate(latestEvaluation.created_date)}</span>
                      </div>
                    )}
                    {proposal.document_comparison_id && (
                      <div className="pt-1">
                        <button
                          type="button"
                          className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                          onClick={() => navigate(createPageUrl(`DocumentComparisonRunDetails?id=${encodeURIComponent(proposal.document_comparison_id)}`))}
                        >
                          <BarChart3 className="w-3 h-3" />
                          Run details
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
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
                <TabsTrigger value="report" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  AI Report
                  {evaluations.length > 0 && <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>}
                </TabsTrigger>
                <TabsTrigger value="proposal" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  <FileText className="w-4 h-4 mr-2" />
                  Proposal
                </TabsTrigger>
              </TabsList>


              <TabsContent value="report" className="mt-6 space-y-5">

                {/* Outcome row */}
                {(() => {
                  const currentStatus = String(proposal.status || '').toLowerCase();
                  const isWon = currentStatus === 'won';
                  const isLost = currentStatus === 'lost';
                  const isClosed = isWon || isLost;
                  return (
                    <div className="flex flex-wrap items-center gap-3">
                      {isClosed ? (
                        <>
                          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-semibold text-sm border ${isWon ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}`}>
                            {isWon ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            {isWon ? 'Won' : 'Lost'}
                            {proposal.closed_at && <span className="text-xs opacity-70 ml-1">· {formatDate(proposal.closed_at)}</span>}
                          </div>
                          <Button size="sm" variant="outline" disabled={markOutcomeMutation.isPending || isWon} onClick={() => markOutcomeMutation.mutate('won')}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Won
                          </Button>
                          <Button size="sm" variant="outline" disabled={markOutcomeMutation.isPending || isLost} onClick={() => markOutcomeMutation.mutate('lost')}>
                            <XCircle className="w-3.5 h-3.5 mr-1.5" /> Lost
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={markOutcomeMutation.isPending} onClick={() => markOutcomeMutation.mutate('won')}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark as Won
                          </Button>
                          <Button size="sm" variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50" disabled={markOutcomeMutation.isPending} onClick={() => markOutcomeMutation.mutate('lost')}>
                            <XCircle className="w-3.5 h-3.5 mr-1.5" /> Mark as Lost
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Shared AI report — same ComparisonAiReportTab used by recipient Step 0 and Step 3.
                   Only the data changes; the layout is structurally identical across all roles.
                   latestReportData = comparison.public_report (primary) so proposer reads the
                   same stored object that SharedReport reads via buildLatestReport(). */}
                <ComparisonAiReportTab
                  isEvaluationRunning={runEvaluationMutation.isPending}
                  isPollingTimedOut={false}
                  isEvaluationNotConfigured={false}
                  showConfidentialityWarning={false}
                  confidentialityWarningMessage=""
                  confidentialityWarningDetails=""
                  isEvaluationFailed={false}
                  evaluationFailureBannerMessage=""
                  hasReport={Boolean(comparisonPublicReport) || evaluations.length > 0}
                  hasEvaluations={evaluations.length > 0}
                  noReportMessage="Run evaluation to generate the AI report."
                  runDetailsHref={
                    proposal.document_comparison_id
                      ? createPageUrl(`DocumentComparisonRunDetails?id=${encodeURIComponent(proposal.document_comparison_id)}`)
                      : ''
                  }
                  report={latestReportData}
                  recommendation={asText(
                    comparisonPublicReport?.recommendation ||
                    latestResult?.recommendation ||
                    latestReportData?.recommendation,
                  )}
                  timelineItems={evaluations.map((ev, i) => ({
                    id: `eval-${ev.id || i}`,
                    kind: 'sparkles',
                    tone: 'success',
                    title: i === 0 ? 'Latest Evaluation' : `Evaluation ${evaluations.length - i}`,
                    timestamp: formatDateTime(ev.created_date || ''),
                  }))}
                />


                {/* Action buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
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

              <TabsContent value="proposal" className="mt-6">
                <div className="space-y-8">
                  {comparison ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            {comparison?.party_a_label || CONFIDENTIAL_LABEL}
                          </h2>
                          <div className="flex gap-2">
                            <Badge variant="outline">{comparison?.doc_a_source || 'typed'}</Badge>
                            <Badge variant="outline">{confidentialWordCount} words</Badge>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[400px] overflow-auto">
                          {renderDocumentReadOnly({
                            text: comparison?.doc_a_text || '',
                            html: comparison?.doc_a_html || '',
                          })}
                        </div>
                      </div>

                      <div className="border-t border-slate-200" />

                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                            {comparison?.party_b_label || SHARED_LABEL}
                          </h2>
                          <div className="flex gap-2">
                            <Badge variant="outline">{comparison?.doc_b_source || 'typed'}</Badge>
                            <Badge variant="outline">{sharedWordCount} words</Badge>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-[400px] overflow-auto">
                          {renderDocumentReadOnly({
                            text: comparison?.doc_b_text || '',
                            html: comparison?.doc_b_html || '',
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <Alert className="bg-slate-50 border-slate-200">
                      <AlertDescription className="text-slate-700">
                        No linked document comparison data was found for this proposal.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>

            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
