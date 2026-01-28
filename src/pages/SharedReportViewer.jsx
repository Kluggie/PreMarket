import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Sparkles, CheckCircle2, AlertTriangle, Shield, Lock, Edit,
  Send, Loader2, RefreshCw, FileText, Mail
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function SharedReportViewer() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validationData, setValidationData] = useState(null);
  const [error, setError] = useState(null);
  const [sendBackEmail, setSendBackEmail] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const navigate = useNavigate();

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const shareLinkId = window.location.pathname.split('/').pop();

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (e) {
        setUser(null);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    const validateLink = async () => {
      if (!token) {
        setError('Invalid link: No token provided');
        setLoading(false);
        return;
      }

      try {
        const result = await base44.functions.invoke('ValidateShareLink', { token });
        
        if (!result.data.ok) {
          setError(result.data.message || 'Invalid or expired link');
          setLoading(false);
          return;
        }

        setValidationData(result.data);
        
        // Pre-fill send-back email with original sender
        if (result.data.evaluationItem?.party_a_email) {
          setSendBackEmail(result.data.evaluationItem.party_a_email);
        }
        
        setLoading(false);
      } catch (error) {
        setError('Failed to validate link');
        setLoading(false);
      }
    };

    validateLink();
  }, [token]);

  const handleEditMyResponse = () => {
    const evalItem = validationData.evaluationItem;
    
    // Check if user is logged in and matches recipient email
    if (!user) {
      toast.error('Please sign in to edit your response');
      base44.auth.redirectToLogin(window.location.href);
      return;
    }

    if (user.email !== validationData.shareLink.recipient_email) {
      toast.error('This link is for a different email address');
      return;
    }

    // Navigate to appropriate edit page based on type
    if (evalItem.type === 'document_comparison' && evalItem.linked_document_comparison_id) {
      navigate(createPageUrl(`DocumentComparisonCreate?draft=${evalItem.linked_document_comparison_id}&mode=recipient`));
    } else if (evalItem.type === 'proposal' && evalItem.linked_proposal_id) {
      navigate(createPageUrl(`CreateProposalWithDrafts?draft=${evalItem.linked_proposal_id}&mode=recipient`));
    } else {
      toast.error('Editing not available for this evaluation type');
    }
  };

  const handleReRunEvaluation = async () => {
    const evalItem = validationData.evaluationItem;
    
    try {
      let result;
      
      if (evalItem.type === 'document_comparison') {
        result = await base44.functions.invoke('EvaluateDocumentComparison', {
          comparison_id: evalItem.linked_document_comparison_id
        });
      } else if (evalItem.type === 'proposal') {
        result = await base44.functions.invoke('RunEvaluation', {
          proposalId: evalItem.linked_proposal_id
        });
      } else {
        toast.error('Evaluation not available for this type');
        return;
      }

      if (!result.data.ok) {
        toast.error(result.data.message || 'Evaluation failed');
        return;
      }

      toast.success('Evaluation completed');
      
      // Refresh validation data
      const refreshResult = await base44.functions.invoke('ValidateShareLink', { token });
      if (refreshResult.data.ok) {
        setValidationData(refreshResult.data);
      }
    } catch (error) {
      toast.error('Failed to re-run evaluation');
      console.error(error);
    }
  };

  const handleSendBack = async () => {
    if (!sendBackEmail || !sendBackEmail.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    const evalItem = validationData.evaluationItem;
    const currentRevision = evalItem.revision_number || 0;
    const maxRevisions = evalItem.max_revisions || 5;

    if (currentRevision >= maxRevisions) {
      toast.error(`Maximum revision limit (${maxRevisions}) reached`);
      return;
    }

    setSendingBack(true);
    try {
      // Send report back (backend will increment revision)
      const result = await base44.functions.invoke('SendReportEmail', {
        evaluationItemId: evalItem.id,
        recipientEmail: sendBackEmail
      });

      if (!result.data.ok) {
        const errorMsg = result.data.message || 'Failed to send report';
        const corrId = result.data.correlationId ? `\n\nCorrelation ID: ${result.data.correlationId}` : '';
        toast.error(errorMsg);
        alert(`${errorMsg}${corrId}`);
        return;
      }

      toast.success(`Report sent to ${sendBackEmail}`);
      setSendBackEmail('');
      
      // Refresh validation data
      const refreshResult = await base44.functions.invoke('ValidateShareLink', { token });
      if (refreshResult.data.ok) {
        setValidationData(refreshResult.data);
      }
    } catch (error) {
      toast.error('Failed to send report back');
      console.error(error);
      alert(`Failed to send report:\n\n${error.message}`);
    } finally {
      setSendingBack(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Link Error</h3>
            <p className="text-slate-500 mb-6">{error}</p>
            <Button onClick={() => navigate(createPageUrl('Landing'))}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { shareLink, evaluationItem, latestRun, linkedData } = validationData;
  const report = latestRun?.public_report_json;
  const hasReport = latestRun?.status === 'completed' && report;
  const revisionNumber = evaluationItem.revision_number || 0;
  const maxRevisions = evaluationItem.max_revisions || 5;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{evaluationItem.title}</h1>
              <p className="text-slate-500 text-sm mt-1">
                Shared {evaluationItem.type.replace('_', ' ')} • 
                Revision {revisionNumber} of {maxRevisions}
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-700">
              Uses: {shareLink.uses}/{shareLink.max_uses}
            </Badge>
          </div>

          {/* Actions Bar */}
          <div className="flex flex-wrap gap-2 mb-6">
            <Button 
              variant="outline" 
              onClick={handleEditMyResponse}
              disabled={!user || user.email !== shareLink.recipient_email}
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit My Response
            </Button>
            <Button 
              variant="outline"
              onClick={handleReRunEvaluation}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-run Evaluation
            </Button>
          </div>

          {!user && (
            <Alert className="mb-6">
              <AlertDescription>
                <strong>Guest viewing mode.</strong> Sign in to save changes or create an account to persist your edits.
                <Button 
                  variant="link" 
                  className="ml-2 h-auto p-0"
                  onClick={() => base44.auth.redirectToLogin(window.location.href)}
                >
                  Sign In
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Report Content */}
        {!hasReport && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No report available</h3>
              <p className="text-slate-500">Run evaluation to generate a report.</p>
            </CardContent>
          </Card>
        )}

        {hasReport && (
          <div className="space-y-6">
            {/* Summary */}
            <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-blue-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Evaluation Report
                </CardTitle>
                <CardDescription>
                  AI-generated analysis respecting confidentiality settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                {report.summary && (
                  <div className="space-y-4">
                    {report.summary.match_level && (
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Match Level</p>
                        <p className="text-2xl font-bold capitalize">{report.summary.match_level}</p>
                      </div>
                    )}
                    {report.summary.match_score_0_100 !== null && report.summary.match_score_0_100 !== undefined && (
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Match Score</p>
                        <p className="text-2xl font-bold">{Math.round(report.summary.match_score_0_100)}%</p>
                      </div>
                    )}
                    {report.summary.rationale && (
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-700">{report.summary.rationale}</p>
                      </div>
                    )}
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

            {/* Send Back Card */}
            <Card className="border-0 shadow-sm bg-blue-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  Send Report Back
                </CardTitle>
                <CardDescription>
                  Share your updated evaluation with the original sender
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {revisionNumber >= maxRevisions && (
                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      Maximum revision limit ({maxRevisions}) reached. No more send-backs allowed.
                    </AlertDescription>
                  </Alert>
                )}
                {revisionNumber < maxRevisions && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="sendback-email">Recipient Email</Label>
                      <Input
                        id="sendback-email"
                        type="email"
                        placeholder="recipient@example.com"
                        value={sendBackEmail}
                        onChange={(e) => setSendBackEmail(e.target.value)}
                        disabled={sendingBack}
                      />
                    </div>
                    <Button 
                      onClick={handleSendBack}
                      disabled={sendingBack || !sendBackEmail}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {sendingBack ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send Back
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Privacy Notice */}
            {report.depends_on_confidential && (
              <Alert className="border-amber-200 bg-amber-50">
                <Shield className="w-4 h-4" />
                <AlertDescription>
                  This report is based on confidential information but does not reveal any confidential content.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Link Info Footer */}
        <div className="mt-8 p-4 bg-slate-100 rounded-lg text-xs text-slate-600 text-center">
          <p>Secure access link • Uses: {shareLink?.uses || 0}/{shareLink?.max_uses || 25}</p>
        </div>
      </div>
    </div>
  );
}