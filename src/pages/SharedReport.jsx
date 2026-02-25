import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function getTokenFromRoute(paramsToken, locationSearch) {
  const pathToken = asText(paramsToken);
  if (pathToken) {
    return pathToken;
  }

  const search = new URLSearchParams(locationSearch || '');
  return asText(search.get('token'));
}

function renderReadOnly({ text, html }) {
  const safeText = String(text || '').trim();
  const safeHtml = asText(html);

  if (!safeText && !safeHtml) {
    return <p className="text-sm text-slate-500 italic">No shared report content available.</p>;
  }

  if (safeHtml) {
    return (
      <div
        className="text-sm text-slate-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return <div className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">{safeText}</div>;
}

export default function SharedReport() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(
    () => getTokenFromRoute(params.token, location.search),
    [params.token, location.search],
  );

  const [responderEmail, setResponderEmail] = useState('');
  const [responseMessage, setResponseMessage] = useState('');

  const {
    data: payload,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['shared-report-public', token],
    enabled: Boolean(token),
    queryFn: () => sharedReportsClient.getByToken(token),
  });

  const sharedReport = payload?.sharedReport || null;

  const respondMutation = useMutation({
    mutationFn: () =>
      sharedReportsClient.respond(token, {
        responderEmail: asText(responderEmail) || null,
        message: asText(responseMessage) || null,
      }),
    onSuccess: () => {
      setResponseMessage('');
      toast.success('Response sent');
      refetch();
    },
    onError: (mutationError) => {
      toast.error(mutationError?.message || 'Unable to submit response');
    },
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing shared report token.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600 mx-auto mb-4" />
              <p className="text-slate-700">Loading shared report...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !sharedReport) {
    const code = asText(error?.code);
    const title =
      code === 'token_expired'
        ? 'This link has expired'
        : code === 'token_inactive'
          ? 'This link has been revoked'
          : code === 'max_uses_reached'
            ? 'This link is no longer available'
            : 'Shared report unavailable';

    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{title}</AlertDescription>
          </Alert>
          <p className="text-sm text-slate-600">{error?.message || 'Unable to open shared report.'}</p>
        </div>
      </div>
    );
  }

  const sharedContent = sharedReport.shared_content || {};
  const aiReport = sharedReport.ai_report || {};
  const aiSections = Array.isArray(aiReport.sections) ? aiReport.sections : [];
  const recommendation = asText(aiReport.recommendation) || 'unknown fit';

  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(createPageUrl('Proposals'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-100 text-blue-700">Shared Report</Badge>
            <Badge variant="outline">Opened {Number(sharedReport.uses || 0)} times</Badge>
          </div>
        </div>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>{sharedReport.title || 'Shared Report'}</CardTitle>
            <CardDescription>
              Status: {sharedReport.status || 'active'} • Expires: {formatDateTime(sharedReport.expires_at)}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>{sharedContent.label || 'Shared Information'}</CardTitle>
          </CardHeader>
          <CardContent>
            {renderReadOnly({
              text: sharedContent.text || '',
              html: sharedContent.html || '',
            })}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>AI Report</CardTitle>
            <CardDescription>
              Recommendation: <span className="capitalize">{recommendation}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {asText(aiReport.executive_summary) ? (
              <p className="text-slate-700">{aiReport.executive_summary}</p>
            ) : null}

            {aiSections.length > 0 ? (
              <div className="space-y-4">
                {aiSections.map((section, index) => (
                  <div
                    key={`${section.key || section.heading || 'section'}-${index}`}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <p className="font-semibold text-slate-900 mb-2">
                      {section.heading || section.key || `Section ${index + 1}`}
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-slate-700">
                      {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                        <li key={`${index}-${lineIndex}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No AI report details are available yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Send Response</CardTitle>
            <CardDescription>Share optional feedback with the report owner.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="response-email">Email (optional)</Label>
              <Input
                id="response-email"
                type="email"
                placeholder="recipient@example.com"
                value={responderEmail}
                onChange={(event) => setResponderEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="response-message">Message</Label>
              <Textarea
                id="response-message"
                rows={4}
                placeholder="Add your response..."
                value={responseMessage}
                onChange={(event) => setResponseMessage(event.target.value)}
              />
            </div>

            {respondMutation.data ? (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-700" />
                <AlertDescription className="text-green-800">
                  Response saved ({respondMutation.data.savedResponses} entries).
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              onClick={() => respondMutation.mutate()}
              disabled={respondMutation.isPending || !asText(responseMessage)}
            >
              <Send className="w-4 h-4 mr-2" />
              {respondMutation.isPending ? 'Sending...' : 'Submit response'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
