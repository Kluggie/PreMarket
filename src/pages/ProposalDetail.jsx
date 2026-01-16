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

  // Run AI Evaluation
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
              {!latestEvaluation && (
                <Button 
                  onClick={() => runEvaluationMutation.mutate()}
                  disabled={runEvaluationMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {runEvaluationMutation.isPending ? 'Evaluating...' : 'Run AI Evaluation'}
                </Button>
              )}
              {latestEvaluation && (
                <Button 
                  variant="outline"
                  onClick={() => runEvaluationMutation.mutate()}
                  disabled={runEvaluationMutation.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${runEvaluationMutation.isPending ? 'animate-spin' : ''}`} />
                  Re-evaluate
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

        {/* Mutual Reveal Banner */}
        {proposal.status !== 'revealed' && (
          <Card className="border-0 shadow-sm mb-6 border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3">
                  {proposal.mutual_reveal ? (
                    <Unlock className="w-6 h-6 text-green-600 flex-shrink-0" />
                  ) : (
                    <Lock className="w-6 h-6 text-amber-600 flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-slate-900">
                      {proposal.mutual_reveal ? 'Identity Revealed' : 'Identity Protected'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {otherPartyRequestedReveal 
                        ? 'The other party has requested mutual reveal. Accept to unlock full identities.'
                        : 'Both parties must request reveal to unlock full contact information.'}
                    </p>
                  </div>
                </div>
                {canRequestReveal && (
                  <Button 
                    onClick={() => requestRevealMutation.mutate()}
                    disabled={requestRevealMutation.isPending}
                    variant={otherPartyRequestedReveal ? 'default' : 'outline'}
                    className={otherPartyRequestedReveal ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {otherPartyRequestedReveal ? (
                      <>
                        <Unlock className="w-4 h-4 mr-2" />
                        Accept Reveal
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4 mr-2" />
                        Request Reveal
                      </>
                    )}
                  </Button>
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
            <TabsTrigger value="verification" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Shield className="w-4 h-4 mr-2" />
              Verification
            </TabsTrigger>
            <TabsTrigger value="attachments" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Paperclip className="w-4 h-4 mr-2" />
              Files ({attachments.length})
            </TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Clock className="w-4 h-4 mr-2" />
              Activity
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

                {/* Reveal Status */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Reveal Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-500">Party A Level</span>
                        <Badge>Gate {proposal.reveal_level_a || 1}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-500">Party B Level</span>
                        <Badge>Gate {proposal.reveal_level_b || 0}</Badge>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-500">Mutual Reveal</span>
                        {proposal.mutual_reveal ? (
                          <Badge className="bg-green-100 text-green-700">Complete</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* AI Report Tab */}
          <TabsContent value="evaluation">
            {!latestEvaluation ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run an AI evaluation to get compatibility analysis.</p>
                  <Button 
                    onClick={() => runEvaluationMutation.mutate()}
                    disabled={runEvaluationMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Run Evaluation
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Summary */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Evaluation Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-slate-600">{latestEvaluation.summary || 'No summary available.'}</p>
                  </CardContent>
                </Card>

                {/* Criteria Scores */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Criteria Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {(latestEvaluation.criteria_scores || []).map((criteria, i) => (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{criteria.name}</span>
                            <span className="font-bold text-blue-600">{criteria.score}%</span>
                          </div>
                          <Progress value={criteria.score} className="h-2" />
                          {criteria.rationale && (
                            <p className="text-sm text-slate-500 mt-2">{criteria.rationale}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Red Flags */}
                {latestEvaluation.red_flags?.length > 0 && (
                  <Card className="border-0 shadow-sm border-l-4 border-l-red-500">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-700">
                        <AlertTriangle className="w-5 h-5" />
                        Red Flags
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {latestEvaluation.red_flags.map((flag, i) => (
                          <div key={i} className="p-4 bg-red-50 rounded-xl">
                            <div className="flex items-start gap-3">
                              <Badge className={
                                flag.severity === 'high' ? 'bg-red-600' :
                                flag.severity === 'medium' ? 'bg-amber-600' : 'bg-slate-600'
                              }>
                                {flag.severity}
                              </Badge>
                              <div>
                                <p className="font-medium text-slate-900">{flag.title}</p>
                                <p className="text-sm text-slate-600 mt-1">{flag.description}</p>
                                {flag.recommendation && (
                                  <p className="text-sm text-blue-600 mt-2">
                                    <strong>Recommendation:</strong> {flag.recommendation}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recommendations */}
                {latestEvaluation.recommendations?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Recommendations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {latestEvaluation.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* Verification Tab */}
          <TabsContent value="verification">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Verification Log</CardTitle>
                <CardDescription>Track verification status of provided information.</CardDescription>
              </CardHeader>
              <CardContent>
                {verifications.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500">No verification items yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {verifications.map(item => (
                      <div key={item.id} className="p-4 bg-slate-50 rounded-xl">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{item.question_id}</p>
                            <p className="text-sm text-slate-500">{item.original_value}</p>
                          </div>
                          <Badge className={
                            item.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                            item.status === 'disputed' ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-700'
                          }>
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Attachments Tab */}
          <TabsContent value="attachments">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Attached Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {attachments.length === 0 ? (
                  <div className="text-center py-12">
                    <Paperclip className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 mb-4">No documents attached yet.</p>
                    <Button variant="outline">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Document
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {attachments.map(file => (
                      <div key={file.id} className="p-4 bg-slate-50 rounded-xl flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{file.name}</p>
                          <p className="text-sm text-slate-500">{file.file_type}</p>
                        </div>
                        <Button variant="ghost" size="sm">View</Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity">
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
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}