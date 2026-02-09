import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, XCircle } from 'lucide-react';

const FRIENDLY_ERROR_MESSAGES = {
  TOKEN_NOT_FOUND: 'This shared link is invalid or no longer exists.',
  TOKEN_EXPIRED: 'This shared link has expired. Request a new link.',
  MAX_VIEWS_REACHED: 'This shared link has reached its maximum number of views.',
  RECIPIENT_MISMATCH: 'This link belongs to a different recipient account.',
  TOKEN_INACTIVE: 'This shared link is inactive.',
  PROPOSAL_NOT_FOUND: 'The linked proposal could not be found.',
  PROPOSAL_LINK_MISSING: 'This shared link is not connected to a proposal.',
  VIEW_NOT_ALLOWED: 'Viewing is disabled for this link.'
};

function buildErrorMeta(error) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    null;
  const responseBody =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;
  const reasonCode =
    responseBody?.code ||
    responseBody?.reason ||
    responseBody?.errorCode ||
    error?.code ||
    'INVOKE_ERROR';

  return {
    statusCode,
    reasonCode,
    responseBody,
    message:
      responseBody?.message ||
      error?.message ||
      'Failed to resolve shared report'
  };
}

async function invokeSharedResolver(token) {
  try {
    return await base44.functions.invoke('ResolveSharedReport', { token });
  } catch (error) {
    const meta = buildErrorMeta(error);
    const missingResolver =
      meta.statusCode === 404 &&
      (!meta.responseBody || (!meta.responseBody.code && !meta.responseBody.reason));

    if (!missingResolver) {
      throw error;
    }

    return base44.functions.invoke('GetSharedReportData', { token });
  }
}

export default function SharedReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [proposalId, setProposalId] = useState(null);
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
    base44.auth.me()
      .then((me) => {
        if (active) setUser(me || null);
      })
      .catch(() => {
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    if (resolvedTokenRef.current === token) return;

    let active = true;
    resolvedTokenRef.current = token;

    const loadSharedReport = async () => {
      try {
        if (active) {
          setIsLoadingReport(true);
          setError(null);
        }

        const result = await invokeSharedResolver(token);
        const data = result?.data;

        if (!data || typeof data !== 'object' || !data.ok) {
          const reasonCode = data?.code || data?.reason || 'RESOLVE_FAILED';
          const statusCode = result?.status || null;
          const friendly = FRIENDLY_ERROR_MESSAGES[reasonCode] || data?.message || 'Unable to resolve shared link.';
          const errorMeta = {
            message: friendly,
            reasonCode,
            statusCode,
            correlationId: data?.correlationId || null,
            responseBody: data || null
          };
          console.error('[SharedReport] Resolve failed', {
            apiCall: {
              functionName: 'ResolveSharedReport',
              method: 'POST',
              payload: { token }
            },
            statusCode,
            reasonCode,
            responseBody: data
          });
          if (active) setError(errorMeta);
          return;
        }

        const resolvedShareData = data.shareLink || {};
        const resolvedReportData = data.reportData || {};
        const resolvedProposalId =
          data.proposalId ||
          resolvedShareData.proposalId ||
          resolvedReportData.proposalId ||
          resolvedReportData.proposal_id ||
          (resolvedReportData.type === 'proposal' ? resolvedReportData.id : null);

        const context = {
          token,
          proposalId: resolvedProposalId || null,
          role: 'recipient',
          evaluationItemId: data.evaluationId || resolvedShareData.evaluationItemId || resolvedReportData.evaluationItemId || null,
          documentComparisonId: resolvedShareData.documentComparisonId || resolvedReportData.documentComparisonId || null,
          loadedAt: new Date().toISOString()
        };

        localStorage.setItem('sharedReportContext', JSON.stringify(context));

        if (!active) return;
        setShareData(resolvedShareData);
        setReportData(resolvedReportData);
        setProposalId(resolvedProposalId || null);

        if (!resolvedProposalId) {
          setError({
            message: 'This shared report is valid but is not linked to a proposal.',
            reasonCode: 'PROPOSAL_LINK_MISSING',
            statusCode: 404,
            correlationId: data?.correlationId || null,
            responseBody: data
          });
          return;
        }
      } catch (invokeError) {
        const invokeMeta = buildErrorMeta(invokeError);
        console.error('[SharedReport] Resolve threw', {
          apiCall: {
            functionName: 'ResolveSharedReport',
            method: 'POST',
            payload: { token }
          },
          statusCode: invokeMeta.statusCode,
          reasonCode: invokeMeta.reasonCode,
          responseBody: invokeMeta.responseBody
        });

        if (active) {
          setError({
            message: FRIENDLY_ERROR_MESSAGES[invokeMeta.reasonCode] || invokeMeta.message,
            reasonCode: invokeMeta.reasonCode,
            statusCode: invokeMeta.statusCode,
            correlationId: invokeMeta.responseBody?.correlationId || null,
            responseBody: invokeMeta.responseBody || null
          });
        }
      } finally {
        if (active) setIsLoadingReport(false);
      }
    };

    loadSharedReport();
    return () => {
      active = false;
    };
  }, [token]);

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

  if (isLoadingReport) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
            <p className="text-slate-700 font-medium">Loading shared report...</p>
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
            <p className="text-slate-600 mb-2">{error.message}</p>
            {error.reasonCode && (
              <p className="text-xs text-slate-500 mb-1">Reason: {error.reasonCode}</p>
            )}
            {error.statusCode && (
              <p className="text-xs text-slate-500 mb-1">HTTP: {error.statusCode}</p>
            )}
            {error.correlationId && (
              <p className="text-xs text-slate-500 mb-6">Correlation ID: {error.correlationId}</p>
            )}
            {!user && (
              <Button onClick={handleSignIn} className="bg-blue-600 hover:bg-blue-700 mr-2">
                Sign In
              </Button>
            )}
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
                Views: {shareData?.viewCount ?? shareData?.uses ?? 0} / {shareData?.maxViews ?? shareData?.maxUses ?? 25}
              </Badge>
              <Badge variant="outline">
                Expires: {shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}
              </Badge>
            </div>

            <p className="text-sm text-slate-600">
              {user?.email ? `Signed in as ${user.email}.` : 'Viewing as guest.'}
            </p>

            <div
              className={`rounded-lg border p-4 ${proposalId ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50'}`}
              onClick={proposalId ? handleOpenProposal : undefined}
              onKeyDown={(event) => {
                if (!proposalId) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleOpenProposal();
                }
              }}
              role={proposalId ? 'button' : undefined}
              tabIndex={proposalId ? 0 : -1}
            >
              <p className="text-lg font-semibold text-slate-900">{reportTitle}</p>
              <p className="text-sm text-slate-600 mt-1">
                Type: {reportData?.type || 'unknown'}{' '}
                {reportData?.created_date ? `| Created: ${new Date(reportData.created_date).toLocaleDateString()}` : ''}
              </p>
            </div>

            <div className="pt-2 space-x-2">
              <Button
                onClick={handleOpenProposal}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!proposalId}
              >
                Open Shared Workspace
              </Button>
              {!user && (
                <Button variant="outline" onClick={handleSignIn}>
                  Sign In for Re-evaluation
                </Button>
              )}
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
