import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, XCircle, FileText, CheckCircle2, AlertTriangle, Sparkles, RefreshCw, Send, Lock } from 'lucide-react';
import { toast } from 'sonner';

export default function SharedReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [user, setUser] = useState(null);
  const [reportData, setReportData] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  useEffect(() => {
    // Try to get user, but don't require it
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Missing access token in URL');
      setLoading(false);
      return;
    }
    loadSharedReport();
  }, [token]);

  const loadSharedReport = async () => {
    try {
      setLoading(true);
      
      // Validate token via backend (guest-safe, no auth required)
      const result = await base44.functions.invoke('ValidateShareLink', { token });
      
      if (!result.data.ok) {
        setError(result.data.message || 'Invalid share link');
        setLoading(false);
        return;
      }

      const { shareLink, permissions } = result.data;
      setShareData({ ...shareLink, permissions });

      // Load report data based on type
      if (shareLink.documentComparisonId) {
        const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ 
          id: shareLink.documentComparisonId 
        });
        if (comparisons[0]) {
          setReportData({ type: 'comparison', data: comparisons[0] });
        }
      } else if (shareLink.proposalId) {
        const proposals = await base44.asServiceRole.entities.Proposal.filter({ 
          id: shareLink.proposalId 
        });
        if (proposals[0]) {
          const reports = await base44.asServiceRole.entities.EvaluationReportShared.filter({ 
            proposal_id: shareLink.proposalId 
          }, '-created_date', 1);
          setReportData({ type: 'proposal', data: proposals[0], report: reports[0] });
        }
      }

      setLoading(false);
    } catch (err) {
      console.error('Load shared report error:', err);
      setError(err.message || 'Failed to load shared report');
      setLoading(false);
    }
  };

  const handleReEvaluate = async () => {
    if (!shareData?.proposalId && !shareData?.documentComparisonId) return;

    try {
      toast.info('Running evaluation...');
      
      if (shareData.documentComparisonId) {
        await base44.functions.invoke('EvaluateDocumentComparison', {
          comparison_id: shareData.documentComparisonId
        });
      } else if (shareData.proposalId) {
        await base44.functions.invoke('EvaluateProposalShared', {
          proposal_id: shareData.proposalId
        });
      }
      
      toast.success('Evaluation completed');
      loadSharedReport();
    } catch (error) {
      toast.error('Evaluation failed');
      console.error('Re-evaluate error:', error);
    }
  };

  const handleSendBack = async () => {
    if (!shareData?.proposalId && !shareData?.documentComparisonId) return;
    
    const recipientEmail = prompt('Enter email to send report back to:');
    if (!recipientEmail) return;

    try {
      const result = await base44.functions.invoke('SendReportEmailSafe', {
        proposalId: shareData.proposalId,
        documentComparisonId: shareData.documentComparisonId,
        recipientEmail
      });

      if (result.data.ok) {
        toast.success(`Report sent to ${recipientEmail}`);
      } else {
        toast.error(result.data.message || 'Failed to send');
      }
    } catch (error) {
      toast.error('Failed to send report');
      console.error('Send back error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Loading report...</h3>
            <p className="text-slate-500">Please wait while we verify your access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Access Denied</h3>
            <p className="text-slate-500 mb-6">{error}</p>
            <Button onClick={() => window.location.href = '/'}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const report = reportData?.type === 'comparison' 
    ? reportData.data.evaluation_report_json 
    : reportData?.report?.output_report_json;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Guest Banner */}
        {!user && (
          <Alert className="mb-6 bg-blue-50 border-blue-200">
            <Lock className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              You're viewing this report as a guest. You can edit, re-evaluate, and send it back.
            </AlertDescription>
          </Alert>
        )}

        {/* Link Usage Stats */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Link uses: {shareData?.uses || 0} / {shareData?.maxUses || 25}
              </span>
              <span className="text-slate-600">
                Expires: {shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Report Content */}
        {reportData?.type === 'comparison' && (
          <Card className="border-0 shadow-sm mb-6 bg-gradient-to-br from-purple-50 to-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                {reportData.data.title || 'Document Comparison'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report ? (
                <div className="space-y-4">
                  {report.summary && (
                    <div className="p-4 bg-white rounded-lg">
                      <p className="text-sm text-slate-600">Match Level</p>
                      <p className="text-2xl font-bold capitalize">{report.summary.match_level || 'Unknown'}</p>
                      {report.summary.rationale && (
                        <p className="text-sm text-slate-700 mt-2">{report.summary.rationale}</p>
                      )}
                    </div>
                  )}

                  {report.alignment_points?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Alignment Points
                      </h4>
                      <div className="space-y-2">
                        {report.alignment_points.map((point, idx) => (
                          <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                            <p className="font-medium text-sm">{point.title}</p>
                            <p className="text-sm text-slate-700 mt-1">{point.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {report.conflicts_or_gaps?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        Conflicts & Gaps
                      </h4>
                      <div className="space-y-2">
                        {report.conflicts_or_gaps.map((conflict, idx) => (
                          <div key={idx} className={`p-3 rounded-lg border ${
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
                                <p className="font-medium text-sm">{conflict.title}</p>
                                <p className="text-sm text-slate-600 mt-1">{conflict.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500">No evaluation report available yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        {reportData?.type === 'proposal' && report && (
          <Card className="border-0 shadow-sm mb-6 bg-gradient-to-br from-emerald-50 to-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                {reportData.data.title || 'Proposal Report'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {report.summary && (
                  <div className="p-4 bg-white rounded-lg">
                    <p className="text-sm text-slate-600">Overall Fit</p>
                    <p className="text-2xl font-bold capitalize">{report.summary.fit_level || 'Unknown'}</p>
                  </div>
                )}

                {report.summary?.top_fit_reasons?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Top Match Reasons
                    </h4>
                    <div className="space-y-2">
                      {report.summary.top_fit_reasons.map((reason, idx) => (
                        <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                          <p className="text-sm text-slate-800">{reason.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.flags?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Flags & Concerns
                    </h4>
                    <div className="space-y-2">
                      {report.flags.map((flag, idx) => (
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
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        {shareData?.permissions && (
          <div className="flex flex-wrap gap-3">
            {shareData.permissions.canReevaluate && (
              <Button 
                onClick={handleReEvaluate}
                variant="outline"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-evaluate
              </Button>
            )}
            {shareData.permissions.canSendBack && (
              <Button 
                onClick={handleSendBack}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="w-4 h-4 mr-2" />
                Send Back
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  async function handleReEvaluate() {
    if (!shareData?.proposalId && !shareData?.documentComparisonId) return;

    try {
      toast.info('Running evaluation...');
      
      if (shareData.documentComparisonId) {
        const result = await base44.functions.invoke('EvaluateDocumentComparison', {
          comparison_id: shareData.documentComparisonId
        });
        
        if (!result.data.ok) {
          toast.error(result.data.message || 'Evaluation failed');
          return;
        }
      } else if (shareData.proposalId) {
        const result = await base44.functions.invoke('EvaluateProposalShared', {
          proposal_id: shareData.proposalId
        });
        
        if (result.data.status === 'failed') {
          toast.error(result.data.error_message || 'Evaluation failed');
          return;
        }
      }
      
      toast.success('Evaluation completed');
      loadSharedReport();
    } catch (error) {
      toast.error('Evaluation failed');
      console.error('Re-evaluate error:', error);
    }
  }

  async function handleSendBack() {
    if (!shareData?.proposalId && !shareData?.documentComparisonId) return;
    
    const recipientEmail = prompt('Enter email to send report back to:');
    if (!recipientEmail || !recipientEmail.includes('@')) {
      toast.error('Invalid email address');
      return;
    }

    try {
      toast.info('Sending...');
      
      const result = await base44.functions.invoke('SendReportEmailSafe', {
        proposalId: shareData.proposalId,
        documentComparisonId: shareData.documentComparisonId,
        recipientEmail
      });

      if (result.data.ok) {
        toast.success(`Report sent to ${recipientEmail}`);
      } else {
        toast.error(result.data.message || 'Failed to send');
        alert(`Failed to send:\n\n${result.data.message}\n\nError Code: ${result.data.errorCode}\nCorrelation ID: ${result.data.correlationId}`);
      }
    } catch (error) {
      toast.error('Failed to send report');
      console.error('Send back error:', error);
    }
  }
}