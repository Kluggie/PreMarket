export const GUEST_COMPARISON_DRAFT_KEY = 'pm:guest_doc_comparison_draft';
export const GUEST_COMPARISON_MIGRATION_KEY = 'pm:guest_doc_comparison_migration';
export const GUEST_COMPARISON_SESSION_KEY = 'pm:guest_doc_comparison_session';
export const GUEST_COMPARISON_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

    return parsed;
  } catch {
    return null;
  }
}

export function writeGuestComparisonDraft(payload) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(GUEST_COMPARISON_DRAFT_KEY, JSON.stringify(payload || {}));
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
