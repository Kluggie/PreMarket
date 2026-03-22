import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import billingStatusHandler from '../../server/routes/billing/status.ts';
import { getDb, schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

function addDays(input, days) {
  const value = new Date(input);
  value.setDate(value.getDate() + days);
  return value;
}

function startOfDay(input) {
  const value = new Date(input);
  value.setHours(0, 0, 0, 0);
  return value;
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

async function seedStarterPlan(userId, email) {
  const db = getDb();
  await db
    .insert(schema.users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: schema.users.id });
  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan: 'starter',
      status: 'active',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: {
        plan: 'starter',
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

async function getSummaryWithRange(cookie, range) {
  const res = await callHandler(dashboardSummaryHandler, {
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { cookie },
    query: range ? { range } : {},
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().summary;
}

async function insertProposalEvent({ proposalId, proposalUserId, actorUserId, actorRole, eventType, createdAt }) {
  const db = getDb();
  await db.insert(schema.proposalEvents).values({
    id: randomUUID(),
    proposalId,
    proposalUserId,
    actorUserId,
    actorRole,
    eventType,
    eventData: {},
    createdAt,
  });
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

  test('dashboard summary range keeps opportunity-level counting and uses exchange_count>=2 for mutual interest', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerUserId = 'dashboard_range_owner';
    const ownerEmail = 'dashboard-range-owner@example.com';
    const ownerCookie = authCookie(ownerUserId, ownerEmail);
    await seedProfessionalPlan(ownerUserId, ownerEmail);

    const oldSentProposal = await createProposal(ownerCookie, {
      title: 'Old Sent Opportunity',
      status: 'sent',
      sentAt: addDays(new Date(), -45).toISOString(),
      partyBEmail: 'dashboard-range-recipient@example.com',
    });
    assert.ok(oldSentProposal?.id);

    const recentSentProposal = await createProposal(ownerCookie, {
      title: 'Recent Sent Opportunity',
      status: 'sent',
      sentAt: addDays(new Date(), -2).toISOString(),
      partyBEmail: 'dashboard-range-recipient@example.com',
    });
    assert.ok(recentSentProposal?.id);

    const mutualProposal = await createProposal(ownerCookie, {
      title: 'Recent Two-Way Opportunity',
      status: 'sent',
      sentAt: addDays(new Date(), -1).toISOString(),
      partyBEmail: 'dashboard-range-recipient@example.com',
    });
    assert.ok(mutualProposal?.id);

    const now = new Date();
    const thresholdReachedAt = addDays(now, -1);
    await insertProposalEvent({
      proposalId: mutualProposal.id,
      proposalUserId: ownerUserId,
      actorUserId: 'dashboard_range_recipient_actor',
      actorRole: 'party_b',
      eventType: 'proposal.send_back',
      createdAt: thresholdReachedAt,
    });
    await insertProposalEvent({
      proposalId: mutualProposal.id,
      proposalUserId: ownerUserId,
      actorUserId: ownerUserId,
      actorRole: 'party_a',
      eventType: 'proposal.send_back',
      createdAt: now,
    });

    const allTimeSummary = await getSummary(ownerCookie);
    assert.equal(allTimeSummary.sentCount, 3);
    assert.equal(allTimeSummary.receivedCount, 0);
    assert.equal(allTimeSummary.mutualInterestCount, 1);

    const sevenDaySummary = await getSummaryWithRange(ownerCookie, '7');
    assert.equal(sevenDaySummary.sentCount, 2);
    assert.equal(sevenDaySummary.receivedCount, 0);
    assert.equal(
      sevenDaySummary.mutualInterestCount,
      1,
      'Mutual Interest should count each qualifying opportunity once even after extra rounds',
    );

    const sevenDayPoints = await getActivity(ownerCookie, '7');
    const sevenDayActivity = aggregateThreadActivity(sevenDayPoints);
    assert.equal(sevenDayActivity.legacySent, 2);
    const mutualTotalFromActivity = sevenDayPoints.reduce(
      (sum, point) => sum + Number(point?.mutual || 0),
      0,
    );
    assert.equal(mutualTotalFromActivity, sevenDaySummary.mutualInterestCount);
    const mutualDays = sevenDayPoints.filter((point) => Number(point?.mutual || 0) > 0);
    assert.equal(mutualDays.length, 1, 'Mutual Interest should be plotted once per qualifying opportunity');
    assert.equal(Number(mutualDays[0]?.mutual || 0), 1);
    assert.equal(
      String(mutualDays[0]?.date || ''),
      startOfDay(thresholdReachedAt).toISOString().slice(0, 10),
      'Mutual Interest should plot on the day exchange_count first reached 2',
    );
  });

  test('dashboard summary range filters won/lost counts while all-time remains lifetime', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerUserId = 'dashboard_range_outcome_owner';
    const ownerEmail = 'dashboard-range-outcome-owner@example.com';
    const ownerCookie = authCookie(ownerUserId, ownerEmail);
    await seedProfessionalPlan(ownerUserId, ownerEmail);

    const wonProposal = await createProposal(ownerCookie, {
      title: 'Won Outside Window',
      status: 'won',
      sentAt: addDays(new Date(), -60).toISOString(),
      partyBEmail: 'dashboard-range-recipient@example.com',
    });
    const lostProposal = await createProposal(ownerCookie, {
      title: 'Lost Inside Window',
      status: 'lost',
      sentAt: addDays(new Date(), -2).toISOString(),
      partyBEmail: 'dashboard-range-recipient@example.com',
    });

    const db = getDb();
    const wonClosedAt = addDays(new Date(), -60);
    await db
      .update(schema.proposals)
      .set({
        closedAt: wonClosedAt,
        partyAOutcomeAt: wonClosedAt,
        partyBOutcomeAt: wonClosedAt,
        updatedAt: wonClosedAt,
      })
      .where(eq(schema.proposals.id, wonProposal.id));

    const sevenDaySummary = await getSummaryWithRange(ownerCookie, '7');
    assert.equal(sevenDaySummary.wonCount, 0);
    assert.equal(sevenDaySummary.lostCount, 1);

    const allTimeSummary = await getSummary(ownerCookie);
    assert.equal(allTimeSummary.wonCount, 1);
    assert.equal(allTimeSummary.lostCount, 1);

    assert.ok(lostProposal?.id);
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

  test('dashboard summary includes starter usage snapshot for starter users', async () => {
    await ensureMigrated();
    await resetTables();

    const starterUserId = 'dashboard_starter_user';
    const starterEmail = 'dashboard-starter-user@example.com';
    await seedStarterPlan(starterUserId, starterEmail);

    const starterCookie = authCookie(starterUserId, starterEmail);
    await createProposal(starterCookie, {
      title: 'Starter Draft',
      status: 'draft',
      partyBEmail: 'starter-recipient@example.com',
    });

    const summary = await getSummary(starterCookie);
    assert.equal(summary.starterUsage?.plan, 'starter');
    assert.equal(summary.starterUsage?.limits?.opportunitiesPerMonth, 3);
    assert.equal(summary.starterUsage?.limits?.activeOpportunities, 2);
    assert.equal(summary.starterUsage?.limits?.aiEvaluationsPerMonth, 10);
    assert.equal(summary.starterUsage?.limits?.uploadBytesPerMonth, 100 * 1024 * 1024);
    assert.equal(summary.starterUsage?.usage?.opportunitiesCreatedThisMonth >= 1, true);
    assert.equal(summary.starterUsage?.remaining?.opportunitiesPerMonth <= 2, true);
  });

  test('dashboard summary omits starter usage snapshot for paid users', async () => {
    await ensureMigrated();
    await resetTables();

    const proUserId = 'dashboard_paid_user';
    const proEmail = 'dashboard-paid-user@example.com';
    const proCookie = authCookie(proUserId, proEmail);
    await seedProfessionalPlan(proUserId, proEmail);

    await createProposal(proCookie, {
      title: 'Paid User Draft',
      status: 'draft',
      partyBEmail: 'paid-recipient@example.com',
    });

    const summary = await getSummary(proCookie);
    assert.equal(summary.starterUsage, null);
  });

  test('dashboard summary omits starter usage snapshot for early access users', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'dashboard_early_access_user';
    const email = 'dashboard-early-access-user@example.com';
    const cookie = authCookie(userId, email);
    await seedProfessionalPlan(userId, email);

    const db = getDb();
    await db
      .insert(schema.billingReferences)
      .values({
        userId,
        plan: 'early_access',
        status: 'active',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.billingReferences.userId,
        set: {
          plan: 'early_access',
          status: 'active',
          updatedAt: new Date(),
        },
      });

    await createProposal(cookie, {
      title: 'Early Access Draft',
      status: 'draft',
      partyBEmail: 'early-access-recipient@example.com',
    });

    const summary = await getSummary(cookie);
    assert.equal(summary.starterUsage, null);
  });

  test('dashboard summary omits starter usage for early access user with NO billing row', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'dashboard_ea_no_billing';
    const email = 'dashboard-ea-no-billing@example.com';
    const cookie = authCookie(userId, email);

    const db = getDb();

    // Only create a user row; no billingReferences row
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // Seed a betaSignups entry for this user (early access path)
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    const summary = await getSummary(cookie);
    assert.equal(
      summary.starterUsage,
      null,
      'Early Access user with no billing row must not receive a starterUsage payload',
    );
  });

  test('dashboard summary omits starter usage snapshot for enterprise users', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'dashboard_enterprise_user';
    const email = 'dashboard-enterprise-user@example.com';
    const cookie = authCookie(userId, email);
    await seedProfessionalPlan(userId, email);

    const db = getDb();
    await db
      .insert(schema.billingReferences)
      .values({
        userId,
        plan: 'enterprise',
        status: 'active',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.billingReferences.userId,
        set: {
          plan: 'enterprise',
          status: 'active',
          updatedAt: new Date(),
        },
      });

    await createProposal(cookie, {
      title: 'Enterprise Draft',
      status: 'draft',
      partyBEmail: 'enterprise-recipient@example.com',
    });

    const summary = await getSummary(cookie);
    assert.equal(summary.starterUsage, null);
  });

  test('dashboard summary omits starter usage for active promo user (future trialEndsAt)', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'dashboard_active_promo';
    const email = 'dashboard-active-promo@example.com';
    const cookie = authCookie(userId, email);

    const db = getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // trialEndsAt 25 days in the future — should still be treated as early_access
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        createdAt: new Date(),
        trialEndsAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    const summary = await getSummary(cookie);
    assert.equal(
      summary.starterUsage,
      null,
      'Active promo user (future trialEndsAt) must not receive a starterUsage payload',
    );
  });

  test('dashboard summary INCLUDES starter usage snapshot for expired promo user', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'dashboard_expired_promo';
    const email = 'dashboard-expired-promo@example.com';
    const cookie = authCookie(userId, email);

    const db = getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // trialEndsAt 2 days in the past — should fall back to starter
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        createdAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    const summary = await getSummary(cookie);
    assert.equal(
      summary.starterUsage?.plan,
      'starter',
      'Expired promo user must fall back to Starter and receive a starterUsage payload',
    );
  });

  test('billing status returns resolved plan_tier early_access for EA user via betaSignups (not raw starter from billing row)', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'billing_ea_via_beta';
    const email = 'billing-ea-via-beta@example.com';
    const cookie = authCookie(userId, email);

    const db = getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // No billing row — plan comes entirely from betaSignups (active promo)
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        createdAt: new Date(),
        trialEndsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    const res = await callHandler(billingStatusHandler, {
      method: 'GET',
      url: '/api/billing/status',
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200);
    const billing = res.jsonBody().billing;
    assert.equal(
      billing.plan_tier,
      'early_access',
      'Billing status must return early_access for EA user via betaSignups — not the raw billing row starter value',
    );
  });

  test('billing status returns starter plan_tier for expired promo user', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'billing_expired_promo';
    const email = 'billing-expired-promo@example.com';
    const cookie = authCookie(userId, email);

    const db = getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // Expired promo — plan should fall back to starter
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    const res = await callHandler(billingStatusHandler, {
      method: 'GET',
      url: '/api/billing/status',
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200);
    const billing = res.jsonBody().billing;
    assert.equal(
      billing.plan_tier,
      'starter',
      'Expired promo user must see starter plan_tier in billing status',
    );
  });
}
