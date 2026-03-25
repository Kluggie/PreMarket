import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test.local' });
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });
dotenv.config();

let migrated = false;

// ──────────────────────────────────────────────────────────────────────────────
// PRODUCTION SAFETY GUARD
//
// This is the #1 cause of the "data wiped after deployment" bug.
// .env.local contained the PRODUCTION DATABASE_URL. Every test that called
// resetTables() ran TRUNCATE against production, destroying all user data.
//
// This guard blocks ALL destructive test operations against production databases.
//
// STRATEGY: ALLOWLIST, not blocklist.
// Only explicitly permitted test/dev database hosts can be targeted.
// Any unknown host is blocked by default. This is safer than trying to
// enumerate all possible production hostnames.
// ──────────────────────────────────────────────────────────────────────────────

const ALLOWED_TEST_DB_HOSTS = [
  // Development branch (.env.local)
  'ep-withered-resonance-a7msfkph-pooler.ap-southeast-2.aws.neon.tech',
  // Integration-tests branch (.env.test.local)
  'ep-still-flower-a7m7ixml-pooler.ap-southeast-2.aws.neon.tech',
  // ── MAINTENANCE NOTE ──────────────────────────────────────────────────────
  // This list must be kept in sync with ALLOWED_NON_PRODUCTION_HOSTS
  // in scripts/_db-safety.mjs (used by db-migrate.mjs and guard-db-safety.mjs).
  // When you add a new Neon branch, update BOTH files.
  // ──────────────────────────────────────────────────────────────────────────
];

// Also block explicitly known production hosts as a defense-in-depth layer
const KNOWN_PRODUCTION_HOSTS = [
  'ep-odd-feather-a7mrocqy-pooler.ap-southeast-2.aws.neon.tech',
];

function isDatabaseUrlAllowedForTests(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_TEST_DB_HOSTS.some(
      (h) => host === h.toLowerCase()
    );
  } catch {
    return false;
  }
}

function isProductionDatabaseUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Block known production hosts
    if (KNOWN_PRODUCTION_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      return true;
    }
    // Block any URL that contains 'production' or 'prod' in the host or path
    if (/\bprod(uction)?\b/i.test(host) || /\bprod(uction)?\b/i.test(parsed.pathname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function assertNotProduction(context) {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  // Layer 1: Explicit production host detection
  if (isProductionDatabaseUrl(databaseUrl)) {
    const parsed = new URL(databaseUrl);
    throw new Error(
      `[FATAL] ${context} — DATABASE_URL points to PRODUCTION database ` +
      `(host: ${parsed.hostname}). This would destroy all user data.\n\n` +
      `Fix: Create a .env.test.local file with a TEST database URL:\n` +
      `  DATABASE_URL=postgresql://...@your-test-branch.neon.tech/neondb\n\n` +
      `Or use a Neon branch: neon branches create --name test-branch\n` +
      `Then set DATABASE_URL to the branch connection string in .env.test.local`
    );
  }

  // Layer 2: Allowlist check — block ANY host not explicitly permitted
  if (databaseUrl && !isDatabaseUrlAllowedForTests(databaseUrl)) {
    let host = '<unparseable>';
    try { host = new URL(databaseUrl).hostname; } catch {}
    throw new Error(
      `[FATAL] ${context} — DATABASE_URL host "${host}" is not in the allowed test database list.\n\n` +
      `Only these hosts are permitted for test runs:\n` +
      ALLOWED_TEST_DB_HOSTS.map((h) => `  - ${h}`).join('\n') + '\n\n' +
      `If this is a new test/dev branch, add its pooler hostname to ALLOWED_TEST_DB_HOSTS\n` +
      `in tests/helpers/db.mjs.`
    );
  }

  // Layer 3: Block if running inside any Vercel deployment (production, preview, or development).
  // When VERCEL_ENV is set, Vercel pre-injects DATABASE_URL into process.env BEFORE dotenv runs.
  // dotenv.config() silently skips env vars that already exist, so .env.test.local is ignored.
  // The Vercel-injected DATABASE_URL would be used instead — which is the shared dev DB in
  // preview/development, or production in production. Either path is wrong for test runs.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) {
    throw new Error(
      `[FATAL] ${context} — VERCEL_ENV is "${vercelEnv}". ` +
      `Tests must never run inside a Vercel deployment (production, preview, or development). ` +
      `When VERCEL_ENV is set, Vercel owns DATABASE_URL and .env.test.local is bypassed entirely.`
    );
  }
}

function getValidDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return null;
    }
    return databaseUrl;
  } catch {
    return null;
  }
}

export function hasDatabaseUrl() {
  return Boolean(getValidDatabaseUrl());
}

export function getDb() {
  const databaseUrl = getValidDatabaseUrl();
  if (!databaseUrl) {
    throw new Error('A valid DATABASE_URL is required');
  }

  return drizzle({ client: neon(databaseUrl) });
}

export async function ensureMigrated() {
  if (migrated) return;
  // Migrations are safe (additive), but guard anyway to prevent accidental
  // schema changes on production during test runs
  assertNotProduction('ensureMigrated()');
  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  migrated = true;
}

export async function resetTables() {
  // ── CRITICAL: This function runs TRUNCATE on ALL tables. ──
  // It MUST NEVER execute against a production database.
  assertNotProduction('resetTables()');
  const db = getDb();
  // Core tables that always exist (from early migrations)
  await db.execute(
    sql`truncate table
      audit_events,
      audit_logs,
      auth_sessions,
      memberships,
      organizations,
      user_profiles,
      user_mfa,
      contact_requests,
      beta_applications,
      beta_signups,
      notifications,
      email_dedupes,
      email_verification_tokens,
      proposal_agreement_request_emails,
      shared_link_verifications,
      shared_report_deliveries,
      shared_report_recipient_revisions,
      shared_report_evaluation_runs,
      shared_report_contributions,
      shared_link_responses,
      snapshot_access,
      proposal_snapshots,
      proposal_versions,
      proposal_events,
      proposal_evaluations,
      document_comparison_coach_cache,
      proposal_responses,
      document_comparisons,
      template_questions,
      template_sections,
      templates,
      shared_links,
      proposals,
      billing_references,
      users
      restart identity cascade`,
  );
  // user_documents only exists after migration 0021; skip gracefully if absent
  const exists = await db.execute(
    sql`select to_regclass('public.user_documents') as oid`,
  );
  const oid = exists?.rows?.[0]?.oid ?? exists?.[0]?.oid ?? null;
  if (oid) {
    await db.execute(sql`truncate table user_documents restart identity cascade`);
  }

  const starterUsageExists = await db.execute(
    sql`select to_regclass('public.starter_usage_events') as oid`,
  );
  const starterUsageOid = starterUsageExists?.rows?.[0]?.oid ?? starterUsageExists?.[0]?.oid ?? null;
  if (starterUsageOid) {
    await db.execute(sql`truncate table starter_usage_events restart identity cascade`);
  }
}
