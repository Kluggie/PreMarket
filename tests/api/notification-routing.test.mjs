import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import proposalOutcomeHandler from '../../server/routes/proposals/[id]/outcome.ts';
import notificationsHandler from '../../server/routes/notifications/index.ts';
import notificationByIdHandler from '../../server/routes/notifications/[id].ts';
import { createNotificationEvent } from '../../server/_lib/notifications.ts';
import { schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import {
  buildDocumentComparisonReportHref,
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
  const res = await callHandler(
    proposalOutcomeHandler,
    {
      method: 'POST',
      url: `/api/proposals/${proposalId}/outcome`,
      headers: { cookie },
      query: { id: proposalId },
      body: { outcome: 'won' },
    },
    proposalId,
  );

  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

if (!hasDatabaseUrl()) {
  test('notification routing integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('document-comparison review notifications resolve to the canonical comparison report route and preserve read state behavior', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('notification_route_owner', 'notification-route-owner@example.com');
    await touchUser(ownerCookie);

    const comparison = await createComparison(ownerCookie);
    const proposalId = comparison.proposal_id;
    assert.ok(proposalId, 'comparison should stay linked to a proposal');

    await evaluateComparison(ownerCookie, comparison.id);

    const notifications = await listNotifications(ownerCookie);
    const notification = notifications.find(
      (entry) => entry.event_type === 'evaluation_update' && entry.title === 'AI mediation review ready',
    );

    assert.ok(notification, 'expected an AI mediation review notification');
    assert.equal(
      notification.action_url,
      buildDocumentComparisonReportHref(comparison.id),
    );
    assert.equal(
      notification.target?.href,
      buildDocumentComparisonReportHref(comparison.id),
    );
    assert.equal(notification.target?.route, 'DocumentComparisonDetail');
    assert.equal(notification.target?.tab, 'report');
    assert.equal(notification.target?.comparison_id, comparison.id);
    assert.equal(notification.target?.proposal_id, proposalId);
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
      buildDocumentComparisonReportHref(comparison.id),
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

  test('request-agreement notifications for document comparisons resolve to the canonical comparison report route', async () => {
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
      buildDocumentComparisonReportHref(comparison.id),
    );
    assert.equal(
      notification.target?.href,
      buildDocumentComparisonReportHref(comparison.id),
    );
    assert.equal(notification.target?.route, 'DocumentComparisonDetail');
    assert.equal(notification.target?.tab, 'report');
    assert.equal(notification.target?.comparison_id, comparison.id);
    assert.equal(notification.target?.proposal_id, proposalId);
    assert.equal(
      notification.target?.legacy_href,
      buildLegacyOpportunityNotificationHref({ proposalId }),
    );
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
