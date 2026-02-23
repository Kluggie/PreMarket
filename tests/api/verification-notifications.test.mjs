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
  const res = await callHandler(proposalsHandler, {
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
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

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

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
    }
  });

  test('notification events are created and user settings gate event creation + mark read', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notify_owner', 'owner@example.com');
    const recipientCookie = authCookie('notify_recipient', 'recipient@example.com');

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
  });
}
