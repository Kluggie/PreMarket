import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, Sparkles, CheckCircle2, XCircle, AlertTriangle,
  FileText, Shield, RefreshCw, Loader2, TrendingUp, TrendingDown, Lock, Send, Mail,
  BarChart3, Download, Clock
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function DocumentComparisonDetail() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const params = new URLSearchParams(window.location.search);
  const comparisonId = params.get('id');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  const { data: comparison, isLoading, error } = useQuery({
    queryKey: ['documentComparison', comparisonId],
    queryFn: async () => {
      if (!comparisonId) {
        throw new Error('No comparison ID provided');
      }
      const comparisons = await base44.entities.DocumentComparison.filter({ id: comparisonId });
      if (!comparisons[0]) {
        throw new Error('Comparison not found');
      }
      return comparisons[0];
    },
    enabled: !!comparisonId,
    refetchInterval: (data) => {
      return data?.status === 'submitted' ? 2000 : false;
    },
    retry: false
  });

  const { data: evaluationRuns = [] } = useQuery({
    queryKey: ['evaluationRuns', comparisonId],
    queryFn: async () => {
      const items = await base44.entities.EvaluationItem.filter({ 
        linked_document_comparison_id: comparisonId 
      });
      if (items.length === 0) return [];
      
      return await base44.entities.EvaluationRun.filter({ 
        evaluation_item_id: items[0].id 
      }, '-created_date');
    },
    enabled: !!comparisonId
  });

  const latestRun = evaluationRuns[0];
  const report = latestRun?.public_report_json || comparison?.evaluation_report_json;
  const hasReport = (comparison?.status === 'evaluated' && comparison.evaluation_report_json) || 
                    (latestRun?.status === 'completed' && latestRun.public_report_json);

  const runEvaluationMutation = useMutation({
    mutationFn: async () => {
      const clientCorrelationId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      try {
        const result = await base44.functions.invoke('EvaluateDocumentComparison', {
          comparison_id: comparisonId
        });
        
        // Check if response is valid JSON
        if (!result.data || typeof result.data !== 'object') {
          const rawText = typeof result.data === 'string' ? result.data.substring(0, 300) : JSON.stringify(result.data).substring(0, 300);
          throw new Error(`Non-JSON response\n\nCorrelation ID: ${clientCorrelationId}\n\nRaw (first 300 chars):\n${rawText}`);
        }
        
        if (!result.data.ok) {
          const errorCode = result.data.errorCode || 'UNKNOWN';
          const errorMsg = result.data.message || result.data.error || 'Evaluation failed';
          const details = result.data.detailsSafe || '';
          const corrId = result.data.correlationId || clientCorrelationId;
          
          throw new Error(`${errorMsg}\n\n${details ? `Details: ${details}\n\n` : ''}Error Code: ${errorCode}\nCorrelation ID: ${corrId}`);
        }
        
        return result.data;
      } catch (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['documentComparison', comparisonId]);
      queryClient.invalidateQueries(['evaluationRuns', comparisonId]);
      toast.success('Evaluation completed successfully');
    },
    onError: (error) => {
      toast.error('Evaluation failed');
      alert(`Evaluation failed:\n\n${error.message}`);
    }
  });

  const handleSendEmail = async () => {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    setSendingEmail(true);
    const clientCorrelationId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    try {
      const result = await base44.functions.invoke('SendReportEmailSafe', {
        documentComparisonId: comparisonId,
        recipientEmail: recipientEmail
      });

      // Check if response is valid JSON
      if (!result.data || typeof result.data !== 'object') {
        const rawText = typeof result.data === 'string' ? result.data.substring(0, 300) : JSON.stringify(result.data).substring(0, 300);
        toast.error('Send failed: Invalid response from backend');
        console.error(`[${clientCorrelationId}] Non-JSON response:`, rawText);
        alert(`Send failed: Non-JSON response from backend\n\nCorrelation ID: ${clientCorrelationId}\n\nRaw response (first 300 chars):\n${rawText}`);
        return;
      }

      if (!result.data.ok) {
        const errorCode = result.data.errorCode || 'UNKNOWN';
        const errorMsg = result.data.message || 'Failed to send email';
        const corrId = result.data.correlationId || clientCorrelationId;
        
        toast.error(`Failed to send: ${errorMsg}`);
        console.error(`[${corrId}] Send email error [${errorCode}]:`, errorMsg);
        
        // Show detailed error in alert
        alert(`Failed to send email\n\nError: ${errorMsg}\n\nError Code: ${errorCode}\nCorrelation ID: ${corrId}`);
        return;
      }

      const corrId = result.data.correlationId || clientCorrelationId;
      console.log(`[${corrId}] Email sent successfully`);
      toast.success(`Report sent to ${recipientEmail}`);
      setRecipientEmail('');
    } catch (error) {
      toast.error('Failed to send email');
      console.error(`[${clientCorrelationId}] Network/unexpected error:`, error);
      alert(`Failed to send email\n\nNetwork or unexpected error:\n${error.message || 'Unknown error occurred'}\n\nCorrelation ID: ${clientCorrelationId}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const result = await base44.functions.invoke('DownloadComparisonPDF', {
        comparisonId
      });
      
      const blob = new Blob([result.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison-report-${comparisonId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success('PDF downloaded');
    } catch (error) {
      toast.error('Failed to download PDF');
      console.error('Download PDF error:', error);
    }
  };

  const handleDownloadJSON = async () => {
    try {
      const result = await base44.functions.invoke('DownloadComparisonJSON', {
        comparisonId
      });
      
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison-report-${comparisonId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success('JSON downloaded');
    } catch (error) {
      toast.error('Failed to download JSON');
      console.error('Download JSON error:', error);
    }
  };

  const handleDownloadInputs = async () => {
    try {
      const result = await base44.functions.invoke('DownloadComparisonInputs', {
        comparisonId
      });
      
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison-inputs-${comparisonId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success('Inputs downloaded');
    } catch (error) {
      toast.error('Failed to download inputs');
      console.error('Download inputs error:', error);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <Link to={createPageUrl('Proposals')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Comparison Not Found</h3>
              <p className="text-slate-500 mb-6">
                This comparison may have been deleted or you don't have access to it.
              </p>
              <Button onClick={() => navigate(createPageUrl('Proposals'))}>
                Return to Proposals
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isLoading || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-48" />
            <div className="h-64 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link to={createPageUrl('Dashboard')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-slate-900">
                  {comparison.title || 'Untitled Comparison'}
                </h1>
                <Badge className={
                  comparison.status === 'evaluated' ? 'bg-green-100 text-green-700' :
                  comparison.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                  comparison.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-slate-100 text-slate-700'
                }>
                  {comparison.status}
                </Badge>
              </div>
              <p className="text-slate-500">
                Document Comparison • Created {new Date(comparison.created_date).toLocaleDateString()}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {comparison.status === 'draft' && (
                <Button 
                  variant="outline"
                  onClick={() => navigate(createPageUrl(`DocumentComparisonCreate?draft=${comparisonId}`))}
                >
                  Edit Draft
                </Button>
              )}
              {hasReport && (
                <>
                  <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
                    <Download className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadJSON}>
                    <Download className="w-4 h-4 mr-2" />
                    JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadInputs}>
                    <Download className="w-4 h-4 mr-2" />
                    Inputs
                  </Button>
                </>
              )}
              <Button 
                onClick={() => runEvaluationMutation.mutate()}
                disabled={runEvaluationMutation.isPending || comparison.status === 'submitted' || latestRun?.status === 'running'}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {(runEvaluationMutation.isPending || comparison.status === 'submitted' || latestRun?.status === 'running') ? 'Evaluating...' : 'Run Evaluation'}
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="report" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <BarChart3 className="w-4 h-4 mr-2" />
              AI Report
              {hasReport && (
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
                {/* Documents */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Documents</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50 rounded-xl">
                        <p className="text-sm text-blue-600 font-medium mb-2">{comparison.party_a_label}</p>
                        <p className="text-2xl font-bold text-slate-900">{comparison.doc_a_plaintext?.length || 0}</p>
                        <p className="text-xs text-slate-500">characters</p>
                        <p className="text-xs text-slate-500 mt-1">Source: {comparison.doc_a_source}</p>
                        {(comparison.doc_a_spans_json?.length || 0) > 0 && (
                          <div className="mt-2 flex gap-1 flex-wrap">
                            <Badge className="bg-red-100 text-red-700 text-xs">
                              {comparison.doc_a_spans_json.filter(s => s.level === 'confidential').length} confidential
                            </Badge>
                            <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                              {comparison.doc_a_spans_json.filter(s => s.level === 'partial').length} partial
                            </Badge>
                          </div>
                        )}
                        {comparison.doc_a_files?.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-600 font-medium">{comparison.doc_a_files.length} file(s)</p>
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-xl">
                        <p className="text-sm text-indigo-600 font-medium mb-2">{comparison.party_b_label}</p>
                        <p className="text-2xl font-bold text-slate-900">{comparison.doc_b_plaintext?.length || 0}</p>
                        <p className="text-xs text-slate-500">characters</p>
                        <p className="text-xs text-slate-500 mt-1">Source: {comparison.doc_b_source}</p>
                        {(comparison.doc_b_spans_json?.length || 0) > 0 && (
                          <div className="mt-2 flex gap-1 flex-wrap">
                            <Badge className="bg-red-100 text-red-700 text-xs">
                              {comparison.doc_b_spans_json.filter(s => s.level === 'confidential').length} confidential
                            </Badge>
                            <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                              {comparison.doc_b_spans_json.filter(s => s.level === 'partial').length} partial
                            </Badge>
                          </div>
                        )}
                        {comparison.doc_b_files?.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-600 font-medium">{comparison.doc_b_files.length} file(s)</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
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
                          <p className="font-medium">Comparison Created</p>
                          <p className="text-sm text-slate-500">{new Date(comparison.created_date).toLocaleString()}</p>
                        </div>
                      </div>
                      {comparison.draft_updated_at && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-slate-600" />
                          </div>
                          <div>
                            <p className="font-medium">Last Updated</p>
                            <p className="text-sm text-slate-500">{new Date(comparison.draft_updated_at).toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                      {evaluationRuns.map(run => (
                        <div key={run.id} className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-purple-600" />
                          </div>
                          <div>
                            <p className="font-medium">Evaluation Run #{run.cycle_index + 1}</p>
                            <p className="text-sm text-slate-500">
                              {new Date(run.created_date).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Share Report */}
                {hasReport && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Mail className="w-4 h-4 text-blue-600" />
                        Share Report
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="recipient-email" className="text-sm">Recipient Email</Label>
                        <Input 
                          id="recipient-email"
                          type="email"
                          placeholder="recipient@example.com"
                          value={recipientEmail}
                          onChange={(e) => setRecipientEmail(e.target.value)}
                          disabled={sendingEmail}
                        />
                      </div>
                      <Button 
                        onClick={handleSendEmail}
                        disabled={sendingEmail || !recipientEmail}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        size="sm"
                      >
                        {sendingEmail ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4 mr-2" />
                            Send Report
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* AI Report Tab */}
          <TabsContent value="report">
            {!hasReport && comparison.status === 'draft' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run AI evaluation to compare these documents.</p>
                  <Button 
                    onClick={() => runEvaluationMutation.mutate()}
                    disabled={runEvaluationMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runEvaluationMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
                  </Button>
                  {runEvaluationMutation.isPending && (
                    <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                  )}
                </CardContent>
              </Card>
            )}

            {(comparison.status === 'submitted' || latestRun?.status === 'running') && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-purple-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating evaluation</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {(comparison.status === 'failed' || latestRun?.status === 'failed') && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{comparison.error_message || latestRun?.error_message || 'Unknown error'}</p>
                  <Button 
                    onClick={() => runEvaluationMutation.mutate()}
                    disabled={runEvaluationMutation.isPending}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Evaluation
                  </Button>
                </CardContent>
              </Card>
            )}

            {hasReport && (
              <div className="space-y-6">
                {/* Summary Card */}
                <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-blue-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        Comparison Report
                      </CardTitle>
                      {report?.depends_on_confidential && (
                        <Badge className="bg-amber-100 text-amber-700 flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          Based on confidential info
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      AI-generated analysis respecting confidentiality markings
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Match Level</p>
                        <p className="text-2xl font-bold capitalize">{report?.summary?.match_level || 'Unknown'}</p>
                      </div>
                      {report?.summary?.match_score_0_100 !== null && report?.summary?.match_score_0_100 !== undefined && (
                        <div className="p-4 bg-white rounded-lg">
                          <p className="text-sm text-slate-600">Match Score</p>
                          <p className="text-2xl font-bold">{Math.round(report.summary.match_score_0_100)}%</p>
                        </div>
                      )}
                    </div>
                    {report?.summary?.rationale && (
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-700">{report.summary.rationale}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Alignment Points */}
                {report?.alignment_points?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        Alignment Points
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {report.alignment_points.map((point, idx) => (
                          <div key={idx} className="p-4 bg-green-50 border border-green-100 rounded-lg">
                            <h4 className="font-semibold text-slate-900 mb-1">{point.title}</h4>
                            <p className="text-sm text-slate-700">{point.detail}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Conflicts or Gaps */}
                {report?.conflicts_or_gaps?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                        Conflicts & Gaps
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {report.conflicts_or_gaps.map((conflict, idx) => (
                          <div key={idx} className={`p-4 rounded-lg border ${
                            conflict.severity === 'high' ? 'bg-red-50 border-red-200' :
                            conflict.severity === 'medium' ? 'bg-amber-50 border-amber-200' :
                            'bg-blue-50 border-blue-200'
                          }`}>
                            <div className="flex items-start gap-2">
                              <Badge className={
                                conflict.severity === 'high' ? 'bg-red-600' :
                                conflict.severity === 'medium' ? 'bg-amber-600' :
                                'bg-blue-600'
                              }>
                                {conflict.severity}
                              </Badge>
                              <div className="flex-1">
                                <h4 className="font-semibold text-slate-900 mb-1">{conflict.title}</h4>
                                <p className="text-sm text-slate-700">{conflict.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Follow-up Requests */}
                {report?.followup_requests?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Recommended Follow-up</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {report.followup_requests.map((request, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="text-purple-600 font-bold">•</span>
                            {request}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Redaction Summary */}
                {report?.redaction_notes && (
                  <Card className="border-0 shadow-sm bg-slate-50">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Lock className="w-4 h-4" />
                        Redaction Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-slate-600">{comparison.party_a_label}</p>
                          <p className="font-medium text-red-700">
                            {report.redaction_notes.confidential_spans_a_count} confidential
                          </p>
                          <p className="font-medium text-yellow-700">
                            {report.redaction_notes.partial_spans_a_count} partial
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-600">{comparison.party_b_label}</p>
                          <p className="font-medium text-red-700">
                            {report.redaction_notes.confidential_spans_b_count} confidential
                          </p>
                          <p className="font-medium text-yellow-700">
                            {report.redaction_notes.partial_spans_b_count} partial
                          </p>
                        </div>
                      </div>
                      <Alert className="mt-3">
                        <Shield className="w-4 h-4" />
                        <AlertDescription className="text-xs">
                          This report does not quote or reveal any confidential or partial content
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                )}

                {/* Re-run Button */}
                <div className="flex justify-center">
                  <Button 
                    variant="outline"
                    onClick={() => runEvaluationMutation.mutate()}
                    disabled={runEvaluationMutation.isPending || latestRun?.status === 'running'}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Re-run Evaluation
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}