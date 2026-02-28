export function toTimestampMs(value) {
  if (value instanceof Date) {
    const numeric = value.getTime();
    return Number.isFinite(numeric) ? numeric : 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveComparisonUpdatedAtMs(comparison) {
  if (!comparison || typeof comparison !== 'object') {
    return 0;
  }

  return Math.max(
    toTimestampMs(comparison.updated_at),
    toTimestampMs(comparison.updated_date),
    toTimestampMs(comparison.updatedAt),
  );
}

export function shouldHydrateComparisonDraft({
  hasLocalUnsavedEdit,
  localLastEditAt,
  serverUpdatedAtMs,
}) {
  if (!hasLocalUnsavedEdit) {
    return true;
  }

  const localEditMs = toTimestampMs(localLastEditAt);
  if (!localEditMs) {
    return true;
  }

  const serverMs = toTimestampMs(serverUpdatedAtMs);
  if (!serverMs) {
    return false;
  }

  return serverMs > localEditMs;
}

function clampStep(value, fallbackStep, maxStep) {
  const fallback = Number.isFinite(Number(fallbackStep)) ? Number(fallbackStep) : 1;
  const limit = Number.isFinite(Number(maxStep)) && Number(maxStep) > 0 ? Number(maxStep) : 2;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.min(Math.max(Math.floor(fallback), 1), limit);
  }
  return Math.min(Math.max(Math.floor(numeric), 1), limit);
}

export function resolveHydratedDraftStep({
  serverDraftStep,
  routeStep,
  hasRouteStepParam,
  maxStep = 2,
}) {
  const serverStep = clampStep(serverDraftStep, 1, maxStep);
  if (hasRouteStepParam) {
    return clampStep(routeStep, serverStep, maxStep);
  }
  return serverStep;
}
