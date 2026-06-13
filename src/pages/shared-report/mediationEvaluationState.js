export const MEDIATION_EVALUATION_POLL_INTERVAL_MS = 2_500;
export const MEDIATION_EVALUATION_STALE_MS = 5 * 60 * 1_000;
export const MEDIATION_EVALUATION_CLIENT_WAIT_MS = 210_000;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isEvaluationRunForRequest(
  run,
  {
    priorEvaluationId = '',
    requestStartedAt = 0,
    activeRevisionId = '',
  } = {},
) {
  if (!run?.id) return false;
  if (priorEvaluationId && asText(run.id) === asText(priorEvaluationId)) return false;
  if (
    activeRevisionId &&
    asText(run.revision_id) &&
    asText(run.revision_id) !== asText(activeRevisionId)
  ) {
    return false;
  }
  const createdAt = timestampMs(run.created_at || run.updated_at);
  return !requestStartedAt || !createdAt || createdAt >= Number(requestStartedAt) - 5_000;
}

export function isRecentPendingEvaluationRun(
  run,
  {
    now = Date.now(),
    staleAfterMs = MEDIATION_EVALUATION_STALE_MS,
    activeRevisionId = '',
  } = {},
) {
  if (asText(run?.status).toLowerCase() !== 'pending') return false;
  if (
    activeRevisionId &&
    asText(run?.revision_id) &&
    asText(run.revision_id) !== asText(activeRevisionId)
  ) {
    return false;
  }
  const startedAt = timestampMs(run?.created_at || run?.updated_at);
  return startedAt > 0 && Number(now) - startedAt < staleAfterMs;
}

export function isStalePendingEvaluationRun(
  run,
  {
    now = Date.now(),
    staleAfterMs = MEDIATION_EVALUATION_STALE_MS,
    activeRevisionId = '',
  } = {},
) {
  if (asText(run?.status).toLowerCase() !== 'pending') return false;
  if (
    activeRevisionId &&
    asText(run?.revision_id) &&
    asText(run.revision_id) !== asText(activeRevisionId)
  ) {
    return false;
  }
  const startedAt = timestampMs(run?.created_at || run?.updated_at);
  return startedAt > 0 && Number(now) - startedAt >= staleAfterMs;
}
