import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

const PARTY_B_KEYS = new Set(['b', 'party_b', 'recipient', 'counterparty']);

const normalizeParty = (value: unknown) => String(value || '').toLowerCase();
const isPartyBResponse = (response: any) => PARTY_B_KEYS.has(normalizeParty(response?.entered_by_party || response?.author_party));

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function statusLabel(statusCode: number): 'ok' | 'not_found' | 'forbidden' | 'expired' | 'auth_required' | 'invalid' {
  if (statusCode === 404) return 'not_found';
  if (statusCode === 401) return 'auth_required';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

function normalizeValue(input: unknown) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  return JSON.stringify(input);
}

function normalizeVisibility(value: unknown): 'full' | 'hidden' {
  const normalized = String(value || '').trim().toLowerCase();
  if (['hidden', 'not_shared', 'private', 'confidential'].includes(normalized)) return 'hidden';
  if (normalized === 'partial') return 'hidden';
  return 'full';
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
  const correlationId = `shared_upsert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const body = await req.json().catch(() => ({}));
    const token = asString(body?.token) || asString(new URL(req.url).searchParams.get('token'));
    const responses = Array.isArray(body?.responses) ? body.responses : [];

    if (!user) {
      return Response.json({
        ok: false,
        status: 'auth_required',
        code: 'AUTH_REQUIRED',
        reason: 'AUTH_REQUIRED',
        message: 'Please sign in to continue',
        correlationId
      }, { status: 401 });
    }

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

    if (responses.length === 0) {
      return Response.json({
        ok: false,
        status: 'invalid',
        code: 'MISSING_RESPONSES',
        reason: 'MISSING_RESPONSES',
        message: 'At least one response payload is required',
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

    if (!validation.permissions.canEditRecipientSide && !validation.permissions.canEdit) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'EDIT_NOT_ALLOWED',
        reason: 'EDIT_NOT_ALLOWED',
        message: 'Recipient editing is disabled for this shared link',
        correlationId
      }, { status: 403 });
    }

    const resolved = await base44.asServiceRole.functions.invoke('GetSharedReportData', {
      token,
      consumeView: false
    });

    const resolvedData = resolved?.data;
    if (!resolvedData?.ok) {
      return Response.json({
        ok: false,
        status: resolvedData?.status || 'invalid',
        code: resolvedData?.code || 'RESOLVE_FAILED',
        reason: resolvedData?.reason || resolvedData?.code || 'RESOLVE_FAILED',
        message: resolvedData?.message || 'Could not resolve shared report context',
        correlationId
      }, { status: resolved?.status || 400 });
    }

    const proposalId = resolvedData?.proposalId;
    const editableQuestionIds: string[] = Array.isArray(resolvedData?.partyBEditableSchema?.editableQuestionIds)
      ? resolvedData.partyBEditableSchema.editableQuestionIds
      : (resolvedData?.partyBEditableSchema?.questions || []).map((question: any) => question.questionId);

    if (!proposalId) {
      return Response.json({
        ok: false,
        status: 'not_found',
        code: 'PROPOSAL_NOT_FOUND',
        reason: 'PROPOSAL_NOT_FOUND',
        message: 'Shared link is not linked to a proposal',
        correlationId
      }, { status: 404 });
    }

    const allowedSet = new Set(editableQuestionIds.map((id: string) => String(id)));
    const invalidQuestions = responses
      .map((item: any) => asString(item?.questionId || item?.question_id))
      .filter((questionId: string | null) => questionId && !allowedSet.has(questionId));

    if (invalidQuestions.length > 0) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'QUESTION_NOT_EDITABLE',
        reason: 'QUESTION_NOT_EDITABLE',
        message: `These questions are not editable by Party B: ${invalidQuestions.join(', ')}`,
        invalidQuestionIds: invalidQuestions,
        correlationId
      }, { status: 403 });
    }

    const existingResponses = await base44.asServiceRole.entities.ProposalResponse.filter(
      { proposal_id: proposalId },
      '-created_date'
    );

    const updates: Array<{ id: string; questionId: string; operation: 'create' | 'update' }> = [];

    for (const incoming of responses) {
      const questionId = asString(incoming?.questionId || incoming?.question_id);
      if (!questionId) continue;

      const explicitValueType = asString(incoming?.valueType || incoming?.value_type);
      const hasRange = incoming?.rangeMin !== undefined || incoming?.range_max !== undefined || incoming?.rangeMax !== undefined || incoming?.range_min !== undefined;
      const valueType = explicitValueType || (hasRange ? 'range' : 'text');
      const rangeMin = incoming?.rangeMin ?? incoming?.range_min ?? null;
      const rangeMax = incoming?.rangeMax ?? incoming?.range_max ?? null;
      const visibility = normalizeVisibility(incoming?.visibility);

      const payload: Record<string, unknown> = {
        proposal_id: proposalId,
        question_id: questionId,
        entered_by_party: 'b',
        author_party: 'b',
        subject_party: 'b',
        claim_type: 'self',
        is_about_counterparty: true,
        visibility,
        value_type: valueType
      };

      if (valueType === 'range') {
        payload.value = normalizeValue(incoming?.value ?? '');
        payload.range_min = rangeMin;
        payload.range_max = rangeMax;
      } else {
        payload.value = normalizeValue(incoming?.value);
        payload.range_min = null;
        payload.range_max = null;
      }

      const existing = existingResponses.find(
        (response: any) => response?.question_id === questionId && isPartyBResponse(response)
      );

      if (existing?.id) {
        await base44.asServiceRole.entities.ProposalResponse.update(existing.id, payload);
        updates.push({ id: existing.id, questionId, operation: 'update' });
      } else {
        const created = await base44.asServiceRole.entities.ProposalResponse.create(payload);
        updates.push({ id: created?.id || '', questionId, operation: 'create' });
      }
    }

    return Response.json({
      ok: true,
      status: 'ok',
      code: 'RESPONSES_UPDATED',
      reason: 'RESPONSES_UPDATED',
      message: 'Recipient responses saved',
      proposalId,
      updatedCount: updates.length,
      updates,
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
      message: err.message || 'Failed to update recipient responses',
      correlationId
    }, { status: statusCode || 500 });
  }
});
