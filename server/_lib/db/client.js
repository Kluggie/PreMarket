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

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = createDbClient(getDatabaseUrl());
  }

  return globalStore[globalKey];
}

export { schema };
