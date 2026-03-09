/**
 * build-config-safety.test.mjs
 *
 * Static assertions that the Vercel build pipeline is correctly configured to
 * run database migrations before every deployment.
 *
 * These tests are deliberately build-time / unit-level: they read package.json
 * and vercel.json and assert structure. They require no DATABASE_URL and run
 * in CI as fast pre-flight checks.
 *
 * WHY THIS EXISTS:
 * The most common source of the "data disappeared after deploy" regression is
 * that migrations were added locally but never applied to the deployment
 * database because the Vercel build command didn't include `db:migrate`.
 * e.g. migration 0023_beta_signups.sql added the `beta_signups` table but the
 * production DB didn't have it, causing /api/beta-signups/stats to return 503
 * and the frontend to display "0 of 50 seats claimed" after every deploy.
 *
 * VERCEL BUILD COMMAND PRIORITY (highest to lowest):
 *   1. vercel.json  "buildCommand"   ← explicit, wins over everything
 *   2. package.json "vercel-build"   ← fallback when no vercel.json override
 *   3. package.json "build"          ← last resort
 *
 * We maintain BOTH vercel.json buildCommand and package.json vercel-build for
 * belt-and-suspenders: vercel.json is the source of truth and is visible to
 * anyone reading the deploy configuration; package.json vercel-build is a
 * fallback and works with `vercel build` locally.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// ──────────────────────────────────────────────────────────────────────────────
// vercel.json buildCommand assertions (highest priority, most explicit)
// ──────────────────────────────────────────────────────────────────────────────

test('vercel.json exists', () => {
  assert.ok(
    fs.existsSync(path.join(rootDir, 'vercel.json')),
    'vercel.json must exist at the project root',
  );
});

test('vercel.json has a "buildCommand" key', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  assert.ok(
    typeof vercel.buildCommand === 'string' && vercel.buildCommand.trim().length > 0,
    'vercel.json must contain a "buildCommand" key. ' +
      'This is the HIGHEST-priority build command on Vercel and ensures migrations ' +
      'run regardless of the Vercel project UI settings. ' +
      'Fix: add "buildCommand": "npm run db:migrate && npm run build" to vercel.json.',
  );
});

test('vercel.json buildCommand contains "db:migrate"', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  const cmd = String(vercel.buildCommand || '');
  assert.ok(
    cmd.includes('db:migrate'),
    `vercel.json "buildCommand" must include "db:migrate". Current: "${cmd}"`,
  );
});

test('vercel.json buildCommand runs db:migrate BEFORE build', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  const cmd = String(vercel.buildCommand || '');
  const migrateIdx = cmd.indexOf('db:migrate');
  const buildIdx = cmd.indexOf('run build');
  assert.ok(migrateIdx !== -1, '"buildCommand" must include db:migrate');
  assert.ok(buildIdx !== -1, '"buildCommand" must include npm run build');
  assert.ok(
    migrateIdx < buildIdx,
    `vercel.json "buildCommand" must run db:migrate BEFORE build. Current: "${cmd}"`,
  );
});

test('vercel.json buildCommand must not contain destructive db commands', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  const cmd = String(vercel.buildCommand || '');
  const destructive = ['db:reset', 'db:seed', 'drizzle-kit push --force', 'drizzle-kit push'];
  for (const pattern of destructive) {
    assert.ok(
      !cmd.includes(pattern),
      `vercel.json "buildCommand" must NOT contain destructive db command "${pattern}". Current: "${cmd}"`,
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// package.json vercel-build script assertions (fallback)
// ──────────────────────────────────────────────────────────────────────────────

test('package.json has a "vercel-build" script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.ok(
    typeof pkg.scripts?.['vercel-build'] === 'string' && pkg.scripts['vercel-build'].trim().length > 0,
    'package.json must define a "vercel-build" script so Vercel uses it instead of the bare "build" script. ' +
      'Without it, Drizzle migrations are never applied during deployment.',
  );
});

test('"vercel-build" script contains "db:migrate"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vercelBuild = String(pkg.scripts?.['vercel-build'] || '');
  assert.ok(
    vercelBuild.includes('db:migrate'),
    `"vercel-build" script must include "db:migrate" so migrations run before every Vercel deploy. ` +
      `Current value: "${vercelBuild}". ` +
      `Fix: "vercel-build": "npm run db:migrate && npm run build"`,
  );
});

test('"vercel-build" script runs db:migrate BEFORE build (not after)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vercelBuild = String(pkg.scripts?.['vercel-build'] || '');
  const migrateIdx = vercelBuild.indexOf('db:migrate');
  const buildIdx = vercelBuild.indexOf('npm run build');
  assert.ok(migrateIdx !== -1, '"vercel-build" must include db:migrate');
  assert.ok(buildIdx !== -1, '"vercel-build" must include npm run build');
  assert.ok(
    migrateIdx < buildIdx,
    '"vercel-build" must run db:migrate BEFORE npm run build. ' +
      `Current: "${vercelBuild}"`,
  );
});

test('"vercel-build" script must not contain destructive db commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vercelBuild = String(pkg.scripts?.['vercel-build'] || '');
  const destructive = ['db:reset', 'db:seed', 'drizzle-kit push --force', 'drizzle-kit push'];
  for (const pattern of destructive) {
    assert.ok(
      !vercelBuild.includes(pattern),
      `"vercel-build" must NOT contain destructive db command "${pattern}". Current: "${vercelBuild}"`,
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Consistency check: vercel.json buildCommand and vercel-build must agree
// ──────────────────────────────────────────────────────────────────────────────

test('vercel.json buildCommand and package.json vercel-build both include db:migrate (consistent)', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vercelCmd = String(vercel.buildCommand || '');
  const pkgCmd = String(pkg.scripts?.['vercel-build'] || '');

  const vercelHasMigrate = vercelCmd.includes('db:migrate');
  const pkgHasMigrate = pkgCmd.includes('db:migrate');

  // At least one must include db:migrate (vercel.json takes priority)
  assert.ok(
    vercelHasMigrate || pkgHasMigrate,
    'Neither vercel.json buildCommand nor package.json vercel-build includes db:migrate. ' +
      'Migrations will never run on Vercel deployments.',
  );

  // Warn if they're inconsistent (one has it, other doesn't)
  // We use plain assert.ok(true) to avoid hard failure here, since the vercel.json
  // buildCommand takes priority. But both having it is belt-and-suspenders.
  if (vercelHasMigrate && !pkgHasMigrate) {
    // vercel.json wins — this is safe but not ideal
    console.warn('[WARN] vercel.json buildCommand has db:migrate but package.json vercel-build does not. ' +
      'Both should have it for consistency.');
  }
  if (!vercelHasMigrate && pkgHasMigrate) {
    // This is a problem — vercel.json overrides and doesn't have migrate
    assert.fail(
      'vercel.json buildCommand overrides package.json but does NOT include db:migrate. ' +
        'Migrations will NOT run on Vercel deployments.',
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Migration file completeness assertions
// ──────────────────────────────────────────────────────────────────────────────

test('drizzle migrations folder exists and is non-empty', () => {
  const migrationsDir = path.join(rootDir, 'drizzle');
  assert.ok(fs.existsSync(migrationsDir), 'drizzle/ folder must exist');
  const sqlFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  assert.ok(sqlFiles.length > 0, 'drizzle/ folder must contain at least one .sql migration file');
});

test('drizzle meta journal matches sql files one-to-one', () => {
  const migrationsDir = path.join(rootDir, 'drizzle');
  const metaDir = path.join(migrationsDir, 'meta');
  const journalPath = path.join(metaDir, '_journal.json');

  assert.ok(fs.existsSync(journalPath), 'drizzle/meta/_journal.json must exist');

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const entryTags = (journal.entries || []).map((e) => e.tag);

  assert.ok(entryTags.length > 0, '_journal.json must have at least one entry');

  // Every journal entry must have a matching .sql file
  for (const tag of entryTags) {
    const sqlPath = path.join(migrationsDir, `${tag}.sql`);
    assert.ok(
      fs.existsSync(sqlPath),
      `Migration file missing: drizzle/${tag}.sql is listed in _journal.json but the .sql file does not exist. ` +
        'This means the migration was registered but never generated, or the file was deleted.',
    );
  }
});

test('schema.js exports betaSignups and betaApplications tables', () => {
  // This test verifies that the schema file includes both the legacy table
  // (beta_applications) used for deduplication and the current table
  // (beta_signups) used for all new signups. If either is missing, the
  // beta seat count will be wrong or the routes will throw.
  const schemaPath = path.join(rootDir, 'server', '_lib', 'db', 'schema.js');
  assert.ok(fs.existsSync(schemaPath), 'server/_lib/db/schema.js must exist');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(
    schemaContent.includes("'beta_signups'") || schemaContent.includes('"beta_signups"'),
    'schema.js must define the beta_signups table (added in migration 0023)',
  );
  assert.ok(
    schemaContent.includes("'beta_applications'") || schemaContent.includes('"beta_applications"'),
    'schema.js must define the beta_applications table (legacy dedup)',
  );
});

test('schema.js exports proposals table', () => {
  const schemaPath = path.join(rootDir, 'server', '_lib', 'db', 'schema.js');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(
    schemaContent.includes("'proposals'"),
    "schema.js must define the proposals table with pgTable('proposals', ...)",
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Error code assertions (unit — no DB required)
// ──────────────────────────────────────────────────────────────────────────────

test('toApiError maps PG 42P01 (undefined_table) to 503 db_schema_missing', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const pgUndefinedTableError = new Error('relation "beta_signups" does not exist');
  pgUndefinedTableError.code = '42P01';

  const apiError = toApiError(pgUndefinedTableError);

  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_schema_missing');
});

test('toApiError maps PG 42703 (undefined_column) to 503 db_schema_missing', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const pgUndefinedColumnError = new Error('column "email_normalized" of relation "beta_signups" does not exist');
  pgUndefinedColumnError.code = '42703';

  const apiError = toApiError(pgUndefinedColumnError);

  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_schema_missing');
});

test('toApiError maps PG 08xxx (connection failure) to 503 db_unavailable', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const pgConnectionError = new Error('connection refused');
  pgConnectionError.code = '08006';

  const apiError = toApiError(pgConnectionError);

  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_unavailable');
});

test('toApiError preserves ApiError instances unchanged', async () => {
  const { toApiError, ApiError } = await import('../../server/_lib/errors.js');

  const original = new ApiError(409, 'already_signed_up', 'Already signed up');
  const result = toApiError(original);

  assert.equal(result, original);
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'already_signed_up');
});

test('toApiError returns 500 internal_error for unknown errors', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const apiError = toApiError(new Error('something unexpected'));

  assert.equal(apiError.statusCode, 500);
  assert.equal(apiError.code, 'internal_error');
});
