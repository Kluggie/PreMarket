import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
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

if (!hasDatabaseUrl()) {
  test('proposal outcomes integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('outcome permissions follow the round rules for proposer and recipient', async () => {
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
    assert.equal(ownerWonRes.statusCode, 403);
    assert.equal(ownerWonRes.jsonBody().error?.code, 'outcome_not_allowed');

    const ownerLostRes = await markOutcome(ownerCookie, roundOne.id, { outcome: 'lost' });
    assert.equal(ownerLostRes.statusCode, 403);
    assert.equal(ownerLostRes.jsonBody().error?.code, 'outcome_not_allowed');

    const recipientWonRes = await markOutcome(recipientCookie, roundOne.id, { outcome: 'won' });
    assert.equal(recipientWonRes.statusCode, 200);
    assert.equal(recipientWonRes.jsonBody().proposal.outcome.state, 'pending_won');
    assert.notEqual(recipientWonRes.jsonBody().proposal.status, 'won');

    const laterRound = await createProposal(ownerCookie, {
      title: 'Later Round Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-rounds@example.com',
    });

    const ownerLaterWonRes = await markOutcome(ownerCookie, laterRound.id, { outcome: 'won' });
    assert.equal(ownerLaterWonRes.statusCode, 200);
    assert.equal(ownerLaterWonRes.jsonBody().proposal.outcome.state, 'pending_won');
    assert.equal(ownerLaterWonRes.jsonBody().proposal.outcome.actor_role, 'party_a');

    const laterRoundLost = await createProposal(ownerCookie, {
      title: 'Later Round Lost Proposal',
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: 'recipient-rounds@example.com',
    });

    const ownerLaterLostRes = await markOutcome(ownerCookie, laterRoundLost.id, { outcome: 'lost' });
    assert.equal(ownerLaterLostRes.statusCode, 200);
    assert.equal(ownerLaterLostRes.jsonBody().proposal.status, 'lost');
    assert.equal(ownerLaterLostRes.jsonBody().proposal.outcome.state, 'lost');
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
      'Use Request Agreement, Confirm Agreement, Lost, or Continue Negotiating.',
    );
  });

  test('unilateral lost closes immediately, updates analytics, and notifies the counterparty', async () => {
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

    const lostRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'lost' });
    assert.equal(lostRes.statusCode, 200);
    assert.equal(lostRes.jsonBody().proposal.status, 'lost');
    assert.equal(lostRes.jsonBody().proposal.outcome.state, 'lost');
    assert.ok(lostRes.jsonBody().proposal.closed_at, 'lost outcome should stamp closed_at');

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
  });

  test('single-sided won stays pending until both parties confirm, then counts as won and emits notifications', async () => {
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

    const pendingWonRes = await markOutcome(recipientCookie, proposal.id, { outcome: 'won' });
    assert.equal(pendingWonRes.statusCode, 200);
    assert.equal(pendingWonRes.jsonBody().proposal.outcome.state, 'pending_won');
    assert.equal(pendingWonRes.jsonBody().proposal.outcome.requested_by, 'party_b');
    assert.equal(pendingWonRes.jsonBody().proposal.outcome.requested_by_current_user, true);

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
