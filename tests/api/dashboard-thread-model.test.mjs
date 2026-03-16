import assert from 'node:assert/strict';
import test from 'node:test';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import { getDb, schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
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

async function archiveProposal(cookie, proposalId) {
  const res = await callHandler(
    proposalArchiveHandler,
    {
      method: 'PATCH',
      url: `/api/proposals/${proposalId}/archive`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
  assert.equal(res.statusCode, 200);
  return res.jsonBody().proposal;
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

function aggregateThreadActivity(points) {
  return points.reduce(
    (acc, point) => {
      acc.newThreads += Number(point?.new_threads || 0);
      acc.activeRounds += Number(point?.active_rounds || 0);
      acc.closedThreads += Number(point?.closed_threads || 0);
      acc.archivedThreads += Number(point?.archived_threads || 0);
      acc.legacySent += Number(point?.sent || 0);
      acc.legacyReceived += Number(point?.received || 0);
      return acc;
    },
    {
      newThreads: 0,
      activeRounds: 0,
      closedThreads: 0,
      archivedThreads: 0,
      legacySent: 0,
      legacyReceived: 0,
    },
  );
}

if (!hasDatabaseUrl()) {
  test('dashboard thread model integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('dashboard summary exposes thread buckets and activity exposes thread-based series', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('dashboard_thread_owner', 'dashboard-thread-owner@example.com');
    const otherCookie = authCookie('dashboard_thread_other', 'dashboard-thread-other@example.com');
    await seedProfessionalPlan('dashboard_thread_owner', 'dashboard-thread-owner@example.com');
    await seedProfessionalPlan('dashboard_thread_other', 'dashboard-thread-other@example.com');

    await createProposal(ownerCookie, {
      title: 'Owner Draft',
      status: 'draft',
      partyBEmail: 'dashboard-thread-recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Owner Sent',
      status: 'sent',
      partyBEmail: 'dashboard-thread-recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Owner Won',
      status: 'won',
      partyBEmail: 'dashboard-thread-recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Owner Lost',
      status: 'lost',
      partyBEmail: 'dashboard-thread-recipient@example.com',
    });
    await createProposal(otherCookie, {
      title: 'Inbound For Owner',
      status: 'sent',
      partyBEmail: 'dashboard-thread-owner@example.com',
    });

    const summary = await getSummary(ownerCookie);
    assert.equal(summary.inboxCount, 2);
    assert.equal(summary.draftsCount, 1);
    assert.equal(summary.closedCount, 2);
    assert.equal(summary.archivedCount, 0);

    const activity = aggregateThreadActivity(await getActivity(ownerCookie, '30'));
    assert.equal(activity.newThreads >= 5, true);
    assert.equal(activity.activeRounds >= 4, true);
    assert.equal(activity.closedThreads >= 2, true);
    assert.equal(activity.archivedThreads, 0);
  });

  test('dashboard archived activity is user-scoped while legacy directional counts stay archive-hidden for the archiver', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('dashboard_archive_owner', 'dashboard-archive-owner@example.com');
    const recipientCookie = authCookie('dashboard_archive_recipient', 'dashboard-archive-recipient@example.com');

    const proposal = await createProposal(ownerCookie, {
      title: 'Archive Visibility Proposal',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'dashboard-archive-recipient@example.com',
    });

    await archiveProposal(ownerCookie, proposal.id);

    const ownerSummary = await getSummary(ownerCookie);
    const recipientSummary = await getSummary(recipientCookie);
    assert.equal(ownerSummary.sentCount, 0);
    assert.equal(recipientSummary.receivedCount, 1);

    const ownerActivity = aggregateThreadActivity(await getActivity(ownerCookie, '30'));
    assert.equal(ownerActivity.legacySent, 0);
    assert.equal(ownerActivity.archivedThreads >= 1, true);

    const recipientActivity = aggregateThreadActivity(await getActivity(recipientCookie, '30'));
    assert.equal(recipientActivity.legacyReceived >= 1, true);
    assert.equal(recipientActivity.archivedThreads, 0);
  });
}
