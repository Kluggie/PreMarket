/**
 * tests/api/public-templates.test.mjs
 *
 * Unit tests for the GET /api/public/templates endpoint.
 *
 * This endpoint is intentionally unauthenticated — it returns only the
 * built-in canonical template definitions so signed-out users can start the
 * guest opportunity flow without a DB connection.
 *
 * Also tests clientIpForRateLimit (canonical home: server/_lib/security.ts),
 * the shared IP-extraction helper used by every rate limiter in this codebase
 * (including /api/public/templates and the shared-report verify flow).
 *
 * Tests verify:
 *  1. Returns 200 OK without an auth cookie
 *  2. Response includes a `templates` array
 *  3. Templates have the expected shape (id, name, slug, questions, etc.)
 *  4. All returned templates are active or published
 *  5. POST, PATCH, DELETE verbs are rejected with 405
 *  6. Cache-Control headers are present
 *  7. clientIpForRateLimit resolves client IP correctly behind proxy/CDN
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import publicTemplatesHandler from '../../server/routes/public/templates.ts';
// clientIpForRateLimit lives in security.ts; templates.ts re-exports it.
import { clientIpForRateLimit, normalizeClientIp } from '../../server/_lib/security.ts';
import { ensureTestEnv } from '../helpers/auth.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

// ── Helper ────────────────────────────────────────────────────────────────────

async function getPublicTemplates(overrides = {}) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/public/templates',
    headers: {},           // deliberately no auth cookie
    ...overrides,
  });
  const res = createMockRes();
  await publicTemplatesHandler(req, res);
  return { status: res.statusCode, body: res.jsonBody() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET /api/public/templates — returns 200 without auth', async () => {
  const { status, body } = await getPublicTemplates();
  assert.equal(status, 200, `Expected 200, got ${status}`);
  assert.ok(body.ok !== false, 'Response should not have ok:false');
});

test('GET /api/public/templates — response contains a templates array', async () => {
  const { body } = await getPublicTemplates();
  assert.ok(Array.isArray(body.templates), 'body.templates must be an array');
  assert.ok(body.templates.length > 0, 'templates array must be non-empty');
});

test('GET /api/public/templates — each template has required fields', async () => {
  const { body } = await getPublicTemplates();
  for (const template of body.templates) {
    assert.ok(typeof template.id === 'string' && template.id.length > 0, `template.id must be a non-empty string (got ${template.id})`);
    assert.ok(typeof template.name === 'string' && template.name.length > 0, `template.name must be a non-empty string (got ${template.name})`);
    assert.ok(typeof template.slug === 'string' && template.slug.length > 0, `template.slug must be a non-empty string (got ${template.slug})`);
    assert.ok(typeof template.description === 'string', `template.description must be a string (got ${typeof template.description})`);
    assert.ok(typeof template.category === 'string' && template.category.length > 0, `template.category must be a non-empty string`);
    assert.ok(Array.isArray(template.sections), `template.sections must be an array`);
    assert.ok(Array.isArray(template.questions), `template.questions must be an array`);
    assert.ok(template.questions.length > 0, `template "${template.slug}" must have at least one question`);
  }
});

test('GET /api/public/templates — all returned templates are active or published', async () => {
  const { body } = await getPublicTemplates();
  for (const template of body.templates) {
    const status = String(template.status || '').toLowerCase();
    assert.ok(
      status === 'active' || status === 'published',
      `Template "${template.slug}" has unexpected status "${status}"`,
    );
  }
});

test('GET /api/public/templates — each question has required fields', async () => {
  const { body } = await getPublicTemplates();
  for (const template of body.templates) {
    for (const question of template.questions) {
      assert.ok(typeof question.id === 'string' && question.id.length > 0, `question.id must be non-empty (template: ${template.slug})`);
      assert.ok(typeof question.label === 'string' && question.label.length > 0, `question.label must be non-empty (template: ${template.slug}, question: ${question.id})`);
      assert.ok(typeof question.field_type === 'string', `question.field_type must be a string (template: ${template.slug}, question: ${question.id})`);
      assert.ok(typeof question.role_type === 'string', `question.role_type must be a string (template: ${template.slug}, question: ${question.id})`);
    }
  }
});

test('GET /api/public/templates — templates are sorted by sort_order', async () => {
  const { body } = await getPublicTemplates();
  const orders = body.templates.map((t) => Number(t.sort_order || 0));
  for (let i = 1; i < orders.length; i++) {
    assert.ok(
      orders[i] >= orders[i - 1],
      `Templates out of sort_order order at index ${i}: ${orders[i - 1]} > ${orders[i]}`,
    );
  }
});

test('POST /api/public/templates — returns 405 Method Not Allowed', async () => {
  const { status } = await getPublicTemplates({ method: 'POST' });
  assert.equal(status, 405, `Expected 405 for POST, got ${status}`);
});

test('DELETE /api/public/templates — returns 405 Method Not Allowed', async () => {
  const { status } = await getPublicTemplates({ method: 'DELETE' });
  assert.equal(status, 405, `Expected 405 for DELETE, got ${status}`);
});

test('GET /api/public/templates — no DB queries (works without DATABASE_URL)', async () => {
  // Temporarily remove DATABASE_URL to prove the endpoint doesn't need it
  const originalDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  let error = null;
  let result = null;
  try {
    result = await getPublicTemplates();
  } catch (err) {
    error = err;
  } finally {
    // Restore
    if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
  }

  assert.ok(!error, `Endpoint should not throw without DATABASE_URL: ${error?.message}`);
  assert.equal(result?.status, 200, `Expected 200 without DATABASE_URL, got ${result?.status}`);
  assert.ok(Array.isArray(result?.body?.templates), 'Should still return templates without DB');
});

// ── Cache header tests ────────────────────────────────────────────────────────

async function getPublicTemplatesWithHeaders(overrides = {}) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/public/templates',
    headers: {},
    ...overrides,
  });
  const res = createMockRes();
  await publicTemplatesHandler(req, res);
  return { status: res.statusCode, body: res.jsonBody(), res };
}

test('GET /api/public/templates — response includes Cache-Control: public header', async () => {
  const { res } = await getPublicTemplatesWithHeaders();
  const cc = res.getHeader('cache-control');
  assert.ok(typeof cc === 'string' && cc.includes('public'), `Expected Cache-Control public header, got: ${cc}`);
  assert.ok(cc.includes('max-age='), `Expected max-age directive, got: ${cc}`);
});

test('GET /api/public/templates — response includes stale-while-revalidate directive', async () => {
  const { res } = await getPublicTemplatesWithHeaders();
  const cc = res.getHeader('cache-control');
  assert.ok(typeof cc === 'string' && cc.includes('stale-while-revalidate'), `Expected stale-while-revalidate in Cache-Control, got: ${cc}`);
});

// ── clientIpForRateLimit unit tests ───────────────────────────────────────────
// These tests verify that the rate limiter uses the correct client IP behind
// Vercel's proxy/CDN and cannot be bypassed by header injection.

test('clientIpForRateLimit — prefers x-real-ip (Vercel trusted header)', () => {
  const req = { headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' } };
  assert.equal(clientIpForRateLimit(req), '1.2.3.4',
    'x-real-ip must take priority over x-forwarded-for');
});

test('clientIpForRateLimit — uses rightmost XFF entry (proxy-appended, not client-injected)', () => {
  // Client injects a fake IP at the left; Vercel appends the real IP at the right.
  const req = { headers: { 'x-forwarded-for': 'spoofed-ip, 10.0.0.1, 1.2.3.4' } };
  assert.equal(clientIpForRateLimit(req), '1.2.3.4',
    'must use rightmost (proxy-appended) XFF entry, not leftmost (client-injectable)');
});

test('clientIpForRateLimit — rightmost XFF used even for single-entry header', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5' } };
  assert.equal(clientIpForRateLimit(req), '203.0.113.5');
});

test('clientIpForRateLimit — does NOT use leftmost XFF (injection-safe)', () => {
  // This would be the wrong behavior: attacker injects a different IP each request.
  const req = { headers: { 'x-forwarded-for': 'attacker-chosen, real-client-ip' } };
  const result = clientIpForRateLimit(req);
  assert.notEqual(result, 'attacker-chosen',
    'leftmost (client-injectable) XFF entry must NOT be used as the rate-limit key');
  assert.equal(result, 'real-client-ip');
});

test('clientIpForRateLimit — falls back to socket.remoteAddress when no headers (local dev)', () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientIpForRateLimit(req), '127.0.0.1',
    'socket.remoteAddress must be used in local dev when no proxy headers are present');
});

test('clientIpForRateLimit — falls back to \'unknown\' when nothing is available', () => {
  const req = { headers: {} };
  assert.equal(clientIpForRateLimit(req), 'unknown');
});

test('clientIpForRateLimit — trims whitespace from XFF entries', () => {
  const req = { headers: { 'x-forwarded-for': '  5.5.5.5 ,  9.9.9.9  ' } };
  assert.equal(clientIpForRateLimit(req), '9.9.9.9',
    'whitespace around XFF entries must be trimmed');
});

test('clientIpForRateLimit — x-real-ip beats socket.remoteAddress', () => {
  const req = { headers: { 'x-real-ip': '203.0.113.1' }, socket: { remoteAddress: '10.0.0.99' } };
  assert.equal(clientIpForRateLimit(req), '203.0.113.1');
});

test('clientIpForRateLimit — handles missing socket gracefully', () => {
  const req = { headers: {} };
  assert.equal(clientIpForRateLimit(req), 'unknown',
    'must not throw when req.socket is absent');
});

// ── normalizeClientIp delegation tests ───────────────────────────────────────
// normalizeClientIp (used for session fingerprinting + audit logging) now
// delegates to clientIpForRateLimit, so it uses the same trusted trust order.

test('normalizeClientIp — delegates to clientIpForRateLimit (x-real-ip preferred)', () => {
  const req = { headers: { 'x-real-ip': '10.1.2.3', 'x-forwarded-for': '5.5.5.5, 9.9.9.9' } };
  assert.equal(normalizeClientIp(req), clientIpForRateLimit(req),
    'normalizeClientIp must return the same value as clientIpForRateLimit');
  assert.equal(normalizeClientIp(req), '10.1.2.3');
});

test('normalizeClientIp — uses rightmost XFF when x-real-ip absent (not leftmost)', () => {
  const req = { headers: { 'x-forwarded-for': 'injected, real-client' } };
  const ip = normalizeClientIp(req);
  assert.notEqual(ip, 'injected', 'must not use injected leftmost XFF');
  assert.equal(ip, 'real-client');
});
