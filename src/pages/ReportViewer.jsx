import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2, XCircle, AlertTriangle, Lock, Eye, Sparkles,
  CheckCircle2, ArrowLeft, LogIn, UserPlus
} from 'lucide-react';

export default function ReportViewer() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tokenData, setTokenData] = useState(null);
  const [evaluationItem, setEvaluationItem] = useState(null);
  const [evaluationRun, setEvaluationRun] = useState(null);
  const navigate = useNavigate();

  // Extract token from URL: /r/:token
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];

  useEffect(() => {
    const init = async () => {
      try {
        // Check if user is logged in
        const userData = await base44.auth.me().catch(() => null);
        setUser(userData);

        // Resolve token
        const tokenResult = await base44.functions.invoke('ResolveAccessToken', { token });
        
        if (!tokenResult.data.ok) {
          setError(tokenResult.data.message || tokenResult.data.error);
          setLoading(false);
          return;
        }

        const resolvedToken = tokenResult.data;
        setTokenData(resolvedToken);

        // Check email match if logged in
        if (userData && userData.email !== resolvedToken.email) {
          setError('account_mismatch');
          setLoading(false);
          return;
        }

        // Consume token (increment usage)
        await base44.functions.invoke('ConsumeAccessToken', { token });

        // Load evaluation item
        const items = await base44.asServiceRole.entities.EvaluationItem.filter({ 
          id: resolvedToken.evaluationItemId 
        });
        const item = items[0];

        if (!item) {
          setError('Evaluation item not found');
          setLoading(false);
          return;
        }

        setEvaluationItem(item);

        // Load active run if exists
        if (item.active_run_id) {
          const runs = await base44.asServiceRole.entities.EvaluationRun.filter({ 
            id: item.active_run_id 
          });
          setEvaluationRun(runs[0]);
        }

        setLoading(false);

      } catch (err) {
        console.error('Report viewer error:', err);
        setError(err.message || 'Failed to load report');
        setLoading(false);
      }
    };

    init();
  }, [token]);

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

  if (error === 'account_mismatch') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Account Mismatch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              This report was sent to <strong>{tokenData?.email}</strong>, but you're logged in as <strong>{user?.email}</strong>.
            </p>
            <div className="space-y-2">
              <Button 
                className="w-full"
                onClick={() => {
                  base44.auth.logout();
                  window.location.reload();
                }}
              >
                Switch to {tokenData?.email}
              </Button>
              <Button 
                variant="outline"
                className="w-full"
                onClick={() => {
                  setError(null);
                  setUser(null);
                }}
              >
                Continue as Guest
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Access Error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">{error}</p>
            <Button 
              variant="outline"
              onClick={() => navigate(createPageUrl('Landing'))}
              className="w-full"
            >
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Welcome to Your Report</CardTitle>
            <CardDescription>
              You've been sent: <strong>{evaluationItem?.title}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              To view and respond to this report, you can:
            </p>
            <div className="space-y-2">
              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => base44.auth.redirectToLogin(`/r/${token}`)}
              >
                <LogIn className="w-4 h-4 mr-2" />
                Log In ({tokenData?.email})
              </Button>
              <Button 
                variant="outline"
                className="w-full"
                onClick={() => base44.auth.redirectToLogin(`/r/${token}`)}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Account
              </Button>
            </div>
            <div className="pt-3 border-t">
              <Button 
                variant="ghost"
                size="sm"
                className="w-full text-slate-500"
                onClick={() => {
                  setUser({ guest: true, email: tokenData?.email });
                }}
              >
                Continue as Guest (limited access)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render report based on type
  const renderReport = () => {
    if (!evaluationItem) return null;

    // Document Comparison
    if (evaluationItem.type === 'document_comparison') {
      if (!evaluationItem.linked_document_comparison_id) {
        return <p className="text-slate-500">No linked comparison found.</p>;
      }
      
      return (
        <div className="space-y-4">
          <Alert>
            <Sparkles className="w-4 h-4" />
            <AlertDescription>
              This is a document comparison report. {tokenData?.role === 'party_a' ? 'You created this comparison.' : 'You received this comparison.'}
            </AlertDescription>
          </Alert>
          <Button 
            onClick={() => navigate(createPageUrl(`DocumentComparisonDetail?id=${evaluationItem.linked_document_comparison_id}`))}
            className="w-full"
          >
            View Full Comparison
          </Button>
        </div>
      );
    }

    // Proposal
    if (evaluationItem.type === 'proposal') {
      if (!evaluationItem.linked_proposal_id) {
        return <p className="text-slate-500">No linked proposal found.</p>;
      }
      
      return (
        <div className="space-y-4">
          <Alert>
            <Sparkles className="w-4 h-4" />
            <AlertDescription>
              This is a proposal evaluation. {tokenData?.role === 'party_a' ? 'You created this proposal.' : 'You received this proposal.'}
            </AlertDescription>
          </Alert>
          <Button 
            onClick={() => navigate(createPageUrl(`ProposalDetail?id=${evaluationItem.linked_proposal_id}`))}
            className="w-full"
          >
            View Full Proposal
          </Button>
        </div>
      );
    }

    // Profile Matching
    if (evaluationItem.type === 'profile_matching') {
      return (
        <div className="space-y-4">
          <Alert>
            <Sparkles className="w-4 h-4" />
            <AlertDescription>
              This is a profile matching evaluation.
            </AlertDescription>
          </Alert>
          {evaluationRun?.public_report_json && (
            <Card>
              <CardHeader>
                <CardTitle>Match Report</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm bg-slate-50 p-4 rounded-lg overflow-auto">
                  {JSON.stringify(evaluationRun.public_report_json, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      );
    }

    return <p className="text-slate-500">Unknown evaluation type: {evaluationItem.type}</p>;
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link to={createPageUrl('Dashboard')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
          
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                {evaluationItem?.title}
              </h1>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-700">
                  {evaluationItem?.type?.replace('_', ' ')}
                </Badge>
                <Badge variant="outline">
                  Viewing as: {tokenData?.role === 'party_a' ? 'Party A' : 'Party B'}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {renderReport()}

        <div className="mt-6">
          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="py-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Lock className="w-4 h-4" />
                  <span>Secure access link</span>
                </div>
                <div className="text-slate-500">
                  Used {tokenData?.usedCount || 0} / {tokenData?.maxUses || 20} times
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}