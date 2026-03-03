import assert from 'node:assert/strict';
import test from 'node:test';
import { isCategoryAllowedByMode, sendCategorizedEmail } from '../../server/_lib/email-delivery.ts';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';

test('email gating in contact_only mode allows contact categories and blocks transactional categories', () => {
  assert.equal(isCategoryAllowedByMode('contact_only', 'contact_support'), true);
  assert.equal(isCategoryAllowedByMode('contact_only', 'contact_sales'), true);
  assert.equal(isCategoryAllowedByMode('contact_only', 'evaluation_complete'), false);
  assert.equal(isCategoryAllowedByMode('contact_only', 'proposal_reevaluation_complete'), false);
});

test('email gating in disabled mode blocks policy-scoped categories but allows security-purpose categories', async () => {
  const originalMode = process.env.EMAIL_MODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env.EMAIL_MODE = 'disabled';
  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com/emails')) {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }
    return originalFetch.call(globalThis, url, init);
  };

  try {
    const blockedContact = await sendCategorizedEmail({
      category: 'contact_support',
      to: 'support@getpremarket.com',
      subject: 'disabled mode test',
      text: 'should be blocked',
    });

    const blockedEvaluation = await sendCategorizedEmail({
      category: 'evaluation_complete',
      to: 'owner@example.com',
      subject: 'disabled mode transactional test',
      text: 'should be blocked',
      dedupeKey: 'evaluation_complete:proposal_1:eval_1',
    });

    const allowedVerification = await sendCategorizedEmail({
      category: 'account_verification',
      purpose: 'security',
      to: 'owner@example.com',
      subject: 'Verify your email',
      text: 'verification link',
    });

    assert.equal(blockedContact.status, 'blocked');
    assert.equal(blockedContact.reason, 'blocked_disabled');
    assert.equal(blockedEvaluation.status, 'blocked');
    assert.equal(blockedEvaluation.reason, 'blocked_disabled');
    assert.equal(allowedVerification.status, 'sent');
    assert.equal(fetchCalls, 1);
  } finally {
    if (originalMode === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = originalMode;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    globalThis.fetch = originalFetch;
  }
});

test('DEV_EMAIL_SINK rewrites recipients in non-production transactional mode', async () => {
  const originalMode = process.env.EMAIL_MODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevSink = process.env.DEV_EMAIL_SINK;
  const originalFetch = globalThis.fetch;
  const capturedPayloads = [];

  process.env.EMAIL_MODE = 'transactional';
  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
  process.env.NODE_ENV = 'test';
  process.env.DEV_EMAIL_SINK = 'sink@getpremarket.com';

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com/emails')) {
      capturedPayloads.push(JSON.parse(String(init?.body || '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }
    return originalFetch.call(globalThis, url, init);
  };

  try {
    const result = await sendCategorizedEmail({
      category: 'evaluation_complete',
      to: 'owner@example.com',
      subject: 'Sink test',
      text: 'body',
      dedupeKey: 'evaluation_complete:sink_test:v1',
    });

    assert.equal(result.status, 'sent');
    assert.equal(capturedPayloads.length, 1);
    assert.deepEqual(capturedPayloads[0].to, ['sink@getpremarket.com']);
  } finally {
    if (originalMode === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = originalMode;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDevSink === undefined) delete process.env.DEV_EMAIL_SINK;
    else process.env.DEV_EMAIL_SINK = originalDevSink;
    globalThis.fetch = originalFetch;
  }
});

if (!hasDatabaseUrl()) {
  test('transactional dedupe skips repeated sends (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('transactional dedupe skips repeated sends for the same dedupeKey', async () => {
    await ensureMigrated();
    await resetTables();

    const originalMode = process.env.EMAIL_MODE;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDevSink = process.env.DEV_EMAIL_SINK;
    const originalFetch = globalThis.fetch;
    let resendCalls = 0;

    process.env.EMAIL_MODE = 'transactional';
    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.NODE_ENV = 'test';
    delete process.env.DEV_EMAIL_SINK;

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com/emails')) {
        resendCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }

      return originalFetch.call(globalThis, url, init);
    };

    try {
      const dedupeKey = 'evaluation_complete:proposal_abc:eval_123';
      const first = await sendCategorizedEmail({
        category: 'evaluation_complete',
        to: 'owner@example.com',
        subject: 'Evaluation complete',
        text: 'first send',
        dedupeKey,
      });

      const second = await sendCategorizedEmail({
        category: 'evaluation_complete',
        to: 'owner@example.com',
        subject: 'Evaluation complete',
        text: 'second send should dedupe',
        dedupeKey,
      });

      assert.equal(first.status, 'sent');
      assert.equal(second.status, 'deduped');
      assert.equal(resendCalls, 1);
    } finally {
      if (originalMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalMode;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalResendFrom;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalDevSink === undefined) delete process.env.DEV_EMAIL_SINK;
      else process.env.DEV_EMAIL_SINK = originalDevSink;
      globalThis.fetch = originalFetch;
    }
  });
}
