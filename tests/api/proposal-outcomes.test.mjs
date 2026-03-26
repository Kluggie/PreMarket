import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import apiHandler from '../../api/index.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalOutcomeHandler from '../../server/routes/proposals/[id]/outcome.ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import proposalUnarchiveHandler from '../../server/routes/proposals/[id]/unarchive.ts';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import notificationsHandler from '../../server/routes/notifications/index.ts';
import { schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function seedProfessionalPlan(userId, email) {
  const db = getDb();
  await db
    .insert(schema.users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: schema.users.id });
  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan: 'professional',
      status: 'active',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: {
        plan: 'professional',
        status: 'active',
        updatedAt: new Date(),
      },
    });
}

async function callHandler(handler, reqOptions, ...args) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res, ...args);
  return res;
}

async function touchUser(cookie) {
  const res = await callHandler(notificationsHandler, {
    method: 'GET',
    url: '/api/notifications',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
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

async function markOutcome(cookie, proposalId, body) {
  return callHandler(
    proposalOutcomeHandler,
    {
      method: 'POST',
      url: `/api/proposals/${proposalId}/outcome`,
      headers: { cookie },
      query: { id: proposalId },
      body,
    },
    proposalId,
  );
}

async function deleteProposal(cookie, proposalId) {
  return callHandler(
    proposalDetailHandler,
    {
      method: 'DELETE',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
}

async function archiveProposal(cookie, proposalId) {
  return callHandler(
    proposalArchiveHandler,
    {
      method: 'PATCH',
      url: `/api/proposals/${proposalId}/archive`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
}

async function unarchiveProposal(cookie, proposalId) {
  return callHandler(
    proposalUnarchiveHandler,
    {
      method: 'PATCH',
      url: `/api/proposals/${proposalId}/unarchive`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
}

async function listAgreementRequestEmails(proposalId = null) {
  const db = getDb();
  const query = db.select().from(schema.proposalAgreementRequestEmails);
  return proposalId
    ? await query.where(eq(schema.proposalAgreementRequestEmails.proposalId, proposalId))
    : await query;
}

async function listProposalEvents(proposalId) {
  const db = getDb();
  return db
    .select()
    .from(schema.proposalEvents)
    .where(eq(schema.proposalEvents.proposalId, proposalId));
}

async function listProposals(cookie, query = {}) {
  const res = await callHandler(proposalsHandler, {
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().proposals || [];
}

async function getSummary(cookie) {
  const res = await callHandler(dashboardSummaryHandler, {
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().summary;
}

async function getActivity(cookie, range = '30') {
  const res = await callHandler(dashboardActivityHandler, {
    method: 'GET',
    url: '/api/dashboard/activity',
    headers: { cookie },
    query: { range },
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().points || [];
}

async function getNotifications(cookie) {
  const res = await callHandler(notificationsHandler, {
    method: 'GET',
    url: '/api/notifications',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().notifications || [];
}

function aggregateActivity(points) {
  return points.reduce(
    (acc, point) => {
      acc.sent += Number(point?.sent || 0);
      acc.received += Number(point?.received || 0);
      acc.mutual += Number(point?.mutual || 0);
      acc.won += Number(point?.won || 0);
      acc.lost += Number(point?.lost || 0);
      return acc;
    },
    { sent: 0, received: 0, mutual: 0, won: 0, lost: 0 },
  );
}

function captureTransactionalEmails() {
  const originalMode = process.env.EMAIL_MODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalResendName = process.env.RESEND_FROM_NAME;
  const originalResendReplyTo = process.env.RESEND_REPLY_TO;
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalFetch = globalThis.fetch;
  const resendPayloads = [];

  process.env.EMAIL_MODE = 'contact_only';
  process.env.RESEND_API_KEY = 'test_resend_key';
  process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
  process.env.RESEND_FROM_NAME = 'PreMarket';
  process.env.RESEND_REPLY_TO = 'support@getpremarket.com';
  process.env.APP_BASE_URL = 'https://app.getpremarket.test';

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com/emails')) {
      resendPayloads.push(JSON.parse(String(init?.body || '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `resend_${resendPayloads.length}` }),
      };
    }
    return originalFetch.call(globalThis, url, init);
  };

  return {
    resendPayloads,
    restore() {
      globalThis.fetch = originalFetch;
      if (originalMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = originalMode;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      if (originalResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalResendFrom;
      if (originalResendName === undefined) delete process.env.RESEND_FROM_NAME;
      else process.env.RESEND_FROM_NAME = originalResendName;
      if (originalResendReplyTo === undefined) delete process.env.RESEND_REPLY_TO;
      else process.env.RESEND_REPLY_TO = originalResendReplyTo;
      if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = originalAppBaseUrl;
    },
  };
}

test('legacy agreement-request dispatch route is no longer mounted', async () => {
  const res = await callHandler(apiHandler, {
    method: 'POST',
    url: '/api?path=internal/proposal-agreement-request-emails/dispatch',
    query: {
      path: 'internal/proposal-agreement-request-emails/dispatch',
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.jsonBody().error?.code, 'not_found');
});

if (!hasDatabaseUrl()) {
  test('proposal outcomes integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('request agreement and counterparty confirmation do not require prior recipient edits', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_rounds', 'owner-rounds@example.com');
    const recipientCookie = authCookie('outcome_recipient_rounds', 'recipient-rounds@example.com');
    await seedProfessionalPlan('outcome_owner_rounds', 'owner-rounds@example.com');
    await seedProfessionalPlan('outcome_recipient_rounds', 'recipient-rounds@example.com');
    await touchUser(recipientCookie);

    const roundOne = await createProposal(ownerCookie, {
      title: 'Round One Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-rounds@example.com',
    });

    const ownerWonRes = await markOutcome(ownerCookie, roundOne.id, { outcome: 'won' });
    assert.equal(ownerWonRes.statusCode, 200);
    assert.equal(ownerWonRes.jsonBody().proposal.outcome.state, 'pending_won');
    assert.equal(ownerWonRes.jsonBody().proposal.outcome.requested_by_current_user, true);
    assert.notEqual(ownerWonRes.jsonBody().proposal.status, 'won');

    const recipientInbox = await listProposals(recipientCookie, { tab: 'inbox', limit: '20' });
    const pendingForRecipient = recipientInbox.find((entry) => entry.id === roundOne.id);
    assert.ok(pendingForRecipient, 'recipient should see the pending agreement request in Inbox');
    assert.equal(pendingForRecipient.outcome.requested_by_counterparty, true);
    assert.equal(pendingForRecipient.outcome.can_mark_won, true);
    assert.equal(pendingForRecipient.outcome.can_continue_negotiating, true);

    const recipientWonRes = await markOutcome(recipientCookie, roundOne.id, { outcome: 'won' });
    assert.equal(recipientWonRes.statusCode, 200);
    assert.equal(recipientWonRes.jsonBody().proposal.outcome.state, 'won');
    assert.equal(recipientWonRes.jsonBody().proposal.status, 'won');

    const ownerDirectLost = await createProposal(ownerCookie, {
      title: 'Owner Direct Lost Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-rounds@example.com',
    });
    const ownerLostRes = await markOutcome(ownerCookie, ownerDirectLost.id, { outcome: 'lost' });
    assert.equal(ownerLostRes.statusCode, 200);
    assert.equal(ownerLostRes.jsonBody().proposal.outcome.state, 'lost');
    assert.equal(ownerLostRes.jsonBody().proposal.status, 'lost');
  });

  test('invalid outcome errors use product-facing agreement language', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_invalid', 'owner-invalid@example.com');

    const proposal = await createProposal(ownerCookie, {
      title: 'Invalid Outcome Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-invalid@example.com',
    });

    const invalidRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'banana' });
    assert.equal(invalidRes.statusCode, 400);
    assert.equal(invalidRes.jsonBody().error?.code, 'invalid_outcome');
    assert.equal(
      invalidRes.jsonBody().error?.message,
      'Use Request Agreement, Confirm Agreement, Continue Negotiating, or Lost.',
    );
  });

  test('api index routes proposal outcome mutations instead of returning route not found', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_api_index', 'owner-api-index@example.com');

    const proposal = await createProposal(ownerCookie, {
      title: 'API Index Outcome Route Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-api-index@example.com',
    });

    const res = await callHandler(apiHandler, {
      method: 'POST',
      url: `/api?path=${encodeURIComponent(`proposals/${proposal.id}/outcome`)}`,
      headers: { cookie: ownerCookie },
      query: {
        path: `proposals/${proposal.id}/outcome`,
        id: proposal.id,
      },
      body: { outcome: 'lost' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody().proposal.status, 'lost');
    assert.equal(res.jsonBody().proposal.outcome.state, 'lost');
  });

  test('unilateral lost closes immediately, sends one final lost email, updates analytics, and notifies the counterparty', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_lost', 'owner-lost@example.com');
    const recipientCookie = authCookie('outcome_recipient_lost', 'recipient-lost@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Lost Outcome Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-lost@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const lostRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'lost' });
      assert.equal(lostRes.statusCode, 200);
      assert.equal(lostRes.jsonBody().proposal.status, 'lost');
      assert.equal(lostRes.jsonBody().proposal.outcome.state, 'lost');
      assert.ok(lostRes.jsonBody().proposal.closed_at, 'lost outcome should stamp closed_at');

      assert.equal(emailCapture.resendPayloads.length, 1);
      assert.deepEqual(emailCapture.resendPayloads[0].to, ['owner-lost@example.com']);
      assert.equal(emailCapture.resendPayloads[0].subject, 'Opportunity Closed as Lost — Lost Outcome Proposal');
      assert.match(
        String(emailCapture.resendPayloads[0].text || ''),
        /The opportunity "Lost Outcome Proposal" was closed as lost\./,
      );
      assert.match(
        String(emailCapture.resendPayloads[0].text || ''),
        /https:\/\/app\.getpremarket\.test\/ProposalDetail\?id=/,
      );
      assert.doesNotMatch(String(emailCapture.resendPayloads[0].subject || ''), /Agreement Finalized/i);

      const repeatLostRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'lost' });
      assert.equal(repeatLostRes.statusCode, 403);
      assert.equal(emailCapture.resendPayloads.length, 1, 'repeating lost must not resend the final lost email');

      const summary = await getSummary(ownerCookie);
      assert.equal(summary.lostCount, 1);
      assert.equal(summary.wonCount, 0);
      assert.equal(summary.closedCount, 1);

      const closedForOwner = await listProposals(ownerCookie, { tab: 'closed', limit: '20' });
      assert.equal(closedForOwner.some((entry) => entry.id === proposal.id && entry.status === 'lost'), true);

      const ownerNotifications = await getNotifications(ownerCookie);
      const lostNotification = ownerNotifications.find((entry) => entry.event_type === 'status_lost');
      assert.ok(lostNotification, 'owner should receive a lost notification');
      assert.equal(String(lostNotification.message || '').includes('Lost Outcome Proposal'), true);
    } finally {
      emailCapture.restore();
    }
  });

  test('single-sided won stays pending until both parties confirm, then sends one finalized agreement email and emits notifications', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_won', 'owner-won@example.com');
    const recipientCookie = authCookie('outcome_recipient_won', 'recipient-won@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Dual Won Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-won@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const pendingWonRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'won' });
      assert.equal(pendingWonRes.statusCode, 200);
      assert.equal(pendingWonRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(pendingWonRes.jsonBody().proposal.outcome.requested_by, 'party_b');
      assert.equal(pendingWonRes.jsonBody().proposal.outcome.requested_by_current_user, true);
      assert.equal(pendingWonRes.jsonBody().proposal.primary_status_label, 'Requested Agreement');
      assert.equal(emailCapture.resendPayloads.length, 1, 'pending agreement requests should send the immediate request email');
      assert.deepEqual(emailCapture.resendPayloads[0].to, ['owner-won@example.com']);
      assert.equal(emailCapture.resendPayloads[0].subject, 'Agreement Requested — Dual Won Proposal');

      const pendingSummary = await getSummary(ownerCookie);
      assert.equal(pendingSummary.wonCount, 0);
      assert.equal(pendingSummary.closedCount, 0);

      const pendingActivity = aggregateActivity(await getActivity(ownerCookie, '30'));
      assert.equal(pendingActivity.won, 0);

      const ownerNotifications = await getNotifications(ownerCookie);
      const pendingNotification = ownerNotifications.find(
        (entry) =>
          entry.event_type === 'status_won' &&
          String(entry.message || '').includes('waiting for your confirmation'),
      );
      assert.ok(pendingNotification, 'owner should receive an agreement requested notification');
      assert.equal(pendingNotification.title, 'Agreement Requested');

      const confirmWonRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(confirmWonRes.statusCode, 200);
      assert.equal(confirmWonRes.jsonBody().proposal.status, 'won');
      assert.equal(confirmWonRes.jsonBody().proposal.outcome.state, 'won');
      assert.ok(confirmWonRes.jsonBody().proposal.closed_at, 'final win should stamp closed_at');

      assert.equal(emailCapture.resendPayloads.length, 2);
      assert.deepEqual(emailCapture.resendPayloads[1].to, ['recipient-won@example.com']);
      assert.equal(emailCapture.resendPayloads[1].subject, 'Agreement Finalized — Dual Won Proposal');
      assert.match(
        String(emailCapture.resendPayloads[1].text || ''),
        /The agreement for "Dual Won Proposal" has been confirmed and finalized\./,
      );
      assert.match(
        String(emailCapture.resendPayloads[1].text || ''),
        /https:\/\/app\.getpremarket\.test\/ProposalDetail\?id=/,
      );
      assert.doesNotMatch(String(emailCapture.resendPayloads[1].subject || ''), /Closed as Lost/i);

      const repeatConfirmRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(repeatConfirmRes.statusCode, 403);
      assert.equal(emailCapture.resendPayloads.length, 2, 'repeating a finalized agreement must not resend the final email');

      const finalSummary = await getSummary(ownerCookie);
      assert.equal(finalSummary.wonCount, 1);
      assert.equal(finalSummary.lostCount, 0);
      assert.equal(finalSummary.closedCount, 1);

      const finalActivity = aggregateActivity(await getActivity(ownerCookie, '30'));
      assert.equal(finalActivity.won >= 1, true);

      const recipientNotifications = await getNotifications(recipientCookie);
      const finalNotification = recipientNotifications.find(
        (entry) =>
          entry.event_type === 'status_won' &&
          String(entry.message || '').includes('is now agreed'),
      );
      assert.ok(finalNotification, 'recipient should receive an agreed notification');
      assert.equal(finalNotification.title, 'Agreed');
    } finally {
      emailCapture.restore();
    }
  });

  test('request agreement sends one immediate recipient email, keeps the in-app notification, and persists Requested Agreement state', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_request_email', 'owner-request-email@example.com');
    const recipientCookie = authCookie('outcome_recipient_request_email', 'recipient-request-email@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Requested Agreement Email Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-request-email@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const requestRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(requestRes.statusCode, 200);
      assert.equal(requestRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(requestRes.jsonBody().proposal.primary_status_key, 'waiting_on_counterparty');
      assert.equal(requestRes.jsonBody().proposal.primary_status_label, 'Requested Agreement');

      assert.equal(emailCapture.resendPayloads.length, 1);
      assert.deepEqual(emailCapture.resendPayloads[0].to, ['recipient-request-email@example.com']);
      assert.equal(
        emailCapture.resendPayloads[0].subject,
        'Agreement Requested — Requested Agreement Email Proposal',
      );
      assert.match(
        String(emailCapture.resendPayloads[0].text || ''),
        /requested agreement on "Requested Agreement Email Proposal" and is waiting for your confirmation\./i,
      );
      assert.match(
        String(emailCapture.resendPayloads[0].text || ''),
        /https:\/\/app\.getpremarket\.test\/ProposalDetail\?id=/,
      );

      const queuedEmails = await listAgreementRequestEmails(proposal.id);
      assert.equal(queuedEmails.length, 0, 'request agreement should no longer create delayed email rows');

      const recipientNotifications = await getNotifications(recipientCookie);
      const agreementNotification = recipientNotifications.find(
        (entry) =>
          entry.event_type === 'status_won' &&
          String(entry.message || '').includes('waiting for your confirmation'),
      );
      assert.ok(agreementNotification, 'recipient should still receive the in-app agreement notification');

      const requesterInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
      const requesterRow = requesterInbox.find((entry) => entry.id === proposal.id);
      assert.ok(requesterRow, 'requesting user should still see the pending thread in Inbox');
      assert.equal(requesterRow.primary_status_label, 'Requested Agreement');

      const repeatRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(repeatRes.statusCode, 200);
      assert.equal(repeatRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(repeatRes.jsonBody().proposal.primary_status_label, 'Requested Agreement');
      assert.equal(emailCapture.resendPayloads.length, 1, 'repeat request should not resend email');
      assert.equal((await listAgreementRequestEmails(proposal.id)).length, 0);

      const recipientNotificationsAfterRepeat = await getNotifications(recipientCookie);
      const agreementNotificationCount = recipientNotificationsAfterRepeat.filter(
        (entry) =>
          entry.event_type === 'status_won' &&
          String(entry.message || '').includes('waiting for your confirmation'),
      ).length;
      assert.equal(agreementNotificationCount, 1);
    } finally {
      emailCapture.restore();
    }
  });

  test('requester cannot use Continue Negotiating as an undo after requesting agreement', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_withdraw_request', 'owner-withdraw-request@example.com');
    const recipientCookie = authCookie('outcome_recipient_withdraw_request', 'recipient-withdraw-request@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Withdraw Requested Agreement Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-withdraw-request@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const requestRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(requestRes.statusCode, 200);
      assert.equal(requestRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(emailCapture.resendPayloads.length, 1);

      const retractRes = await markOutcome(ownerCookie, proposal.id, { action: 'continue' });
      assert.equal(retractRes.statusCode, 403);
      assert.equal(retractRes.jsonBody().error.code, 'outcome_not_allowed');

      const queueRows = await listAgreementRequestEmails(proposal.id);
      assert.equal(queueRows.length, 0);
    } finally {
      emailCapture.restore();
    }
  });

  test('counterparty can continue negotiating, which clears the pending request, keeps the thread active, and notifies the requester', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_continue', 'owner-continue@example.com');
    const recipientCookie = authCookie('outcome_recipient_continue', 'recipient-continue@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Continue Negotiating Proposal',
      status: 'under_verification',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-continue@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const requestRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(requestRes.statusCode, 200);
      assert.equal(requestRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(requestRes.jsonBody().proposal.primary_status_label, 'Requested Agreement');
      assert.equal(emailCapture.resendPayloads.length, 1);

      const pendingForRecipient = (await listProposals(recipientCookie, { tab: 'inbox', limit: '20' }))
        .find((entry) => entry.id === proposal.id);
      assert.ok(pendingForRecipient, 'recipient should see the pending request in Inbox');
      assert.equal(pendingForRecipient.outcome.requested_by_counterparty, true);
      assert.equal(pendingForRecipient.outcome.can_mark_won, true);
      assert.equal(pendingForRecipient.outcome.can_continue_negotiating, true);

      const continueRes = await markOutcome(recipientCookie, proposal.id, {
        action: 'continue_negotiating',
      });
      assert.equal(continueRes.statusCode, 200);
      assert.equal(continueRes.jsonBody().proposal.outcome.state, 'open');
      assert.equal(continueRes.jsonBody().proposal.thread_bucket, 'inbox');
      assert.equal(continueRes.jsonBody().proposal.primary_status_label, 'Waiting on Counterparty');
      assert.equal(continueRes.jsonBody().proposal.status, 'under_verification');

      const requesterInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
      const requesterRow = requesterInbox.find((entry) => entry.id === proposal.id);
      assert.ok(requesterRow, 'requester should still see the reopened thread in Inbox');
      assert.equal(requesterRow.thread_bucket, 'inbox');
      assert.equal(requesterRow.primary_status_label, 'Under Review');
      assert.equal(requesterRow.outcome.pending, false);
      assert.equal(requesterRow.outcome.requested_by_current_user, false);
      assert.equal(requesterRow.outcome.requested_by_counterparty, false);

      const summary = await getSummary(ownerCookie);
      assert.equal(summary.closedCount, 0);
      assert.equal(summary.wonCount, 0);
      assert.equal(summary.lostCount, 0);

      const requesterNotifications = await getNotifications(ownerCookie);
      const continueNotification = requesterNotifications.find(
        (entry) => entry.event_type === 'status_continue_negotiating',
      );
      assert.ok(continueNotification, 'requester should receive a continue negotiating notification');
      assert.equal(continueNotification.title, 'Continue Negotiating');
      assert.match(
        String(continueNotification.message || ''),
        /wants to continue negotiating/i,
      );

      assert.equal(emailCapture.resendPayloads.length, 2);
      assert.deepEqual(emailCapture.resendPayloads[1].to, ['owner-continue@example.com']);
      assert.equal(
        emailCapture.resendPayloads[1].subject,
        'Continue Negotiating — Continue Negotiating Proposal',
      );
      assert.match(
        String(emailCapture.resendPayloads[1].text || ''),
        /wants to continue negotiating on "Continue Negotiating Proposal" and did not confirm the agreement request\./i,
      );
      assert.match(
        String(emailCapture.resendPayloads[1].text || ''),
        /https:\/\/app\.getpremarket\.test\/ProposalDetail\?id=/,
      );

      const proposalEvents = await listProposalEvents(proposal.id);
      assert.equal(
        proposalEvents.some((entry) => entry.eventType === 'proposal.outcome.continue_negotiation'),
        true,
      );
    } finally {
      emailCapture.restore();
    }
  });

  test('counterparty resolution keeps using the final outcome email without creating delayed request rows', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_grace_response', 'owner-grace-response@example.com');
    const recipientCookie = authCookie('outcome_recipient_grace_response', 'recipient-grace-response@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Grace Period Counterparty Response Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-grace-response@example.com',
    });

    const emailCapture = captureTransactionalEmails();

    try {
      const requestRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
      assert.equal(requestRes.statusCode, 200);
      assert.equal(requestRes.jsonBody().proposal.outcome.state, 'pending_won');
      assert.equal(emailCapture.resendPayloads.length, 1);
      assert.equal(
        emailCapture.resendPayloads[0].subject,
        'Agreement Requested — Grace Period Counterparty Response Proposal',
      );

      const lostRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'lost' });
      assert.equal(lostRes.statusCode, 200);
      assert.equal(lostRes.jsonBody().proposal.outcome.state, 'lost');
      assert.equal(lostRes.jsonBody().proposal.thread_bucket, 'closed');
      assert.equal(emailCapture.resendPayloads.length, 2);
      assert.equal(
        emailCapture.resendPayloads[1].subject,
        'Opportunity Closed as Lost — Grace Period Counterparty Response Proposal',
      );
      assert.doesNotMatch(String(emailCapture.resendPayloads[1].subject || ''), /Agreement Requested/i);

      const queueRows = await listAgreementRequestEmails(proposal.id);
      assert.equal(queueRows.length, 0);
    } finally {
      emailCapture.restore();
    }
  });

  test('drafts are excluded from the dashboard activity graph', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_drafts', 'owner-drafts@example.com');

    await createProposal(ownerCookie, {
      title: 'Draft Only Proposal',
      status: 'draft',
      partyBEmail: 'recipient-drafts@example.com',
    });

    const summary = await getSummary(ownerCookie);
    assert.equal(summary.draftsCount, 1);
    assert.equal(summary.sentCount, 0);

    const activity = aggregateActivity(await getActivity(ownerCookie, '30'));
    assert.deepEqual(activity, {
      sent: 0,
      received: 0,
      mutual: 0,
      won: 0,
      lost: 0,
    });
  });

  test('archive stays reversible per actor and only hides proposals from the archiving user', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_delete', 'owner-delete@example.com');
    const recipientCookie = authCookie('outcome_recipient_delete', 'recipient-delete@example.com');
    await touchUser(recipientCookie);

    const sentProposal = await createProposal(ownerCookie, {
      title: 'Soft Delete Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-delete@example.com',
    });
    const draftProposal = await createProposal(ownerCookie, {
      title: 'Hard Delete Draft',
      status: 'draft',
      partyBEmail: 'recipient-delete@example.com',
    });

    const archiveRes = await archiveProposal(ownerCookie, sentProposal.id);
    assert.equal(archiveRes.statusCode, 200);
    assert.ok(archiveRes.jsonBody().proposal.archived_at);

    const ownerDefaultAfterArchive = await listProposals(ownerCookie, { tab: 'all', limit: '20' });
    assert.equal(ownerDefaultAfterArchive.some((entry) => entry.id === sentProposal.id), false);
    const ownerArchived = await listProposals(ownerCookie, { tab: 'archived', limit: '20' });
    assert.equal(ownerArchived.some((entry) => entry.id === sentProposal.id), true);
    const recipientDefaultAfterOwnerArchive = await listProposals(recipientCookie, { tab: 'all', limit: '20' });
    assert.equal(recipientDefaultAfterOwnerArchive.some((entry) => entry.id === sentProposal.id), true);

    const ownerSummaryWhileArchived = await getSummary(ownerCookie);
    assert.equal(ownerSummaryWhileArchived.sentCount, 0);
    const recipientSummaryWhileOwnerArchived = await getSummary(recipientCookie);
    assert.equal(recipientSummaryWhileOwnerArchived.receivedCount, 1);

    const ownerActivityWhileArchived = aggregateActivity(await getActivity(ownerCookie, '30'));
    assert.equal(ownerActivityWhileArchived.sent, 0);
    const recipientActivityWhileOwnerArchived = aggregateActivity(await getActivity(recipientCookie, '30'));
    assert.equal(recipientActivityWhileOwnerArchived.received >= 1, true);

    const unarchiveRes = await unarchiveProposal(ownerCookie, sentProposal.id);
    assert.equal(unarchiveRes.statusCode, 200);
    assert.equal(unarchiveRes.jsonBody().proposal.archived_at, null);

    const ownerDefaultAfterUnarchive = await listProposals(ownerCookie, { tab: 'all', limit: '20' });
    assert.equal(ownerDefaultAfterUnarchive.some((entry) => entry.id === sentProposal.id), true);

    const recipientArchiveRes = await archiveProposal(recipientCookie, sentProposal.id);
    assert.equal(recipientArchiveRes.statusCode, 200);
    assert.ok(recipientArchiveRes.jsonBody().proposal.archived_at);

    const recipientDefaultAfterArchive = await listProposals(recipientCookie, { tab: 'all', limit: '20' });
    assert.equal(recipientDefaultAfterArchive.some((entry) => entry.id === sentProposal.id), false);
    const recipientArchived = await listProposals(recipientCookie, { tab: 'archived', limit: '20' });
    assert.equal(recipientArchived.some((entry) => entry.id === sentProposal.id), true);
    const ownerDefaultAfterRecipientArchive = await listProposals(ownerCookie, { tab: 'all', limit: '20' });
    assert.equal(ownerDefaultAfterRecipientArchive.some((entry) => entry.id === sentProposal.id), true);

    const recipientSummaryWhileArchived = await getSummary(recipientCookie);
    assert.equal(recipientSummaryWhileArchived.receivedCount, 0);
    const ownerSummaryWhileRecipientArchived = await getSummary(ownerCookie);
    assert.equal(ownerSummaryWhileRecipientArchived.sentCount, 1);

    const recipientUnarchiveRes = await unarchiveProposal(recipientCookie, sentProposal.id);
    assert.equal(recipientUnarchiveRes.statusCode, 200);
    assert.equal(recipientUnarchiveRes.jsonBody().proposal.archived_at, null);
    const recipientDefaultAfterUnarchive = await listProposals(recipientCookie, { tab: 'all', limit: '20' });
    assert.equal(recipientDefaultAfterUnarchive.some((entry) => entry.id === sentProposal.id), true);
  });

  test('outcome and archive responses return the thread-model fields used by cache updates', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_response_shape', 'owner-response-shape@example.com');
    const recipientCookie = authCookie('outcome_recipient_response_shape', 'recipient-response-shape@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Response Shape Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-response-shape@example.com',
    });

    const lostRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'lost' });
    assert.equal(lostRes.statusCode, 200);
    assert.equal(lostRes.jsonBody().proposal.thread_bucket, 'closed');
    assert.equal(lostRes.jsonBody().proposal.primary_status_key, 'closed_lost');
    assert.equal(lostRes.jsonBody().proposal.outcome.state, 'lost');
    assert.ok(lostRes.jsonBody().proposal.last_activity_at);

    const archivedProposal = await createProposal(ownerCookie, {
      title: 'Archive Response Shape Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-response-shape@example.com',
    });

    const archiveRes = await archiveProposal(ownerCookie, archivedProposal.id);
    assert.equal(archiveRes.statusCode, 200);
    assert.equal(archiveRes.jsonBody().proposal.thread_bucket, 'archived');
    assert.equal(archiveRes.jsonBody().proposal.primary_status_key, 'waiting_on_counterparty');
    assert.equal(archiveRes.jsonBody().proposal.outcome.actor_role, 'party_a');
    assert.ok(archiveRes.jsonBody().proposal.last_activity_at);
  });

  test('delete uses hard-delete for drafts plus soft-delete for sent proposals', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_delete_modes', 'owner-delete-modes@example.com');
    const recipientCookie = authCookie('outcome_recipient_delete_modes', 'recipient-delete-modes@example.com');
    await touchUser(recipientCookie);

    const sentProposal = await createProposal(ownerCookie, {
      title: 'Soft Delete Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient-delete-modes@example.com',
    });
    const draftProposal = await createProposal(ownerCookie, {
      title: 'Hard Delete Draft',
      status: 'draft',
      partyBEmail: 'recipient-delete-modes@example.com',
    });

    const hardDeleteRes = await deleteProposal(ownerCookie, draftProposal.id);
    assert.equal(hardDeleteRes.statusCode, 200);
    assert.equal(hardDeleteRes.jsonBody().mode, 'hard');

    const db = getDb();
    const hardDeletedRows = await db
      .select({ id: schema.proposals.id })
      .from(schema.proposals)
      .where(eq(schema.proposals.id, draftProposal.id));
    assert.equal(hardDeletedRows.length, 0);

    const softDeleteRes = await deleteProposal(recipientCookie, sentProposal.id);
    assert.equal(softDeleteRes.statusCode, 200);
    assert.equal(softDeleteRes.jsonBody().mode, 'soft');
    assert.equal(softDeleteRes.jsonBody().actor_role, 'party_b');

    const softDeletedRows = await db
      .select({
        id: schema.proposals.id,
        deletedByPartyBAt: schema.proposals.deletedByPartyBAt,
      })
      .from(schema.proposals)
      .where(eq(schema.proposals.id, sentProposal.id));
    assert.equal(softDeletedRows.length, 1);
    assert.ok(softDeletedRows[0].deletedByPartyBAt, 'soft delete should stamp deleted_by_party_b_at');

    const recipientVisible = await listProposals(recipientCookie, { tab: 'all', limit: '20' });
    assert.equal(recipientVisible.some((entry) => entry.id === sentProposal.id), false);

    const ownerVisible = await listProposals(ownerCookie, { tab: 'all', limit: '20' });
    assert.equal(ownerVisible.some((entry) => entry.id === sentProposal.id), true);

    const ownerSummary = await getSummary(ownerCookie);
    assert.equal(ownerSummary.sentCount, 1);
  });

  test('agreement requests surface through the proposals filter and move into agreed counts only after confirmation', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('outcome_owner_agreement_filter', 'owner-agreement-filter@example.com');
    const recipientCookie = authCookie('outcome_recipient_agreement_filter', 'recipient-agreement-filter@example.com');
    await touchUser(recipientCookie);

    const proposal = await createProposal(ownerCookie, {
      title: 'Agreement Requested Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-agreement-filter@example.com',
    });

    const pendingRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'won' });
    assert.equal(pendingRes.statusCode, 200);
    assert.equal(pendingRes.jsonBody().proposal.outcome.state, 'pending_won');

    const ownerAgreementRequests = await listProposals(ownerCookie, {
      status: 'agreement_requested',
      limit: '20',
    });
    assert.equal(ownerAgreementRequests.some((entry) => entry.id === proposal.id), true);

    const recipientAgreementRequests = await listProposals(recipientCookie, {
      status: 'agreement_requested',
      limit: '20',
    });
    assert.equal(recipientAgreementRequests.some((entry) => entry.id === proposal.id), false);

    const pendingSummary = await getSummary(ownerCookie);
    assert.equal(pendingSummary.wonCount, 0);

    const confirmRes = await markOutcome(ownerCookie, proposal.id, { outcome: 'won' });
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.jsonBody().proposal.status, 'won');

    const ownerAgreementRequestsAfterConfirm = await listProposals(ownerCookie, {
      status: 'agreement_requested',
      limit: '20',
    });
    assert.equal(ownerAgreementRequestsAfterConfirm.some((entry) => entry.id === proposal.id), false);

    const finalSummary = await getSummary(ownerCookie);
    assert.equal(finalSummary.wonCount, 1);
  });
}
