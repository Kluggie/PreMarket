/**
 * proposals-workflow-tabs.test.mjs
 *
 * Regression tests for:
 * A) /api/debug/db production token gating (missing token → 404, valid token → 200)
 * B) Thread bucket mapping and counts for Inbox/Drafts/Closed/Archived
 * C) Same-row workflow routing across send/respond/send-back rounds
 * D) Pending win / archive / delete regressions that can look like persistence loss
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import debugDbHandler from '../../server/routes/debug/db.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import proposalOutcomeHandler from '../../server/routes/proposals/[id]/outcome.ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import proposalUnarchiveHandler from '../../server/routes/proposals/[id]/unarchive.ts';
import sharedLinkRespondHandler from '../../server/routes/shared-links/[token]/respond.ts';
import summaryHandler from '../../server/routes/dashboard/summary.ts';
import { getDb, hasDatabaseUrl, schema } from '../../server/_lib/db/client.js';
import { ensureMigrated } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

ensureTestEnv();

const dbAvailable = hasDatabaseUrl();

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
  assert.equal(res.statusCode, 201, `Create proposal should return 201, got ${res.statusCode}`);
  return res.jsonBody().proposal;
}

async function listProposals(cookie, query = {}) {
  const res = await callHandler(proposalsHandler, {
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  assert.equal(res.statusCode, 200, `List proposals should return 200, got ${res.statusCode}`);
  return res.jsonBody().proposals || [];
}

async function withMockedEmailSend(fn) {
  const originalFetch = global.fetch;
  global.fetch = async (...args) => {
    const [url] = args;
    if (String(url || '').startsWith('https://api.resend.com/emails')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `email_${Date.now()}` }),
      };
    }
    return originalFetch(...args);
  };
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

async function sendProposal(cookie, proposalId, body = {}) {
  return withMockedEmailSend(async () => {
    const res = await callHandler(
      proposalSendHandler,
      {
        method: 'POST',
        url: `/api/proposals/${proposalId}/send`,
        headers: { cookie },
        query: { id: proposalId },
        body,
      },
      proposalId,
    );
    assert.equal(res.statusCode, 200, `Send should return 200, got ${res.statusCode}`);
    return res.jsonBody();
  });
}

async function respondToSharedLink(token, body) {
  const res = await callHandler(
    sharedLinkRespondHandler,
    {
      method: 'POST',
      url: `/api/shared-links/${token}/respond`,
      query: { token },
      body,
    },
    token,
  );
  assert.equal(res.statusCode, 200, `Shared-link response should return 200, got ${res.statusCode}`);
  return res.jsonBody();
}

async function markOutcome(cookie, proposalId, body) {
  const res = await callHandler(
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
  assert.equal(res.statusCode, 200, `Outcome update should return 200, got ${res.statusCode}`);
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
  assert.equal(res.statusCode, 200, `Archive should return 200, got ${res.statusCode}`);
  return res.jsonBody().proposal;
}

async function unarchiveProposal(cookie, proposalId) {
  const res = await callHandler(
    proposalUnarchiveHandler,
    {
      method: 'PATCH',
      url: `/api/proposals/${proposalId}/unarchive`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
  assert.equal(res.statusCode, 200, `Unarchive should return 200, got ${res.statusCode}`);
  return res.jsonBody().proposal;
}

async function deleteProposal(cookie, proposalId) {
  const res = await callHandler(
    proposalDetailHandler,
    {
      method: 'DELETE',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
  assert.equal(res.statusCode, 200, `Delete should return 200, got ${res.statusCode}`);
  return res.jsonBody();
}

async function getSummary(cookie) {
  const res = await callHandler(summaryHandler, {
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200, `Summary should return 200, got ${res.statusCode}`);
  return res.jsonBody().summary;
}

// ─── withEnvOverride helper ────────────────────────────────────────────────────

function withEnvOverride(overrides, fn) {
  const original = new Map();
  Object.entries(overrides).forEach(([key, value]) => {
    original.set(key, process.env[key]);
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      original.forEach((value, key) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    });
}

// ─── A) /api/debug/db production token gating ─────────────────────────────────

test('debug/db: production without token returns 404 (not 200, not 401)', async () => {
  await withEnvOverride(
    {
      VERCEL_ENV: 'production',
      DEBUG_TOKEN: 'super-secret-debug-token-abc123',
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/debug/db',
        headers: {}, // no x-debug-token header
      });
      const res = createMockRes();

      await debugDbHandler(req, res);

      assert.equal(
        res.statusCode,
        404,
        `Expected 404 when x-debug-token is missing in production, got ${res.statusCode}. ` +
          'This would advertise the debug endpoint to unauthenticated callers.',
      );
    },
  );
});

test('debug/db: production with wrong token returns 404', async () => {
  await withEnvOverride(
    {
      VERCEL_ENV: 'production',
      DEBUG_TOKEN: 'correct-token-xyz',
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/debug/db',
        headers: { 'x-debug-token': 'wrong-token-abc' },
      });
      const res = createMockRes();

      await debugDbHandler(req, res);

      assert.equal(res.statusCode, 404, `Expected 404 for wrong token, got ${res.statusCode}`);
    },
  );
});

test('debug/db: production with correct token returns 200', async () => {
  const token = 'valid-debug-token-for-test-123';
  await withEnvOverride(
    {
      VERCEL_ENV: 'production',
      DEBUG_TOKEN: token,
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/debug/db',
        headers: { 'x-debug-token': token },
      });
      const res = createMockRes();

      await debugDbHandler(req, res);

      assert.equal(
        res.statusCode,
        200,
        `Expected 200 for correct token in production, got ${res.statusCode}`,
      );
      const body = res.jsonBody();
      assert.equal(body.ok, true, 'Response body ok should be true');
    },
  );
});

test('debug/db: non-production returns 200 without any token', async () => {
  await withEnvOverride(
    {
      VERCEL_ENV: 'preview',
      DEBUG_TOKEN: null,
    },
    async () => {
      const req = createMockReq({
        method: 'GET',
        url: '/api/debug/db',
        headers: {},
      });
      const res = createMockRes();

      await debugDbHandler(req, res);

      // Preview should not gate behind the token
      assert.equal(
        res.statusCode,
        200,
        `Expected 200 for preview without token, got ${res.statusCode}`,
      );
    },
  );
});

// ─── B/C) Tab classification + summary counts (require DB) ────────────────────

test(
  'under_review with sent_at=null is counted in draftsCount, not sentCount',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    const cookie = makeSessionCookie({
      sub: 'workflow-tabs-test-user-counts',
      email: 'workflowtabscounts@workflow-test.example',
    });

    // Create a proposal with status=under_verification, no sent_at
    const createReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie },
      body: {
        title: `Workflow Tab Count Test ${Date.now()}`,
        status: 'under_verification',
        // sentAt deliberately omitted
      },
    });
    const createRes = createMockRes();
    await proposalsHandler(createReq, createRes);

    assert.equal(
      createRes.statusCode,
      201,
      `Proposal creation should return 201, got ${createRes.statusCode}`,
    );
    const created = createRes.jsonBody();
    const proposalId = created?.proposal?.id;
    assert.ok(proposalId, 'Created proposal should have an id');
    assert.equal(created?.proposal?.sent_at, null, 'sent_at should be null after creation without sentAt');

    // Now call the summary endpoint
    const summaryReq = createMockReq({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie },
    });
    const summaryRes = createMockRes();
    await summaryHandler(summaryReq, summaryRes);

    assert.equal(summaryRes.statusCode, 200, `Summary should return 200, got ${summaryRes.statusCode}`);
    const summaryBody = summaryRes.jsonBody();
    assert.ok(
      summaryBody?.summary?.draftsCount >= 1,
      `Expected draftsCount >= 1 for under_verification proposal with sent_at=null, got draftsCount=${summaryBody?.summary?.draftsCount}. ` +
        'This means under_verification is still NOT counted in drafts (regression of issue B/C).',
    );
  },
);

test(
  'under_review with sent_at=null appears in All and Drafts, NOT in Sent',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    const sub = 'workflow-tabs-test-user-list';
    const email = 'workflowtabslist@workflow-test.example';
    const cookie = makeSessionCookie({ sub, email });

    // Create proposal with under_verification status, no sent_at
    const titleMarker = `TabListTest-NoSentAt-${Date.now()}`;
    const createReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie },
      body: {
        title: titleMarker,
        status: 'under_verification',
        // No sentAt
      },
    });
    const createRes = createMockRes();
    await proposalsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201, `Create should return 201, got ${createRes.statusCode}`);
    const proposalId = createRes.jsonBody()?.proposal?.id;
    assert.ok(proposalId, 'Should have a proposal id');

    // Helper to fetch proposals for a specific tab
    async function fetchTab(tab) {
      const req = createMockReq({
        method: 'GET',
        url: '/api/proposals',
        query: { tab, limit: '100' },
        headers: { cookie },
      });
      const res = createMockRes();
      await proposalsHandler(req, res);
      assert.equal(res.statusCode, 200, `Tab '${tab}' request should return 200`);
      return (res.jsonBody()?.proposals || []);
    }

    const allProposals = await fetchTab('all');
    const draftsProposals = await fetchTab('drafts');
    const sentProposals = await fetchTab('sent');

    const inAll = allProposals.some((p) => p.id === proposalId);
    const inDrafts = draftsProposals.some((p) => p.id === proposalId);
    const inSent = sentProposals.some((p) => p.id === proposalId);

    assert.ok(
      inAll,
      `Proposal ${proposalId} should appear in "All" tab. ` +
        'If missing, the all-tab query is incorrectly filtering out under_verification.',
    );
    assert.ok(
      inDrafts,
      `Proposal ${proposalId} with status=under_verification and sent_at=null should appear in "Drafts" tab. ` +
        'If missing, the drafts tab is still filtering by DRAFT_STATUSES instead of sent_at IS NULL.',
    );
    assert.equal(
      inSent,
      false,
      `Proposal ${proposalId} with sent_at=null must NOT appear in "Sent" tab. ` +
        'If present, sent_at is not being used as the source of truth for "sent".',
    );
  },
);

test(
  'proposal with sent_at set appears in All and Sent, NOT in Drafts',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    const sub = 'workflow-tabs-test-user-sent';
    const email = 'workflowtabssent@workflow-test.example';
    const cookie = makeSessionCookie({ sub, email });

    // Create proposal with sent_at explicitly set (simulates email being sent)
    const titleMarker = `TabListTest-WithSentAt-${Date.now()}`;
    const sentAt = new Date().toISOString();
    const createReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie },
      body: {
        title: titleMarker,
        status: 'under_verification',
        sentAt,
      },
    });
    const createRes = createMockRes();
    await proposalsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201, `Create should return 201, got ${createRes.statusCode}`);
    const proposalId = createRes.jsonBody()?.proposal?.id;
    assert.ok(proposalId, 'Should have a proposal id');
    assert.ok(
      createRes.jsonBody()?.proposal?.sent_at,
      'sent_at should be set in the created proposal response',
    );

    async function fetchTab(tab) {
      const req = createMockReq({
        method: 'GET',
        url: '/api/proposals',
        query: { tab, limit: '100' },
        headers: { cookie },
      });
      const res = createMockRes();
      await proposalsHandler(req, res);
      assert.equal(res.statusCode, 200, `Tab '${tab}' request should return 200`);
      return res.jsonBody()?.proposals || [];
    }

    const allProposals = await fetchTab('all');
    const draftsProposals = await fetchTab('drafts');
    const sentProposals = await fetchTab('sent');

    const inAll = allProposals.some((p) => p.id === proposalId);
    const inDrafts = draftsProposals.some((p) => p.id === proposalId);
    const inSent = sentProposals.some((p) => p.id === proposalId);

    assert.ok(inAll, `Proposal ${proposalId} should appear in "All" tab`);
    assert.ok(
      inSent,
      `Proposal ${proposalId} with sent_at set should appear in "Sent" tab. ` +
        'If missing, sent tab filtering is broken.',
    );
    assert.equal(
      inDrafts,
      false,
      `Proposal ${proposalId} with sent_at set must NOT appear in "Drafts" tab. ` +
        'Once sent_at is set, a proposal graduates out of Drafts.',
    );
  },
);

test(
  'thread buckets place drafts only in Drafts and active threads only in Inbox',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const cookie = makeSessionCookie({
      sub: `workflow-buckets-${runId}`,
      email: `workflow-buckets-${runId}@example.com`,
    });

    const draft = await createProposal(cookie, {
      title: `Draft Thread ${Date.now()}`,
      status: 'under_verification',
      partyBEmail: 'bucket-counterparty@example.com',
    });
    const active = await createProposal(cookie, {
      title: `Inbox Thread ${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'bucket-counterparty@example.com',
    });

    const drafts = await listProposals(cookie, { tab: 'drafts', limit: '20' });
    const inbox = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    const closed = await listProposals(cookie, { tab: 'closed', limit: '20' });

    const draftRow = drafts.find((entry) => entry.id === draft.id);
    const activeRow = inbox.find((entry) => entry.id === active.id);

    assert.ok(draftRow, 'Draft proposal should appear in Drafts');
    assert.equal(inbox.some((entry) => entry.id === draft.id), false, 'Draft should not appear in Inbox');
    assert.equal(closed.some((entry) => entry.id === draft.id), false, 'Draft should not appear in Closed');
    assert.equal(draftRow.thread_bucket, 'drafts');
    assert.equal(draftRow.is_latest_version, true, 'Canonical thread row should still point to latest draft version');

    assert.ok(activeRow, 'Active sent proposal should appear in Inbox');
    assert.equal(drafts.some((entry) => entry.id === active.id), false, 'Active proposal must not appear in Drafts');
    assert.equal(closed.some((entry) => entry.id === active.id), false, 'Active proposal must not appear in Closed');
    assert.equal(activeRow.thread_bucket, 'inbox');
    assert.equal(activeRow.latest_direction, 'sent');
    assert.equal(activeRow.waiting_on_other_party, true);
    assert.equal(activeRow.needs_response, false);
    assert.equal(activeRow.is_latest_version, true);
  },
);

test(
  'send route sets latestDirection from canonical thread activity',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const cookie = makeSessionCookie({
      sub: `workflow-send-direction-${runId}`,
      email: `workflow-send-direction-${runId}@example.com`,
    });
    const recipientEmail = 'workflow-send-direction-recipient@example.com';

    const draft = await createProposal(cookie, {
      title: `Send Direction Draft ${Date.now()}`,
      status: 'draft',
      partyBEmail: recipientEmail,
    });

    const sendResult = await sendProposal(cookie, draft.id, {
      recipientEmail,
    });
    assert.ok(sendResult.sharedLink?.token, 'Send should return a shared-link token');

    const inbox = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    const row = inbox.find((entry) => entry.id === draft.id);

    assert.ok(row, 'Sent proposal should move into Inbox');
    assert.equal(row.latest_direction, 'sent');
    assert.equal(row.waiting_on_other_party, true);
    assert.equal(row.needs_response, false);
    assert.ok(row.last_thread_activity_at, 'Canonical thread activity timestamp should be exposed');
    assert.equal(row.last_thread_actor_role, 'party_a');
  },
);

test(
  'real send, counterparty response, and resend keep one Inbox row while direction and ordering update',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const ownerCookie = makeSessionCookie({
      sub: `workflow-thread-rounds-${runId}`,
      email: `workflow-thread-rounds-owner-${runId}@example.com`,
    });
    const recipientEmail = 'workflow-thread-rounds-recipient@example.com';

    const firstThread = await createProposal(ownerCookie, {
      title: `First Thread ${Date.now()}`,
      status: 'draft',
      partyBEmail: recipientEmail,
    });
    const firstSend = await sendProposal(ownerCookie, firstThread.id, {
      recipientEmail,
    });
    assert.ok(firstSend.sharedLink?.token, 'Initial send should create a share token');

    const secondThread = await createProposal(ownerCookie, {
      title: `Second Thread ${Date.now()}`,
      status: 'draft',
      partyBEmail: recipientEmail,
    });
    await sendProposal(ownerCookie, secondThread.id, {
      recipientEmail,
    });

    let inbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    assert.equal(inbox[0]?.id, secondThread.id, 'Newest active thread should be first before any resend/response');

    await respondToSharedLink(firstSend.sharedLink.token, {
      responderEmail: recipientEmail,
      responses: [{ questionId: 'q_counter_round', value: 'Counterparty update' }],
    });

    inbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    const receivedRow = inbox.filter((entry) => entry.id === firstThread.id);
    assert.equal(receivedRow.length, 1, 'A counter round must not create a duplicate top-level row');
    assert.equal(inbox[0]?.id, firstThread.id, 'The updated canonical row should move to the top of Inbox');
    assert.equal(receivedRow[0].latest_direction, 'received');
    assert.equal(receivedRow[0].needs_response, true);
    assert.equal(receivedRow[0].waiting_on_other_party, false);
    assert.equal(receivedRow[0].is_latest_version, true);
    assert.equal(receivedRow[0].last_thread_actor_role, 'party_b');

    await sendProposal(ownerCookie, firstThread.id, {
      recipientEmail,
      createShareLink: false,
    });

    inbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    const resentRow = inbox.filter((entry) => entry.id === firstThread.id);
    assert.equal(resentRow.length, 1, 'Resending must continue to reuse the same thread row');
    assert.equal(resentRow[0].latest_direction, 'sent');
    assert.equal(resentRow[0].needs_response, false);
    assert.equal(resentRow[0].waiting_on_other_party, true);
    assert.equal(resentRow[0].is_latest_version, true);
    assert.equal(resentRow[0].last_thread_actor_role, 'party_a');
  },
);

test(
  'generic PATCH cannot rewrite transport timestamps or corrupt latestDirection',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const cookie = makeSessionCookie({
      sub: `workflow-patch-guard-${runId}`,
      email: `workflow-patch-guard-${runId}@example.com`,
    });
    const recipientEmail = 'workflow-patch-guard-recipient@example.com';
    const thread = await createProposal(cookie, {
      title: `Patch Guard Thread ${Date.now()}`,
      status: 'draft',
      partyBEmail: recipientEmail,
    });
    await sendProposal(cookie, thread.id, { recipientEmail });

    const before = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    const beforeRow = before.find((entry) => entry.id === thread.id);
    assert.equal(beforeRow?.latest_direction, 'sent');

    const res = await callHandler(
      proposalDetailHandler,
      {
        method: 'PATCH',
        url: `/api/proposals/${thread.id}`,
        headers: { cookie },
        query: { id: thread.id },
        body: {
          title: 'Corrupt attempt',
          receivedAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
      thread.id,
    );
    assert.equal(res.statusCode, 400, 'PATCH should reject sentAt/receivedAt writes');

    const after = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    const afterRow = after.find((entry) => entry.id === thread.id);
    assert.equal(afterRow?.latest_direction, 'sent');
    assert.equal(afterRow?.last_thread_actor_role, 'party_a');
  },
);

test(
  'archive and unarchive do not change Inbox ordering without new thread activity',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const cookie = makeSessionCookie({
      sub: `workflow-unarchive-order-${runId}`,
      email: `workflow-unarchive-order-${runId}@example.com`,
    });

    const older = await createProposal(cookie, {
      title: `Older Inbox ${Date.now()}`,
      status: 'sent',
      sentAt: new Date(Date.now() - 120_000).toISOString(),
      partyBEmail: 'workflow-unarchive-order-recipient@example.com',
    });
    const newer = await createProposal(cookie, {
      title: `Newer Inbox ${Date.now()}`,
      status: 'sent',
      sentAt: new Date(Date.now() - 30_000).toISOString(),
      partyBEmail: 'workflow-unarchive-order-recipient@example.com',
    });

    let inbox = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    assert.equal(inbox[0]?.id, newer.id);

    await archiveProposal(cookie, older.id);
    await unarchiveProposal(cookie, older.id);

    inbox = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    assert.equal(inbox[0]?.id, newer.id, 'Unarchive should not bump an older thread to the top');
    assert.equal(inbox.some((entry) => entry.id === older.id), true);
  },
);

test(
  'AI reevaluation without a new counterparty round does not reorder Inbox',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const ownerCookie = makeSessionCookie({
      sub: `workflow-eval-order-${runId}`,
      email: `workflow-eval-order-owner-${runId}@example.com`,
    });
    const recipientEmail = 'workflow-eval-order-recipient@example.com';
    const older = await createProposal(ownerCookie, {
      title: `Older Eval Thread ${Date.now()}`,
      status: 'draft',
      partyBEmail: recipientEmail,
    });
    const olderSend = await sendProposal(ownerCookie, older.id, { recipientEmail });
    const newer = await createProposal(ownerCookie, {
      title: `Newer Eval Thread ${Date.now()}`,
      status: 'sent',
      sentAt: new Date(Date.now() + 60_000).toISOString(),
      partyBEmail: recipientEmail,
    });

    let inbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    assert.equal(inbox[0]?.id, newer.id);

    await respondToSharedLink(olderSend.sharedLink.token, {
      responderEmail: recipientEmail,
      runEvaluation: true,
    });

    inbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    const olderRow = inbox.find((entry) => entry.id === older.id);
    assert.equal(inbox[0]?.id, newer.id, 'Evaluation-only updates should not reorder Inbox');
    assert.equal(olderRow?.latest_direction, 'sent', 'Evaluation-only updates must not flip direction');
  },
);

test(
  'pending win requests do not reorder Inbox without new thread activity',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const ownerCookie = makeSessionCookie({
      sub: `workflow-outcome-order-owner-${runId}`,
      email: `workflow-outcome-order-owner-${runId}@example.com`,
    });
    const recipientCookie = makeSessionCookie({
      sub: `workflow-outcome-order-recipient-${runId}`,
      email: `workflow-outcome-order-recipient-${runId}@example.com`,
    });

    const older = await createProposal(ownerCookie, {
      title: `Older Outcome Thread ${Date.now()}`,
      status: 'sent',
      sentAt: new Date(Date.now() - 120_000).toISOString(),
      partyBEmail: `workflow-outcome-order-recipient-${runId}@example.com`,
    });
    const newer = await createProposal(ownerCookie, {
      title: `Newer Outcome Thread ${Date.now()}`,
      status: 'sent',
      sentAt: new Date(Date.now() - 30_000).toISOString(),
      partyBEmail: `workflow-outcome-order-recipient-${runId}@example.com`,
    });

    let ownerInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    assert.equal(ownerInbox[0]?.id, newer.id);

    const pendingProposal = await markOutcome(recipientCookie, older.id, { outcome: 'won' });
    assert.equal(pendingProposal.outcome.state, 'pending_won');

    ownerInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    const pendingRow = ownerInbox.find((entry) => entry.id === older.id);
    assert.equal(ownerInbox[0]?.id, newer.id, 'Outcome-only changes must not reorder Inbox');
    assert.equal(pendingRow?.win_confirmation_requested, true);
    assert.equal(pendingRow?.latest_direction, 'sent');
  },
);

test(
  'pending_won stays in Inbox while final won and lost move to Closed',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const ownerCookie = makeSessionCookie({
      sub: `workflow-closed-owner-${runId}`,
      email: `workflow-closed-owner-${runId}@example.com`,
    });
    const recipientCookie = makeSessionCookie({
      sub: `workflow-closed-recipient-${runId}`,
      email: `workflow-closed-recipient-${runId}@example.com`,
    });

    const pendingWinThread = await createProposal(ownerCookie, {
      title: `Pending Win Thread ${Date.now()}`,
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: `workflow-closed-recipient-${runId}@example.com`,
    });

    const pendingProposal = await markOutcome(recipientCookie, pendingWinThread.id, { outcome: 'won' });
    assert.equal(pendingProposal.outcome.state, 'pending_won');

    let ownerInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    let ownerClosed = await listProposals(ownerCookie, { tab: 'closed', limit: '20' });
    const pendingRow = ownerInbox.find((entry) => entry.id === pendingWinThread.id);
    assert.ok(pendingRow, 'Pending agreement request should remain in Inbox');
    assert.equal(pendingRow.win_confirmation_requested, true);
    assert.equal(ownerClosed.some((entry) => entry.id === pendingWinThread.id), false, 'Pending won must not appear in Closed');

    await markOutcome(ownerCookie, pendingWinThread.id, { outcome: 'won' });

    ownerInbox = await listProposals(ownerCookie, { tab: 'inbox', limit: '20' });
    ownerClosed = await listProposals(ownerCookie, { tab: 'closed', limit: '20' });
    assert.equal(ownerInbox.some((entry) => entry.id === pendingWinThread.id), false, 'Confirmed win should leave Inbox');
    assert.equal(
      ownerClosed.some((entry) => entry.id === pendingWinThread.id && entry.status === 'won'),
      true,
      'Confirmed win should appear in Closed',
    );

    const lostThread = await createProposal(ownerCookie, {
      title: `Lost Thread ${Date.now()}`,
      status: 'received',
      sentAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      partyBEmail: `workflow-closed-recipient-${runId}@example.com`,
    });
    await markOutcome(recipientCookie, lostThread.id, { outcome: 'lost' });

    ownerClosed = await listProposals(ownerCookie, { tab: 'closed', limit: '20' });
    assert.equal(
      ownerClosed.some((entry) => entry.id === lostThread.id && entry.status === 'lost'),
      true,
      'Lost proposals should move into Closed',
    );
  },
);

test(
  'archived and deleted proposals leave visible buckets and summary counts match Inbox/Drafts/Closed/Archived',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    await ensureMigrated();

    const runId = Date.now();
    const cookie = makeSessionCookie({
      sub: `workflow-counts-owner-${runId}`,
      email: `workflow-counts-owner-${runId}@example.com`,
    });

    const draft = await createProposal(cookie, {
      title: `Count Draft ${Date.now()}`,
      status: 'draft',
      partyBEmail: 'workflow-counts@example.com',
    });
    const inboxThread = await createProposal(cookie, {
      title: `Count Inbox ${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'workflow-counts@example.com',
    });
    const closedThread = await createProposal(cookie, {
      title: `Count Closed ${Date.now()}`,
      status: 'lost',
      sentAt: new Date().toISOString(),
      partyBEmail: 'workflow-counts@example.com',
    });
    const archivedThread = await createProposal(cookie, {
      title: `Count Archived ${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'workflow-counts@example.com',
    });
    await archiveProposal(cookie, archivedThread.id);
    const deletedThread = await createProposal(cookie, {
      title: `Count Deleted ${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'workflow-counts@example.com',
    });
    const deleteResult = await deleteProposal(cookie, deletedThread.id);
    assert.equal(deleteResult.mode, 'soft');

    const drafts = await listProposals(cookie, { tab: 'drafts', limit: '20' });
    const inbox = await listProposals(cookie, { tab: 'inbox', limit: '20' });
    const closed = await listProposals(cookie, { tab: 'closed', limit: '20' });
    const archived = await listProposals(cookie, { tab: 'archived', limit: '20' });
    const summary = await getSummary(cookie);

    assert.equal(drafts.some((entry) => entry.id === draft.id), true);
    assert.equal(inbox.some((entry) => entry.id === draft.id), false);

    assert.equal(inbox.some((entry) => entry.id === inboxThread.id), true);
    assert.equal(drafts.some((entry) => entry.id === inboxThread.id), false);
    assert.equal(closed.some((entry) => entry.id === inboxThread.id), false);

    assert.equal(closed.some((entry) => entry.id === closedThread.id && entry.status === 'lost'), true);
    assert.equal(inbox.some((entry) => entry.id === closedThread.id), false);

    assert.equal(archived.some((entry) => entry.id === archivedThread.id), true);
    assert.equal(inbox.some((entry) => entry.id === archivedThread.id), false);
    assert.equal(closed.some((entry) => entry.id === archivedThread.id), false);

    assert.equal(drafts.some((entry) => entry.id === deletedThread.id), false);
    assert.equal(inbox.some((entry) => entry.id === deletedThread.id), false);
    assert.equal(closed.some((entry) => entry.id === deletedThread.id), false);
    assert.equal(archived.some((entry) => entry.id === deletedThread.id), false);

    assert.equal(summary.draftsCount, 1);
    assert.equal(summary.inboxCount, 1);
    assert.equal(summary.closedCount, 1);
    assert.equal(summary.archivedCount, 1);
    assert.equal(summary.totalCount, 3);
  },
);

test(
  'document_comparison proposal with evaluation history resumes at step 3',
  { skip: !dbAvailable ? 'DATABASE_URL not set' : false },
  async () => {
    const sub = 'workflow-tabs-test-user-resume-step3';
    const email = 'workflowtabsresumestep3@workflow-test.example';
    const cookie = makeSessionCookie({ sub, email });
    const comparisonId = `comparison_resume_${Date.now()}`;

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie },
      body: {
        title: `Resume Step 3 ${Date.now()}`,
        status: 'draft',
        proposalType: 'document_comparison',
        documentComparisonId: comparisonId,
      },
    });
    const createRes = createMockRes();
    await proposalsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201, `Create should return 201, got ${createRes.statusCode}`);
    const createdProposal = createRes.jsonBody()?.proposal;
    assert.ok(createdProposal?.id, 'Created proposal should have an id');

    const db = getDb();
    const now = new Date();
    await db.insert(schema.proposalEvaluations).values({
      id: `eval_resume_${Date.now()}`,
      proposalId: createdProposal.id,
      userId: sub,
      source: 'document_comparison_vertex',
      status: 'failed',
      summary: 'Simulated evaluation attempt for resume-step regression guard',
      result: { error: { code: 'simulated_failure' } },
      createdAt: now,
      updatedAt: now,
    });

    const listReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { tab: 'drafts', limit: '100' },
      headers: { cookie },
    });
    const listRes = createMockRes();
    await proposalsHandler(listReq, listRes);
    assert.equal(listRes.statusCode, 200, `List should return 200, got ${listRes.statusCode}`);

    const proposals = listRes.jsonBody()?.proposals || [];
    const matching = proposals.find((entry) => entry.id === createdProposal.id);
    assert.ok(matching, 'Created proposal should appear in drafts list');
    assert.equal(
      Number(matching.resume_step || 0),
      3,
      `Expected resume_step=3 when evaluation history exists, got ${matching.resume_step}`,
    );
  },
);
