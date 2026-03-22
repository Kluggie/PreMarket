export const STARTER_PLAN_LIMITS = Object.freeze({
  opportunitiesPerMonth: 5,
  activeOpportunities: 2,
  aiEvaluationsPerMonth: 10,
  uploadBytesPerOpportunity: 25 * 1024 * 1024,
  uploadBytesPerMonth: 100 * 1024 * 1024,
});

const STARTER_PLAN_ALIASES = new Set(['starter', 'free']);

export function normalizePlanTier(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function isStarterPlanTier(value) {
  const normalized = normalizePlanTier(value);
  return normalized ? STARTER_PLAN_ALIASES.has(normalized) : false;
}

export function toWholeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

export function formatCount(value) {
  return toWholeNumber(value).toLocaleString();
}

export function formatBytes(value) {
  const bytes = toWholeNumber(value);
  if (!bytes) {
    return '0 MB';
  }

  const mb = bytes / (1024 * 1024);
  if (mb < 10) {
    return `${mb.toFixed(1)} MB`;
  }

  return `${Math.round(mb)} MB`;
}

export function toRemaining(limit, used) {
  const normalizedLimit = toWholeNumber(limit);
  const normalizedUsed = toWholeNumber(used);
  return Math.max(0, normalizedLimit - normalizedUsed);
}

export function isStarterOpportunityLimitReached(starterUsage) {
  if (!isStarterPlanTier(starterUsage?.plan)) {
    return false;
  }
  const used = toWholeNumber(starterUsage?.usage?.opportunitiesCreatedThisMonth);
  return used >= STARTER_PLAN_LIMITS.opportunitiesPerMonth;
}
