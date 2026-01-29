import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, XCircle, AlertTriangle, Sparkles, CheckCircle2, Lock } from 'lucide-react';

export default function SharedReportPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [shareData, setShareData] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  useEffect(() => {
    if (!token) {
      setError('Missing token');
      setLoading(false);
      return;
    }

    loadReport();
  }, [token]);

  const loadReport = async () => {
    try {
      setLoading(true);
      const result = await base44.functions.invoke('GetSharedReportData', { token });
      
      if (!result.data.ok) {
        setError(result.data.message || 'Invalid or expired link');
        setLoading(false);
        return;
      }

      setShareData(result.data.shareLink);
      setReportData(result.data.reportData);
      setLoading(false);
    } catch (err) {
      console.error('Load report error:', err);
      setError('Failed to load report');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Loading report...</h3>
            <p className="text-slate-500">Verifying access...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Missing Access Token</h3>
            <p className="text-slate-500 mb-6">This link is incomplete. Please request a new share link.</p>
            <Button onClick={() => window.location.href = '/'}>
              Go to Home
            </Button>
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Invalid or Expired Link</h3>
            <p className="text-slate-500 mb-6">{error}</p>
            <Button onClick={() => window.location.href = '/'}>
              Go to Home
            </Button>
          </CardContent>
          <div className="px-6 pb-4 pt-2 border-t border-slate-100 text-xs text-slate-400 text-center">
            <p>Build: {new Date().toISOString()}</p>
            <p>Env: {typeof window !== 'undefined' ? window.location.origin : 'unknown'}</p>
          </div>
        </Card>
      </div>
    );
  }

  const report = reportData?.report;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Alert className="mb-6 bg-blue-50 border-blue-200">
          <Lock className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            Viewing shared report - Token: {token.substring(0, 8)}...
          </AlertDescription>
        </Alert>

        {/* Link Stats */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Uses: {shareData?.uses || 0} / {shareData?.maxUses || 25}
              </span>
              <span className="text-slate-600">
                Expires: {shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Report Content */}
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              {reportData?.title || 'Shared Report'}
            </CardTitle>
            <p className="text-sm text-slate-500">
              Type: {reportData?.type || 'unknown'} | Created: {reportData?.created_date ? new Date(reportData.created_date).toLocaleDateString() : 'N/A'}
            </p>
          </CardHeader>
          <CardContent>
            {report ? (
              <div className="space-y-4">
                {report.summary && (
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600">Overall Assessment</p>
                    <p className="text-2xl font-bold capitalize">
                      {report.summary.match_level || report.summary.fit_level || 'N/A'}
                    </p>
                    {report.summary.rationale && (
                      <p className="text-sm text-slate-700 mt-2">{report.summary.rationale}</p>
                    )}
                  </div>
                )}

                {report.alignment_points?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Strengths
                    </h4>
                    <div className="space-y-2">
                      {report.alignment_points.map((point, idx) => (
                        <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                          <p className="text-sm font-medium">{point.title || point.text}</p>
                          {point.detail && <p className="text-sm text-slate-700 mt-1">{point.detail}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(report.conflicts_or_gaps?.length > 0 || report.flags?.length > 0) && (
                  <div>
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Concerns
                    </h4>
                    <div className="space-y-2">
                      {(report.conflicts_or_gaps || report.flags || []).map((item, idx) => (
                        <div key={idx} className={`p-3 rounded-lg border ${
                          item.severity === 'high' ? 'bg-red-50 border-red-200' :
                          item.severity === 'medium' || item.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                          'bg-blue-50 border-blue-200'
                        }`}>
                          <div className="flex items-start gap-2">
                            <Badge className={
                              item.severity === 'high' ? 'bg-red-600' :
                              item.severity === 'medium' || item.severity === 'med' ? 'bg-amber-600' :
                              'bg-blue-600'
                            }>
                              {item.severity}
                            </Badge>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{item.title}</p>
                              {item.detail && <p className="text-sm text-slate-600 mt-1">{item.detail}</p>}
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

        {/* Debug Footer */}
        <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 text-center space-y-1">
          <p>APP_BASE_URL: {typeof process !== 'undefined' && process.env?.APP_BASE_URL ? process.env.APP_BASE_URL : 'https://getpremarket.com'}</p>
          <p>Build timestamp: {new Date().toISOString()}</p>
          <p>Route: /shared-report</p>
        </div>
      </div>
    </div>
  );
}