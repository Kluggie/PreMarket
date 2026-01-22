import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
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
      const hasRunning = data?.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
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

  // Run New Evaluation (Vertex Gemini)
  const runNewEvaluationMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('EvaluateProposal', { proposal_id: proposal.id });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['evaluationReports', proposalId]);
      queryClient.invalidateQueries(['proposal', proposalId]);
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
              <Button 
                variant="outline"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const doc = new jsPDF();
                  
                  doc.setFontSize(18);
                  doc.text('Full Proposal Document', 20, 20);
                  doc.setFontSize(12);
                  doc.text(proposal.title || 'Untitled Proposal', 20, 30);
                  doc.setFontSize(9);
                  doc.text(`Template: ${proposal.template_name}`, 20, 37);
                  doc.text(`Created: ${new Date(proposal.created_date).toLocaleDateString()}`, 20, 42);
                  
                  let y = 52;
                  doc.setFontSize(11);
                  doc.text('Parties', 20, y);
                  y += 6;
                  doc.setFontSize(9);
                  doc.text(`Party A (Proposer): ${proposal.mutual_reveal || isPartyA ? proposal.party_a_email : 'Identity Protected'}`, 20, y);
                  y += 5;
                  doc.text(`Party B (Recipient): ${proposal.mutual_reveal || isPartyB ? proposal.party_b_email || 'Not specified' : 'Identity Protected'}`, 20, y);
                  y += 12;
                  
                  // Responses
                  doc.setFontSize(11);
                  doc.text('Proposal Responses', 20, y);
                  y += 8;
                  
                  if (responses.length > 0) {
                    responses.forEach(response => {
                      if (y > 270) { doc.addPage(); y = 20; }
                      
                      doc.setFontSize(9);
                      const questionLabel = response.question_id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                      doc.text(`${questionLabel} [${response.visibility}]`, 20, y);
                      y += 5;
                      
                      const value = response.value_type === 'range' 
                        ? `Range: ${response.range_min} - ${response.range_max}`
                        : response.value || 'Not provided';
                      
                      const lines = doc.splitTextToSize(value, 170);
                      lines.forEach(line => {
                        if (y > 275) { doc.addPage(); y = 20; }
                        doc.text(line, 22, y);
                        y += 4;
                      });
                      y += 3;
                    });
                  } else {
                    doc.text('No responses recorded', 20, y);
                  }
                  
                  doc.save(`${proposal.title || 'proposal'}_full.pdf`);
                }}
              >
                <FileText className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button 
                onClick={() => runNewEvaluationMutation.mutate()}
                disabled={runNewEvaluationMutation.isPending || latestReport?.status === 'running' || latestReport?.status === 'queued'}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {(runNewEvaluationMutation.isPending || latestReport?.status === 'running' || latestReport?.status === 'queued') ? 'Evaluating...' : 'Run AI Evaluation'}
              </Button>
              {latestSuccessReport && (
                <Button 
                  variant="outline"
                  onClick={async () => {
                    const { jsPDF } = await import('jspdf');
                    const doc = new jsPDF();
                    const report = latestSuccessReport.output_report_json;
                    
                    doc.setFontSize(18);
                    doc.text('AI Evaluation Report', 20, 20);
                    doc.setFontSize(10);
                    doc.text(`Generated: ${new Date(latestSuccessReport.generated_at || latestSuccessReport.created_date).toLocaleString()}`, 20, 28);
                    
                    let y = 40;
                    
                    // Summary
                    doc.setFontSize(14);
                    doc.text('Executive Summary', 20, y);
                    y += 8;
                    doc.setFontSize(10);
                    doc.text(`Fit Level: ${report.summary?.fit_level || 'unknown'}`, 20, y);
                    y += 10;
                    
                    // Quality
                    doc.setFontSize(12);
                    doc.text('Quality Metrics', 20, y);
                    y += 6;
                    doc.setFontSize(9);
                    doc.text(`Party A Completeness: ${Math.round((report.quality?.completeness_a || 0) * 100)}%`, 20, y);
                    y += 5;
                    doc.text(`Party B Completeness: ${Math.round((report.quality?.completeness_b || 0) * 100)}%`, 20, y);
                    y += 5;
                    doc.text(`Overall Confidence: ${Math.round((report.quality?.confidence_overall || 0) * 100)}%`, 20, y);
                    y += 10;
                    
                    // Flags
                    if (report.flags?.length > 0) {
                      doc.setFontSize(12);
                      doc.text('Flags & Risks', 20, y);
                      y += 6;
                      doc.setFontSize(9);
                      report.flags.forEach(flag => {
                        if (y > 270) { doc.addPage(); y = 20; }
                        doc.text(`[${flag.severity?.toUpperCase()}] ${flag.title}`, 22, y);
                        y += 5;
                      });
                      y += 5;
                    }
                    
                    // Follow-ups
                    if (report.followup_questions?.length > 0) {
                      if (y > 250) { doc.addPage(); y = 20; }
                      doc.setFontSize(12);
                      doc.text('Follow-up Questions', 20, y);
                      y += 6;
                      doc.setFontSize(9);
                      report.followup_questions.slice(0, 10).forEach(q => {
                        if (y > 270) { doc.addPage(); y = 20; }
                        doc.text(`[${q.priority}] ${q.question_text}`, 22, y);
                        y += 5;
                      });
                    }
                    
                    doc.save(`${proposal.title || 'proposal'}_ai_report.pdf`);
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
              AI Report
            </TabsTrigger>
            <TabsTrigger value="fullproposal" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Full Proposal
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
                          {proposal.mutual_reveal || isPartyB 
                            ? proposal.party_b_email || 'Not specified' 
                            : 'Identity Protected'}
                        </p>
                        {isPartyB && <Badge className="mt-2 bg-indigo-100 text-indigo-700">You</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Responses */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Template Responses</CardTitle>
                    <CardDescription>Information provided in this proposal.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {responses.length === 0 ? (
                      <p className="text-slate-500 text-center py-8">No responses recorded yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {responses.map(response => (
                          <div key={response.id} className="p-4 bg-slate-50 rounded-xl">
                            <div className="flex items-start justify-between mb-2">
                              <p className="font-medium text-slate-900 capitalize">
                                {response.question_id.replace(/_/g, ' ')}
                              </p>
                              <Badge variant="outline" className="text-xs">
                                {response.visibility === 'full' ? (
                                  <><Eye className="w-3 h-3 mr-1" /> Visible</>
                                ) : response.visibility === 'partial' ? (
                                  <><Eye className="w-3 h-3 mr-1" /> Partial</>
                                ) : (
                                  <><Lock className="w-3 h-3 mr-1" /> Hidden</>
                                )}
                              </Badge>
                            </div>
                            <p className="text-slate-600">
                              {response.value_type === 'range' 
                                ? `${response.range_min} - ${response.range_max}`
                                : response.value || 'Not provided'
                              }
                            </p>
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
            {/* Evaluation History */}
            {evaluationReports.length > 0 && (
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

            {!latestReport && (
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

            {latestReport && (latestReport.status === 'queued' || latestReport.status === 'running') && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation in progress</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                  <Badge className="mt-4 bg-blue-600">{latestReport.status}</Badge>
                </CardContent>
              </Card>
            )}
            
            {latestReport && latestReport.status === 'succeeded' && latestReport.output_report_json && (
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
                        <p className="font-medium mb-2">Top Fit Reasons</p>
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
            {latestReport && latestReport.status === 'failed' && (
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
          <TabsContent value="fullproposal">
            <div className="space-y-6">
              {/* Proposal Header */}
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>{proposal.title || 'Untitled Proposal'}</CardTitle>
                  <CardDescription>
                    {proposal.template_name} • Created {new Date(proposal.created_date).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 bg-blue-50 rounded-xl">
                      <p className="text-sm text-blue-600 font-medium mb-2">Party A (Proposer)</p>
                      <p className="font-medium text-slate-900">
                        {proposal.mutual_reveal || isPartyA ? proposal.party_a_email : 'Identity Protected'}
                      </p>
                    </div>
                    <div className="p-4 bg-indigo-50 rounded-xl">
                      <p className="text-sm text-indigo-600 font-medium mb-2">Party B (Recipient)</p>
                      <p className="font-medium text-slate-900">
                        {proposal.mutual_reveal || isPartyB ? proposal.party_b_email || 'Not specified' : 'Identity Protected'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Full Template Responses */}
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Complete Proposal Answers</CardTitle>
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
                                Party {(response.party || '').toUpperCase()}
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

              {/* AI Evaluation Summary */}
              {latestEvaluation && (
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>AI Evaluation Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 mb-6">
                      <div className="text-center">
                        <p className="text-4xl font-bold text-blue-600">{latestEvaluation.overall_score}%</p>
                        <p className="text-sm text-slate-500 mt-1">Match Score</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-500 mb-1">Confidence</p>
                        <div className="flex items-center gap-2">
                          <Progress value={latestEvaluation.confidence || 0} className="w-32 h-2" />
                          <span className="text-sm font-medium">{latestEvaluation.confidence}%</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-slate-600">{latestEvaluation.summary}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}