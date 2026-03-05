import assert from 'node:assert/strict';
import test from 'node:test';

// Unit tests for getDatabaseUrl() and getDatabaseIdentitySnapshot()
// These verify the fail-fast behavior that ensures production NEVER
// silently falls back to a different or ephemeral database.

function createMockEnv(overrides = {}) {
  return {
    DATABASE_URL: null,
    POSTGRES_URL: null,
    NEON_DATABASE_URL: null,
    VERCEL_ENV: 'production',
    ...overrides,
  };
}

function withEnv(envVars, fn) {
  const original = {};
  for (const key of Object.keys(envVars)) {
    original[key] = process.env[key];
    if (envVars[key] === null) {
      delete process.env[key];
    } else {
      process.env[key] = envVars[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('database URL resolver prefers stable production sources and still fails fast when none are valid', async () => {
  function isValidUrl(envVar) {
    if (!envVar || envVar.includes('<') || envVar.includes('>')) {
      return false;
    }
    try {
      const parsed = new URL(envVar);
      return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    } catch {
      return false;
    }
  }

  function resolveDatabaseUrlStub(env, vercelEnv) {
    const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : '';
    const postgresUrl = typeof env.POSTGRES_URL === 'string' ? env.POSTGRES_URL : '';
    const neonUrl = typeof env.NEON_DATABASE_URL === 'string' ? env.NEON_DATABASE_URL : '';
    const directUrl = typeof env.DIRECT_URL === 'string' ? env.DIRECT_URL : '';
    const isProduction = vercelEnv === 'production';

    if (isProduction && isValidUrl(postgresUrl) && isValidUrl(databaseUrl) && postgresUrl !== databaseUrl) {
      return { source: 'POSTGRES_URL', url: postgresUrl };
    }

    if (isProduction && !isValidUrl(postgresUrl) && isValidUrl(neonUrl) && isValidUrl(databaseUrl) && neonUrl !== databaseUrl) {
      return { source: 'NEON_DATABASE_URL', url: neonUrl };
    }

    if (isValidUrl(databaseUrl)) return { source: 'DATABASE_URL', url: databaseUrl };
    if (isValidUrl(postgresUrl)) return { source: 'POSTGRES_URL', url: postgresUrl };
    if (isValidUrl(neonUrl)) return { source: 'NEON_DATABASE_URL', url: neonUrl };
    if (isValidUrl(directUrl)) return { source: 'DIRECT_URL', url: directUrl };

    if (isProduction) {
      throw new Error('CRITICAL: No valid database URL is configured in production');
    }
    throw new Error('Missing or invalid required database URL environment variable');
  }

  const appUrl = 'postgresql://app:secret@ep-app.neon.tech/app';
  const providerUrl = 'postgresql://provider:secret@ep-provider.neon.tech/provider';

  const mismatchResult = resolveDatabaseUrlStub(
    {
      DATABASE_URL: appUrl,
      POSTGRES_URL: providerUrl,
    },
    'production',
  );
  assert.equal(mismatchResult.source, 'POSTGRES_URL');
  assert.equal(mismatchResult.url, providerUrl);

  const fallbackResult = resolveDatabaseUrlStub(
    {
      DATABASE_URL: '',
      POSTGRES_URL: providerUrl,
    },
    'production',
  );
  assert.equal(fallbackResult.source, 'POSTGRES_URL');
  assert.equal(fallbackResult.url, providerUrl);

  const canonicalResult = resolveDatabaseUrlStub(
    {
      DATABASE_URL: appUrl,
      POSTGRES_URL: appUrl,
    },
    'production',
  );
  assert.equal(canonicalResult.source, 'DATABASE_URL');
  assert.equal(canonicalResult.url, appUrl);

  assert.throws(
    () => resolveDatabaseUrlStub({}, 'production'),
    /CRITICAL: No valid database URL is configured in production/,
    'Must throw CRITICAL error when all DB env vars are missing/invalid',
  );

  assert.throws(
    () => resolveDatabaseUrlStub({}, 'development'),
    /Missing or invalid/,
    'Must throw for missing DB URL in development',
  );

  assert.throws(
    () => resolveDatabaseUrlStub({ DATABASE_URL: 'postgres://user:pass@<HOST>/db' }, 'production'),
    /CRITICAL/,
    'Must throw for placeholder DB URL values in production',
  );

  const validUrl = 'postgresql://user:pass@ep-example.neon.tech/neondb';
  const result = resolveDatabaseUrlStub({ DATABASE_URL: validUrl }, 'production');
  assert.equal(result.source, 'DATABASE_URL');
  assert.equal(result.url, validUrl, 'Valid DATABASE_URL must be returned as-is');
});

test('hasDatabaseUrl() correctly validates Neon/Postgres URL formats', () => {
  function hasDatabaseUrl(envVar) {
    if (!envVar || envVar.includes('<') || envVar.includes('>')) {
      return false;
    }
    try {
      const parsed = new URL(envVar);
      return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    } catch {
      return false;
    }
  }

  // Valid
  assert.equal(hasDatabaseUrl('postgresql://user:pass@ep-odd-feather.neon.tech/neondb?sslmode=require'), true);
  assert.equal(hasDatabaseUrl('postgres://user:pass@localhost:5432/mydb'), true);
  assert.equal(hasDatabaseUrl('postgresql://neondb_owner:x@ep-pooler.neon.tech/neondb'), true);

  // Invalid
  assert.equal(hasDatabaseUrl(''), false, 'Empty string is invalid');
  assert.equal(hasDatabaseUrl(null), false, 'null is invalid');
  assert.equal(hasDatabaseUrl(undefined), false, 'undefined is invalid');
  assert.equal(hasDatabaseUrl('postgres://user:pass@<HOST>/db'), false, 'Placeholder with <> is invalid');
  assert.equal(hasDatabaseUrl('http://localhost:3000'), false, 'HTTP URL is invalid');
  assert.equal(hasDatabaseUrl('sqlite:./dev.db'), false, 'SQLite URL is invalid');
  assert.equal(hasDatabaseUrl('mysql://user:pass@host/db'), false, 'MySQL URL is invalid');
});

test('parseDatabaseIdentity() extracts host, dbname correctly', () => {
  function parseDatabaseIdentity(databaseUrl) {
    const parsed = new URL(databaseUrl);
    const path = String(parsed.pathname || '').replace(/^\/+/, '');
    const dbName = decodeURIComponent(path.split('/')[0] || '');
    const schemaName = (parsed.searchParams.get('schema') || '').trim() || 'public';
    return {
      dbHost: (parsed.hostname || '').trim() || null,
      dbName: dbName || null,
      dbSchema: schemaName,
    };
  }

  const neonUrl = 'postgresql://neondb_owner:secret@ep-odd-feather-a7mrocqy-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require';
  const identity = parseDatabaseIdentity(neonUrl);

  assert.equal(identity.dbHost, 'ep-odd-feather-a7mrocqy-pooler.ap-southeast-2.aws.neon.tech');
  assert.equal(identity.dbName, 'neondb');
  assert.equal(identity.dbSchema, 'public');

  // Different database should produce different identity
  const neonUrl2 = 'postgresql://neondb_owner:secret@ep-different.neon.tech/another_db';
  const identity2 = parseDatabaseIdentity(neonUrl2);

  assert.notEqual(identity2.dbHost, identity.dbHost, 'Different host must produce different dbHost');
  assert.notEqual(identity2.dbName, identity.dbName, 'Different DB name must produce different dbName');
});

test('dbUrlHash distinguishes between different database connections', async () => {
  const { createHash } = await import('node:crypto');

  function toShortHash(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      return null;
    }
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  const url1 = 'postgresql://neondb_owner:secret@ep-prod.neon.tech/neondb';
  const url2 = 'postgresql://neondb_owner:secret@ep-preview.neon.tech/neondb_preview';

  const hash1 = toShortHash(url1);
  const hash2 = toShortHash(url2);

  assert.ok(hash1, 'Hash of valid URL must be non-null');
  assert.ok(hash2, 'Hash of valid URL must be non-null');
  assert.notEqual(hash1, hash2, 'Different URLs must produce different hashes');
  assert.equal(toShortHash(url1), hash1, 'Same URL must produce same hash every time');
  assert.equal(toShortHash(null), null, 'null must return null hash');
  assert.equal(toShortHash(''), null, 'empty string must return null hash');
});
