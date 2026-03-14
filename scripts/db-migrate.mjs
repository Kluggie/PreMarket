import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import {
  ALLOWED_NON_PRODUCTION_HOSTS,
  isProductionDatabaseUrl,
  isAllowedNonProductionHost,
} from './_db-safety.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
  console.error('[FATAL] db-migrate — A valid DATABASE_URL is required.');
  process.exit(1);
}

let parsedHost;
try {
  parsedHost = new URL(databaseUrl).hostname.toLowerCase();
} catch {
  console.error('[FATAL] db-migrate — DATABASE_URL is not a valid URL.');
  process.exit(1);
}

// ── Context-aware fail-closed migration guard ─────────────────────────────
//
// VERCEL_ENV=production  → Vercel owns DATABASE_URL; it points to production.
//                          This is the only context where production migrations
//                          are permitted. Allow unconditionally.
//
// VERCEL_ENV=preview     → Vercel owns DATABASE_URL; it should point to the
// VERCEL_ENV=development   development branch. Block if it somehow points to
//                          production (misconfiguration guard). Allow otherwise.
//
// (no VERCEL_ENV)        → Local run. Fail-closed allowlist: only explicitly
//                          approved non-production hosts are permitted.
//                          Any unknown host is blocked by default.
// ─────────────────────────────────────────────────────────────────────────
const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv === 'production') {
  // Intentional Vercel production migration — allow.
  console.log(`[db-migrate] Vercel production deployment — migrating: ${parsedHost}`);

} else if (vercelEnv === 'preview' || vercelEnv === 'development') {
  // Vercel preview/development: Vercel injects DATABASE_URL (should be dev branch).
  // Guard against misconfiguration where production URL is injected.
  if (isProductionDatabaseUrl(databaseUrl)) {
    console.error(
      `[FATAL] db-migrate — VERCEL_ENV="${vercelEnv}" but DATABASE_URL points to PRODUCTION (${parsedHost}).\n` +
      `Vercel preview and development deployments must not migrate production.\n` +
      `Fix: set the DATABASE_URL env var for preview/development in Vercel project settings\n` +
      `to the development branch connection string.`
    );
    process.exit(1);
  }
  console.log(`[db-migrate] Vercel ${vercelEnv} deployment — migrating: ${parsedHost}`);

} else {
  // Local run — fail-closed allowlist.
  if (isProductionDatabaseUrl(databaseUrl)) {
    console.error(
      `[FATAL] db-migrate — DATABASE_URL points to PRODUCTION (${parsedHost}).\n` +
      `Local migrations cannot target production.\n` +
      `Set DATABASE_URL to a development or test branch in .env.local.`
    );
    process.exit(1);
  }

  if (!isAllowedNonProductionHost(databaseUrl)) {
    console.error(
      `[FATAL] db-migrate — DATABASE_URL host "${parsedHost}" is not in ALLOWED_NON_PRODUCTION_HOSTS.\n` +
      `Only these hosts are permitted for local migrations:\n` +
      ALLOWED_NON_PRODUCTION_HOSTS.map((h) => `  - ${h}`).join('\n') + '\n' +
      `If this is a new branch, add its pooler hostname to ALLOWED_NON_PRODUCTION_HOSTS\n` +
      `in scripts/_db-safety.mjs.`
    );
    process.exit(1);
  }

  console.log(`[db-migrate] Local run — migrating: ${parsedHost}`);
}

async function run() {
  const db = drizzle({ client: neon(databaseUrl) });
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Drizzle migrations applied successfully.');
}

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
