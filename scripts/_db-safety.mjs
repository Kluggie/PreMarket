/**
 * _db-safety.mjs
 *
 * Shared DB safety constants and classification logic.
 * Used by db-migrate.mjs and guard-db-safety.mjs.
 *
 * tests/helpers/db.mjs maintains its own inline copy so that it has
 * zero external dependencies during test runs.
 *
 * ── Maintenance ────────────────────────────────────────────────────────────
 * When you create or recreate a Neon branch, add its pooler hostname to
 * ALLOWED_NON_PRODUCTION_HOSTS below.
 * When the production endpoint changes, update KNOWN_PRODUCTION_HOSTS.
 * ───────────────────────────────────────────────────────────────────────────
 */

// Production Neon endpoints. Local migrations and test runs are blocked
// against all of these regardless of any other flag.
export const KNOWN_PRODUCTION_HOSTS = [
  'ep-odd-feather-a7mrocqy-pooler.ap-southeast-2.aws.neon.tech',
];

// Non-production Neon endpoints explicitly approved for local migration runs,
// Vercel preview/development deployments, and test runs.
// Any host NOT listed here is blocked when running outside Vercel production.
export const ALLOWED_NON_PRODUCTION_HOSTS = [
  'ep-withered-resonance-a7msfkph-pooler.ap-southeast-2.aws.neon.tech', // development branch
  'ep-still-flower-a7m7ixml-pooler.ap-southeast-2.aws.neon.tech',       // integration-tests branch
];

/**
 * Returns true if `url` points to a known or pattern-matched production database.
 * @param {string} url
 */
export function isProductionDatabaseUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (KNOWN_PRODUCTION_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
    if (/\bprod(uction)?\b/i.test(host) || /\bprod(uction)?\b/i.test(parsed.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns true if `url` points to an explicitly approved non-production host.
 * @param {string} url
 */
export function isAllowedNonProductionHost(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_NON_PRODUCTION_HOSTS.some((h) => host === h.toLowerCase());
  } catch {
    return false;
  }
}
