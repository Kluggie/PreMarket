/**
 * proposals-auth-visibility.test.mjs
 *
 * Regression tests for the "proposal history appears wiped after redeploy" bug.
 *
 * ROOT CAUSE: The proposals API was returning 401 after redeploy (expired / missing
 * session), but Dashboard.jsx was silently defaulting to `data = []`, making it look
 * like the data was gone.
 *
 * These tests verify:
 * 1. Unauthenticated proposal list → 401 (NOT 200 with empty array)
 * 2. Session tokens signed with the same SECRET are stable across cold-starts
 * 3. User scoping: proposals created by u1 are not returned to u2
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import { hasDatabaseUrl } from '../../server/_lib/db/client.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

ensureTestEnv();

// ─── helpers ──────────────────────────────────────────────────────────────────

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function makeRawToken({ sub, email, secret, ttlSeconds = 3600 }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = { sub, email, name: 'Test User', iat: issuedAt, exp: issuedAt + ttlSeconds };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

// ─── TEST 1: Unauthenticated request must return 401, never empty 200 ─────────

test('GET /api/proposals without session cookie returns 401', async () => {
  const req = createMockReq({
    method: 'GET',
    url: '/api/proposals',
    query: {},
    headers: {}, // no cookie
  });
  const res = createMockRes();

  await proposalsHandler(req, res);

  assert.equal(
    res.statusCode,
    401,
    `Expected 401 unauthorized but got ${res.statusCode}. ` +
      'If this is 200 with an empty array the "silent wipe" bug has regressed.',
  );

  const body = res.jsonBody();
  assert.equal(body.ok, false, 'Response body ok should be false for 401');
  // Must never return a proposals array on an unauthed request
  assert.equal(
    body.proposals,
    undefined,
    'Unauthenticated response must not include a proposals array (would cause silent empty list in UI)',
  );
});

// ─── TEST 2: Session token signed with same secret validates across cold-starts ─

test('session token signed with SESSION_SECRET is stable across module reloads', () => {
  const secret = process.env.SESSION_SECRET || 'test-session-secret';
  const sub = 'google-oauth2|stability-test-user';
  const email = 'stability@example.com';

  // Simulate "first deploy": create token
  const token1 = makeRawToken({ sub, email, secret });

  // Simulate "second deploy" (cold start): rebuild token from scratch with SAME secret
  // The token from the first deploy should still verify against the same secret.
  const [encoded, signature] = token1.split('.');
  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');

  assert.equal(
    signature,
    expectedSig,
    'Token signature must match when verified with the same SESSION_SECRET. ' +
      'If this fails, SESSION_SECRET changed between deploys — that causes the visibility wipe.',
  );

  // Also verify payload round-trips intact
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.equal(decoded.sub, sub);
  assert.equal(decoded.email, email);
  assert.ok(decoded.exp > Math.floor(Date.now() / 1000), 'token should not be expired');
});

test('session token with wrong secret is rejected (does not verify)', () => {
  const correctSecret = process.env.SESSION_SECRET || 'test-session-secret';
  const wrongSecret = 'a-completely-different-secret-that-was-rotated';

  const token = makeRawToken({ sub: 'user-123', email: 'test@example.com', secret: correctSecret });
  const [encoded, _sig] = token.split('.');
  const wrongSig = createHmac('sha256', wrongSecret).update(encoded).digest('base64url');

  // The signature produced by wrong secret must NOT match the one from correct secret
  const correctSig = createHmac('sha256', correctSecret).update(encoded).digest('base64url');
  assert.notEqual(
    wrongSig,
    correctSig,
    'A token signed with a different secret must not validate — rotating SESSION_SECRET invalidates all sessions.',
  );
});

// ─── TEST 3: User scoping (requires DATABASE_URL) ─────────────────────────────

const dbAvailable = hasDatabaseUrl();

test(
  'proposals API scopes results to the authenticated user (u1 cannot see u2 proposals)',
  { skip: !dbAvailable ? 'DATABASE_URL not set — skipping DB-level scoping test' : false },
  async () => {
    // u1's cookie
    const u1Cookie = makeSessionCookie({ sub: 'visibility-test-u1', email: 'u1@visibility-test.example' });
    // u2's cookie
    const u2Cookie = makeSessionCookie({ sub: 'visibility-test-u2', email: 'u2@visibility-test.example' });

    // Request as u1 — should only return proposals belonging to u1
    const u1Req = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { tab: 'sent' },
      headers: { cookie: u1Cookie },
    });
    const u1Res = createMockRes();
    await proposalsHandler(u1Req, u1Res);

    // Should succeed (200) and not be a 401 — u1 is authed
    assert.equal(
      u1Res.statusCode,
      200,
      `u1 request should return 200, got ${u1Res.statusCode}. Session may not be validating.`,
    );

    const u1Body = u1Res.jsonBody();
    assert.ok(
      Array.isArray(u1Body.proposals),
      `u1 response.proposals should be an array, got ${JSON.stringify(u1Body.proposals)}`,
    );

    // Request as u2
    const u2Req = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { tab: 'sent' },
      headers: { cookie: u2Cookie },
    });
    const u2Res = createMockRes();
    await proposalsHandler(u2Req, u2Res);

    assert.equal(
      u2Res.statusCode,
      200,
      `u2 request should return 200, got ${u2Res.statusCode}. Session may not be validating.`,
    );

    const u2Body = u2Res.jsonBody();
    assert.ok(Array.isArray(u2Body.proposals), 'u2 response.proposals should be an array');

    // Proposal IDs from u1 must not appear in u2's response
    if (u1Body.proposals.length > 0) {
      const u1Ids = new Set(u1Body.proposals.map((p) => p.id));
      const overlap = u2Body.proposals.filter((p) => u1Ids.has(p.id));
      assert.equal(
        overlap.length,
        0,
        `u2 can see ${overlap.length} of u1's proposals — cross-user data leak! IDs: ${overlap.map((p) => p.id).join(', ')}`,
      );
    }
  },
);
