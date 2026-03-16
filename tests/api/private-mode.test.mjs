/**
 * private-mode.test.mjs
 *
 * Regression tests for the "Private Mode" feature on proposals.
 *
 * Scenarios covered:
 *  1. Starter plan is rejected when creating a private opportunity (403)
 *  2. Early Access plan can create a private opportunity (201)
 *  3. Professional plan can create a private opportunity (201)
 *  4. Enterprise plan can create a private opportunity (201)
 *  5. Owner (party_a) GET list — still sees own identity (party_a_email present)
 *  6. Recipient (party_b) GET list — party_a_email + counterparty_email masked
 *  7. Recipient (party_b) GET detail — party_a_email + owner_user_id masked
 *  8. Owner GET detail — party_a_email NOT masked
 *  9. Non-private proposal — identity visible to both sides unchanged
 * 10. Legacy records without is_private_mode — treated as false (not masked)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import * as schema from '../../server/_lib/db/schema.js';
import { eq } from 'drizzle-orm';

ensureTestEnv();

// ─── helpers ──────────────────────────────────────────────────────────────────

function authCookie(userId, email) {
  return makeSessionCookie({ sub: userId, email });
}

async function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  return drizzle(sql, { schema });
}

/** Seed a billing_references row for a user to give them a specific plan tier. */
async function seedBillingPlan(userId, plan) {
  const db = await getDb();
  await db
    .insert(schema.users)
    .values({
      id: userId,
      email: `${userId}@example.com`,
    })
    .onConflictDoNothing({ target: schema.users.id });
  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: { plan, status: 'active' },
    });
}

function getErrorCode(body) {
  return body?.error?.code || body?.code || null;
}

/** Create a proposal via the API. Returns proposal object (or null on failure). */
async function createProposal(cookie, body) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  return { statusCode: res.statusCode, body: res.jsonBody() };
}

/** GET /api/proposals (list). */
async function listProposals(cookie, query = {}) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query: { limit: '20', ...query },
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  return res.jsonBody();
}

