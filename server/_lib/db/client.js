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

export function getDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  if (!hasDatabaseUrl()) {
    throw new Error('Missing or invalid required environment variable: DATABASE_URL');
  }
  return databaseUrl;
}

export function getDb() {
  const globalKey = '__pm_drizzle_db';
  const globalStore = globalThis;
  const databaseUrl = getDatabaseUrl();
  warnIfDatabaseEnvMismatch(databaseUrl);

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = createDbClient(databaseUrl);
  }

  return globalStore[globalKey];
}

export { schema };
