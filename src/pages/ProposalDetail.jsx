import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { getProposalId } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import DeleteDraftDialog from '../components/proposal/DeleteDraftDialog';
import {
  ArrowLeft, FileText, BarChart3, Shield, Eye, Clock, CheckCircle2,
  AlertTriangle, XCircle, Users, MessageSquare, Paperclip, RefreshCw,
  Send, Lock, Unlock, Sparkles, TrendingUp, TrendingDown, Minus,
  ChevronRight, Upload, ThumbsUp, ThumbsDown
} from 'lucide-react';

const StatusBadge = ({ status }) => {
  const config = {
    draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
    sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent' },
    received: { color: 'bg-amber-100 text-amber-700', label: 'Received' },
    under_verification: { color: 'bg-purple-100 text-purple-700', label: 'Under Review' },
    re_evaluated: { color: 'bg-indigo-100 text-indigo-700', label: 'Re-evaluated' },
    mutual_interest: { color: 'bg-green-100 text-green-700', label: 'Mutual Interest' },
    revealed: { color: 'bg-emerald-100 text-emerald-700', label: 'Revealed' },
    closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
    withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' }
  };
  const { color, label } = config[status] || config.draft;
  return <Badge className={`${color} font-medium`}>{label}</Badge>;
};

