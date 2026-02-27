import assert from 'node:assert/strict';
import test from 'node:test';
import apiHandler from '../../api/index.ts';
import authCsrfHandler from '../../server/routes/auth/csrf.ts';
import authMeHandler from '../../server/routes/auth/me.ts';
import { hasDatabaseUrl } from '../../server/_lib/db/client.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureTestEnv } from '../helpers/auth.mjs';

ensureTestEnv();

function withEnvOverride(overrides, fn) {
  const original = new Map();

  Object.entries(overrides).forEach(([key, value]) => {
    original.set(key, process.env[key]);
    if (value === null || value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = String(value);
  });

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      original.forEach((value, key) => {
        if (value === undefined) {
          delete process.env[key];
          return;
        }
        process.env[key] = value;
      });
    });
}

test('csrf returns not_configured instead of crashing when session env is missing', async () => {
  await withEnvOverride(
    {
      APP_BASE_URL: null,
      SESSION_SECRET: null,
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/auth/csrf',
      });
      const res = createMockRes();

      await authCsrfHandler(req, res);

      assert.equal(res.statusCode, 503);
      const body = res.jsonBody();
      assert.equal(body.ok, false);
      assert.equal(body.error?.code, 'not_configured');
    },
  );
});

test('me returns not_configured instead of crashing when DATABASE_URL is missing', async () => {
  await withEnvOverride(
    {
      APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:5173',
      SESSION_SECRET: process.env.SESSION_SECRET || 'test-session-secret',
      DATABASE_URL: null,
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/auth/me',
      });
      const res = createMockRes();

      await authMeHandler(req, res);

      assert.equal(res.statusCode, 503);
      const body = res.jsonBody();
      assert.equal(body.ok, false);
      assert.equal(body.error?.code, 'not_configured');
    },
  );
});

if (!hasDatabaseUrl()) {
  test('me returns 401 when user is not authenticated (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('me returns 401 when user is not authenticated', async () => {
    const req = createMockReq({
      method: 'GET',
      url: '/api/auth/me',
      headers: {},
    });
    const res = createMockRes();

    await authMeHandler(req, res);

    assert.equal(res.statusCode, 401);
    const body = res.jsonBody();
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'unauthorized');
  });
}

test('csrf API request is not canonical-redirected in production mode', async () => {
  await withEnvOverride(
    {
      VERCEL_ENV: 'production',
      APP_BASE_URL: 'https://pre-market.vercel.app',
      SESSION_SECRET: process.env.SESSION_SECRET || 'test-session-secret',
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/index?path=auth%2Fcsrf',
        query: {
          path: 'auth/csrf',
        },
        headers: {
          host: 'pre-market-git-main-kluggies-projects.vercel.app',
          'x-forwarded-host': 'pre-market-git-main-kluggies-projects.vercel.app',
          'x-forwarded-proto': 'https',
        },
      });
      const res = createMockRes();

      await authCsrfHandler(req, res);

      assert.notEqual(res.statusCode, 307);
      assert.equal(res.statusCode, 200);
      assert.equal(Boolean(res.getHeader('location')), false);
      assert.equal(Boolean(res.jsonBody().csrfToken), true);
    },
  );
});

test('api route aliases for csrf and me resolve correctly', async () => {
  const csrfReq = createMockReq({
    method: 'GET',
    url: '/api/index?path=csrf',
    query: {
      path: 'csrf',
    },
  });
  const csrfRes = createMockRes();
  await apiHandler(csrfReq, csrfRes);
  assert.equal(csrfRes.statusCode, 200);
  assert.equal(Boolean(csrfRes.jsonBody().csrfToken), true);

  const meReq = createMockReq({
    method: 'GET',
    url: '/api/index?path=me',
    query: {
      path: 'me',
    },
  });
  const meRes = createMockRes();
  await apiHandler(meReq, meRes);
  assert.equal([401, 503].includes(meRes.statusCode), true);
});
