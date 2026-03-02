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
// CHECK 5: Verify package.json build script doesn't call db:reset or db:seed
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
}

// ──────────────────────────────────────────────────────────────────────────────
// REPORT
// ──────────────────────────────────────────────────────────────────────────────
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