export default function ProposalDetail() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const params = new URLSearchParams(window.location.search);
  const proposalId = params.get('id');

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const { data: proposal, isLoading: loadingProposal } = useQuery({
    queryKey: ['proposal', proposalId],
    queryFn: async () => {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      return proposals[0];
    },
    enabled: !!proposalId
  });

  const { data: responses = [] } = useQuery({
    queryKey: ['proposalResponses', proposalId],
    queryFn: () => base44.entities.ProposalResponse.filter({ proposal_id: proposalId }),
    enabled: !!proposalId
  });

  const { data: evaluations = [] } = useQuery({
    queryKey: ['evaluations', proposalId],
    queryFn: () => base44.entities.EvaluationRun.filter({ proposal_id: proposalId }, '-created_date'),
    enabled: !!proposalId
  });

  const { data: evaluationReports = [] } = useQuery({
    queryKey: ['evaluationReports', proposalId],
    queryFn: async () => {
      const reports = await base44.entities.EvaluationReport.filter({ proposal_id: proposalId });
      return reports.sort((a, b) => {
        const dateA = a.generated_at || a.created_date;
        const dateB = b.generated_at || b.created_date;
        return new Date(dateB) - new Date(dateA);
      }).slice(0, 5);
    },
    enabled: !!proposalId,
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: sharedReports = [] } = useQuery({
    queryKey: ['sharedReports', proposalId],
    queryFn: () => base44.entities.EvaluationReportShared.filter({ proposal_id: proposalId }),
    enabled: !!proposalId,
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: fitCardReports = [] } = useQuery({
    queryKey: ['fitCardReports', proposalId],
    queryFn: () => base44.entities.FitCardReportShared.filter({ proposal_id: proposalId }),
    enabled: !!proposalId,
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => base44.entities.Template.list(),
    enabled: !!proposal?.template_id
  });

  const { data: verifications = [] } = useQuery({
    queryKey: ['verifications', proposalId],
    queryFn: () => base44.entities.VerificationItem.filter({ proposal_id: proposalId }),
    enabled: !!proposalId
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', proposalId],
    queryFn: () => base44.entities.ProposalComment.filter({ proposal_id: proposalId }, '-created_date'),
    enabled: !!proposalId
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['attachments', proposalId],
    queryFn: () => base44.entities.Attachment.filter({ proposal_id: proposalId }),
    enabled: !!proposalId
  });

  const isPartyA = proposal?.party_a_email === user?.email;
  const isPartyB = proposal?.party_b_email === user?.email;
  const latestEvaluation = evaluations[0];
  const latestReport = evaluationReports?.[0];
  const latestSuccessReport = evaluationReports?.find(r => r.status === 'succeeded');
  const sharedReport = sharedReports?.[0];
  const fitCardReport = fitCardReports?.[0];

  const currentTemplate = templates.find(t => t.id === proposal?.template_id);
  const isFinanceTemplate = currentTemplate?.slug === 'universal_finance_deal_prequal';
  const isProfileMatchingTemplate = currentTemplate?.slug === 'universal_profile_matching';

  // Run New Evaluation (Vertex Gemini)
  const runNewEvaluationMutation = useMutation({
    mutationFn: async () => {
      const clientCorrelationId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const resolvedProposalId = getProposalId(proposal) || proposalId;
      if (!resolvedProposalId) {
        throw new Error('Cannot evaluate: proposal id missing');
      }
      let comparisonId = proposal?.document_comparison_id || null;

      try {
        // Prefer resolving a linked DocumentComparison by proposal id rather than relying solely on proposal shape.
        try {
          const comparisons = await base44.entities.DocumentComparison.filter({ proposal_id: resolvedProposalId }, '-created_date');
          if (comparisons && comparisons.length > 0) {
            comparisonId = comparisons[0].id || comparisonId;
          }
        } catch (cmpErr) {
          // Non-fatal: if lookup fails, fall back to proposal fields
          if (import.meta.env.DEV) console.debug('DocumentComparison lookup error', cmpErr);
        }

        let functionName = null;
        let payload = null;

        if (isFinanceTemplate) {
          functionName = 'EvaluateProposalShared';
          payload = { proposal_id: resolvedProposalId };
        } else if (isProfileMatchingTemplate) {
          functionName = 'EvaluateFitCardShared';
          payload = { proposal_id: resolvedProposalId };
        } else if (comparisonId) {
          // Always prefer the working DocumentComparison flow for proposals with a comparison
          functionName = 'EvaluateDocumentComparison';
          payload = { comparison_id: comparisonId };
        } else {
          functionName = 'EvaluateProposal';
          payload = { proposal_id: resolvedProposalId };
        }

        if (import.meta.env.DEV) {
          console.debug('Invoking evaluation', { functionName, proposalId: resolvedProposalId, comparisonId, payload });
        }

        const response = await base44.functions.invoke(functionName, payload);

        // Check if response is valid JSON
        if (!response.data || typeof response.data !== 'object') {
          const rawText = typeof response.data === 'string' ? response.data.substring(0, 300) : JSON.stringify(response.data).substring(0, 300);
          throw new Error(`Non-JSON response\n\nCorrelation ID: ${clientCorrelationId}\n\nRaw (first 300 chars):\n${rawText}`);
        }

        // Normalize success/failure checks across different functions
        if (response.data.status === 'failed' || response.data.status === 'error' || response.data.ok === false) {
          const errorMsg = response.data.error_message || response.data.error || response.data.message || 'Evaluation failed';
          const corrId = response.data.correlation_id || response.data.correlationId || clientCorrelationId;
          throw new Error(`${errorMsg}\n\nCorrelation ID: ${corrId}`);
        }

        return response.data;
      } catch (error) {
        // Dev-only enhanced logging for easy diagnosis of 404s and other failures
        if (import.meta.env.DEV) {
          console.error('Evaluation request failed', {
            message: error?.message,
            status: error?.response?.status || error?.status,
            responseData: error?.response?.data || null,
            url: error?.config?.url || error?.request?.responseURL || null,
            proposalId: resolvedProposalId,
            comparisonId: comparisonId || null
          });
        }

        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['evaluationReports', proposalId]);
      queryClient.invalidateQueries(['sharedReports', proposalId]);
      queryClient.invalidateQueries(['fitCardReports', proposalId]);
      queryClient.invalidateQueries(['proposal', proposalId]);
    },
    onError: (error) => {
      alert(`Evaluation failed:\n\n${error.message}`);
    }
  });

  // Run AI Evaluation (Legacy)
  const runEvaluationMutation = useMutation({
    mutationFn: async () => {
      // Create evaluation run
      const evalRun = await base44.entities.EvaluationRun.create({
        proposal_id: proposalId,
        run_by_party: isPartyA ? 'a' : 'b',
        run_by_user_id: user.id,
        status: 'processing'
      });

      // Generate AI evaluation
      const prompt = `
        Evaluate this pre-qualification proposal:
        Template: ${proposal.template_name}
        
        Responses provided:
        ${responses.map(r => `- ${r.question_id}: ${r.value}`).join('\n')}
        
        Generate a compatibility evaluation with:
        1. Overall score (0-100)
        2. Confidence level (0-100)
        3. Criteria scores for: Financial Fit, Strategic Alignment, Market Position, Deal Terms
        4. Missing data penalties
        5. Red flags (if any)
        6. Recommendations
        7. Summary
      `;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            overall_score: { type: 'number' },
            confidence: { type: 'number' },
            criteria_scores: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  score: { type: 'number' },
                  rationale: { type: 'string' },
                  weight: { type: 'number' }
                }
              }
            },
            missing_data_penalties: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  penalty: { type: 'number' },
                  reason: { type: 'string' }
                }
              }
            },
            red_flags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  recommendation: { type: 'string' }
                }
              }
            },
            recommendations: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' }
          }
        }
      });

      // Update evaluation with results
      await base44.entities.EvaluationRun.update(evalRun.id, {
        ...result,
        status: 'completed'
      });

      // Update proposal with latest score
      await base44.entities.Proposal.update(proposalId, {
        latest_score: result.overall_score,
        latest_evaluation_id: evalRun.id,
        status: proposal.status === 'received' ? 'under_verification' : proposal.status
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['evaluations', proposalId]);
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  // Request Reveal
  const requestRevealMutation = useMutation({
    mutationFn: async () => {
      const updateField = isPartyA ? 'reveal_requested_by_a' : 'reveal_requested_by_b';
      await base44.entities.Proposal.update(proposalId, {
        [updateField]: true
      });

      // Check if mutual reveal is complete
      const otherPartyRequested = isPartyA ? proposal.reveal_requested_by_b : proposal.reveal_requested_by_a;
      if (otherPartyRequested) {
        await base44.entities.Proposal.update(proposalId, {
          mutual_reveal: true,
          status: 'revealed',
          reveal_level_a: 3,
          reveal_level_b: 3
        });

        await base44.entities.RevealEvent.create({
          proposal_id: proposalId,
          user_id: user.id,
          party: isPartyA ? 'a' : 'b',
          event_type: 'mutual_reveal_completed',
          from_level: isPartyA ? proposal.reveal_level_a : proposal.reveal_level_b,
          to_level: 3
        });
      } else {
        await base44.entities.RevealEvent.create({
          proposal_id: proposalId,
          user_id: user.id,
          party: isPartyA ? 'a' : 'b',
          event_type: 'reveal_requested',
          from_level: isPartyA ? proposal.reveal_level_a : proposal.reveal_level_b,
          to_level: 3
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  // Express Interest
  const expressInterestMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Proposal.update(proposalId, {
        status: 'mutual_interest'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  if (loadingProposal || !proposal) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-48" />
            <div className="h-64 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const canRequestReveal = (isPartyA && !proposal.reveal_requested_by_a) || 
                          (isPartyB && !proposal.reveal_requested_by_b);
  const otherPartyRequestedReveal = (isPartyA && proposal.reveal_requested_by_b) || 
                                    (isPartyB && proposal.reveal_requested_by_a);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link to={createPageUrl('Proposals')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-slate-900">
                  {proposal.title || 'Untitled Proposal'}
                </h1>
                <StatusBadge status={proposal.status} />
              </div>
              <p className="text-slate-500">
                {proposal.template_name} • Created {new Date(proposal.created_date).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {proposal.status === 'draft' && isPartyA && (
                <DeleteDraftDialog 
                  onConfirm={async () => {
                    try {
                      const responses = await base44.entities.ProposalResponse.filter({ proposal_id: proposalId });
                      const reports = await base44.entities.EvaluationReport.filter({ proposal_id: proposalId });
                      const attachments = await base44.entities.Attachment.filter({ proposal_id: proposalId });
                      
                      await Promise.all([
                        ...responses.map(r => base44.entities.ProposalResponse.delete(r.id)),
                        ...reports.map(r => base44.entities.EvaluationReport.delete(r.id)),
                        ...attachments.map(a => base44.entities.Attachment.delete(a.id))
                      ]);
                      
                      await base44.entities.Proposal.delete(proposalId);
                      navigate(createPageUrl('Proposals'));
                    } catch (error) {
                      console.error('Delete failed:', error);
                      alert('Failed to delete draft');
                    }
                  }}
                />
              )}
              <Button 
                variant="outline"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const { default: autoTable } = await import('jspdf-autotable');
                  const doc = new jsPDF();
                  
                  // Header
                  doc.setFillColor(15, 23, 42);
                  doc.rect(0, 0, 210, 35, 'F');
                  doc.setTextColor(255, 255, 255);
                  doc.setFontSize(20);
                  doc.text('PreMarket', 20, 15);
                  doc.setFontSize(14);
                  doc.text('Proposal Information', 20, 25);
                  
                  doc.setTextColor(0, 0, 0);
                  
                  // Title Section
                  doc.setFontSize(16);
                  doc.setFont(undefined, 'bold');
                  doc.text(proposal.title || 'Untitled Proposal', 20, 45);
                  doc.setFont(undefined, 'normal');
                  doc.setFontSize(10);
                  doc.setTextColor(100, 100, 100);
                  doc.text(`Template: ${proposal.template_name}`, 20, 52);
                  doc.text(`Created: ${new Date(proposal.created_date).toLocaleDateString()}`, 20, 58);
                  
                  // Parties Table
                  doc.setTextColor(0, 0, 0);
                  autoTable(doc, {
                    startY: 68,
                    head: [['Party', 'Identity']],
                    body: [
                      ['Party A (Proposer)', isPartyA ? proposal.party_a_email : (proposal.party_a_email || 'Identity Protected')],
                      ['Party B (Recipient)', proposal.party_b_email || 'Not specified']
                    ],
                    theme: 'grid',
                    headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                    styles: { fontSize: 10, cellPadding: 5 }
                  });
                  
                  // Responses Table
                  const responsesData = responses.map(r => [
                    r.question_id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    r.value_type === 'range' ? `${r.range_min} - ${r.range_max}` : (r.value || 'Not provided'),
                    r.visibility || 'full'
                  ]);
                  
                  autoTable(doc, {
                    startY: doc.lastAutoTable.finalY + 10,
                    head: [['Field', 'Value', 'Visibility']],
                    body: responsesData.length > 0 ? responsesData : [['No responses recorded', '', '']],
                    theme: 'striped',
                    headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                    styles: { fontSize: 9, cellPadding: 4 },
                    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 100 }, 2: { cellWidth: 30 } }
                  });
                  
                  // Footer
                  const pageCount = doc.internal.getNumberOfPages();
                  for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setTextColor(150, 150, 150);
                    doc.text(`Page ${i} of ${pageCount}`, 20, 285);
                    doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 285);
                  }
                  
                  doc.save(`${proposal.title || 'proposal'}_info.pdf`);
                }}
              >
                <FileText className="w-4 h-4 mr-2" />
                Download Proposal Info PDF
              </Button>
              <Button 
                onClick={() => runNewEvaluationMutation.mutate()}
                disabled={runNewEvaluationMutation.isPending || latestReport?.status === 'running' || latestReport?.status === 'queued' || sharedReport?.status === 'running' || fitCardReport?.status === 'running'}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {(runNewEvaluationMutation.isPending || latestReport?.status === 'running' || latestReport?.status === 'queued' || sharedReport?.status === 'running' || fitCardReport?.status === 'running') ? 'Evaluating...' : (isProfileMatchingTemplate ? 'Run Profile Evaluation' : 'Run AI Evaluation')}
              </Button>
              {latestSuccessReport && latestSuccessReport.output_report_json && (
                <Button 
                  variant="outline"
                  onClick={async () => {
                    try {
                      const { jsPDF } = await import('jspdf');
                      const { default: autoTable } = await import('jspdf-autotable');
                      const doc = new jsPDF();
                    const report = latestSuccessReport.output_report_json;
                    
                    // Header
                    doc.setFillColor(15, 23, 42);
                    doc.rect(0, 0, 210, 35, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(20);
                    doc.text('PreMarket', 20, 15);
                    doc.setFontSize(14);
                    doc.text('AI Evaluation Report', 20, 25);
                    
                    doc.setTextColor(0, 0, 0);
                    doc.setFontSize(10);
                    doc.setTextColor(100, 100, 100);
                    doc.text(`Generated: ${new Date(latestSuccessReport.generated_at || latestSuccessReport.created_date).toLocaleString()}`, 20, 45);
                    
                    // Executive Summary Card
                    doc.setTextColor(0, 0, 0);
                    doc.setFontSize(14);
                    doc.setFont(undefined, 'bold');
                    doc.text('Executive Summary', 20, 55);
                    doc.setFont(undefined, 'normal');
                    
                    const fitLevel = report.summary?.fit_level || 'unknown';
                    const fitColor = fitLevel === 'high' ? [34, 197, 94] : fitLevel === 'medium' ? [251, 191, 36] : [148, 163, 184];
                    doc.setFillColor(...fitColor);
                    doc.roundedRect(20, 60, 30, 8, 2, 2, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(10);
                    doc.text(fitLevel + ' fit', 22, 65);
                    
                    // Quality Metrics Table
                    doc.setTextColor(0, 0, 0);
                    autoTable(doc, {
                      startY: 75,
                      head: [['Metric', 'Value']],
                      body: [
                        ['Party A Completeness', `${Math.round((report.quality?.completeness_a || 0) * 100)}%`],
                        ['Party B Completeness', `${Math.round((report.quality?.completeness_b || 0) * 100)}%`],
                        ['Overall Confidence', `${Math.round((report.quality?.confidence_overall || 0) * 100)}%`]
                      ],
                      theme: 'grid',
                      headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                      styles: { fontSize: 10, cellPadding: 5 }
                    });
                    
                    // Flags & Risks
                    if (report.flags?.length > 0) {
                      const flagsData = report.flags.map(f => [
                        f.severity?.toUpperCase() || 'N/A',
                        f.title || '',
                        f.detail || ''
                      ]);
                      
                      autoTable(doc, {
                        startY: doc.lastAutoTable.finalY + 10,
                        head: [['Severity', 'Title', 'Detail']],
                        body: flagsData,
                        theme: 'striped',
                        headStyles: { fillColor: [239, 68, 68], fontSize: 11, fontStyle: 'bold' },
                        styles: { fontSize: 9, cellPadding: 4 },
                        columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 50 }, 2: { cellWidth: 105 } },
                        didParseCell: function(data) {
                          if (data.section === 'body' && data.column.index === 0) {
                            const severity = data.cell.raw;
                            if (severity === 'HIGH') data.cell.styles.fillColor = [254, 226, 226];
                            else if (severity === 'MED') data.cell.styles.fillColor = [254, 243, 199];
                          }
                        }
                      });
                    }
                    
                    // Follow-up Questions
                    if (report.followup_questions?.length > 0) {
                      const followupData = report.followup_questions.slice(0, 10).map(q => [
                        q.priority?.toUpperCase() || 'N/A',
                        q.to_party?.toUpperCase() || 'N/A',
                        q.question_text || ''
                      ]);
                      
                      autoTable(doc, {
                        startY: doc.lastAutoTable.finalY + 10,
                        head: [['Priority', 'To', 'Question']],
                        body: followupData,
                        theme: 'striped',
                        headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                        styles: { fontSize: 9, cellPadding: 4 },
                        columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 20 }, 2: { cellWidth: 145 } }
                      });
                    }
                    
                    // Appendix - Field Digest
                    if (report.appendix?.field_digest?.length > 0) {
                      const digestData = report.appendix.field_digest.slice(0, 20).map(f => [
                        f.label || f.question_id || '',
                        f.value_summary || '',
                        f.visibility || 'N/A'
                      ]);
                      
                      autoTable(doc, {
                        startY: doc.lastAutoTable.finalY + 10,
                        head: [['Field', 'Summary', 'Visibility']],
                        body: digestData,
                        theme: 'grid',
                        headStyles: { fillColor: [100, 116, 139], fontSize: 10, fontStyle: 'bold' },
                        styles: { fontSize: 8, cellPadding: 3 },
                        columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 100 }, 2: { cellWidth: 30 } }
                      });
                    }
                    
                    // Footer
                    const pageCount = doc.internal.getNumberOfPages();
                    for (let i = 1; i <= pageCount; i++) {
                      doc.setPage(i);
                      doc.setFontSize(8);
                      doc.setTextColor(150, 150, 150);
                      doc.text(`Page ${i} of ${pageCount}`, 20, 285);
                      doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 285);
                    }
                    
                      doc.save(`${proposal.title || 'proposal'}_ai_report.pdf`);
                    } catch (error) {
                      console.error('PDF generation error:', error);
                      alert('Failed to generate PDF. Please try again.');
                    }
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Download AI Report PDF
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Score Card */}
        {latestEvaluation && (
          <Card className="border-0 shadow-sm mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-5xl font-bold">{latestEvaluation.overall_score || 0}%</p>
                    <p className="text-blue-100 mt-1">Match Score</p>
                  </div>
                  <Separator orientation="vertical" className="h-16 bg-blue-400/30 hidden md:block" />
                  <div>
                    <p className="text-sm text-blue-100">Confidence</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={latestEvaluation.confidence || 0} className="w-32 h-2 bg-blue-400/30" />
                      <span className="text-sm font-medium">{latestEvaluation.confidence || 0}%</span>
                    </div>
                  </div>
                </div>

                {latestEvaluation.red_flags?.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 rounded-lg">
                    <AlertTriangle className="w-5 h-5" />
                    <span>{latestEvaluation.red_flags.length} Red Flag{latestEvaluation.red_flags.length > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}



        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6 flex-wrap">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="evaluation" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <BarChart3 className="w-4 h-4 mr-2" />
              {isProfileMatchingTemplate ? 'Profile Evaluation' : 'AI Report'}
              {(latestSuccessReport || sharedReport?.status === 'succeeded' || fitCardReport?.status === 'succeeded') && (
                <Badge className="ml-2 bg-green-100 text-green-700 text-xs">
                  Complete
                </Badge>
              )}
            </TabsTrigger>

          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Parties */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Parties</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-4 bg-blue-50 rounded-xl">
                        <p className="text-sm text-blue-600 font-medium mb-2">Party A (Proposer)</p>
                        <p className="font-medium text-slate-900">
                          {proposal.mutual_reveal || isPartyA ? proposal.party_a_email : 'Identity Protected'}
                        </p>
                        {isPartyA && <Badge className="mt-2 bg-blue-100 text-blue-700">You</Badge>}
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-xl">
                        <p className="text-sm text-indigo-600 font-medium mb-2">Party B (Recipient)</p>
                        <p className="font-medium text-slate-900">
                          {proposal.party_b_email || 'Not specified'}
                        </p>
                        {isPartyB && <Badge className="mt-2 bg-indigo-100 text-indigo-700">You</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Detailed Responses */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Complete Proposal Details</CardTitle>
                    <CardDescription>All information provided in this proposal.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {responses.length === 0 ? (
                      <p className="text-slate-500 text-center py-8">No responses recorded yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {responses.map(response => (
                          <div key={response.id} className="p-4 border border-slate-200 rounded-xl">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <p className="font-semibold text-slate-900 capitalize mb-1">
                                  {response.question_id.replace(/_/g, ' ')}
                                </p>
                                <Badge variant="outline" className="text-xs">
                                  Party {response.entered_by_party?.toUpperCase() || 'A'}
                                </Badge>
                              </div>
                              <Badge className={
                                response.visibility === 'full' ? 'bg-green-100 text-green-700' :
                                response.visibility === 'partial' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-700'
                              }>
                                {response.visibility}
                              </Badge>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg">
                              <p className="text-slate-700">
                                {response.value_type === 'range' 
                                  ? `Range: ${response.range_min} - ${response.range_max}`
                                  : response.value || 'Not provided'
                                }
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Quick Actions */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isPartyB && proposal.status === 'received' && (
                      <Button 
                        className="w-full bg-green-600 hover:bg-green-700"
                        onClick={() => expressInterestMutation.mutate()}
                      >
                        <ThumbsUp className="w-4 h-4 mr-2" />
                        Express Interest
                      </Button>
                    )}
                    <Button variant="outline" className="w-full">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Add Comment
                    </Button>
                    <Button variant="outline" className="w-full">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Document
                    </Button>
                  </CardContent>
                </Card>

                {/* Activity Timeline */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Activity Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium">Proposal Created</p>
                          <p className="text-sm text-slate-500">{new Date(proposal.created_date).toLocaleString()}</p>
                        </div>
                      </div>
                      {proposal.sent_at && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                            <Send className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium">Proposal Sent</p>
                            <p className="text-sm text-slate-500">{new Date(proposal.sent_at).toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                      {evaluations.map(evalRun => (
                        <div key={evalRun.id} className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-purple-600" />
                          </div>
                          <div>
                            <p className="font-medium">AI Evaluation Run</p>
                            <p className="text-sm text-slate-500">
                              Score: {evalRun.overall_score}% • {new Date(evalRun.created_date).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                      {proposal.mutual_reveal && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium">Reveal Status: Passed</p>
                            <p className="text-sm text-slate-500">Both parties agreed to reveal identities</p>
                          </div>
                        </div>
                      )}
                      {!proposal.mutual_reveal && (proposal.reveal_requested_by_a || proposal.reveal_requested_by_b) && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-medium">Reveal Status: Pending</p>
                            <p className="text-sm text-slate-500">Waiting for mutual reveal agreement</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* AI Report Tab */}
          <TabsContent value="evaluation">
            {/* FitCard Report for Profile Matching Template */}
            {isProfileMatchingTemplate && fitCardReport?.status === 'succeeded' && fitCardReport.output_report_json && (
              <div className="space-y-6">
                <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-indigo-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        Profile Evaluation Report
                      </CardTitle>
                      <Badge variant="outline">Shared with both parties</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Mode</p>
                        <p className="text-xl font-bold">{fitCardReport.mode_value}</p>
                      </div>
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Match Level</p>
                        <p className="text-xl font-bold capitalize">{fitCardReport.output_report_json.summary?.fit_level || 'Unknown'}</p>
                      </div>
                    </div>

                    {fitCardReport.output_report_json.must_haves_check && (
                      <div className="mb-4 p-4 bg-white rounded-lg">
                        <h4 className="font-semibold mb-2">Must-Haves Check</h4>
                        <p className="text-2xl font-bold text-blue-600">
                          {fitCardReport.output_report_json.must_haves_check.satisfied_count} / {fitCardReport.output_report_json.must_haves_check.total_count}
                        </p>
                        {fitCardReport.output_report_json.must_haves_check.missing_items?.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {fitCardReport.output_report_json.must_haves_check.missing_items.map((item, idx) => (
                              <div key={idx} className="text-sm p-2 bg-red-50 border border-red-100 rounded">
                                {item.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {fitCardReport.output_report_json.summary?.top_strengths?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          Top Match Reasons
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.summary.top_strengths.map((strength, idx) => (
                            <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                              <p className="text-sm text-slate-800">{strength.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.summary?.key_gaps?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-600" />
                          Key Gaps
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.summary.key_gaps.map((gap, idx) => (
                            <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                              <p className="text-sm text-slate-800">{gap.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.flags?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Flags & Concerns
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.flags.map((flag, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border ${
                              flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                              flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                              'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex items-start gap-2">
                                <Badge className={
                                  flag.severity === 'high' ? 'bg-red-600' :
                                  flag.severity === 'med' ? 'bg-amber-600' :
                                  'bg-blue-600'
                                }>
                                  {flag.severity}
                                </Badge>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{flag.title}</p>
                                  <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.followup_questions?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          Follow-up Questions
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.followup_questions.map((q, idx) => (
                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-xs">{q.priority}</Badge>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{q.question_text}</p>
                                  <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  variant="outline"
                  onClick={() => runNewEvaluationMutation.mutate()}
                  disabled={runNewEvaluationMutation.isPending || fitCardReport?.status === 'running'}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-run Profile Evaluation
                </Button>
              </div>
            )}

            {isProfileMatchingTemplate && fitCardReport?.status === 'running' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-purple-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating Profile Evaluation</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {isProfileMatchingTemplate && fitCardReport?.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{fitCardReport.error_message || 'Unknown error'}</p>
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {isProfileMatchingTemplate && !fitCardReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No profile evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run a profile evaluation to see compatibility analysis.</p>
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Generating...' : 'Run Profile Evaluation'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Shared Report for Finance Template */}
            {isFinanceTemplate && sharedReport?.status === 'succeeded' && sharedReport.output_report_json && (
              <div className="space-y-6">
                <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-blue-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-emerald-600" />
                        Shared Evaluation Report
                      </CardTitle>
                      <Badge variant="outline">
                        Both parties see this report
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Deal Mode</p>
                        <p className="text-xl font-bold">{sharedReport.mode_value}</p>
                      </div>
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Overall Fit</p>
                        <p className="text-xl font-bold capitalize">{sharedReport.output_report_json.summary?.fit_level || 'Unknown'}</p>
                      </div>
                    </div>

                    {sharedReport.output_report_json.summary?.top_fit_reasons?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          Top Match Reasons
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.summary.top_fit_reasons.map((reason, idx) => (
                            <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                              <p className="text-sm text-slate-800">{reason.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.summary?.top_blockers?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-600" />
                          Top Blockers
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.summary.top_blockers.map((blocker, idx) => (
                            <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                              <p className="text-sm text-slate-800">{blocker.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.flags?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Flags & Concerns
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.flags.map((flag, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border ${
                              flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                              flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                              'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex items-start gap-2">
                                <Badge className={
                                  flag.severity === 'high' ? 'bg-red-600' :
                                  flag.severity === 'med' ? 'bg-amber-600' :
                                  'bg-blue-600'
                                }>
                                  {flag.severity}
                                </Badge>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{flag.title}</p>
                                  <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.followup_questions?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          Follow-up Questions
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.followup_questions.map((q, idx) => (
                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {q.priority}
                                </Badge>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{q.question_text}</p>
                                  <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  variant="outline"
                  onClick={() => runNewEvaluationMutation.mutate()}
                  disabled={runNewEvaluationMutation.isPending || sharedReport?.status === 'running'}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-run Evaluation
                </Button>
              </div>
            )}

            {isFinanceTemplate && sharedReport?.status === 'running' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating shared evaluation</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {isFinanceTemplate && sharedReport?.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{sharedReport.error_message || 'Unknown error'}</p>
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Evaluation
                  </Button>
                </CardContent>
              </Card>
            )}

            {isFinanceTemplate && !sharedReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run an AI evaluation to get comprehensive compatibility analysis.</p>
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
                  </Button>
                  {runNewEvaluationMutation.isPending && (
                    <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Standard Reports (Non-Finance Templates) */}
            {!isFinanceTemplate && evaluationReports.length > 0 && (
              <Card className="border-0 shadow-sm mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Evaluation History ({evaluationReports.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {evaluationReports.map((report, idx) => (
                      <div key={report.id} className={`p-3 rounded-lg border ${
                        idx === 0 ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge className={
                              report.status === 'succeeded' ? 'bg-green-600' :
                              report.status === 'failed' ? 'bg-red-600' :
                              report.status === 'running' ? 'bg-blue-600' :
                              'bg-slate-600'
                            }>
                              {report.status}
                            </Badge>
                            <span className="text-sm text-slate-600">
                              {new Date(report.generated_at || report.created_date).toLocaleString()}
                            </span>
                            {idx === 0 && <Badge variant="outline">Latest</Badge>}
                          </div>
                          {report.status === 'succeeded' && report.output_report_json && (
                            <span className="text-sm font-medium text-blue-600">
                              {Math.round((report.output_report_json.quality?.confidence_overall || 0) * 100)}% confidence
                            </span>
                          )}
                        </div>
                        {report.status === 'failed' && report.error_message && (
                          <p className="text-xs text-red-600 mt-2">{report.error_message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {!isFinanceTemplate && !latestReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run an AI evaluation to get comprehensive compatibility analysis.</p>
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
                  </Button>
                  {runNewEvaluationMutation.isPending && (
                    <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                  )}
                </CardContent>
              </Card>
            )}

            {!isFinanceTemplate && latestReport && (latestReport.status === 'queued' || latestReport.status === 'running') && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation in progress</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                  <Badge className="mt-4 bg-blue-600">{latestReport.status}</Badge>
                </CardContent>
              </Card>
            )}
            
            {!isFinanceTemplate && latestReport && latestReport.status === 'succeeded' && latestReport.output_report_json && (
              <div className="space-y-6">
                {/* Quality Metrics */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-500">Party A Completeness</p>
                        <p className="text-2xl font-bold">{Math.round((latestReport.output_report_json.quality?.completeness_a || 0) * 100)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-500">Party B Completeness</p>
                        <p className="text-2xl font-bold">{Math.round((latestReport.output_report_json.quality?.completeness_b || 0) * 100)}%</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm text-slate-500 mb-2">Overall Confidence</p>
                        <Progress value={(latestReport.output_report_json.quality?.confidence_overall || 0) * 100} className="h-3" />
                        <p className="text-xs text-slate-500 mt-1">
                          {latestReport.output_report_json.quality?.confidence_reasoning?.join(' • ')}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Summary */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <Badge className={
                        latestReport.output_report_json.summary?.fit_level === 'high' ? 'bg-green-600' :
                        latestReport.output_report_json.summary?.fit_level === 'medium' ? 'bg-amber-600' :
                        'bg-slate-600'
                      }>
                        {(latestReport.output_report_json.summary?.fit_level || 'unknown')} fit
                      </Badge>
                    </div>
                    
                    {latestReport.output_report_json.summary?.top_fit_reasons?.length > 0 && (
                          <div>
                            <p className="font-medium mb-2">Top Match Reasons</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.top_fit_reasons.map((reason, i) => (
                            <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              {reason.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {latestReport.output_report_json.summary?.top_blockers?.length > 0 && (
                      <div>
                        <p className="font-medium mb-2">Top Blockers</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.top_blockers.map((blocker, i) => (
                            <li key={i} className="text-sm text-red-600 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              {blocker.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {latestReport.output_report_json.summary?.next_actions?.length > 0 && (
                      <div>
                        <p className="font-medium mb-2">Next Actions</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.next_actions.map((action, i) => (
                            <li key={i} className="text-sm text-blue-600 flex items-start gap-2">
                              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Flags */}
                {latestReport.output_report_json.flags?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Flags & Risks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {latestReport.output_report_json.flags.map((flag, i) => (
                          <div key={i} className={`p-3 rounded-lg ${
                            flag.severity === 'high' ? 'bg-red-50' :
                            flag.severity === 'med' ? 'bg-amber-50' :
                            'bg-slate-50'
                          }`}>
                            <div className="flex items-start gap-2">
                              <Badge className={
                                flag.severity === 'high' ? 'bg-red-600' :
                                flag.severity === 'med' ? 'bg-amber-600' :
                                'bg-slate-600'
                              }>
                                {flag.severity}
                              </Badge>
                              <div>
                                <p className="font-medium">{flag.title}</p>
                                <p className="text-sm text-slate-600">{flag.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Follow-up Questions */}
                {latestReport.output_report_json.followup_questions?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Recommended Follow-up Questions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {latestReport.output_report_json.followup_questions.map((q, i) => (
                          <div key={i} className="p-3 bg-blue-50 rounded-lg">
                            <div className="flex items-start gap-2">
                              <Badge className={
                                q.priority === 'high' ? 'bg-red-600' :
                                q.priority === 'med' ? 'bg-amber-600' :
                                'bg-slate-600'
                              }>
                                {q.priority}
                              </Badge>
                              <div>
                                <p className="font-medium">{q.question_text}</p>
                                <p className="text-sm text-slate-600 mt-1">{q.why_this_matters}</p>
                                <Badge variant="outline" className="text-xs mt-2">To: Party {(q.to_party || '').toUpperCase()}</Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Failed Evaluation Display */}
            {!isFinanceTemplate && latestReport && latestReport.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{latestReport.error_message || 'Unknown error'}</p>
                  {latestReport.raw_output && (
                    <details className="mt-4 text-left">
                      <summary className="cursor-pointer text-sm text-slate-600">View raw output</summary>
                      <pre className="mt-2 p-3 bg-slate-100 rounded text-xs overflow-auto max-h-48">
                        {latestReport.raw_output}
                      </pre>
                    </details>
                  )}
                  <Button 
                    onClick={() => runNewEvaluationMutation.mutate()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                    className="mt-4"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Evaluation
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>



          {/* Full Proposal Tab */}

        </Tabs>
      </div>
    </div>
  );
}
