/**
 * guard-db-safety.mjs
 *
 * Pre-deploy guard that verifies:
 * 1. DATABASE_URL is set and valid (fail fast, never silently use fallback)
 * 2. No destructive migration/seed scripts are referenced in build commands
 * 3. drizzle.config.js uses the DATABASE_URL canonical env var
 *
 * Run via: node scripts/guard-db-safety.mjs
 * Integrated in: npm run guard:db-safety (called in Vercel build)
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { KNOWN_PRODUCTION_HOSTS } from './_db-safety.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config();

const errors = [];
const warnings = [];

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 1: DATABASE_URL must be set and valid
// ──────────────────────────────────────────────────────────────────────────────
const databaseUrl = (process.env.DATABASE_URL || '').trim();
const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'not-set';
const isProduction = vercelEnv === 'production';

if (!databaseUrl) {
  const msg = `DATABASE_URL is not set. Current VERCEL_ENV=${vercelEnv}`;
  if (isProduction) {
    errors.push(`[CRITICAL] ${msg} - production builds MUST have DATABASE_URL`);
  } else {
    warnings.push(`[WARNING] ${msg} - database functionality will not work`);
  }
} else if (databaseUrl.includes('<') || databaseUrl.includes('>')) {
  errors.push(`[CRITICAL] DATABASE_URL appears to contain placeholder values: ${databaseUrl.slice(0, 30)}...`);
} else {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      errors.push(`[CRITICAL] DATABASE_URL must use postgres:// or postgresql:// protocol, got: ${parsed.protocol}`);
    } else {
      console.log(`[OK] DATABASE_URL is valid - host=${parsed.hostname} db=${parsed.pathname.replace(/^\//, '')}`);
    }
  } catch (e) {
    errors.push(`[CRITICAL] DATABASE_URL is not a valid URL: ${e.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 2: SESSION_SECRET and APP_BASE_URL must be set (session stability)
// ──────────────────────────────────────────────────────────────────────────────
// If SESSION_SECRET is missing, ALL user sessions become 401 → proposals appear
// wiped to every user. This is the #1 cause of the "history disappeared" bug.

const sessionSecret = (process.env.SESSION_SECRET || '').trim();
if (!sessionSecret) {
  const msg = 'SESSION_SECRET is not set. All verified sessions will return 401 and proposals will appear empty to every user.';
  if (isProduction) {
    errors.push(`[CRITICAL] ${msg}`);
  } else {
    warnings.push(`[WARNING] ${msg} — set it in .env.local for local dev`);
  }
} else if (sessionSecret.length < 32) {
  errors.push(`[CRITICAL] SESSION_SECRET is too short (${sessionSecret.length} chars). It must be at least 32 characters for HMAC-SHA256 security.`);
} else {
  console.log(`[OK] SESSION_SECRET is set (length=${sessionSecret.length})`);
}

const appBaseUrl = (process.env.APP_BASE_URL || '').trim();
if (!appBaseUrl) {
  const msg = 'APP_BASE_URL is not set. Auth cookie domain scoping and canonical redirects will break, preventing re-login after a session expires.';
  if (isProduction) {
    errors.push(`[CRITICAL] ${msg}`);
  } else {
    warnings.push(`[WARNING] ${msg} — set APP_BASE_URL in .env.local for local dev`);
  }
} else {
  try {
    const parsed = new URL(appBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      errors.push(`[CRITICAL] APP_BASE_URL must be an http/https URL, got: ${parsed.protocol}`);
    } else {
      console.log(`[OK] APP_BASE_URL is set - ${parsed.origin}`);
    }
  } catch (e) {
    errors.push(`[CRITICAL] APP_BASE_URL is not a valid URL: ${e.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 3: Scan scripts + vercel config for destructive commands
// ──────────────────────────────────────────────────────────────────────────────
const DESTRUCTIVE_PATTERNS = [
  { label: 'drizzle push --force', regex: /drizzle-kit\s+push\s+--force/ },
  { label: 'db:reset or prisma reset', regex: /db:reset|prisma\s+db\s+push\s+--force-reset/ },
  { label: 'DROP TABLE (migration)', regex: /DROP\s+TABLE\s+(?!IF\s+EXISTS\s+)"/ },
  { label: 'TRUNCATE (data wipe)', regex: /^\s*TRUNCATE\s+/im },
  { label: 'DELETE FROM (bulk wipe in migration)', regex: /^\s*DELETE\s+FROM\s+(?!template_questions|template_sections)/im },
];

const FILES_TO_SCAN = [
  'package.json',
  'vercel.json',
  'vercel.local.json',
  ...fs.readdirSync('scripts').map((f) => path.join('scripts', f)).filter((f) => f.endsWith('.mjs') || f.endsWith('.js')),
];

for (const filePath of FILES_TO_SCAN) {
  if (!fs.existsSync(filePath)) continue;

  // Skip this guard script itself to avoid self-matches
  if (path.resolve(filePath) === path.resolve('scripts/guard-db-safety.mjs')) continue;

  const content = fs.readFileSync(filePath, 'utf8');

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.regex.test(content)) {
      // Skip known safe truncate in test helpers and seed scripts
      if (filePath.includes('test') || filePath.includes('spec')) continue;
      warnings.push(`[WARN] Destructive pattern "${pattern.label}" found in ${filePath} - verify it's not run in production deploy`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 4: Verify drizzle.config.js does NOT use a hardcoded fallback DB
// ──────────────────────────────────────────────────────────────────────────────
if (fs.existsSync('drizzle.config.js')) {
  const drizzleConfig = fs.readFileSync('drizzle.config.js', 'utf8');

  // The old unsafe pattern was:
  //   process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/premarket'
  // Detect an OR-fallback from DATABASE_URL directly in the config (not a guard check)
  if (/process\.env\.DATABASE_URL\s*\|\|\s*['"`]postgres/.test(drizzleConfig)) {
    errors.push('[CRITICAL] drizzle.config.js uses DATABASE_URL with a fallback URL. This can cause silent data loss. Remove the fallback and use a fail-fast check instead.');
  }
  if (/getDatabaseUrl\(\)|process\.env\.DATABASE_URL/.test(drizzleConfig)) {
    console.log('[OK] drizzle.config.js uses DATABASE_URL env variable');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 5: DEBUG_TOKEN must be set in production (debug/db endpoint)
// ──────────────────────────────────────────────────────────────────────────────
// /api/debug/db is gated by x-debug-token header in production. If DEBUG_TOKEN
// is not set, every production request to that route falls through to 404 which
// is safe, but means the endpoint is unusable for operators. Warn so it gets set.

const debugToken = (process.env.DEBUG_TOKEN || '').trim();
if (isProduction) {
  if (!debugToken) {
    warnings.push('[WARNING] DEBUG_TOKEN is not set. The /api/debug/db endpoint will return 404 in production and will be unavailable for operators. Set DEBUG_TOKEN in Vercel env vars to enable it.');
  } else if (debugToken.length < 16) {
    warnings.push(`[WARNING] DEBUG_TOKEN is short (${debugToken.length} chars). Use at least 16 random characters.`);
  } else {
    console.log(`[OK] DEBUG_TOKEN is set (length=${debugToken.length})`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 6: Verify package.json build script doesn't call db:reset or db:seed
// ──────────────────────────────────────────────────────────────────────────────
if (fs.existsSync('package.json')) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const buildScript = pkg.scripts?.build || '';
  const vercelBuildScript = pkg.scripts?.['vercel-build'] || '';

  for (const [name, script] of [['build', buildScript], ['vercel-build', vercelBuildScript]]) {
    if (/db:reset|db:seed|drizzle-kit push/.test(script)) {
      errors.push(`[CRITICAL] package.json "${name}" script contains destructive DB commands: ${script}`);
    }
  }
  console.log(`[OK] package.json build scripts are safe: build="${buildScript}"`);

  // ── CHECK 6b: vercel-build must include db:migrate ───────────────────────
  // Without this, schema migrations are NEVER applied automatically during
  // Vercel deployments. New tables (like beta_signups) won't exist in the
  // deployed DB, causing persistent "0/50" beta counts and API 503 errors that
  // look like data loss to users.
  if (!vercelBuildScript) {
    const msg =
      'package.json is missing a "vercel-build" script. ' +
      'Vercel uses this script when it exists instead of "build". ' +
      'Without it, Drizzle migrations never run automatically during deployment. ' +
      'Fix: add "vercel-build": "npm run db:migrate && npm run build" to package.json scripts.';
    if (isProduction) {
      errors.push(`[CRITICAL] ${msg}`);
    } else {
      warnings.push(`[WARNING] ${msg}`);
    }
  } else if (!vercelBuildScript.includes('db:migrate')) {
    const msg =
      `package.json "vercel-build" script does not include db:migrate: "${vercelBuildScript}". ` +
      'Drizzle migrations will not run automatically during Vercel deployments. ' +
      'Fix: add "npm run db:migrate &&" to the beginning of the vercel-build script.';
    if (isProduction) {
      errors.push(`[CRITICAL] ${msg}`);
    } else {
      warnings.push(`[WARNING] ${msg}`);
    }
  } else {
    console.log(`[OK] package.json "vercel-build" includes db:migrate: "${vercelBuildScript}"`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 7: Scan API client files for dangerous silent fallback patterns
//          on server response fields that can mask backend failures.
//
// WHY: Patterns like `response.summary || { sentCount: 0 }` or
// `response.proposals || []` convert any missing field in a 2xx response into
// fake "no data". This makes DB unavailability or schema errors look identical
// to "the user has no proposals / zero signups".
//
// The correct pattern is to throw (with code: 'invalid_response') when expected
// fields are absent from a 2xx response body, so React Query sets isError=true
// and the UI shows a proper error state.
//
// Scans for:
//   (A) response.FIELD || { ...: 0 }   — silent zero-count object fallback
//   (B) Number(response.FIELD || 0)    — silent zero-count numeric fallback
//   (C) response.FIELD || []           — silent empty-array fallback
// ──────────────────────────────────────────────────────────────────────────────
const API_CLIENT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'api');
if (fs.existsSync(API_CLIENT_DIR)) {
  const silentZeroObjectPattern = /response\.\w+\s*\|\|\s*\{[^}]*:\s*0[^}]*\}/s;
  const silentZeroNumericPattern = /Number\s*\(\s*response\.\w+\s*\|\|\s*0\s*\)/;
  const silentArrayFallbackPattern = /response\.\w+\s*\|\|\s*\[\]/;

  const apiClientFiles = fs.readdirSync(API_CLIENT_DIR)
    .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
    .map((f) => path.join(API_CLIENT_DIR, f));

  for (const filePath of apiClientFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(process.cwd(), filePath);

    if (silentZeroObjectPattern.test(content)) {
      warnings.push(
        `[WARN] Silent zero-count object fallback in ${rel}: ` +
        'Found "response.FIELD || { ...: 0 }" pattern. ' +
        'Throw when expected response fields are absent instead of returning fake zeros.',
      );
    }

    if (silentZeroNumericPattern.test(content)) {
      warnings.push(
        `[WARN] Silent zero-count numeric fallback in ${rel}: ` +
        'Found "Number(response.FIELD || 0)" pattern. ' +
        'Throw when expected numeric response fields are absent instead of returning 0.',
      );
    }

    if (silentArrayFallbackPattern.test(content)) {
      warnings.push(
        `[WARN] Silent empty-array fallback in ${rel}: ` +
        'Found "response.FIELD || []" pattern. ' +
        'An empty array is indistinguishable from "no data" when the real cause is a backend failure. ' +
        'Throw when expected array fields are absent instead of returning [].',
      );
    }
  }
  console.log('[OK] API client files scanned for silent fallbacks (Check 7: zero-count, empty-array)');
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 8: Test helpers must have production safety guards
//
// WHY: tests/helpers/db.mjs contains resetTables() which runs TRUNCATE on ALL
// tables. If DATABASE_URL in .env.local points to production (which it did),
// running ANY integration test locally truncates the entire production database.
// This was the root cause of the repeated "data wiped after deployment" incident.
// ──────────────────────────────────────────────────────────────────────────────
const testDbHelperPath = path.join('tests', 'helpers', 'db.mjs');
if (fs.existsSync(testDbHelperPath)) {
  const testDbHelper = fs.readFileSync(testDbHelperPath, 'utf8');
  if (!testDbHelper.includes('assertNotProduction')) {
    errors.push(
      '[CRITICAL] tests/helpers/db.mjs is missing the assertNotProduction() guard. ' +
      'resetTables() will TRUNCATE ALL production tables if DATABASE_URL points to production. ' +
      'This was the root cause of the repeated data-loss incident.'
    );
  }
  if (testDbHelper.includes('resetTables') && !testDbHelper.includes('isProductionDatabaseUrl')) {
    errors.push(
      '[CRITICAL] tests/helpers/db.mjs resetTables() does not check isProductionDatabaseUrl(). ' +
      'It will blindly truncate whatever database DATABASE_URL points to.'
    );
  }
  console.log('[OK] Test helper production guard check completed (Check 8)');
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 9: .env.local must not use production DATABASE_URL for test runs
// (KNOWN_PRODUCTION_HOSTS imported from scripts/_db-safety.mjs)
// ──────────────────────────────────────────────────────────────────────────────
const envLocalPath = '.env.local';
if (fs.existsSync(envLocalPath)) {
  const envLocalContent = fs.readFileSync(envLocalPath, 'utf8');
  const dbUrlMatch = envLocalContent.match(/^DATABASE_URL\s*=\s*["']?([^\s"']+)/m);
  if (dbUrlMatch) {
    try {
      const localDbUrl = new URL(dbUrlMatch[1]);
      const localHost = localDbUrl.hostname.toLowerCase();
      if (KNOWN_PRODUCTION_HOSTS.some((h) => localHost === h || localHost.endsWith('.' + h))) {
        warnings.push(
          '[CRITICAL WARNING] .env.local DATABASE_URL points to a KNOWN PRODUCTION database host: ' +
          localHost + '. Running integration tests locally will TRUNCATE ALL production data. ' +
          'Create a Neon test branch and update .env.local (or better, create .env.test.local) ' +
          'with the branch DATABASE_URL.'
        );
      }
    } catch {
      // URL parse failure is not dangerous for this check
    }
  }
  console.log('[OK] .env.local production URL check completed (Check 9)');
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 10: .env.test.local must have an active DATABASE_URL
//
// WHY: tests/helpers/db.mjs loads .env.test.local first, then .env.local.
// If .env.test.local has DATABASE_URL commented out, tests silently fall
// through to .env.local — which means test runs TRUNCATE the development
// database instead of a dedicated test branch. This breaks the intended
// 3-way environment separation (dev / test / production).
// ──────────────────────────────────────────────────────────────────────────────
const envTestLocalPath = '.env.test.local';
if (fs.existsSync(envTestLocalPath)) {
  const envTestContent = fs.readFileSync(envTestLocalPath, 'utf8');
  const activeDbUrl = envTestContent.match(/^DATABASE_URL\s*=\s*["']?([^\s"'#]+)/m);
  const commentedDbUrl = envTestContent.match(/^#\s*DATABASE_URL/m);
  if (!activeDbUrl && commentedDbUrl) {
    warnings.push(
      '[WARNING] .env.test.local exists but DATABASE_URL is commented out. ' +
      'Tests will fall through to .env.local and TRUNCATE the development database. ' +
      'Uncomment DATABASE_URL in .env.test.local and set it to the integration-tests branch URL.'
    );
  } else if (!activeDbUrl) {
    warnings.push(
      '[WARNING] .env.test.local exists but has no DATABASE_URL. ' +
      'Tests will fall through to .env.local. Set DATABASE_URL to the integration-tests branch URL.'
    );
  } else {
    console.log('[OK] .env.test.local has an active DATABASE_URL (Check 10)');
  }
} else {
  warnings.push(
    '[WARNING] .env.test.local does not exist. Tests will use .env.local DATABASE_URL. ' +
    'Create .env.test.local with DATABASE_URL pointing to a dedicated test branch.'
  );
}
console.log('[OK] .env.test.local DATABASE_URL presence check completed (Check 10)');

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 11: Every migration SQL file must be registered in _journal.json
//
// WHY: This was the exact root cause of the March 2026 production incident.
// 0028_recipient_details.sql was committed with schema.js changes, but the
// journal was not updated. Drizzle's migrate() skips files it doesn't know
// about. The production build ran, the columns were never created, and every
// SELECT * from proposals crashed with "column party_b_name does not exist".
// ──────────────────────────────────────────────────────────────────────────────
const DRIZZLE_DIR = 'drizzle';
const JOURNAL_PATH = path.join(DRIZZLE_DIR, 'meta', '_journal.json');

if (fs.existsSync(JOURNAL_PATH)) {
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
  const journalTags = new Set((journal.entries || []).map((e) => e.tag));

  const sqlFiles = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const unregistered = sqlFiles.filter((f) => {
    const tag = f.replace(/\.sql$/, '');
    return !journalTags.has(tag);
  });

  if (unregistered.length > 0) {
    errors.push(
      `[CRITICAL] ${unregistered.length} migration file(s) exist in drizzle/ but are NOT registered in _journal.json:\n` +
      unregistered.map((f) => `  - drizzle/${f}`).join('\n') + '\n' +
      `  Drizzle's migrate() will SILENTLY SKIP these files. Columns/tables they add will\n` +
      `  never exist in production, and any code referencing them will crash at runtime.\n` +
      `  Fix: run "npx drizzle-kit generate" to regenerate the journal, or manually add\n` +
      `  the missing entries to drizzle/meta/_journal.json.`
    );
  } else {
    console.log(`[OK] All ${sqlFiles.length} migration files are registered in _journal.json (Check 11)`);
  }
} else {
  errors.push('[CRITICAL] drizzle/meta/_journal.json does not exist. Drizzle migrations cannot run.');
}

// ──────────────────────────────────────────────────────────────────────────────
// CHECK 12: Migration SQL files must use statement-breakpoint separators
//
// WHY: Neon's HTTP driver sends each query as a prepared statement.
// PostgreSQL rejects prepared statements that contain multiple commands
// ("cannot insert multiple commands into a prepared statement", code 42601).
// Drizzle splits SQL files on `--> statement-breakpoint` markers and sends
// each segment as a separate query. A file with 2+ statements and no
// breakpoint marker will be sent as one query and fail at deploy time.
//
// This check counts SQL statement terminators (semicolons outside comments)
// and requires at least (statements - 1) breakpoint markers.
// ──────────────────────────────────────────────────────────────────────────────
if (fs.existsSync(DRIZZLE_DIR)) {
  const sqlFiles = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const sqlFile of sqlFiles) {
    const filePath = path.join(DRIZZLE_DIR, sqlFile);
    const content = fs.readFileSync(filePath, 'utf8');

    // Count statement-breakpoint markers
    const breakpointMatches = content.match(/--> statement-breakpoint/g);
    const breakpointCount = breakpointMatches ? breakpointMatches.length : 0;

    // Count semicolons that actually terminate SQL statements.
    // Strategy: strip pure-comment lines (lines starting with -- that are NOT
    // breakpoint markers), then count remaining semicolons.
    const nonCommentLines = content
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        // Keep breakpoint marker lines regardless
        if (trimmed.includes('--> statement-breakpoint')) return true;
        // Discard pure comment lines
        if (trimmed.startsWith('--')) return false;
        return true;
      })
      .join('\n');

    // Count `;` in the non-comment content (each marks end of a SQL statement)
    const semicolonCount = (nonCommentLines.match(/;/g) || []).length;

    if (semicolonCount > 1 && breakpointCount === 0) {
      errors.push(
        `[CRITICAL] drizzle/${sqlFile} has ${semicolonCount} SQL statements but zero ` +
        `"--> statement-breakpoint" separators. ` +
        `Neon's HTTP driver will reject multi-statement queries (Postgres error 42601). ` +
        `Add "--> statement-breakpoint" on its own line between each statement.\n` +
        `  Example: ALTER TABLE "t" ADD COLUMN "a" text;--> statement-breakpoint\n` +
        `           ALTER TABLE "t" ADD COLUMN "b" text;`
      );
    }
  }
  console.log(`[OK] Migration SQL breakpoint formatting checked (Check 12)`);
}

if (warnings.length > 0) {
  console.warn('\nWarnings:');
  for (const warning of warnings) {
    console.warn(` ${warning}`);
  }
}

if (errors.length > 0) {
  console.error('\nERRORS - Database safety check FAILED:');
  for (const error of errors) {
    console.error(` ${error}`);
  }

  if (isProduction) {
    console.error('\nAborting production build due to database safety errors.');
    process.exit(1);
  } else {
    console.error('\nWould abort production build. Continuing in non-production environment.');
    process.exit(0);
  }
}

console.log('\n✓ Database safety guard passed.');
