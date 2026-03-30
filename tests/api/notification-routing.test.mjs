import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import proposalOutcomeHandler from '../../server/routes/proposals/[id]/outcome.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import notificationsHandler from '../../server/routes/notifications/index.ts';
import notificationByIdHandler from '../../server/routes/notifications/[id].ts';
import { createNotificationEvent } from '../../server/_lib/notifications.ts';
import { schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import {
  buildDocumentComparisonNotificationHref,
  buildLegacyOpportunityNotificationHref,
} from '../../src/lib/notificationTargets.js';

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

async function touchUser(cookie) {
  const res = await callHandler(notificationsHandler, {
    method: 'GET',
    url: '/api/notifications',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
}

async function createComparison(cookie, overrides = {}) {
  const res = await callHandler(documentComparisonsHandler, {
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: 'Notification Routing Comparison',
      createProposal: true,
      docAText: 'Confidential contract language about payment timing and renewal rights.',
      docBText: 'Shared contract language about payment timing, renewals, and support coverage.',
      ...overrides,
    },
  });

  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison;
}

async function evaluateComparison(cookie, comparisonId) {
  const res = await callHandler(
    documentComparisonsEvaluateHandler,
    {
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/evaluate`,
      headers: { cookie },
      query: { id: comparisonId },
      body: {},
    },
    comparisonId,
  );

  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

async function createSharedReport(cookie, comparisonId, recipientEmail) {
  const res = await callHandler(sharedReportsHandler, {
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 25,
    },
  });

  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

async function getSharedReportWorkspace(token, cookie = null) {
  const res = await callHandler(
    sharedReportRecipientTokenHandler,
    {
      method: 'GET',
      url: `/api/shared-report/${token}`,
      query: { token },
      headers: cookie ? { cookie } : {},
    },
    token,
  );
  return res;
}

async function saveRecipientDraft(token, cookie, body = {}) {
  const res = await callHandler(
    sharedReportRecipientDraftHandler,
    {
      method: 'POST',
      url: `/api/shared-report/${token}/draft`,
      headers: cookie ? { cookie } : {},
      query: { token },
      body,
    },
    token,
  );
  return res;
}

async function sendBackRecipientDraft(token, cookie) {
  const res = await callHandler(
    sharedReportRecipientSendBackHandler,
    {
      method: 'POST',
      url: `/api/shared-report/${token}/send-back`,
      headers: cookie ? { cookie } : {},
      query: { token },
      body: {},
    },
    token,
  );
  return res;
}

async function listNotifications(cookie) {
  const res = await callHandler(notificationsHandler, {
    method: 'GET',
    url: '/api/notifications',
    headers: { cookie },
  });

  assert.equal(res.statusCode, 200);
  return res.jsonBody().notifications || [];
}

async function requestAgreement(cookie, proposalId) {
  const res = await markOutcome(cookie, proposalId, { outcome: 'won' });
  assert.equal(res.statusCode, 200);
  return res.jsonBody();
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

if (!hasDatabaseUrl()) {
  test('notification routing integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('document-comparison review notifications resolve to the true shared-report Step 0 route and preserve read state behavior', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notification_route_owner', 'notification-route-owner@example.com');
    await touchUser(ownerCookie);

    const comparison = await createComparison(ownerCookie);
    const proposalId = comparison.proposal_id;
    assert.ok(proposalId, 'comparison should stay linked to a proposal');
    const sharedReport = await createSharedReport(
      ownerCookie,
      comparison.id,
      'notification-route-review-recipient@example.com',
    );

    await evaluateComparison(ownerCookie, comparison.id);

    const notifications = await listNotifications(ownerCookie);
    const notification = notifications.find(
      (entry) => entry.event_type === 'evaluation_update' && entry.title === 'AI mediation review ready',
    );

    assert.ok(notification, 'expected an AI mediation review notification');
    assert.equal(
      notification.action_url,
      buildDocumentComparisonNotificationHref(sharedReport.token),
    );
    assert.equal(
      notification.target?.href,
      buildDocumentComparisonNotificationHref(sharedReport.token),
    );
    assert.equal(notification.target?.route, 'SharedReport');
    assert.equal(notification.target?.tab, null);
    assert.equal(notification.target?.comparison_id, comparison.id);
    assert.equal(notification.target?.proposal_id, proposalId);
    assert.equal(notification.target?.shared_report_token, sharedReport.token);
    assert.equal(
      notification.target?.legacy_href,
      buildLegacyOpportunityNotificationHref({ proposalId }),
    );
    assert.equal(notification.read, false);

    const markReadRes = await callHandler(
      notificationByIdHandler,
      {
        method: 'PATCH',
        url: `/api/notifications/${notification.id}`,
        headers: { cookie: ownerCookie },
        query: { id: notification.id },
        body: { read: true },
      },
      notification.id,
    );
    assert.equal(markReadRes.statusCode, 200);

    const notificationsAfterRead = await listNotifications(ownerCookie);
    const readNotification = notificationsAfterRead.find((entry) => entry.id === notification.id);
    assert.ok(readNotification, 'notification should still be present after mark-read');
    assert.equal(readNotification.read, true);
    assert.equal(
      readNotification.action_url,
      buildDocumentComparisonNotificationHref(sharedReport.token),
    );
  });

  test('proposal-native notifications keep the existing proposal destination', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'notification_route_native_owner';
    const ownerCookie = authCookie(ownerId, 'notification-route-native@example.com');
    await touchUser(ownerCookie);

    const proposalId = 'proposal_native_notification_123';
    const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });
    await createNotificationEvent({
      db: getDb(),
      userId: ownerId,
      eventType: 'new_proposal',
      dedupeKey: `native:${proposalId}`,
      title: 'New proposal received',
      message: 'A standard proposal notification should keep its legacy destination.',
      actionUrl: legacyHref,
    });

    const notifications = await listNotifications(ownerCookie);
    const notification = notifications.find((entry) => entry.title === 'New proposal received');
    assert.ok(notification, 'expected a proposal-native notification');
    assert.equal(notification.action_url, legacyHref);
    assert.equal(notification.target?.route, null);
    assert.equal(notification.target?.is_legacy_fallback, true);
  });

  test('request-agreement notifications for document comparisons resolve to the true shared-report Step 0 route', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notification_route_agreement_owner', 'notification-route-agreement-owner@example.com');
    const recipientCookie = authCookie('notification_route_agreement_recipient', 'notification-route-agreement-recipient@example.com');
    await touchUser(ownerCookie);
    await touchUser(recipientCookie);

    const comparison = await createComparison(ownerCookie, {
      recipientEmail: 'notification-route-agreement-recipient@example.com',
    });
    const proposalId = comparison.proposal_id;
    assert.ok(proposalId, 'comparison should stay linked to a proposal');
    const sharedReport = await createSharedReport(
      ownerCookie,
      comparison.id,
      'notification-route-agreement-recipient@example.com',
    );

    const now = new Date();
    await getDb()
      .update(schema.proposals)
      .set({
        status: 'received',
        sentAt: now,
        receivedAt: now,
        partyBEmail: 'notification-route-agreement-recipient@example.com',
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, proposalId));

    await requestAgreement(ownerCookie, proposalId);

    const notifications = await listNotifications(recipientCookie);
    const notification = notifications.find(
      (entry) =>
        entry.event_type === 'status_won' &&
        entry.title === 'Agreement Requested',
    );

    assert.ok(notification, 'expected an agreement-request notification');
    assert.equal(
      notification.action_url,
      buildDocumentComparisonNotificationHref(sharedReport.token),
    );
    assert.equal(
      notification.target?.href,
      buildDocumentComparisonNotificationHref(sharedReport.token),
    );
    assert.equal(notification.target?.route, 'SharedReport');
    assert.equal(notification.target?.tab, null);
    assert.equal(notification.target?.comparison_id, comparison.id);
    assert.equal(notification.target?.proposal_id, proposalId);
    assert.equal(notification.target?.shared_report_token, sharedReport.token);
    assert.equal(
      notification.target?.legacy_href,
      buildLegacyOpportunityNotificationHref({ proposalId }),
    );
  });

  test('continue-negotiating notifications keep recipient binding on the counterparty handoff token', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerEmail = 'notification-route-continue-owner@example.com';
    const recipientEmail = 'notification-route-continue-recipient@example.com';
    const ownerCookie = authCookie('notification_route_continue_owner', ownerEmail);
    const recipientCookie = authCookie('notification_route_continue_recipient', recipientEmail);
    await touchUser(ownerCookie);
    await touchUser(recipientCookie);

    const comparison = await createComparison(ownerCookie, { recipientEmail });
    const proposalId = comparison.proposal_id;
    assert.ok(proposalId, 'comparison should stay linked to a proposal');

    const initialShare = await createSharedReport(ownerCookie, comparison.id, recipientEmail);
    assert.ok(initialShare?.token, 'initial shared-report token should exist');

    const saveDraftRes = await saveRecipientDraft(initialShare.token, recipientCookie, {
      shared_payload: {
        label: 'Shared Information',
        text: 'Recipient shared update before handoff',
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Recipient confidential note',
      },
    });
    assert.equal(saveDraftRes.statusCode, 200);

    const sendBackRes = await sendBackRecipientDraft(initialShare.token, recipientCookie);
    assert.equal(sendBackRes.statusCode, 200);
    const returnToken = String(sendBackRes.jsonBody().return_link?.token || '');
    assert.ok(returnToken, 'send-back should create a return link token for the counterparty');

    // Re-open the old recipient link so its updatedAt becomes newest.
    // The regression is that continue-negotiating previously selected this stale token.
    const reopenOldLinkRes = await getSharedReportWorkspace(initialShare.token, recipientCookie);
    assert.equal(reopenOldLinkRes.statusCode, 200);

    const now = new Date();
    await getDb()
      .update(schema.proposals)
      .set({
        status: 'received',
        sentAt: now,
        receivedAt: now,
        partyBEmail: recipientEmail,
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, proposalId));

    await requestAgreement(ownerCookie, proposalId);

    const continueRes = await markOutcome(recipientCookie, proposalId, {
      action: 'continue_negotiating',
    });
    assert.equal(continueRes.statusCode, 200);

    const ownerNotifications = await listNotifications(ownerCookie);
    const continueNotification = ownerNotifications.find(
      (entry) =>
        entry.event_type === 'status_continue_negotiating' &&
        entry.title === 'Continue Negotiating',
    );
    assert.ok(continueNotification, 'owner should receive a continue-negotiating notification');

    const expectedHref = buildDocumentComparisonNotificationHref(returnToken);
    assert.equal(continueNotification.action_url, expectedHref);
    assert.equal(continueNotification.target?.href, expectedHref);
    assert.equal(String(continueNotification.target?.shared_report_token || ''), returnToken);

    const ownerWorkspaceRes = await getSharedReportWorkspace(returnToken, ownerCookie);
    assert.equal(ownerWorkspaceRes.statusCode, 200);
    const ownerWorkspaceBody = ownerWorkspaceRes.jsonBody();
    assert.equal(String(ownerWorkspaceBody.share?.invited_email || '').toLowerCase(), ownerEmail);
    assert.equal(Boolean(ownerWorkspaceBody.share?.authorization?.authorized_for_current_user), true);
    assert.equal(Boolean(ownerWorkspaceBody.share?.authorization?.requires_verification), false);

    const wrongAccountRes = await getSharedReportWorkspace(initialShare.token, ownerCookie);
    assert.equal(wrongAccountRes.statusCode, 200);
    const wrongAccountBody = wrongAccountRes.jsonBody();
    assert.equal(String(wrongAccountBody.share?.invited_email || '').toLowerCase(), recipientEmail);
    assert.equal(Boolean(wrongAccountBody.share?.authorization?.authorized_for_current_user), false);
    assert.equal(Boolean(wrongAccountBody.share?.authorization?.requires_verification), true);
  });

  test('older comparison notifications without comparison routing metadata fall back safely', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'notification_route_legacy_owner';
    const ownerCookie = authCookie(ownerId, 'notification-route-legacy@example.com');
    await touchUser(ownerCookie);

    const proposalId = 'proposal_legacy_notification_456';
    const legacyHref = buildLegacyOpportunityNotificationHref({ proposalId });
    await createNotificationEvent({
      db: getDb(),
      userId: ownerId,
      eventType: 'evaluation_update',
      dedupeKey: `legacy:${proposalId}`,
      title: 'AI mediation review ready',
      message: 'This simulates an older notification row without comparison metadata.',
      actionUrl: legacyHref,
    });

    const notifications = await listNotifications(ownerCookie);
    const notification = notifications.find((entry) => entry.title === 'AI mediation review ready');
    assert.ok(notification, 'expected a legacy notification');
    assert.equal(notification.action_url, legacyHref);
    assert.equal(notification.target?.comparison_id, null);
    assert.equal(notification.target?.legacy_href, legacyHref);
    assert.equal(notification.target?.is_legacy_fallback, true);
  });
}
