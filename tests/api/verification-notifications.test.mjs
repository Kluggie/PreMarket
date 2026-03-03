import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import profileHandler from '../../server/routes/account/profile.ts';
import verificationSendHandler from '../../server/routes/account/verification/send.ts';
import verificationConfirmHandler from '../../server/routes/account/verification/confirm.ts';
import notificationsHandler from '../../server/routes/notifications/index.ts';
import notificationByIdHandler from '../../server/routes/notifications/[id].ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import proposalEvaluateHandler from '../../server/routes/proposals/[id]/evaluate.ts';
import { createNotificationEvent } from '../../server/_lib/notifications.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { schema } from '../../server/_lib/db/client.js';

ensureTestEnv();
if (!process.env.VERTEX_MOCK) {
  process.env.VERTEX_MOCK = '1';
}

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function callHandler(handler, reqOptions, ...args) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res, ...args);
  return res;
}

async function createProposal(cookie, body) {
  const normalizedStatus = String(body?.status || '').trim().toLowerCase();
  const shouldDefaultSentAt =
    normalizedStatus &&
    !['draft', 'ready'].includes(normalizedStatus) &&
    body?.sentAt === undefined &&
    body?.sent_at === undefined;
  const payload = shouldDefaultSentAt ? { ...body, sentAt: new Date().toISOString() } : body;

  const res = await callHandler(proposalsHandler, {
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body: payload,
  });
  assert.equal(res.statusCode, 201);
  return res.jsonBody().proposal;
}

