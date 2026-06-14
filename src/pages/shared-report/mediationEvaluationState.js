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
    activeEvaluationId = '',
    priorEvaluationId = '',
    activeRevisionId = '',
  } = {},
) {
  if (!run?.id) return false;
  if (
    activeRevisionId &&
    asText(run.revision_id) &&
    asText(run.revision_id) !== asText(activeRevisionId)
  ) {
    return false;
  }
  if (activeEvaluationId) {
    return asText(run.id) === asText(activeEvaluationId);
  }
  if (priorEvaluationId && asText(run.id) === asText(priorEvaluationId)) return false;
  // The workspace endpoint already returns the newest run for this link.
  // Match it by run identity and revision instead of comparing browser and
  // database clocks, which may be skewed enough to reject a valid completion.
  return true;
}

export function isRecentPendingEvaluationRun(
  run,
  {
    now = Date.now(),
    staleAfterMs = MEDIATION_EVALUATION_STALE_MS,
    activeRevisionId = '',
    requestStartedAt = 0,
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
  const startedAt =
    Number(requestStartedAt) > 0
      ? Number(requestStartedAt)
      : timestampMs(run?.created_at || run?.updated_at);
  return startedAt > 0 && Number(now) - startedAt < staleAfterMs;
}

export function isStalePendingEvaluationRun(
  run,
  {
    now = Date.now(),
    staleAfterMs = MEDIATION_EVALUATION_STALE_MS,
    activeRevisionId = '',
    requestStartedAt = 0,
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
  const startedAt =
    Number(requestStartedAt) > 0
      ? Number(requestStartedAt)
      : timestampMs(run?.created_at || run?.updated_at);
  return startedAt > 0 && Number(now) - startedAt >= staleAfterMs;
}

export function isGenerationFailureFallback(report) {
  return (
    asText(report?.generation_status).toLowerCase() === 'failed' &&
    report?.retry_recommended !== false
  );
}
