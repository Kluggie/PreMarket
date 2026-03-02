/**
 * proposals-workflow-tabs.test.mjs
 *
 * Regression tests for:
 * A) /api/debug/db production token gating (missing token → 404, valid token → 200)
 * B) Tab counts match what is displayed (under_verification counted in draftsCount)
 * C) Workflow / status routing:
 *    - under_verification with sent_at=NULL → in All + Drafts, NOT Sent
 *    - under_verification with sent_at set → in All + Sent, NOT Drafts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import debugDbHandler from '../../server/routes/debug/db.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import summaryHandler from '../../server/routes/dashboard/summary.ts';
import { hasDatabaseUrl } from '../../server/_lib/db/client.js';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

ensureTestEnv();

const dbAvailable = hasDatabaseUrl();

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