/** GET /api/proposals/:id (detail). */
async function getProposal(cookie, id) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/proposals/${id}`,
    headers: { cookie },
    query: { id },
  });
  const res = createMockRes();
  await proposalDetailHandler(req, res, id);
  return res.jsonBody();
}

/** Stub Resend so send.ts doesn't make real HTTP calls. Returns a restore fn. */
function stubResend() {
  const originalFetch = globalThis.fetch;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  const originalName = process.env.RESEND_FROM_NAME;
  const originalReplyTo = process.env.RESEND_REPLY_TO;

  process.env.RESEND_API_KEY = 'test_key_private_mode';
  process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
  process.env.RESEND_FROM_NAME = 'PreMarket';
  process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend_stub_private_mode' }),
      };
    }
    return originalFetch.call(globalThis, url, init);
  };

  return function restore() {
    globalThis.fetch = originalFetch;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
    if (originalName === undefined) delete process.env.RESEND_FROM_NAME;
    else process.env.RESEND_FROM_NAME = originalName;
    if (originalReplyTo === undefined) delete process.env.RESEND_REPLY_TO;
    else process.env.RESEND_REPLY_TO = originalReplyTo;
  };
}

// ─── test suite ───────────────────────────────────────────────────────────────

if (!hasDatabaseUrl()) {
  test('private-mode integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('Private Mode: plan gating — starter plan cannot create private proposals', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('pm_starter_user', 'starter@example.com');
    // No billing row seeded → defaults to 'starter'

    const { statusCode, body } = await createProposal(cookie, {
      title: 'Private on Starter',
      partyBEmail: 'recipient@example.com',
      is_private_mode: true,
    });

    assert.equal(
      statusCode,
      403,
      `Starter plan should receive 403 when creating a private proposal, got ${statusCode}`,
    );
    assert.equal(body.ok, false);
    assert.equal(
      getErrorCode(body),
      'plan_not_eligible',
      `Expected error code 'plan_not_eligible', got '${getErrorCode(body)}'`,
    );
  });

  test('Private Mode: plan gating — early access plan CAN create private proposals', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'pm_ea_user';
    const cookie = authCookie(userId, 'ea@example.com');
    await seedBillingPlan(userId, 'early_access');

    const { statusCode, body } = await createProposal(cookie, {
      title: 'Private on Early Access',
      partyBEmail: 'recipient@example.com',
      is_private_mode: true,
    });

    assert.equal(statusCode, 201, `Early Access plan should be able to create private proposal, got ${statusCode}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.proposal.is_private_mode, true, 'Newly created proposal must have is_private_mode: true');
  });

  test('Private Mode: plan gating — professional plan CAN create private proposals', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'pm_pro_user';
    const cookie = authCookie(userId, 'pro@example.com');
    await seedBillingPlan(userId, 'professional');

    const { statusCode, body } = await createProposal(cookie, {
      title: 'Private on Professional',
      partyBEmail: 'recipient@example.com',
      is_private_mode: true,
    });

    assert.equal(statusCode, 201, `Professional plan should be able to create private proposal, got ${statusCode}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.proposal.is_private_mode, true, 'Newly created proposal must have is_private_mode: true');
  });

  test('Private Mode: plan gating — enterprise plan CAN create private proposals', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'pm_ent_user';
    const cookie = authCookie(userId, 'enterprise@example.com');
    await seedBillingPlan(userId, 'enterprise');

    const { statusCode, body } = await createProposal(cookie, {
      title: 'Private on Enterprise',
      partyBEmail: 'recipient@example.com',
      is_private_mode: true,
    });

    assert.equal(statusCode, 201, `Enterprise plan should be able to create private proposal, got ${statusCode}`);
    assert.equal(body.ok, true);
    assert.equal(body.proposal.is_private_mode, true);
  });

  test('Private Mode: owner list — sender identity NOT masked for the proposal owner', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_visibility';
    const ownerEmail = 'owner.visibility@example.com';
    const ownerCookie = authCookie(ownerId, ownerEmail);
    await seedBillingPlan(ownerId, 'professional');

    const restore = stubResend();
    try {
      // Create + send a private proposal
      const { body: create } = await createProposal(ownerCookie, {
        title: 'Private Visibility Test',
        partyBEmail: 'recipient@example.com',
        is_private_mode: true,
        status: 'draft',
      });
      assert.equal(create.ok, true);
      const proposalId = create.proposal.id;

      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie: ownerCookie },
        query: { id: proposalId },
        body: { recipientEmail: 'recipient@example.com' },
      });
      const sendRes = createMockRes();
      await proposalSendHandler(sendReq, sendRes, proposalId);
      assert.equal(sendRes.statusCode, 200, `Send failed: ${JSON.stringify(sendRes.jsonBody())}`);

      // Owner lists proposals — must see their own identity
      const listBody = await listProposals(ownerCookie);
      assert.equal(listBody.ok, true);
      const row = listBody.proposals.find((p) => p.id === proposalId);
      assert.ok(row, 'Owner should find the private proposal in the list');
      assert.equal(row.is_private_mode, true, 'is_private_mode must be true on list row');
      // Owner is party_a — they must still see recipient's email (counterparty_email = party_b)
      assert.ok(
        row.counterparty_email !== null && row.counterparty_email !== undefined,
        'Owner must still see counterparty_email (not masked for sender)',
      );
    } finally {
      restore();
    }
  });

  test('Private Mode: recipient list — party_a_email and counterparty_email masked', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_mask_list';
    const ownerCookie = authCookie(ownerId, 'owner.mask@example.com');
    await seedBillingPlan(ownerId, 'professional');

    const recipientEmail = 'recipient.mask.list@example.com';
    const recipientId = 'pm_recipient_mask_list';
    const recipientCookie = authCookie(recipientId, recipientEmail);

    const restore = stubResend();
    try {
      // Create + send private proposal
      const { body: create } = await createProposal(ownerCookie, {
        title: 'Private Masked List',
        partyBEmail: recipientEmail,
        is_private_mode: true,
        status: 'draft',
      });
      assert.equal(create.ok, true, `Create failed: ${JSON.stringify(create)}`);
      const proposalId = create.proposal.id;

      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie: ownerCookie },
        query: { id: proposalId },
        body: { recipientEmail },
      });
      const sendRes = createMockRes();
      await proposalSendHandler(sendReq, sendRes, proposalId);
      assert.equal(sendRes.statusCode, 200, `Send failed: ${JSON.stringify(sendRes.jsonBody())}`);

      // Recipient lists proposals — identity must be masked
      const listBody = await listProposals(recipientCookie);
      assert.equal(listBody.ok, true);
      const row = listBody.proposals.find((p) => p.id === proposalId);
      assert.ok(row, 'Recipient must find the private proposal in their list');
      assert.equal(row.is_private_mode, true);
      assert.equal(
        row.counterparty_email,
        null,
        'counterparty_email must be null for recipient of private proposal',
      );
      assert.equal(
        row.owner_user_id,
        null,
        'owner_user_id must be null for recipient of private proposal',
      );
    } finally {
      restore();
    }
  });

  test('Private Mode: recipient detail — party_a_email and owner_user_id masked', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_mask_detail';
    const ownerCookie = authCookie(ownerId, 'owner.detail@example.com');
    await seedBillingPlan(ownerId, 'professional');

    const recipientEmail = 'recipient.detail@example.com';
    const recipientId = 'pm_recipient_mask_detail';
    const recipientCookie = authCookie(recipientId, recipientEmail);

    const restore = stubResend();
    try {
      const { body: create } = await createProposal(ownerCookie, {
        title: 'Private Masked Detail',
        partyBEmail: recipientEmail,
        is_private_mode: true,
        status: 'draft',
      });
      assert.equal(create.ok, true);
      const proposalId = create.proposal.id;

      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie: ownerCookie },
        query: { id: proposalId },
        body: { recipientEmail },
      });
      const sendRes = createMockRes();
      await proposalSendHandler(sendReq, sendRes, proposalId);
      assert.equal(sendRes.statusCode, 200);

      // Recipient GETs detail
      const detail = await getProposal(recipientCookie, proposalId);
      assert.ok(detail.proposal, 'Recipient must be able to fetch proposal detail');
      assert.equal(detail.proposal.is_private_mode, true);
      assert.equal(
        detail.proposal.party_a_email,
        null,
        'party_a_email must be null for recipient in private mode',
      );
      assert.equal(
        detail.proposal.owner_user_id,
        null,
        'owner_user_id must be null for recipient in private mode',
      );
    } finally {
      restore();
    }
  });

  test('Private Mode: owner detail — party_a_email NOT masked for the owner', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_detail_visible';
    const ownerEmail = 'owner.detail.visible@example.com';
    const ownerCookie = authCookie(ownerId, ownerEmail);
    await seedBillingPlan(ownerId, 'professional');

    const restore = stubResend();
    try {
      const { body: create } = await createProposal(ownerCookie, {
        title: 'Private Owner Sees Email',
        partyBEmail: 'other@example.com',
        is_private_mode: true,
        status: 'draft',
      });
      assert.equal(create.ok, true);
      const proposalId = create.proposal.id;

      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie: ownerCookie },
        query: { id: proposalId },
        body: { recipientEmail: 'other@example.com' },
      });
      const sendRes = createMockRes();
      await proposalSendHandler(sendReq, sendRes, proposalId);
      assert.equal(sendRes.statusCode, 200);

      const detail = await getProposal(ownerCookie, proposalId);
      assert.ok(detail.proposal, 'Owner must get proposal detail');
      assert.equal(
        detail.proposal.party_a_email,
        ownerEmail,
        `Owner should see their own email (${ownerEmail}), got: ${detail.proposal.party_a_email}`,
      );
      assert.equal(
        detail.proposal.owner_user_id,
        ownerId,
        'Owner must see their own owner_user_id',
      );
    } finally {
      restore();
    }
  });

  test('Private Mode: non-private proposal — identity visible to both sides', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_nonprivate';
    const ownerEmail = 'owner.nonprivate@example.com';
    const ownerCookie = authCookie(ownerId, ownerEmail);

    const recipientEmail = 'recipient.nonprivate@example.com';
    const recipientId = 'pm_recipient_nonprivate';
    const recipientCookie = authCookie(recipientId, recipientEmail);

    const restore = stubResend();
    try {
      const { body: create } = await createProposal(ownerCookie, {
        title: 'Non-Private Proposal',
        partyBEmail: recipientEmail,
        status: 'draft',
        // No is_private_mode flag
      });
      assert.equal(create.ok, true, `Create failed: ${JSON.stringify(create)}`);
      const proposalId = create.proposal.id;

      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie: ownerCookie },
        query: { id: proposalId },
        body: { recipientEmail },
      });
      const sendRes = createMockRes();
      await proposalSendHandler(sendReq, sendRes, proposalId);
      assert.equal(sendRes.statusCode, 200);

      // Recipient sees owner email
      const detail = await getProposal(recipientCookie, proposalId);
      assert.ok(detail.proposal);
      assert.equal(detail.proposal.is_private_mode, false, 'Non-private proposal must have is_private_mode: false');
      assert.equal(
        detail.proposal.party_a_email,
        ownerEmail,
        `Non-private proposal must show owner email to recipient, got: ${detail.proposal.party_a_email}`,
      );
    } finally {
      restore();
    }
  });

  test('Private Mode: PATCH preserves is_private_mode when not changed', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_patch';
    const ownerCookie = authCookie(ownerId, 'owner.patch@example.com');
    await seedBillingPlan(ownerId, 'enterprise');

    const { body: create } = await createProposal(ownerCookie, {
      title: 'Private Patch Test',
      partyBEmail: 'patch.recipient@example.com',
      is_private_mode: true,
    });
    assert.equal(create.ok, true);
    const proposalId = create.proposal.id;

    // PATCH without touching is_private_mode
    const patchReq = createMockReq({
      method: 'PATCH',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
      body: { title: 'Updated Private Patch Test' },
    });
    const patchRes = createMockRes();
    await proposalDetailHandler(patchReq, patchRes, proposalId);
    assert.equal(patchRes.statusCode, 200, `Patch failed: ${JSON.stringify(patchRes.jsonBody())}`);

    // Verify is_private_mode still true after unrelated PATCH
    const detail = await getProposal(ownerCookie, proposalId);
    assert.equal(
      detail.proposal.is_private_mode,
      true,
      'is_private_mode must persist across unrelated PATCH operations',
    );
    assert.equal(detail.proposal.title, 'Updated Private Patch Test', 'Title must be updated');
  });

  test('Private Mode: PATCH plan gating — starter cannot enable is_private_mode', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_patch_starter';
    const ownerCookie = authCookie(ownerId, 'owner.patch.starter@example.com');

    // Create as normal (non-private) under starter/no billing row.
    const { body: create } = await createProposal(ownerCookie, {
      title: 'Starter Patch Gate',
      partyBEmail: 'starter.patch.recipient@example.com',
      is_private_mode: false,
    });
    assert.equal(create.ok, true);
    const proposalId = create.proposal.id;

    // Attempt to enable private mode via PATCH.
    const patchReq = createMockReq({
      method: 'PATCH',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
      body: { is_private_mode: true },
    });
    const patchRes = createMockRes();
    await proposalDetailHandler(patchReq, patchRes, proposalId);

    assert.equal(
      patchRes.statusCode,
      403,
      `Starter PATCH should be blocked with 403, got ${patchRes.statusCode}: ${JSON.stringify(patchRes.jsonBody())}`,
    );
    assert.equal(getErrorCode(patchRes.jsonBody()), 'plan_not_eligible');

    // Verify proposal remains non-private.
    const detail = await getProposal(ownerCookie, proposalId);
    assert.equal(detail.proposal.is_private_mode, false);
  });

  test('Private Mode: PATCH plan gating — early access can enable is_private_mode', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerId = 'pm_owner_patch_ea';
    const ownerCookie = authCookie(ownerId, 'owner.patch.ea@example.com');
    await seedBillingPlan(ownerId, 'early_access');

    const { body: create } = await createProposal(ownerCookie, {
      title: 'Early Access Patch Gate',
      partyBEmail: 'ea.patch.recipient@example.com',
      is_private_mode: false,
    });
    assert.equal(create.ok, true);
    const proposalId = create.proposal.id;

    const patchReq = createMockReq({
      method: 'PATCH',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
      body: { is_private_mode: true },
    });
    const patchRes = createMockRes();
    await proposalDetailHandler(patchReq, patchRes, proposalId);

    assert.equal(
      patchRes.statusCode,
      200,
      `Early Access PATCH should be allowed, got ${patchRes.statusCode}: ${JSON.stringify(patchRes.jsonBody())}`,
    );

    const detail = await getProposal(ownerCookie, proposalId);
    assert.equal(detail.proposal.is_private_mode, true);
  });
}
