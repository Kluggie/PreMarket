export const GUEST_COMPARISON_DRAFT_KEY = 'pm:guest_doc_comparison_draft';
export const GUEST_COMPARISON_MIGRATION_KEY = 'pm:guest_doc_comparison_migration';
export const GUEST_COMPARISON_SESSION_KEY = 'pm:guest_doc_comparison_session';
export const GUEST_COMPARISON_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const GUEST_COMPARISON_TOTAL_STEPS = 3;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSafeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
}

function clampGuestStep(value, maxStep = GUEST_COMPARISON_TOTAL_STEPS) {
  const normalizedMax = Math.max(1, toSafeInteger(maxStep) || GUEST_COMPARISON_TOTAL_STEPS);
  const numeric = toSafeInteger(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(1, Math.min(normalizedMax, numeric));
}

export function normalizeGuestAiUsageState(value, fallback = {}) {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  const fallbackState =
    fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      ? fallback
      : {};
  const fallbackAssistance = Math.max(0, toSafeInteger(fallbackState.assistanceRequestsUsed) || 0);
  const fallbackMediation = Math.max(0, toSafeInteger(fallbackState.mediationRunsUsed) || 0);

  return {
    assistanceRequestsUsed: Math.max(
      0,
      toSafeInteger(raw.assistanceRequestsUsed) || fallbackAssistance,
    ),
    mediationRunsUsed: Math.max(
      0,
      toSafeInteger(raw.mediationRunsUsed) || fallbackMediation,
    ),
  };
}

export function resolveGuestComparisonHydrationStep({
  draftStep,
  routeStep,
  hasStepParam = false,
  maxStep = GUEST_COMPARISON_TOTAL_STEPS,
} = {}) {
  if (hasStepParam) {
    return clampGuestStep(routeStep, maxStep);
  }
  return clampGuestStep(draftStep || routeStep || 1, maxStep);
}

export function resolveGuestComparisonPersistedStep({
  requestedStep,
  canonicalStep,
  forceStep = false,
  maxStep = GUEST_COMPARISON_TOTAL_STEPS,
} = {}) {
  const normalizedCanonicalStep = clampGuestStep(canonicalStep, maxStep);
  const normalizedRequestedStep = clampGuestStep(
    requestedStep == null ? normalizedCanonicalStep : requestedStep,
    maxStep,
  );
  return forceStep ? normalizedRequestedStep : normalizedCanonicalStep;
}

export function createGuestComparisonLocalId(prefix = 'guest_doc_compare') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readGuestComparisonDraft() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(GUEST_COMPARISON_DRAFT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(GUEST_COMPARISON_DRAFT_KEY);
      return null;
    }

    const savedAt = Number(parsed.savedAt || 0);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > GUEST_COMPARISON_DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(GUEST_COMPARISON_DRAFT_KEY);
      return null;
    }

    const legacyMediationRunsUsed = Math.max(
      0,
      toSafeInteger(parsed?.guestEvaluationPreview?.runCount) || 0,
    );

    return {
      ...parsed,
      guestAiUsage: normalizeGuestAiUsageState(parsed.guestAiUsage, {
        mediationRunsUsed: legacyMediationRunsUsed,
      }),
    };
  } catch {
    return null;
  }
}

export function writeGuestComparisonDraft(payload) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const normalizedPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? {
            ...payload,
            guestAiUsage: normalizeGuestAiUsageState(payload.guestAiUsage, {
              mediationRunsUsed: Math.max(
                0,
                toSafeInteger(payload?.guestEvaluationPreview?.runCount) || 0,
              ),
            }),
          }
        : {};
    window.localStorage.setItem(GUEST_COMPARISON_DRAFT_KEY, JSON.stringify(normalizedPayload));
    return true;
  } catch {
    return false;
  }
}

export function clearGuestComparisonDraft() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(GUEST_COMPARISON_DRAFT_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}

export function getOrCreateGuestComparisonSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const existing = asText(window.localStorage.getItem(GUEST_COMPARISON_SESSION_KEY));
    if (existing) {
      return existing;
    }
    const next = createGuestComparisonLocalId('guest_doc_compare_session');
    window.localStorage.setItem(GUEST_COMPARISON_SESSION_KEY, next);
    return next;
  } catch {
    return createGuestComparisonLocalId('guest_doc_compare_session');
  }
}

export function readGuestComparisonMigrationOverlay() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(GUEST_COMPARISON_MIGRATION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeGuestComparisonMigrationOverlay(payload) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(GUEST_COMPARISON_MIGRATION_KEY, JSON.stringify(payload || {}));
    return true;
  } catch {
    return false;
  }
}

export function clearGuestComparisonMigrationOverlay() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(GUEST_COMPARISON_MIGRATION_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}
