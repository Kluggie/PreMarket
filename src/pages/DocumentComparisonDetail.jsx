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
import {
  ArrowLeft, Sparkles, CheckCircle2, XCircle, AlertTriangle,
  FileText, Shield, RefreshCw, Loader2, TrendingUp, TrendingDown, Lock
} from 'lucide-react';

export default function DocumentComparisonDetail() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  const runEvaluationMutation = useMutation({
    mutationFn: async () => {
      const result = await base44.functions.invoke('EvaluateDocumentComparison', {
        comparison_id: comparisonId
      });
      
      if (!result.data.ok) {
        throw new Error(result.data.error || 'Evaluation failed');
      }
      
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['documentComparison', comparisonId]);
    },
    onError: (error) => {
      alert(`Evaluation failed: ${error.message}`);
    }
  });

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

  const report = comparison.evaluation_report_json;
  const hasReport = comparison.status === 'evaluated' && report;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link to={createPageUrl('Dashboard')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                {comparison.title || 'Untitled Comparison'}
              </h1>
              <p className="text-slate-500">
                Created {new Date(comparison.created_date).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Badge className={
                comparison.status === 'evaluated' ? 'bg-green-100 text-green-700' :
                comparison.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                comparison.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-slate-100 text-slate-700'
              }>
                {comparison.status}
              </Badge>
              {comparison.status === 'draft' && (
                <Button 
                  variant="outline"
                  onClick={() => navigate(createPageUrl(`DocumentComparisonCreate?draft=${comparisonId}`))}
                >
                  Edit Draft
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Document Info */}
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 rounded-xl">
                <p className="text-sm text-blue-600 font-medium mb-2">{comparison.party_a_label}</p>
                <p className="text-2xl font-bold text-slate-900">{comparison.doc_a_plaintext?.length || 0}</p>
                <p className="text-xs text-slate-500">characters</p>
                {(comparison.doc_a_spans_json?.length || 0) > 0 && (
                  <div className="mt-2 flex gap-1">
                    <Badge className="bg-red-100 text-red-700 text-xs">
                      {comparison.doc_a_spans_json.filter(s => s.level === 'confidential').length} confidential
                    </Badge>
                    <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                      {comparison.doc_a_spans_json.filter(s => s.level === 'partial').length} partial
                    </Badge>
                  </div>
                )}
              </div>
              <div className="p-4 bg-indigo-50 rounded-xl">
                <p className="text-sm text-indigo-600 font-medium mb-2">{comparison.party_b_label}</p>
                <p className="text-2xl font-bold text-slate-900">{comparison.doc_b_plaintext?.length || 0}</p>
                <p className="text-xs text-slate-500">characters</p>
                {(comparison.doc_b_spans_json?.length || 0) > 0 && (
                  <div className="mt-2 flex gap-1">
                    <Badge className="bg-red-100 text-red-700 text-xs">
                      {comparison.doc_b_spans_json.filter(s => s.level === 'confidential').length} confidential
                    </Badge>
                    <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                      {comparison.doc_b_spans_json.filter(s => s.level === 'partial').length} partial
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* No Evaluation Yet */}
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

        {/* Evaluation Running */}
        {comparison.status === 'submitted' && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <RefreshCw className="w-12 h-12 text-purple-500 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating evaluation</h3>
              <p className="text-slate-500">This may take 10-30 seconds...</p>
            </CardContent>
          </Card>
        )}

        {/* Evaluation Failed */}
        {comparison.status === 'failed' && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
              <p className="text-slate-500 mb-4">{comparison.error_message || 'Unknown error'}</p>
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

        {/* Evaluation Report */}
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
                  {report.depends_on_confidential && (
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
                    <p className="text-2xl font-bold capitalize">{report.summary?.match_level || 'Unknown'}</p>
                  </div>
                  {report.summary?.match_score_0_100 !== null && report.summary?.match_score_0_100 !== undefined && (
                    <div className="p-4 bg-white rounded-lg">
                      <p className="text-sm text-slate-600">Match Score</p>
                      <p className="text-2xl font-bold">{Math.round(report.summary.match_score_0_100)}%</p>
                    </div>
                  )}
                </div>
                {report.summary?.rationale && (
                  <div className="p-4 bg-white rounded-lg">
                    <p className="text-sm text-slate-700">{report.summary.rationale}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Alignment Points */}
            {report.alignment_points?.length > 0 && (
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
            {report.conflicts_or_gaps?.length > 0 && (
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
            {report.followup_requests?.length > 0 && (
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
            {report.redaction_notes && (
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
                disabled={runEvaluationMutation.isPending || comparison.status === 'submitted'}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-run Evaluation
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}