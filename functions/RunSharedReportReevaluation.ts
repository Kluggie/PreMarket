import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

const DEFAULT_MAX_REEVALUATIONS = 3;

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return fallback;
  return Math.floor(n);
}

function statusLabel(statusCode: number): 'ok' | 'not_found' | 'forbidden' | 'expired' | 'invalid' {
  if (statusCode === 404) return 'not_found';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

function normalizeRole(value: unknown) {
  return String(value || '').toLowerCase();
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
  const correlationId = `shared_reeval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'AUTH_REQUIRED',
        reason: 'AUTH_REQUIRED',
        message: 'Sign in is required to run re-evaluation',
        correlationId
      }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const token = asString(body?.token) || asString(new URL(req.url).searchParams.get('token'));

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

    if (!validation.permissions.canReevaluate) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'REEVALUATION_NOT_ALLOWED',
        reason: 'REEVALUATION_NOT_ALLOWED',
        message: 'Re-evaluation is disabled for this shared link',
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
        message: resolvedData?.message || 'Unable to resolve shared report context',
        correlationId
      }, { status: resolved?.status || 400 });
    }

    const proposalId = resolvedData?.proposalId;
    let evaluationItemId = resolvedData?.evaluationId || null;

    if (!evaluationItemId && proposalId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter(
        { linked_proposal_id: proposalId },
        '-created_date',
        1
      );
      evaluationItemId = items?.[0]?.id || null;
    }

    if (!proposalId || !evaluationItemId) {
      return Response.json({
        ok: false,
        status: 'not_found',
        code: 'EVALUATION_CONTEXT_NOT_FOUND',
        reason: 'EVALUATION_CONTEXT_NOT_FOUND',
        message: 'No evaluation context found for this shared proposal',
        correlationId
      }, { status: 404 });
    }

    const configuredLimit = toPositiveInt(
      body?.maxReevaluations ??
      resolvedData?.shareLink?.maxReevaluations ??
      resolvedData?.shareLink?.max_reevaluations,
      DEFAULT_MAX_REEVALUATIONS
    );

    const allRuns = await base44.asServiceRole.entities.EvaluationRun.filter(
      { evaluation_item_id: evaluationItemId },
      '-created_date'
    );
    const recipientRuns = allRuns.filter((run: any) => normalizeRole(run?.initiated_by_role) === 'shared_recipient');

    if (recipientRuns.length >= configuredLimit) {
      return Response.json({
        ok: false,
        status: 'forbidden',
        code: 'REEVALUATION_LIMIT_REACHED',
        reason: 'REEVALUATION_LIMIT_REACHED',
        message: `Re-evaluation limit reached (${configuredLimit})`,
        reevaluation: {
          max: configuredLimit,
          used: recipientRuns.length,
          remaining: 0
        },
        correlationId
      }, { status: 429 });
    }

    const runResult = await base44.functions.invoke('RunEvaluation', {
      evaluationItemId,
      initiatedByRole: 'shared_recipient'
    });

    const runData = runResult?.data;
    if (!runData?.ok) {
      return Response.json({
        ok: false,
        status: 'invalid',
        code: runData?.errorCode || 'REEVALUATION_FAILED',
        reason: runData?.errorCode || 'REEVALUATION_FAILED',
        message: runData?.message || runData?.error || 'Re-evaluation failed',
        detailsSafe: runData?.detailsSafe || null,
        reevaluation: {
          max: configuredLimit,
          used: recipientRuns.length,
          remaining: Math.max(0, configuredLimit - recipientRuns.length)
        },
        correlationId: runData?.correlationId || correlationId
      }, { status: runResult?.status || 500 });
    }

    const used = recipientRuns.length + 1;
    const remaining = Math.max(0, configuredLimit - used);

    return Response.json({
      ok: true,
      status: 'ok',
      code: 'REEVALUATION_COMPLETED',
      reason: 'REEVALUATION_COMPLETED',
      message: 'Re-evaluation completed',
      proposalId,
      evaluationItemId,
      runId: runData?.runId || null,
      cycleIndex: runData?.cycleIndex ?? null,
      report: runData?.report || null,
      reevaluation: {
        max: configuredLimit,
        used,
        remaining
      },
      correlationId: runData?.correlationId || correlationId
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
      message: err.message || 'Failed to run shared re-evaluation',
      correlationId
    }, { status: statusCode || 500 });
  }
});
