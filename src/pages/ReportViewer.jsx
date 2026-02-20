import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { FileText, AlertTriangle, ExternalLink } from 'lucide-react';

function useToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('token') || '';
  }, [location.search]);
}

export default function ReportViewer() {
  const tokenFromQuery = useToken();
  const [tokenInput, setTokenInput] = useState(tokenFromQuery);

  const {
    data: payload,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['report-viewer', tokenFromQuery],
    enabled: Boolean(tokenFromQuery),
    queryFn: () => sharedLinksClient.getByToken(tokenFromQuery, { consume: false, includeDetails: true }),
  });

  const openPath = tokenInput
    ? createPageUrl(`SharedReport?token=${encodeURIComponent(tokenInput)}`)
    : createPageUrl('SharedReport');

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Report Viewer
            </CardTitle>
            <CardDescription>Open a tokenized shared report using the baseline route contract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Shared Token</Label>
              <Input
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="paste shared token"
              />
            </div>
            <Link to={openPath}>
              <Button>
                Open Shared Report
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {tokenFromQuery ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Token Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? <p className="text-sm text-slate-500">Loading token details...</p> : null}
              {error ? (
                <Alert className="bg-red-50 border-red-200">
                  <AlertTriangle className="h-4 w-4 text-red-700" />
                  <AlertDescription className="text-red-800">{error.message}</AlertDescription>
                </Alert>
              ) : null}
              {payload?.sharedLink ? (
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                  <p className="text-sm font-medium text-slate-900">
                    {payload.sharedLink.proposal?.title || 'Shared proposal'}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-blue-100 text-blue-700">
                      {payload.sharedLink.status || 'active'}
                    </Badge>
                    <Badge variant="outline">
                      Uses {payload.sharedLink.uses || 0}/{payload.sharedLink.maxUses || 0}
                    </Badge>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
