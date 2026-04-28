import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function statusLabel(statusCode: number): 'ok' | 'not_found' | 'forbidden' | 'expired' | 'invalid' {
  if (statusCode === 404) return 'not_found';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

function extractError(error: any) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    500;
  const payload =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;
  return { statusCode, payload };
}

Deno.serve(async (req) => {
  const correlationId = `shared_sendback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const token = asString(body?.token) || asString(new URL(req.url).searchParams.get('token'));
    const message = asString(body?.message) || '';
    const counterproposal = body?.counterproposal || null;

    if (!token) {
      return Response.json({
        ok: false,
        status: 'invalid',
        code: 'MISSING_TOKEN',
        reason: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }

    if (!message) {
      return Response.json({
        ok: false,
        status: 'invalid',
        code: 'MISSING_MESSAGE',
        reason: 'MISSING_MESSAGE',
        message: 'A response message is required',
        correlationId
      }, { status: 400 });
    }

    const validation = await validateShareLinkAccess(base44, { token, consumeView: false });
    if (!validation.ok) {
      return Response.json({
        ok: false,
        status: statusLabel(validation.statusCode),
        code: validation.code,
        reason: validation.reason,
        message: validation.message,
        correlationId
      }, { status: validation.statusCode });
    }

    if (!validation.permissions.canSendBack) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'SEND_BACK_NOT_ALLOWED',
        reason: 'SEND_BACK_NOT_ALLOWED',
        message: 'Send-back is disabled for this shared link',
        correlationId
      }, { status: 403 });
    }

    const resolved = await base44.asServiceRole.functions.invoke('GetSharedReportData', {
      token,
      consumeView: false
    });
    const resolvedData = resolved?.data;
    const proposalId = resolvedData?.proposalId || validation.shareLink.proposalId;

    if (!proposalId) {
      return Response.json({
        ok: false,
        status: 'not_found',
        code: 'PROPOSAL_NOT_FOUND',
        reason: 'PROPOSAL_NOT_FOUND',
        message: 'No proposal found for this shared link',
        correlationId
      }, { status: 404 });
    }

    const user = await base44.auth.me().catch(() => null);
    const actorEmail = asString(user?.email) || validation.currentUserEmail || validation.shareLink.recipientEmail || 'recipient';

    const notePayload = JSON.stringify({
      message,
      counterproposal: counterproposal || null,
      source: 'shared_report_send_back',
      tokenId: validation.shareLink.id,
      actorEmail,
      sentAt: new Date().toISOString()
    });

    const created = await base44.asServiceRole.entities.ProposalResponse.create({
      proposal_id: proposalId,
      question_id: `__shared_send_back_note_${Date.now()}`,
      entered_by_party: 'b',
      author_party: 'b',
      subject_party: 'b',
      claim_type: 'recipient_counterproposal',
      value_type: 'text',
      value: notePayload,
      visibility: 'full'
    });

    return Response.json({
      ok: true,
      status: 'ok',
      code: 'SEND_BACK_RECORDED',
      reason: 'SEND_BACK_RECORDED',
      message: 'Response recorded and linked to proposal',
      proposalId,
      responseId: created?.id || null,
      correlationId
    });
  } catch (error) {
    const { statusCode, payload } = extractError(error);
    if (payload) {
      return Response.json({
        ...payload,
        correlationId: payload?.correlationId || correlationId
      }, { status: statusCode || 500 });
    }

    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      status: 'invalid',
      code: 'INTERNAL_ERROR',
      reason: 'INTERNAL_ERROR',
      message: err.message || 'Failed to submit shared response',
      correlationId
    }, { status: statusCode || 500 });
  }
});
