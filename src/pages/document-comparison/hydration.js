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
