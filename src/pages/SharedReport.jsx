import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getTokenFromRoute(paramsToken, locationSearch) {
  const pathToken = asText(paramsToken);
  if (pathToken) return pathToken;
  const search = new URLSearchParams(locationSearch || '');
  return asText(search.get('token'));
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function parseJsonObject(value, fieldLabel) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || '{}'));
  } catch {
    throw new Error(`${fieldLabel} must be valid JSON`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} must be a JSON object`);
  }

  return parsed;
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function toStatusBadge(status) {
  const normalized = asText(status).toLowerCase();
  if (normalized === 'active') {
    return { label: 'Active', className: 'bg-green-100 text-green-700 border-green-200' };
  }
  if (normalized === 'revoked' || normalized === 'inactive') {
    return { label: 'Revoked', className: 'bg-red-100 text-red-700 border-red-200' };
  }
  if (normalized === 'expired') {
    return { label: 'Expired', className: 'bg-amber-100 text-amber-700 border-amber-200' };
  }
  return { label: normalized || 'Unknown', className: 'bg-slate-100 text-slate-700 border-slate-200' };
}

function toFriendlyLoadError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This shared link has expired.';
  if (code === 'token_inactive') return 'This shared link has been revoked.';
  if (code === 'max_uses_reached') return 'This shared link has reached its view limit.';
  if (code === 'token_not_found') return 'This shared link is invalid.';
  if (code === 'request_timeout') return 'Loading timed out. Please refresh and try again.';
  return error?.message || 'Unable to load this shared report.';
}

function toFriendlySaveError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This link has expired. Draft cannot be saved.';
  if (code === 'token_inactive') return 'This link is no longer active.';
  if (code === 'edit_not_allowed') return 'You do not have permission to edit Shared Information.';
  if (code === 'confidential_edit_not_allowed') {
    return 'You do not have permission to edit Confidential Information.';
  }
  if (code === 'payload_too_large') return 'Draft is too large to save.';
  return error?.message || 'Unable to save draft.';
}

function renderAiReport(report) {
  const recommendation = asText(report?.recommendation);
  const executiveSummary = asText(report?.executive_summary);
  const sections = Array.isArray(report?.sections) ? report.sections : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Read-only</Badge>
        {recommendation ? (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 capitalize">{recommendation}</Badge>
        ) : null}
      </div>
      {executiveSummary ? <p className="text-sm text-slate-700">{executiveSummary}</p> : null}
      {sections.length > 0 ? (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div key={`${section?.heading || section?.key || 'section'}-${index}`} className="rounded-lg border p-3">
              <p className="font-semibold text-sm text-slate-900 mb-2">
                {section?.heading || section?.key || `Section ${index + 1}`}
              </p>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                {(Array.isArray(section?.bullets) ? section.bullets : []).map((line, lineIndex) => (
                  <li key={`${index}-${lineIndex}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No report sections available.</p>
      )}
    </div>
  );
}

async function fetchWorkspaceWithTimeout(token, timeoutMs = 15000) {
  let timeoutId = null;

  try {
    return await Promise.race([
      sharedReportsClient.getRecipientWorkspace(token),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error('Loading timed out');
          timeoutError.code = 'request_timeout';
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export default function SharedReport() {
  const params = useParams();
  const location = useLocation();
  const token = useMemo(
    () => getTokenFromRoute(params.token, location.search),
    [params.token, location.search],
  );
  const [sharedPayloadText, setSharedPayloadText] = useState('{}');
  const [confidentialPayloadText, setConfidentialPayloadText] = useState('{}');

  const workspaceQuery = useQuery({
    queryKey: ['shared-report-recipient-workspace', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => fetchWorkspaceWithTimeout(token),
  });

  const share = workspaceQuery.data?.share || null;
  const parent = workspaceQuery.data?.parent || null;
  const latestReport = workspaceQuery.data?.latestReport || {};
  const currentDraft = workspaceQuery.data?.currentDraft || null;
  const defaults = workspaceQuery.data?.defaults || {};
  const canEditShared = Boolean(share?.permissions?.can_edit_shared);
  const canEditConfidential = Boolean(share?.permissions?.can_edit_confidential);
  const canSave = canEditShared || canEditConfidential;

  useEffect(() => {
    if (!workspaceQuery.data) return;
    const nextSharedPayload =
      currentDraft?.shared_payload || defaults.shared_payload || { label: 'Shared Information', text: '' };
    const nextConfidentialPayload =
      currentDraft?.recipient_confidential_payload ||
      defaults.recipient_confidential_payload ||
      { label: 'Confidential Information', notes: '' };
    setSharedPayloadText(stringifyJson(nextSharedPayload));
    setConfidentialPayloadText(stringifyJson(nextConfidentialPayload));
  }, [workspaceQuery.data, currentDraft, defaults.shared_payload, defaults.recipient_confidential_payload]);

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const sharedPayload = parseJsonObject(sharedPayloadText, 'Shared Information');
      const confidentialPayload = parseJsonObject(confidentialPayloadText, 'Confidential Information');
      return sharedReportsClient.saveRecipientDraft(token, {
        shared_payload: sharedPayload,
        recipient_confidential_payload: confidentialPayload,
      });
    },
    onSuccess: async () => {
      toast.success('Draft saved');
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      toast.error(toFriendlySaveError(error));
    },
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing shared report token.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600 mx-auto mb-3" />
              <p className="text-slate-700">Loading shared report...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (workspaceQuery.error || !share || !parent) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{toFriendlyLoadError(workspaceQuery.error)}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const statusBadge = toStatusBadge(share.status);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{parent.title || 'Shared Report'}</CardTitle>
              <Badge variant="outline" className={statusBadge.className}>
                {statusBadge.label}
              </Badge>
            </div>
            <CardDescription>
              Created: {formatDateTime(parent.created_at)} • Expires: {formatDateTime(share.expires_at)}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shared Information</CardTitle>
            <CardDescription>
              {canEditShared
                ? 'Editable shared payload visible to both sides.'
                : 'Read-only for this link.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label className="text-xs text-slate-500 mb-2 block">JSON object</Label>
            <Textarea
              value={sharedPayloadText}
              onChange={(event) => setSharedPayloadText(event.target.value)}
              rows={14}
              disabled={!canEditShared}
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Report</CardTitle>
            <CardDescription>Recipient-safe report view generated from shared content.</CardDescription>
          </CardHeader>
          <CardContent>{renderAiReport(latestReport)}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confidential Information</CardTitle>
            <CardDescription>
              {canEditConfidential
                ? 'Editable private payload stored server-side for analysis only.'
                : 'Read-only for this link.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label className="text-xs text-slate-500 mb-2 block">JSON object</Label>
            <Textarea
              value={confidentialPayloadText}
              onChange={(event) => setConfidentialPayloadText(event.target.value)}
              rows={12}
              disabled={!canEditConfidential}
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => saveDraftMutation.mutate()}
            disabled={saveDraftMutation.isPending || !canSave}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
