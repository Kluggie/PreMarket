import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, XCircle } from 'lucide-react';

export default function SharedReport() {
  const navigate = useNavigate();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  useEffect(() => {
    let active = true;

    const checkAuth = async () => {
      try {
        const me = await base44.auth.me();
        if (active) {
          setUser(me || null);
        }
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setIsCheckingAuth(false);
        }
      }
    };

    checkAuth();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isCheckingAuth || !user) {
      return;
    }

    const resolveSharedToken = async () => {
      if (!token) {
        setError('Missing access token in URL.');
        return;
      }

      try {
        setIsResolving(true);
        setError('');

        const result = await base44.functions.invoke('GetSharedReportData', { token });
        const data = result?.data;

        if (!data || typeof data !== 'object' || !data.ok) {
          const correlationId = data?.correlationId ? ` (correlationId: ${data.correlationId})` : '';
          setError(`${data?.message || 'Invalid or expired share link.'}${correlationId}`);
          return;
        }

        const shareLink = data.shareLink || {};
        const reportData = data.reportData || {};

        const proposalId =
          shareLink.proposalId ||
          reportData.proposalId ||
          reportData.proposal_id ||
          (reportData.type === 'proposal' ? reportData.id : null);

        if (!proposalId) {
          setError('This shared report is valid but is not linked to a proposal.');
          return;
        }

        const context = {
          token,
          proposalId,
          role: 'recipient',
          evaluationItemId: shareLink.evaluationItemId || reportData.evaluationItemId || null,
          documentComparisonId: shareLink.documentComparisonId || reportData.documentComparisonId || null,
          loadedAt: new Date().toISOString()
        };

        localStorage.setItem('sharedReportContext', JSON.stringify(context));

        const targetUrl = createPageUrl(
          `ProposalDetail?id=${encodeURIComponent(proposalId)}&sharedToken=${encodeURIComponent(token)}&role=recipient`
        );
        navigate(targetUrl, { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to resolve shared report: ${message}`);
      } finally {
        setIsResolving(false);
      }
    };

    resolveSharedToken();
  }, [isCheckingAuth, user, token, navigate]);

  const handleSignIn = () => {
    const returnPath = `${window.location.pathname}${window.location.search}`;
    base44.auth.redirectToLogin(returnPath);
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
            <p className="text-slate-700 font-medium">Checking access...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Lock className="w-10 h-10 text-blue-600 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Please sign in to view this report</h1>
            <p className="text-slate-600 mb-6">You need to sign in before we can open the shared AI report.</p>
            <Button onClick={handleSignIn} className="bg-blue-600 hover:bg-blue-700">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Unable to open shared report</h1>
            <p className="text-slate-600 mb-6">{error}</p>
            <Button variant="outline" onClick={() => navigate(createPageUrl('Dashboard'))}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 shadow-sm">
        <CardContent className="py-12 text-center">
          <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
          <p className="text-slate-700 font-medium">
            {isResolving ? 'Opening shared report...' : 'Preparing redirect...'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
