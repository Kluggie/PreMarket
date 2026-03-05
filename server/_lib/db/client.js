import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/**
 * Neon HTTP + Drizzle is serverless-safe for Vercel because it does not
 * hold long-lived TCP connections per invocation.
 */
function createDbClient(databaseUrl) {
  const sql = neon(databaseUrl);
  return drizzle({ client: sql, schema });
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toShortHash(value) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function parseDatabaseIdentity(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const path = String(parsed.pathname || '').replace(/^\/+/, '');
  const dbName = decodeURIComponent(path.split('/')[0] || '');
  const schemaName = asTrimmedString(parsed.searchParams.get('schema')) || 'public';

  return {
    dbHost: asTrimmedString(parsed.hostname) || null,
    dbName: dbName || null,
    dbSchema: schemaName,
  };
}

export function getDatabaseEnvPresence() {
  return {
    DATABASE_URL: Boolean(asTrimmedString(process.env.DATABASE_URL)),
    DIRECT_URL: Boolean(asTrimmedString(process.env.DIRECT_URL)),
    POSTGRES_URL: Boolean(asTrimmedString(process.env.POSTGRES_URL)),
    NEON_DATABASE_URL: Boolean(asTrimmedString(process.env.NEON_DATABASE_URL)),
  };
}

export function getDatabaseIdentitySnapshot() {
  const databaseUrl = asTrimmedString(process.env.DATABASE_URL);
  const envPresence = getDatabaseEnvPresence();
  const vercelEnv = asTrimmedString(process.env.VERCEL_ENV) || 'development';

  if (!hasDatabaseUrl()) {
    return {
      configured: false,
      sourceEnvKey: 'DATABASE_URL',
      vercelEnv,
      dbHost: null,
      dbName: null,
      dbSchema: null,
      dbUrlHash: null,
      envPresence,
      alternativeDbUrlHashes: {
        DIRECT_URL: toShortHash(process.env.DIRECT_URL),
        POSTGRES_URL: toShortHash(process.env.POSTGRES_URL),
        NEON_DATABASE_URL: toShortHash(process.env.NEON_DATABASE_URL),
      },
    };
  }

  const identity = parseDatabaseIdentity(databaseUrl);
  return {
    configured: true,
    sourceEnvKey: 'DATABASE_URL',
    vercelEnv,
    ...identity,
    dbUrlHash: toShortHash(databaseUrl),
    envPresence,
    alternativeDbUrlHashes: {
      DIRECT_URL: toShortHash(process.env.DIRECT_URL),
      POSTGRES_URL: toShortHash(process.env.POSTGRES_URL),
      NEON_DATABASE_URL: toShortHash(process.env.NEON_DATABASE_URL),
    },
  };
}

let warnedAboutDatabaseEnvMismatch = false;

function warnIfDatabaseEnvMismatch(databaseUrl) {
  if (warnedAboutDatabaseEnvMismatch) {
    return;
  }

  const alternateEntries = [
    ['DIRECT_URL', asTrimmedString(process.env.DIRECT_URL)],
    ['POSTGRES_URL', asTrimmedString(process.env.POSTGRES_URL)],
    ['NEON_DATABASE_URL', asTrimmedString(process.env.NEON_DATABASE_URL)],
  ].filter(([, value]) => Boolean(value));

  if (!alternateEntries.length) {
    warnedAboutDatabaseEnvMismatch = true;
    return;
  }

  const canonicalHash = toShortHash(databaseUrl);
  const mismatches = alternateEntries
    .map(([key, value]) => ({
      key,
      hash: toShortHash(value),
      matchesCanonical: value === databaseUrl,
    }))
    .filter((entry) => !entry.matchesCanonical);

  warnedAboutDatabaseEnvMismatch = true;
  if (!mismatches.length) {
    return;
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      route: 'db_client',
      message: 'DATABASE_URL differs from alternate database env vars',
      canonicalSource: 'DATABASE_URL',
      canonicalHash,
      mismatches,
    }),
  );
}

export function hasDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
    return false;
  }

  try {
    const parsed = new URL(databaseUrl);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

/**
 * Returns the canonical DATABASE_URL for all database operations.
 * CRITICAL: This function MUST fail fast in production if DATABASE_URL is missing.
 * This prevents silent fallback to ephemeral storage which causes data loss.
 */
export function getDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
  const isProduction = vercelEnv === 'production';

  if (!hasDatabaseUrl()) {
    const errorMessage = isProduction
      ? 'CRITICAL: DATABASE_URL is missing or invalid in production. ' +
        'This will cause data loss. Set DATABASE_URL in Vercel Environment Variables.'
      : 'Missing or invalid required environment variable: DATABASE_URL';

    // Log the failure for observability
    console.error(
      JSON.stringify({
        level: 'error',
        route: 'db_client',
        message: errorMessage,
        vercelEnv,
        envPresence: getDatabaseEnvPresence(),
      }),
    );

    throw new Error(errorMessage);
  }

  return databaseUrl;
}

let dbInitLogged = false;

export function getDb() {
  const globalKey = '__pm_drizzle_db';
  const globalStore = globalThis;
  const databaseUrl = getDatabaseUrl();
  warnIfDatabaseEnvMismatch(databaseUrl);

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = createDbClient(databaseUrl);

    // Log database identity on first connection for deploy debugging
    if (!dbInitLogged) {
      dbInitLogged = true;
      const identity = getDatabaseIdentitySnapshot();
      console.log(
        JSON.stringify({
          level: 'info',
          route: 'db_client',
          message: 'Database client initialized',
          vercelEnv: identity.vercelEnv,
          gitCommit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || null,
          dbHost: identity.dbHost,
          dbName: identity.dbName,
          dbUrlHash: identity.dbUrlHash,
        }),
      );
    }
  }

  return globalStore[globalKey];
}

export { schema };