if (!hasDatabaseUrl()) {
  test('verification + notifications integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('verification email send + confirm flow marks profile as verified with one-time token', async () => {
    await ensureMigrated();
    await resetTables();

    const unique = Date.now().toString(36);
    const verifyUserId = `verify_user_${unique}`;
    const verifyEmail = `verify-${unique}@example.com`;
    const cookie = authCookie(verifyUserId, verifyEmail);
    const originalFetch = globalThis.fetch;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalResendName = process.env.RESEND_FROM_NAME;
    const originalResendReplyTo = process.env.RESEND_REPLY_TO;
    const originalEmailMode = process.env.EMAIL_MODE;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';
    process.env.EMAIL_MODE = 'transactional';

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }
      return originalFetch.call(globalThis, url, init);
    };

    try {
      const sendRes = await callHandler(verificationSendHandler, {
        method: 'POST',
        url: '/api/account/verification/send',
        headers: { cookie },
        body: {},
      });
      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().sent, true);

      const db = getDb();
      const tokenRows = await db
        .select()
        .from(schema.emailVerificationTokens)
        .where(
          and(
            eq(schema.emailVerificationTokens.userId, verifyUserId),
            eq(schema.emailVerificationTokens.status, 'pending'),
          ),
        );
      assert.equal(tokenRows.length >= 1, true);

      const rawToken = 'manual_verification_token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const now = new Date();
      await db.insert(schema.emailVerificationTokens).values({
        id: `verify_token_manual_${unique}`,
        userId: verifyUserId,
        userEmail: verifyEmail,
        tokenHash,
        status: 'pending',
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        usedAt: null,
        metadata: { source: 'test' },
        createdAt: now,
        updatedAt: now,
      });

      const confirmRes = await callHandler(verificationConfirmHandler, {
        method: 'POST',
        url: '/api/account/verification/confirm',
        body: { token: rawToken },
      });
      assert.equal(confirmRes.statusCode, 200);
      assert.equal(confirmRes.jsonBody().verified, true);

      const profileRes = await callHandler(profileHandler, {
        method: 'GET',
        url: '/api/account/profile',
        headers: { cookie },
      });
      assert.equal(profileRes.statusCode, 200);
      assert.equal(profileRes.jsonBody().profile.email_verified, true);
      assert.equal(profileRes.jsonBody().profile.verification_status, 'verified');

      const confirmAgainRes = await callHandler(verificationConfirmHandler, {
        method: 'POST',
        url: '/api/account/verification/confirm',
        body: { token: rawToken },
      });
      assert.equal(confirmAgainRes.statusCode, 410);
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
      if (originalEmailMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalEmailMode;
    }
  });

  test('contact_only blocks transactional notification email delivery while still creating the notification', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notify_owner_policy', 'owner-policy@example.com');
    await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie: ownerCookie },
    });

    const originalMode = process.env.EMAIL_MODE;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalFetch = globalThis.fetch;
    let resendCalls = 0;

    process.env.EMAIL_MODE = 'contact_only';
    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com/emails')) {
        resendCalls += 1;
      }
      return originalFetch.call(globalThis, url, init);
    };

    try {
      const db = getDb();
      const created = await createNotificationEvent({
        db,
        userId: 'notify_owner_policy',
        userEmail: 'owner-policy@example.com',
        eventType: 'evaluation_update',
        emailCategory: 'evaluation_complete',
        dedupeKey: 'evaluation_update:policy_test:v1',
        title: 'Evaluation complete',
        message: 'A policy test evaluation has completed.',
        emailSubject: 'Evaluation complete',
        emailText: 'This email should be blocked by contact_only mode.',
      });

      assert.equal(created.created, true);
      assert.equal(resendCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalMode;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    }
  });

  test('verification email route bypasses policy gating when email mode is disabled', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('verify_policy_bypass_user', 'verify-policy-bypass@example.com');
    await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie },
    });

    const originalMode = process.env.EMAIL_MODE;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalFetch = globalThis.fetch;
    let resendCalls = 0;

    process.env.EMAIL_MODE = 'disabled';
    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com/emails')) {
        resendCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend_verify_policy_bypass' }),
        };
      }
      return originalFetch.call(globalThis, url, init);
    };

    try {
      const sendRes = await callHandler(verificationSendHandler, {
        method: 'POST',
        url: '/api/account/verification/send',
        headers: { cookie },
        body: {},
      });

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().sent, true);
      assert.equal(sendRes.jsonBody().blocked, false);
      assert.equal(resendCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalMode;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    }
  });

  test('verification email route returns provider-config error when disabled mode has no email credentials', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('verify_not_config_user', 'verify-not-config@example.com');
    await callHandler(profileHandler, {
      method: 'GET',
      url: '/api/account/profile',
      headers: { cookie },
    });

    const originalMode = process.env.EMAIL_MODE;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;

    process.env.EMAIL_MODE = 'disabled';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    try {
      const sendRes = await callHandler(verificationSendHandler, {
        method: 'POST',
        url: '/api/account/verification/send',
        headers: { cookie },
        body: {},
      });

      assert.equal(sendRes.statusCode, 501);
      assert.equal(sendRes.jsonBody().error?.code, 'not_configured');
      assert.equal(sendRes.jsonBody().error?.message, 'Email service not configured');
      assert.notEqual(sendRes.jsonBody().error?.code, 'email_blocked_by_policy');
    } finally {
      if (originalMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalMode;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalResendFrom;
    }
  });

  test('notification events are created and user settings gate event creation + mark read', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notify_owner', 'owner@example.com');
    const recipientCookie = authCookie('notify_recipient', 'recipient@example.com');
    const originalFetch = globalThis.fetch;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalResendName = process.env.RESEND_FROM_NAME;
    const originalResendReplyTo = process.env.RESEND_REPLY_TO;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.resend.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend_notify_test' }),
        };
      }
      return originalFetch.call(globalThis, url, init);
    };

    try {
      await callHandler(profileHandler, {
        method: 'GET',
        url: '/api/account/profile',
        headers: { cookie: ownerCookie },
      });
      await callHandler(profileHandler, {
        method: 'GET',
        url: '/api/account/profile',
        headers: { cookie: recipientCookie },
      });

    const created = await createProposal(ownerCookie, {
      title: 'Notify Proposal',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });

    const sendRes = await callHandler(
      proposalSendHandler,
      {
        method: 'POST',
        url: `/api/proposals/${created.id}/send`,
        headers: { cookie: ownerCookie },
        query: { id: created.id },
        body: {
          recipientEmail: 'recipient@example.com',
          createShareLink: false,
        },
      },
      created.id,
    );
    assert.equal(sendRes.statusCode, 200);

    const recipientNotificationsRes = await callHandler(notificationsHandler, {
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie: recipientCookie },
    });
    assert.equal(recipientNotificationsRes.statusCode, 200);
    const recipientNotifications = recipientNotificationsRes.jsonBody().notifications;
    assert.equal(recipientNotifications.length >= 1, true);
    assert.equal(recipientNotifications[0].event_type, 'new_proposal');
    assert.equal(recipientNotifications[0].read, false);

    const markReadRes = await callHandler(
      notificationByIdHandler,
      {
        method: 'PATCH',
        url: `/api/notifications/${recipientNotifications[0].id}`,
        headers: { cookie: recipientCookie },
        query: { id: recipientNotifications[0].id },
        body: { read: true },
      },
      recipientNotifications[0].id,
    );
    assert.equal(markReadRes.statusCode, 200);

    const disableProposalNoticesRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie: recipientCookie },
      body: {
        profile: {
          notification_settings: {
            email_notifications: true,
            email_proposals: false,
            email_evaluations: true,
            email_reveals: true,
            email_marketing: false,
          },
        },
      },
    });
    assert.equal(disableProposalNoticesRes.statusCode, 200);

    const secondProposal = await createProposal(ownerCookie, {
      title: 'Second Notify Proposal',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });

    const secondSendRes = await callHandler(
      proposalSendHandler,
      {
        method: 'POST',
        url: `/api/proposals/${secondProposal.id}/send`,
        headers: { cookie: ownerCookie },
        query: { id: secondProposal.id },
        body: {
          recipientEmail: 'recipient@example.com',
          createShareLink: false,
        },
      },
      secondProposal.id,
    );
    assert.equal(secondSendRes.statusCode, 200);

    const recipientAfterDisabledRes = await callHandler(notificationsHandler, {
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie: recipientCookie },
    });
    assert.equal(recipientAfterDisabledRes.statusCode, 200);
    const recipientAfterDisabled = recipientAfterDisabledRes.jsonBody().notifications;
    assert.equal(
      recipientAfterDisabled.some((entry) => String(entry.message || '').includes('Second Notify Proposal')),
      false,
    );

    const disableEvaluationUpdatesRes = await callHandler(profileHandler, {
      method: 'PUT',
      url: '/api/account/profile',
      headers: { cookie: ownerCookie },
      body: {
        profile: {
          notification_settings: {
            email_notifications: true,
            email_proposals: true,
            email_evaluations: false,
            email_reveals: true,
            email_marketing: false,
          },
        },
      },
    });
    assert.equal(disableEvaluationUpdatesRes.statusCode, 200);

    const evaluateRes = await callHandler(
      proposalEvaluateHandler,
      {
        method: 'POST',
        url: `/api/proposals/${created.id}/evaluate`,
        headers: { cookie: ownerCookie },
        query: { id: created.id },
        body: {},
      },
      created.id,
    );
    assert.equal(evaluateRes.statusCode, 200);

    const ownerNotificationsRes = await callHandler(notificationsHandler, {
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie: ownerCookie },
    });
    assert.equal(ownerNotificationsRes.statusCode, 200);
    const ownerNotifications = ownerNotificationsRes.jsonBody().notifications;
    assert.equal(ownerNotifications.some((entry) => entry.event_type === 'evaluation_update'), false);

    const db = getDb();
    await createNotificationEvent({
      db,
      userId: 'notify_owner',
      eventType: 'general',
      dedupeKey: 'dedupe:test:event',
      title: 'Dedupe Test',
      message: 'Only one of these should be stored.',
    });
    await createNotificationEvent({
      db,
      userId: 'notify_owner',
      eventType: 'general',
      dedupeKey: 'dedupe:test:event',
      title: 'Dedupe Test',
      message: 'Only one of these should be stored.',
    });

    const ownerAfterDedupeRes = await callHandler(notificationsHandler, {
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie: ownerCookie },
    });
    assert.equal(ownerAfterDedupeRes.statusCode, 200);
      const dedupeEntries = ownerAfterDedupeRes
        .jsonBody()
        .notifications.filter((entry) => entry.title === 'Dedupe Test');
      assert.equal(dedupeEntries.length, 1);
    } finally {
      if (originalResendKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalResendKey;
      }

      if (originalResendFrom === undefined) {
        delete process.env.RESEND_FROM_EMAIL;
      } else {
        process.env.RESEND_FROM_EMAIL = originalResendFrom;
      }

      if (originalResendName === undefined) {
        delete process.env.RESEND_FROM_NAME;
      } else {
        process.env.RESEND_FROM_NAME = originalResendName;
      }

      if (originalResendReplyTo === undefined) {
        delete process.env.RESEND_REPLY_TO;
      } else {
        process.env.RESEND_REPLY_TO = originalResendReplyTo;
      }

      globalThis.fetch = originalFetch;
    }
  });
}
