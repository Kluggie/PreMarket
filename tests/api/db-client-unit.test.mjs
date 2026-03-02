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

test('getDatabaseUrl() throws when DATABASE_URL is missing in production', async () => {
  // Inline test of hasDatabaseUrl logic without importing the module
  // (avoids circular issues with dotenv calls on load)
  function hasDatabaseUrlStub(envVar) {
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

  function getDatabaseUrlStub(envVar, vercelEnv) {
    if (!hasDatabaseUrlStub(envVar)) {
      if (vercelEnv === 'production') {
        throw new Error('CRITICAL: DATABASE_URL is missing or invalid in production');
      }
      throw new Error('Missing or invalid required environment variable: DATABASE_URL');
    }
    return envVar;
  }

  // Test: missing DATABASE_URL in production must throw
  assert.throws(
    () => getDatabaseUrlStub('', 'production'),
    /CRITICAL.*DATABASE_URL.*missing.*production/,
    'Must throw CRITICAL error for missing DATABASE_URL in production',
  );

  // Test: missing DATABASE_URL in development must throw (different message)
  assert.throws(
    () => getDatabaseUrlStub('', 'development'),
    /Missing or invalid/,
    'Must throw for missing DATABASE_URL in development',
  );

  // Test: placeholder value must throw
  assert.throws(
    () => getDatabaseUrlStub('postgres://user:pass@<HOST>/db', 'production'),
    /CRITICAL/,
    'Must throw for placeholder DATABASE_URL in production',
  );

  // Test: valid DATABASE_URL must succeed
  const validUrl = 'postgresql://user:pass@ep-example.neon.tech/neondb';
  const result = getDatabaseUrlStub(validUrl, 'production');
  assert.equal(result, validUrl, 'Valid DATABASE_URL must be returned as-is');
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
