import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createPageUrl } from '@/utils';
import { sharedLinksClient } from '@/api/sharedLinksClient';

function useToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('token') || '';
  }, [location.search]);
}

export default function SharedReportDb() {
  const token = useToken();
  const navigate = useNavigate();

  const { data: sharedLink, isLoading, error } = useQuery({
    queryKey: ['db-shared-link', token],
    enabled: Boolean(token),
    queryFn: () => sharedLinksClient.getByToken(token, { consume: true }),
  });

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Shared Report</h1>
            <p className="text-sm text-slate-500">Token-based read for shared opportunity metadata.</p>
          </div>
          <Button variant="outline" onClick={() => navigate(createPageUrl('Opportunities'))}>
            Back to Opportunities
          </Button>
        </div>

        {!token && (
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-slate-600">Missing token in URL.</p>
            </CardContent>
          </Card>
        )}

        {token && isLoading && (
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-slate-600">Loading shared link...</p>
            </CardContent>
          </Card>
        )}

        {token && error && (
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-red-600">{error.message}</p>
            </CardContent>
          </Card>
        )}

        {sharedLink && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>{sharedLink.proposal?.title || 'Shared opportunity'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Status: {sharedLink.status}</p>
              <p className="text-sm text-slate-600">Uses: {sharedLink.uses} / {sharedLink.maxUses}</p>
              <p className="text-sm text-slate-600">Recipient: {sharedLink.recipientEmail || 'Any recipient'}</p>
              <p className="text-sm text-slate-600">Expires: {sharedLink.expiresAt ? new Date(sharedLink.expiresAt).toLocaleString() : 'Never'}</p>
              <div className="p-3 rounded-lg bg-slate-100">
                <p className="text-xs text-slate-500">Metadata</p>
                <pre className="text-xs text-slate-700 overflow-auto">
                  {JSON.stringify(sharedLink.reportMetadata || {}, null, 2)}
                </pre>
              </div>
              {sharedLink.proposal?.id && (
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl(`OpportunityDetail?id=${encodeURIComponent(sharedLink.proposal.id)}`))}
                >
                  View Opportunity
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
