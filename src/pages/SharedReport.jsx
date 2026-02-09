import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, XCircle } from 'lucide-react';

export default function SharedReport() {
  const navigate = useNavigate();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [proposalId, setProposalId] = useState(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const location = useLocation();
  const resolvedTokenRef = useRef(null);

  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('token');
  }, [location.search]);

  const reportTitle = useMemo(() => {
    if (reportData?.title) return reportData.title;
    if (reportData?.type === 'proposal') return 'Shared Proposal Report';
    if (reportData?.type === 'document_comparison') return 'Shared Comparison Report';
    return 'Shared AI Report';
  }, [reportData]);

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
    if (isCheckingAuth || !user) return;
    if (!token) return;
    if (resolvedTokenRef.current === token) return;

    let active = true;
    resolvedTokenRef.current = token;

    const loadSharedReport = async () => {
      try {
        if (active) {
          setIsLoadingReport(true);
          setError('');
          setIsRedirecting(false);
        }

        const result = await base44.functions.invoke('GetSharedReportData', { token });
        const data = result?.data;

        if (!data || typeof data !== 'object' || !data.ok) {
          const correlationId = data?.correlationId ? ` (correlationId: ${data.correlationId})` : '';
          if (active) setError(`${data?.message || 'Invalid or expired share link.'}${correlationId}`);
          return;
        }

        const resolvedShareData = data.shareLink || {};
        const resolvedReportData = data.reportData || {};
        const resolvedProposalId =
          resolvedShareData.proposalId ||
          resolvedReportData.proposalId ||
          resolvedReportData.proposal_id ||
          (resolvedReportData.type === 'proposal' ? resolvedReportData.id : null);

        const context = {
          token,
          proposalId: resolvedProposalId || null,
          role: 'recipient',
          evaluationItemId: resolvedShareData.evaluationItemId || resolvedReportData.evaluationItemId || null,
          documentComparisonId: resolvedShareData.documentComparisonId || resolvedReportData.documentComparisonId || null,
          loadedAt: new Date().toISOString()
        };

        localStorage.setItem('sharedReportContext', JSON.stringify(context));

        if (!active) return;
        setShareData(resolvedShareData);
        setReportData(resolvedReportData);
        setProposalId(resolvedProposalId || null);

        if (!resolvedProposalId) {
          setError('This shared report is valid but is not linked to a proposal.');
          return;
        }

        setIsRedirecting(true);
        const targetUrl = createPageUrl(
          `ProposalDetail?id=${encodeURIComponent(resolvedProposalId)}&sharedToken=${encodeURIComponent(token)}&role=recipient`
        );
        navigate(targetUrl, { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (active) setError(`Failed to resolve shared report: ${message}`);
      } finally {
        if (active) setIsLoadingReport(false);
      }
    };

    loadSharedReport();
    return () => {
      active = false;
    };
  }, [isCheckingAuth, user, token, navigate]);

  const handleSignIn = () => {
    const returnPath = `${location.pathname}${location.search}`;
    base44.auth.redirectToLogin(returnPath);
  };

  const handleOpenProposal = () => {
    if (!proposalId || !token) return;
    const targetUrl = createPageUrl(
      `ProposalDetail?id=${encodeURIComponent(proposalId)}&sharedToken=${encodeURIComponent(token)}&role=recipient`
    );
    navigate(targetUrl);
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

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Missing access token</h1>
            <p className="text-slate-600 mb-6">This link is incomplete. Request a new report link.</p>
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

  if (isLoadingReport) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
            <p className="text-slate-700 font-medium">
              {isRedirecting ? 'Opening proposal...' : 'Loading shared report...'}
            </p>
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
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{reportTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{reportData?.type || 'shared-report'}</Badge>
              <Badge variant="outline">
                Uses: {shareData?.uses ?? 0} / {shareData?.maxUses ?? 25}
              </Badge>
              <Badge variant="outline">
                Expires: {shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}
              </Badge>
            </div>

            <p className="text-sm text-slate-600">
              Signed in as {user?.email || 'authenticated user'}.
            </p>

            <div className="pt-2">
              <Button
                onClick={handleOpenProposal}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!proposalId}
              >
                Open Proposal
              </Button>
            </div>

            {!proposalId && (
              <p className="text-sm text-amber-700">
                This shared report is not linked to a proposal.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
