/**
 * persistence-hardening.test.mjs
 *
 * Systematic persistence safety tests covering:
 *
 * 1. httpClient — 200+non-JSON responses must throw, not silently return {}
 * 2. dashboardClient — missing summary field on 2xx must throw, not return zeros
 * 3. API client patterns — no response.X || {zeroCounts} fallbacks in src/api/
 * 4. UI error semantics — pages must not mask backend errors as empty data
 * 5. Guard script — Check 7 catches silent zero-count fallbacks correctly
 * 6. Server route error handling — DB errors produce 503, not 200+empty
 * 7. Data architecture — durable state is in Postgres, not module-level Maps
 *
 * These are unit/static tests. No DATABASE_URL required.
 * Run via: npm run test:api:integration
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const srcApiDir = path.join(rootDir, 'src', 'api');
const serverDir = path.join(rootDir, 'server');

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 1: httpClient.js — 200+non-JSON must throw
//
// WHY: parseJsonSafely() used to return {} on JSON parse failure. A 200 with
// an empty body (proxy error, CDN, server mid-crash) would return {} silently,
// allowing downstream `response.field || fallback` patterns to mask the failure.
// The fix: track jsonParsed flag and throw if 2xx but JSON parsing failed.
// ──────────────────────────────────────────────────────────────────────────────

test('httpClient.js: 200+non-JSON guard is present in source', () => {
  const httpClientPath = path.join(srcApiDir, 'httpClient.js');
  assert.ok(fs.existsSync(httpClientPath), 'httpClient.js must exist');
  const content = fs.readFileSync(httpClientPath, 'utf8');

  // Must NOT use the old silent parseJsonSafely pattern
  assert.ok(
    !content.includes('parseJsonSafely'),
    'httpClient.js must not use the old parseJsonSafely() function that swallowed JSON errors silently',
  );

  // Must track whether JSON parsing actually succeeded
  assert.ok(
    content.includes('jsonParsed'),
    'httpClient.js must track jsonParsed flag to detect 200+non-JSON responses',
  );

  // Must throw when 2xx + JSON parse failed
  assert.ok(
    content.includes('invalid_response'),
    'httpClient.js must throw an error with code "invalid_response" when 2xx response has no valid JSON body',
  );
});

test('httpClient.js: throws on 200+non-JSON via simulated fetch mock', async () => {
  // We simulate the httpClient logic inline (can't import due to @/ alias in Node tests)
  // This mirrors the exact request() function logic post-fix.

  function toError(response, body) {
    const errorMessage = body?.error?.message || body?.message || 'Request failed';
    const errorCode = body?.error?.code || 'request_failed';
    const error = new Error(errorMessage);
    error.status = response.status;
    error.code = errorCode;
    return error;
  }

  async function simulateRequest(mockResponse) {
    let body;
    let jsonParsed = false;
    try {
      body = await mockResponse.json();
      jsonParsed = true;
    } catch {
      body = {};
    }

    if (!mockResponse.ok || body?.ok === false) {
      throw toError(mockResponse, body);
    }

    if (!jsonParsed) {
      const err = new Error(`Server returned a non-JSON response`);
      err.status = mockResponse.status;
      err.code = 'invalid_response';
      throw err;
    }

    return body;
  }

  // Case A: 200 with valid JSON — must succeed
  const validResponse = {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, summary: { sentCount: 3 } }),
  };
  const result = await simulateRequest(validResponse);
  assert.equal(result.summary.sentCount, 3, 'Valid JSON response must return data');

  // Case B: 200 with empty/non-JSON body — must throw invalid_response
  const emptyBodyResponse = {
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
  };
  await assert.rejects(
    () => simulateRequest(emptyBodyResponse),
    (err) => {
      assert.equal(err.code, 'invalid_response', 'Must throw invalid_response on 200+non-JSON');
      return true;
    },
  );

  // Case C: 401 with JSON error body — must throw with the error details
  const unauthorizedResponse = {
    ok: false,
    status: 401,
    json: async () => ({ ok: false, error: { code: 'unauthorized', message: 'Authentication required' } }),
  };
  await assert.rejects(
    () => simulateRequest(unauthorizedResponse),
    (err) => {
      assert.equal(err.code, 'unauthorized', 'Must propagate error code from 401 response');
      return true;
    },
  );

  // Case D: 503 with JSON body.ok===false — must throw
  const dbErrorResponse = {
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: { code: 'db_schema_missing', message: 'Migration not applied' } }),
  };
  await assert.rejects(
    () => simulateRequest(dbErrorResponse),
    (err) => {
      assert.equal(err.code, 'db_schema_missing', 'Must propagate db_schema_missing code');
      return true;
    },
  );

  // Case E: 200 with body.ok===false (explicit server-side failure on 200) — must throw
  const explicitFailureOnOk = {
    ok: true,
    status: 200,
    json: async () => ({ ok: false, error: { code: 'some_logic_error', message: 'Logic failed' } }),
  };
  await assert.rejects(
    () => simulateRequest(explicitFailureOnOk),
    (err) => {
      assert.equal(err.code, 'some_logic_error', 'Must throw when body.ok===false even on 200');
      return true;
    },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 2: dashboardClient.js — no silent zero fallback
//
// WHY: response.summary || { sentCount: 0, ... } returned fake zero stats when
// the API call succeeded but summary was absent. This made "API failure" look
// identical to "user has no proposals". The fix throws instead.
// ──────────────────────────────────────────────────────────────────────────────

test('dashboardClient.js: silent zero-count fallback is NOT present', () => {
  const clientPath = path.join(srcApiDir, 'dashboardClient.js');
  assert.ok(fs.existsSync(clientPath), 'dashboardClient.js must exist');
  const content = fs.readFileSync(clientPath, 'utf8');

  // The old dangerous pattern:  response.summary || { sentCount: 0
  assert.ok(
    !content.includes('sentCount: 0'),
    'dashboardClient.js must NOT contain sentCount: 0 fallback — this silently masks API failures as zero data',
  );
  assert.ok(
    !content.includes('receivedCount: 0'),
    'dashboardClient.js must NOT contain receivedCount: 0 fallback',
  );

  // Must throw when summary is absent
  assert.ok(
    content.includes('invalid_response') || content.includes('throw'),
    'dashboardClient.js must throw when response.summary is absent, not return zero fallback',
  );
});

test('dashboardClient.js: getSummary throws when response.summary is missing', async () => {
  // Inline simulation of getSummary() logic post-fix
  function simulateGetSummary(response) {
    if (!response.summary || typeof response.summary !== 'object') {
      const error = new Error('Dashboard summary missing from server response');
      error.code = 'invalid_response';
      throw error;
    }
    return response.summary;
  }

  // Valid response — must return summary
  const validSummary = { sentCount: 5, receivedCount: 2, draftsCount: 1, mutualInterestCount: 0, wonCount: 3, lostCount: 1, totalCount: 7 };
  const result = simulateGetSummary({ summary: validSummary });
  assert.equal(result.sentCount, 5, 'Must return summary.sentCount from valid response');

  // Response with missing summary — must throw
  assert.throws(
    () => simulateGetSummary({ ok: true }),
    (err) => {
      assert.equal(err.code, 'invalid_response', 'Must throw invalid_response when summary is absent');
      return true;
    },
    'getSummary must throw when summary is absent, not return zeros',
  );

  // Response with null summary — must throw
  assert.throws(
    () => simulateGetSummary({ summary: null }),
    (err) => {
      assert.equal(err.code, 'invalid_response', 'Must throw invalid_response when summary is null');
      return true;
    },
  );

  // Response with scalar summary — must throw
  assert.throws(
    () => simulateGetSummary({ summary: 0 }),
    (err) => {
      assert.equal(err.code, 'invalid_response', 'Must throw invalid_response when summary is not an object');
      return true;
    },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 3: API client patterns — static scan for dangerous fallbacks
//
// Verify that no src/api/*.js file contains the pattern:
//   response.FIELD || { ...zeroCounts }
// which silently converts backend errors to fake "no data" responses.
// ──────────────────────────────────────────────────────────────────────────────

test('src/api/*.js: no silent zero-count object fallback on response fields', () => {
  // This pattern: response.X || { someKey: 0 } is dangerous because it converts
  // any missing field in a 2xx response to fake zeros, masking failures.
  const silentZeroPattern = /response\.\w+\s*\|\|\s*\{[^}]*:\s*0[^}]*\}/s;

  const apiFiles = fs.readdirSync(srcApiDir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(srcApiDir, f), 'utf8') }));

  const violations = apiFiles.filter(({ content }) => silentZeroPattern.test(content));

  assert.equal(
    violations.length,
    0,
    `Found silent zero-count fallback pattern in API client(s): ${violations.map((v) => v.name).join(', ')}. ` +
    'Fix: throw when the expected field is absent instead of returning fake zeros. ' +
    'See dashboardClient.js for the correct pattern.',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 4: UI pages — error state handling (static analysis)
//
// Verify that key pages destructure isError from useQuery for data-bearing queries.
// This prevents silent empty/zero display when the API fails.
// ──────────────────────────────────────────────────────────────────────────────

test('Dashboard.jsx: summary query destructures isError', () => {
  const dashboardPath = path.join(rootDir, 'src', 'pages', 'Dashboard.jsx');
  assert.ok(fs.existsSync(dashboardPath), 'Dashboard.jsx must exist');
  const content = fs.readFileSync(dashboardPath, 'utf8');

  assert.ok(
    content.includes('isError: summaryError') || content.includes('isError:summaryError'),
    'Dashboard.jsx summary useQuery must destructure isError so stats show "—" not "0" on API failure',
  );
});

test('Dashboard.jsx: stats render uses summaryError guard (not raw nullish)', () => {
  const dashboardPath = path.join(rootDir, 'src', 'pages', 'Dashboard.jsx');
  const content = fs.readFileSync(dashboardPath, 'utf8');

  assert.ok(
    content.includes('summaryError'),
    'Dashboard.jsx must reference summaryError in the stats render to distinguish "0 proposals" from "API failure"',
  );
});

test('ProposalsChart.jsx: activity query destructures isError', () => {
  const chartPath = path.join(rootDir, 'src', 'components', 'dashboard', 'ProposalsChart.jsx');
  assert.ok(fs.existsSync(chartPath), 'ProposalsChart.jsx must exist');
  const content = fs.readFileSync(chartPath, 'utf8');

  assert.ok(
    content.includes('isError') || content.includes('activityError'),
    'ProposalsChart.jsx must handle isError from the activity query — otherwise error looks like "no activity"',
  );
});

test('Proposals.jsx: summary query destructures isError', () => {
  const proposalsPath = path.join(rootDir, 'src', 'pages', 'Proposals.jsx');
  assert.ok(fs.existsSync(proposalsPath), 'Proposals.jsx must exist');
  const content = fs.readFileSync(proposalsPath, 'utf8');

  assert.ok(
    content.includes('summaryError') || content.includes('isError: summaryError'),
    'Proposals.jsx must handle summaryError from the summary query',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 5: Guard script — Check 7 pattern detection
// ──────────────────────────────────────────────────────────────────────────────

test('guard-db-safety.mjs: contains Check 7 for silent zero-count fallbacks', () => {
  const guardPath = path.join(rootDir, 'scripts', 'guard-db-safety.mjs');
  assert.ok(fs.existsSync(guardPath), 'guard-db-safety.mjs must exist');
  const content = fs.readFileSync(guardPath, 'utf8');

  assert.ok(
    content.includes('CHECK 7') || content.includes('silentZeroFallback') || content.includes('silent zero-count'),
    'guard-db-safety.mjs must include Check 7 that scans API clients for dangerous silent zero fallbacks',
  );
});

test('guard-db-safety.mjs: Check 7 contains all three pattern detectors', () => {
  const guardPath = path.join(rootDir, 'scripts', 'guard-db-safety.mjs');
  const content = fs.readFileSync(guardPath, 'utf8');

  // Must scan for zero-count object fallbacks: response.X || { ...: 0 }
  assert.ok(
    content.includes('silentZeroObjectPattern'),
    'Guard must include silentZeroObjectPattern for response.X || { ...: 0 } objects',
  );

  // Must scan for numeric zero fallbacks: Number(response.X || 0)
  assert.ok(
    content.includes('silentZeroNumericPattern'),
    'Guard must include silentZeroNumericPattern for Number(response.X || 0)',
  );

  // Must scan for empty-array fallbacks: response.X || []
  assert.ok(
    content.includes('silentArrayFallbackPattern'),
    'Guard must include silentArrayFallbackPattern for response.X || []',
  );
});

test('guard-db-safety.mjs: Check 7 patterns correctly detect dangerous fallbacks', () => {
  // Test all three detection patterns from Check 7 directly.
  const silentZeroObjectPattern = /response\.\w+\s*\|\|\s*\{[^}]*:\s*0[^}]*\}/s;
  const silentZeroNumericPattern = /Number\s*\(\s*response\.\w+\s*\|\|\s*0\s*\)/;
  const silentArrayFallbackPattern = /response\.\w+\s*\|\|\s*\[\]/;

  // (A) Zero-count object fallback — should match
  assert.ok(
    silentZeroObjectPattern.test("return response.summary || { sentCount: 0, receivedCount: 0 };"),
    'silentZeroObjectPattern must detect response.FIELD || { count: 0 }',
  );
  assert.ok(
    !silentZeroObjectPattern.test("return response.proposals || [];"),
    'silentZeroObjectPattern must NOT flag response.X || []',
  );

  // (B) Numeric zero fallback — should match
  assert.ok(
    silentZeroNumericPattern.test("return { claimed: Number(response.seatsClaimed || 0) };"),
    'silentZeroNumericPattern must detect Number(response.FIELD || 0)',
  );
  assert.ok(
    !silentZeroNumericPattern.test("typeof response.count === 'number' ? response.count : 0"),
    'silentZeroNumericPattern must not flag safe ternary guards',
  );

  // (C) Empty-array fallback — should match
  assert.ok(
    silentArrayFallbackPattern.test("return response.proposals || [];"),
    'silentArrayFallbackPattern must detect response.FIELD || []',
  );
  assert.ok(
    !silentArrayFallbackPattern.test("return response.proposals ?? null;"),
    'silentArrayFallbackPattern must not flag response.X ?? null',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 6: Server-side error handling — DB errors produce explicit failures
// ──────────────────────────────────────────────────────────────────────────────

test('toApiError: 42P01 (undefined_table) → 503 db_schema_missing (not 200+empty)', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const err = new Error('relation "proposals" does not exist');
  err.code = '42P01';

  const apiError = toApiError(err);
  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_schema_missing');
});

test('toApiError: 42703 (undefined_column) → 503 db_schema_missing', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const err = new Error('column "email_normalized" does not exist');
  err.code = '42703';

  const apiError = toApiError(err);
  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_schema_missing');
});

test('toApiError: 08006 (connection_failure) → 503 db_unavailable', async () => {
  const { toApiError } = await import('../../server/_lib/errors.js');

  const err = new Error('connection refused');
  err.code = '08006';

  const apiError = toApiError(err);
  assert.equal(apiError.statusCode, 503);
  assert.equal(apiError.code, 'db_unavailable');
});

test('server routes: withApiRoute catches all errors and returns structured JSON', async () => {
  // Verify the wrapper route behavior using mock req/res
  const { withApiRoute } = await import('../../server/_lib/route.js');

  const responses = [];
  function createMockRes() {
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { this.body = body; },
      jsonBody() { return JSON.parse(this.body); },
    };
    return res;
  }

  // Simulate a DB schema error inside a route handler
  const req = { method: 'GET', url: '/api/test', headers: {} };
  const res = createMockRes();

  await withApiRoute(req, res, '/api/test', async () => {
    const err = new Error('relation "missing_table" does not exist');
    err.code = '42P01';
    throw err;
  });

  assert.equal(res.statusCode, 503, 'DB schema error must produce 503');
  const body = res.jsonBody();
  assert.equal(body.ok, false, 'Error response must have ok:false');
  assert.equal(body.error.code, 'db_schema_missing', 'Error code must be db_schema_missing');
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 7: Data architecture — durable state is in Postgres
//
// Scan server route files for module-level mutable state that is NOT the
// intentional DB client memoization, and verify it has documentation.
// ──────────────────────────────────────────────────────────────────────────────

test('server routes: in-memory Maps are documented as intentionally ephemeral', () => {
  // We specifically check the known in-memory rate limiter.
  // This is the ONLY non-DB state in server routes; it must have an explicit
  // comment explaining that it resets on cold start/deploy (by design).
  const documentsRoutePath = path.join(serverDir, 'routes', 'documents', 'index.ts');
  assert.ok(fs.existsSync(documentsRoutePath), 'documents/index.ts must exist');
  const content = fs.readFileSync(documentsRoutePath, 'utf8');

  assert.ok(
    content.includes('INTENTIONALLY EPHEMERAL') || content.includes('intentionally ephemeral') || content.includes('cold start'),
    'The in-memory _uploadTimestamps Map in documents/index.ts must be documented as intentionally ephemeral, ' +
    'explaining it resets on cold start and is not durable storage.',
  );
});

test('server routes: no undocumented module-level mutable Maps used for durable data', () => {
  // Walk all server route files and find module-level Maps.
  // Known intentional ones: _uploadTimestamps (rate limiter, documents/index.ts)
  // DB client: globalThis.__pm_drizzle_db (correct, already documented)
  const KNOWN_SAFE_EPHEMERAL = ['_uploadTimestamps'];

  function walkTs(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkTs(full));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        results.push(full);
      }
    }
    return results;
  }

  // Pattern: module-level `const NAME = new Map<...>()` or `let NAME = new Map()`
  // (not inside a function, not in a test file)
  const moduleLevelMapPattern = /^(?:const|let|var)\s+(\w+)\s*=\s*new\s+Map[<(]/m;

  const serverRouteFiles = walkTs(path.join(serverDir, 'routes'));
  const violations = [];

  for (const filePath of serverRouteFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    // Remove everything inside functions to check only top-level declarations
    // Simple heuristic: look for the pattern at the start of a line (not indented)
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Top-level means no leading whitespace (or minimal)
      if (/^(?:const|let|var)\s+(\w+)\s*=\s*new\s+Map[<(]/.test(line)) {
        const match = line.match(/^(?:const|let|var)\s+(\w+)/);
        const mapName = match ? match[1] : 'unknown';
        if (!KNOWN_SAFE_EPHEMERAL.includes(mapName)) {
          violations.push({ file: path.relative(rootDir, filePath), line: i + 1, name: mapName });
        }
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    'Found undocumented module-level Maps in server routes: ' +
    violations.map((v) => `${v.file}:${v.line} (${v.name})`).join(', ') + '. ' +
    'Module-level Maps reset on cold start/deploy and must NOT be used for durable data. ' +
    'Either move to Postgres or document explicitly as INTENTIONALLY EPHEMERAL.',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 8: Environment safety
//
// Verify the server's env handling fails loudly for broken config.
// ──────────────────────────────────────────────────────────────────────────────

test('env.ts: respondIfEnvMissing returns 503 when vars are absent', async () => {
  // We can't easily import env.ts without all the server context, so we test
  // structurally: verify the function exists and produces 503 responses.
  const envPath = path.join(serverDir, '_lib', 'env.ts');
  assert.ok(fs.existsSync(envPath), 'server/_lib/env.ts must exist');
  const content = fs.readFileSync(envPath, 'utf8');

  // Must define respondIfEnvMissing that returns 503
  assert.ok(
    content.includes('respondIfEnvMissing') && content.includes('503'),
    'env.ts must define respondIfEnvMissing() that returns 503 when required env vars are missing',
  );

  // Must check all four critical vars
  assert.ok(content.includes('DATABASE_URL'), 'env.ts must check DATABASE_URL');
  assert.ok(content.includes('SESSION_SECRET'), 'env.ts must check SESSION_SECRET');
  assert.ok(content.includes('APP_BASE_URL'), 'env.ts must check APP_BASE_URL');
  assert.ok(content.includes('GOOGLE_CLIENT_ID'), 'env.ts must check GOOGLE_CLIENT_ID');
});

test('db/client.js: getDatabaseUrl fails fast on missing DATABASE_URL', () => {
  const clientPath = path.join(serverDir, '_lib', 'db', 'client.js');
  assert.ok(fs.existsSync(clientPath), 'db/client.js must exist');
  const content = fs.readFileSync(clientPath, 'utf8');

  // The fail-fast pattern: getDatabaseUrl OR an error throw when DATABASE_URL is missing
  assert.ok(
    content.includes('getDatabaseUrl') || content.includes('hasDatabaseUrl'),
    'db/client.js must have a getDatabaseUrl() or hasDatabaseUrl() function for fail-fast DB initialization',
  );

  // Must not have a fallback URL
  assert.ok(
    !content.includes("|| 'postgres://") && !content.includes('|| "postgres://'),
    'db/client.js must NOT have a hardcoded fallback Postgres URL',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 9: Auth vs persistence clarity
//
// Verify that auth failures (401) cannot be mistaken for empty data.
// The critical invariant: routes must return 401 (not 200+[]) on missing auth.
// ──────────────────────────────────────────────────────────────────────────────

test('requireUser: unauthenticated session returns 401, not empty data', async () => {
  const { ApiError } = await import('../../server/_lib/errors.js');

  // Import auth module
  const authModule = await import('../../server/_lib/auth.js');
  const { requireUser } = authModule;

  // Simulate a request with no cookie / missing session
  const req = { headers: {}, method: 'GET', url: '/api/proposals' };
  const writtenStatus = { code: null, body: '' };
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) { this.writtenBody = body; },
    writtenBody: '',
  };

  const result = await requireUser(req, res);

  // On missing session, requireUser returns { ok: false } and writes 401
  assert.equal(
    result.ok,
    false,
    'requireUser must return { ok: false } when no session cookie is present',
  );

  // Verify the response was NOT 200 (would be misleading as empty data)
  assert.notEqual(
    res.statusCode,
    200,
    'requireUser must set a non-200 status for unauthenticated requests',
  );
});

test('proposals route: GET without session must NOT return 200+proposals array', async () => {
  // The key invariant: an unauthenticated request must never return 200 with a
  // proposals array. It should return 401 (auth failure) or 503 (env/db not
  // configured — in CI/test environments without DATABASE_URL or SESSION_SECRET
  // the env guard fires first and returns 503, which is also correct and safe).
  // What we must NEVER see: 200 + { proposals: [...] }.
  const handlerModule = await import('../../server/routes/proposals/index.ts');
  const handler = handlerModule.default;

  let responseStatus = null;
  let responseBody = '';

  const req = {
    method: 'GET',
    url: '/api/proposals',
    headers: {},
    query: {},
  };

  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) { responseBody = body; },
    get statusCode() { return this._statusCode || 200; },
    set statusCode(code) { this._statusCode = code; responseStatus = code; },
    _statusCode: 200,
  };

  await handler(req, res);

  // Must not be 200 (that would mean data leaked without auth or env setup)
  assert.notEqual(
    responseStatus,
    200,
    `GET /api/proposals without session must not return 200. Got: ${responseStatus}. ` +
    'Expected 401 (no auth) or 503 (env vars absent in test environment).',
  );

  // Body must have ok:false and must not contain a proposals array
  let parsed;
  try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
  if (parsed) {
    assert.equal(parsed.ok, false, 'Error response must have ok:false');
    assert.ok(
      !parsed.proposals,
      'Error response must not contain a proposals array — data must not leak on unauthenticated/unconfigured requests',
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 10: API client list endpoint hardening
//
// These tests verify that ALL primary list endpoints in API clients throw
// (with code: 'invalid_response') when the server returns a 2xx response
// that is missing the expected array field.
//
// WHY: A missing array on a 2xx response is a server-side bug. Returning []
// makes it look like "no data" to the UI, masking the real cause.
// ──────────────────────────────────────────────────────────────────────────────

test('betaClient.js: requireCount throws when seatsClaimed is missing or non-numeric', () => {
  // Inline simulation of betaClient.getCount() logic post-fix.
  function requireCount(response, field) {
    if (typeof response[field] !== 'number') {
      const err = new Error(`Server response missing "${field}" count`);
      err.code = 'invalid_response';
      throw err;
    }
    return response[field];
  }

  // Valid response — must return the count
  assert.equal(requireCount({ seatsClaimed: 12 }, 'seatsClaimed'), 12);

  // Missing field — must throw
  assert.throws(
    () => requireCount({}, 'seatsClaimed'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
    'betaClient.getCount must throw when seatsClaimed is absent — 0 is indistinguishable from "no signups"',
  );

  // String instead of number — must throw
  assert.throws(
    () => requireCount({ seatsClaimed: '12' }, 'seatsClaimed'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
    'betaClient.getCount must throw when seatsClaimed is a string, not a number',
  );

  // null — must throw
  assert.throws(
    () => requireCount({ seatsClaimed: null }, 'seatsClaimed'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
    'betaClient.getCount must throw when seatsClaimed is null',
  );
});

test('proposalsClient.js: requireArray throws when proposals field is missing', () => {
  // Inline simulation of requireArray() logic as defined in proposalsClient.js.
  function requireArray(response, field) {
    if (!Array.isArray(response[field])) {
      const err = new Error(`Server response missing "${field}" array`);
      err.code = 'invalid_response';
      throw err;
    }
    return response[field];
  }

  // Valid empty array — must NOT throw (empty list is legitimate "no data")
  const result = requireArray({ proposals: [] }, 'proposals');
  assert.deepEqual(result, []);

  // Valid populated array — must return it
  const proposals = [{ id: '1', title: 'Test' }];
  assert.deepEqual(requireArray({ proposals }, 'proposals'), proposals);

  // Missing proposals key — must throw (not silently return [])
  assert.throws(
    () => requireArray({}, 'proposals'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
    'proposalsClient.list() must throw when proposals is absent — "missing field" must not look like "no proposals"',
  );

  // null instead of array — must throw
  assert.throws(
    () => requireArray({ proposals: null }, 'proposals'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
  );

  // Object instead of array — must throw
  assert.throws(
    () => requireArray({ proposals: {} }, 'proposals'),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
  );
});

test('src/api/*.js: no response.FIELD || [] patterns remaining', () => {
  // After the hardening pass, NO API client should contain response.X || []
  // on server response fields. Use requireArray() or equivalent instead.
  const silentArrayFallbackPattern = /response\.\w+\s*\|\|\s*\[\]/;

  const apiFiles = fs.readdirSync(srcApiDir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(srcApiDir, f), 'utf8') }));

  const violations = apiFiles.filter(({ content }) => silentArrayFallbackPattern.test(content));

  assert.equal(
    violations.length,
    0,
    `Found response.FIELD || [] pattern in API client(s): ${violations.map((v) => v.name).join(', ')}. ` +
    'Fix: use requireArray(response, "field") or throw explicitly instead of returning []. ' +
    'An empty array silently masks backend failures as "no data".',
  );
});

test('src/api/*.js: no Number(response.FIELD || 0) patterns remaining', () => {
  // After the hardening pass, NO API client should contain Number(response.X || 0).
  // Use typeof guards (e.g. typeof x === "number" ? x : 0) or throw for required fields.
  const silentNumericFallbackPattern = /Number\s*\(\s*response\.\w+\s*\|\|\s*0\s*\)/;

  const apiFiles = fs.readdirSync(srcApiDir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.ts'))
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(srcApiDir, f), 'utf8') }));

  const violations = apiFiles.filter(({ content }) => silentNumericFallbackPattern.test(content));

  assert.equal(
    violations.length,
    0,
    `Found Number(response.FIELD || 0) pattern in API client(s): ${violations.map((v) => v.name).join(', ')}. ` +
    'Fix: use typeof guards or throw for required numeric counts. ' +
    'Returning 0 silently masks backend failures as "zero signups / zero count".',
  );
});

test('betaClient.js: missing seatsClaimed in source (does NOT use || 0 fallback)', () => {
  const betaClientPath = path.join(srcApiDir, 'betaClient.js');
  assert.ok(fs.existsSync(betaClientPath), 'betaClient.js must exist');
  const content = fs.readFileSync(betaClientPath, 'utf8');

  assert.ok(
    !content.includes('seatsClaimed || 0'),
    'betaClient.js must NOT use seatsClaimed || 0 — returning 0 when seatsClaimed is absent would make ' +
    '"beta stats API failed" look identical to "zero people have signed up"',
  );

  assert.ok(
    content.includes('requireCount') || content.includes('invalid_response'),
    'betaClient.js must use requireCount() or throw invalid_response when seatsClaimed is absent',
  );
});

test('proposalsClient.js: uses requireArray() for proposals list (not || [] fallback)', () => {
  const proposalsClientPath = path.join(srcApiDir, 'proposalsClient.js');
  const content = fs.readFileSync(proposalsClientPath, 'utf8');

  assert.ok(
    content.includes('requireArray'),
    'proposalsClient.js must use requireArray() helper to guard proposal list responses',
  );

  assert.ok(
    !content.includes('response.proposals || []'),
    'proposalsClient.js must NOT use response.proposals || [] — this silently converts "missing proposals field" into empty list',
  );
});

test('notificationsClient.js: throws when notifications array is missing', () => {
  const clientPath = path.join(srcApiDir, 'notificationsClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes('response.notifications || []'),
    'notificationsClient.js must NOT use response.notifications || [] fallback',
  );

  assert.ok(
    content.includes('invalid_response') || content.includes('Array.isArray'),
    'notificationsClient.js must throw or validate with Array.isArray when notifications is absent',
  );
});

test('templatesClient.js: throws when templates array is missing', () => {
  const clientPath = path.join(srcApiDir, 'templatesClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes('response.templates || []'),
    'templatesClient.js must NOT use response.templates || [] fallback',
  );

  assert.ok(
    content.includes('Array.isArray'),
    'templatesClient.js must validate response.templates with Array.isArray before returning it',
  );
});

test('sharedLinksClient.js: throws when sharedLinks array is missing', () => {
  const clientPath = path.join(srcApiDir, 'sharedLinksClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes('response.sharedLinks || []'),
    'sharedLinksClient.js must NOT use response.sharedLinks || [] fallback for list()',
  );
});

test('accountClient.js: throws when organizations or memberships arrays are missing', () => {
  const clientPath = path.join(srcApiDir, 'accountClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes("response.organizations || []"),
    'accountClient.js must NOT use response.organizations || [] fallback',
  );

  assert.ok(
    !content.includes("response.memberships || []"),
    'accountClient.js must NOT use response.memberships || [] fallback',
  );
});

test('documentComparisonsClient.js: throws when comparisons array is missing', () => {
  const clientPath = path.join(srcApiDir, 'documentComparisonsClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes("response.comparisons || []"),
    'documentComparisonsClient.js must NOT use response.comparisons || [] fallback',
  );

  assert.ok(
    content.includes('Array.isArray'),
    'documentComparisonsClient.js must validate response.comparisons with Array.isArray',
  );
});

test('documentComparisonsClient.js: download endpoints throw on missing report/inputs', () => {
  const clientPath = path.join(srcApiDir, 'documentComparisonsClient.js');
  const content = fs.readFileSync(clientPath, 'utf8');

  assert.ok(
    !content.includes("response.report || {}"),
    'documentComparisonsClient.js downloadJson must NOT return {} when report is absent — that silently gives an empty download file',
  );

  assert.ok(
    !content.includes("response.inputs || {}"),
    'documentComparisonsClient.js downloadInputs must NOT return {} when inputs is absent',
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 11: Database constraint integrity (beta signups duplicate prevention)
// ──────────────────────────────────────────────────────────────────────────────

test('beta_signups migration: has UNIQUE constraint on email_normalized', () => {
  // The DB-level unique constraint on email_normalized is the last line of
  // defense against duplicate beta signups. The app code uses
  // onConflictDoNothing() but the DB constraint ensures even if app code has
  // a concurrency race or bug, duplicates cannot be inserted.
  const migrationPath = path.join(rootDir, 'drizzle', '0023_beta_signups.sql');
  assert.ok(fs.existsSync(migrationPath), '0023_beta_signups.sql migration must exist');
  const content = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(
    content.includes('UNIQUE') || content.includes('unique'),
    'beta_signups migration must define a UNIQUE constraint on email_normalized',
  );
  assert.ok(
    content.includes('email_normalized'),
    'The unique constraint must be on the email_normalized column (not just email)',
  );
});

test('beta_signups schema: Drizzle schema has uniqueIndex on emailNormalized', () => {
  const schemaPath = path.join(rootDir, 'server', '_lib', 'db', 'schema.js');
  assert.ok(fs.existsSync(schemaPath), 'schema.js must exist');
  const content = fs.readFileSync(schemaPath, 'utf8');

  // betaSignups table must define uniqueIndex on emailNormalized
  assert.ok(
    content.includes('betaSignupsEmailNormalizedUnique') || content.includes('uniqueIndex'),
    'Drizzle schema must define uniqueIndex for betaSignups.emailNormalized to enforce at ORM level',
  );
});

test('beta-signups route: uses onConflictDoNothing to guard against race-condition duplicates', () => {
  const routePath = path.join(rootDir, 'server', 'routes', 'beta-signups', 'index.ts');
  assert.ok(fs.existsSync(routePath), 'beta-signups/index.ts route must exist');
  const content = fs.readFileSync(routePath, 'utf8');

  assert.ok(
    content.includes('onConflictDoNothing'),
    'beta-signups route must use onConflictDoNothing so concurrent insert races resolve safely at the DB level',
  );
});

test('beta-signups route: seat count is derived from DB rows (not in-memory counter)', () => {
  const routePath = path.join(rootDir, 'server', 'routes', 'beta-signups', 'index.ts');
  const content = fs.readFileSync(routePath, 'utf8');

  // The route must read seatsClaimed from the DB (SELECT count/rows), not from
  // a module-level variable that would reset on cold start/deploy.
  assert.ok(
    content.includes('getSeatsClaimed') || content.includes('select') || content.includes('SELECT'),
    'beta-signups route must derive seat count from DB query, not from a mutable in-memory variable',
  );

  // Must NOT have a top-level mutable counter like: let seatsClaimed = 0;
  assert.ok(
    !(/^let\s+seatsClaimed\s*=\s*\d/m.test(content)),
    'beta-signups route must NOT use a module-level mutable seatsClaimed counter — it would reset on cold start',
  );
});
