import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import contactHandler from '../../server/routes/contact/index.ts';
import betaApplyHandler from '../../server/routes/beta/apply.ts';
import betaCountHandler from '../../server/routes/beta/count.ts';
import profileHandler from '../../server/routes/account/profile.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { schema } from '../../server/_lib/db/client.js';

ensureTestEnv();

async function callHandler(handler, reqOptions, ...args) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res, ...args);
  return res;
}

test('contact endpoint sends email when configured and returns 501 when email integration is missing', async () => {
  const originalFetch = globalThis.fetch;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalResendName = process.env.RESEND_FROM_NAME;
  const originalResendReplyTo = process.env.RESEND_REPLY_TO;
  const originalContactTo = process.env.CONTACT_TO_EMAIL;

  const sentPayloads = [];

  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
  process.env.RESEND_FROM_NAME = 'PreMarket';
  process.env.RESEND_REPLY_TO = 'support@getpremarket.com';
  process.env.CONTACT_TO_EMAIL = 'support@getpremarket.com';

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com/emails')) {
      sentPayloads.push(JSON.parse(String(init?.body || '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }

    return originalFetch.call(globalThis, url, init);
  };

  try {
    const successRes = await callHandler(contactHandler, {
      method: 'POST',
      url: '/api/contact',
      body: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        organization: 'Acme',
        reason: 'sales',
        message: 'Need enterprise pricing details.',
      },
    });

    assert.equal(successRes.statusCode, 200);
    assert.equal(successRes.jsonBody().ok, true);
    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0].subject.includes('Sales'), true);
    assert.equal(sentPayloads[0].subject.includes('jane@example.com'), true);
    assert.deepEqual(sentPayloads[0].to, ['support@getpremarket.com']);
    assert.equal(sentPayloads[0].reply_to, 'jane@example.com');

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.CONTACT_TO_EMAIL;

    const notConfiguredRes = await callHandler(contactHandler, {
      method: 'POST',
      url: '/api/contact',
      body: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        reason: 'support',
        message: 'Hello',
      },
    });

    assert.equal(notConfiguredRes.statusCode, 501);
    assert.equal(notConfiguredRes.jsonBody().error?.code, 'not_configured');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    if (originalResendName === undefined) delete process.env.RESEND_FROM_NAME;
    else process.env.RESEND_FROM_NAME = originalResendName;
    if (originalResendReplyTo === undefined) delete process.env.RESEND_REPLY_TO;
    else process.env.RESEND_REPLY_TO = originalResendReplyTo;
    if (originalContactTo === undefined) delete process.env.CONTACT_TO_EMAIL;
    else process.env.CONTACT_TO_EMAIL = originalContactTo;
  }
});

if (!hasDatabaseUrl()) {
  test('beta apply/count integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('beta apply/count tracks unique lowercased emails and does not double count duplicates', async () => {
    await ensureMigrated();
    await resetTables();

    const userCookie = makeSessionCookie({
      sub: `beta_user_${Date.now().toString(36)}`,
      email: 'beta-owner@example.com',
    });

    const profileRes = await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie: userCookie },
    });
    assert.equal(profileRes.statusCode, 200);

    const initialCount = await callHandler(betaCountHandler, {
      method: 'GET',
      url: '/api/beta/count',
    });
    assert.equal(initialCount.statusCode, 200);
    assert.equal(initialCount.jsonBody().claimed, 0);

    const firstApply = await callHandler(betaApplyHandler, {
      method: 'POST',
      url: '/api/beta/apply',
      headers: { cookie: userCookie },
      body: {
        email: 'BetaApplicant@Example.com',
        source: 'pricing',
      },
    });
    assert.equal(firstApply.statusCode, 200);
    assert.equal(firstApply.jsonBody().claimed, 1);
    assert.equal(firstApply.jsonBody().applied, true);

    const secondApply = await callHandler(betaApplyHandler, {
      method: 'POST',
      url: '/api/beta/apply',
      headers: { cookie: userCookie },
      body: {
        email: 'betaapplicant@example.com',
        source: 'pricing',
      },
    });
    assert.equal(secondApply.statusCode, 200);
    assert.equal(secondApply.jsonBody().claimed, 1);

    const postCount = await callHandler(betaCountHandler, {
      method: 'GET',
      url: '/api/beta/count',
    });
    assert.equal(postCount.statusCode, 200);
    assert.equal(postCount.jsonBody().claimed, 1);
    assert.equal(postCount.jsonBody().limit, 50);

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.betaApplications)
      .where(eq(schema.betaApplications.email, 'betaapplicant@example.com'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'pricing');
    assert.equal(Boolean(rows[0].userId), true);
  });
}
