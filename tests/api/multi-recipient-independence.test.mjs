import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import sharedReportSendHandler from '../../server/routes/shared-reports/[token]/send.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function makeCookie(seed) {
  return makeSessionCookie({
    sub: `${seed}_user`,
    email: `${seed}@example.com`,
  });
}

async function createComparison(cookie, input) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: input.title,
      createProposal: true,
      docAText: input.docAText || 'Confidential doc A text.',
      docBText: input.docBText || 'Shared doc B text.',
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201, `create comparison failed: ${res.body}`);
  return res.jsonBody().comparison;
}

async function createSharedReportLink(cookie, comparisonId, recipientEmail) {
  const req = createMockReq({
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
      maxUses: 50,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201, `create shared report link failed: ${res.body}`);
  return res.jsonBody().sharedReport;
}

async function sendProposal(cookie, proposalId, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/proposals/${proposalId}/send`,
    headers: { cookie },
    query: { id: proposalId },
    body: { recipientEmail, createShareLink: true },
  });
  const res = createMockRes();
  await proposalSendHandler(req, res, proposalId);
  return res;
}

async function sendViaSharedReport(cookie, token, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/sharedReports/${token}/send`,
    headers: { cookie },
    query: { token },
    body: { recipientEmail },
  });
  const res = createMockRes();
  await sharedReportSendHandler(req, res, token);
  return res;
}

async function listProposals(cookie, query = {}) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  return res;
}

function stubResendEmail() {
  const original = {
    EMAIL_MODE: process.env.EMAIL_MODE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    fetch: globalThis.fetch,
  };
  const sent = [];
  process.env.EMAIL_MODE = 'transactional';
  process.env.RESEND_API_KEY = 'test-key-multi-recipient';
  process.env.RESEND_FROM_EMAIL = 'test@mail.getpremarket.com';
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.resend.com/emails')) {
      const payload = JSON.parse(String(init.body || '{}'));
      sent.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `msg_${sent.length}` }),
      };
    }
    return original.fetch(url, init);
  };
  return {
    sent,
    restore() {
      globalThis.fetch = original.fetch;
      for (const [key, val] of Object.entries(original)) {
        if (key === 'fetch') continue;
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    },
  };
}

if (!hasDatabaseUrl()) {
  test('multi-recipient independence (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('sending same opportunity to two recipients creates independent threads via proposals/[id]/send', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeCookie('mr_owner');
    const stub = stubResendEmail();

    try {
      // Create a comparison + proposal
      const comparison = await createComparison(ownerCookie, {
        title: 'Multi-Recipient Test',
      });
      const proposalId = comparison.proposal_id;
      assert.ok(proposalId, 'comparison should create a linked proposal');

      // Send to recipient A
      const sendARes = await sendProposal(ownerCookie, proposalId, 'alice@example.com');
      assert.equal(sendARes.statusCode, 200, `send to A failed: ${sendARes.body}`);
      const sendABody = sendARes.jsonBody();
      const proposalA = sendABody.proposal;
      assert.equal(proposalA.party_b_email, 'alice@example.com');
      assert.equal(proposalA.status, 'sent');
      const linkA = sendABody.sharedLink;
      assert.ok(linkA?.token, 'should create shared link for A');

      // Send same original proposal to recipient B — should fork
      const sendBRes = await sendProposal(ownerCookie, proposalId, 'bob@example.com');
      assert.equal(sendBRes.statusCode, 200, `send to B failed: ${sendBRes.body}`);
      const sendBBody = sendBRes.jsonBody();
      const proposalB = sendBBody.proposal;
      const linkB = sendBBody.sharedLink;
      assert.ok(linkB?.token, 'should create shared link for B');

      // ── Test 1: Two separate independent threads ──
      assert.notEqual(proposalA.id, proposalB.id, 'must create separate proposal for each recipient');
      assert.equal(proposalB.party_b_email, 'bob@example.com');
      assert.equal(proposalB.status, 'sent');

      // ── Test 6: Different shared link tokens ──
      assert.notEqual(linkA.token, linkB.token, 'each recipient must have a different token');

      // ── Test 7: Different documentComparisonId values ──
      assert.ok(proposalA.document_comparison_id, 'A should have comparison');
      assert.ok(proposalB.document_comparison_id, 'B should have comparison');
      assert.notEqual(
        proposalA.document_comparison_id,
        proposalB.document_comparison_id,
        'each recipient must have an independent document comparison',
      );

      // ── Test 2: Original proposal for A is not modified ──
      const db = getDb();
      const originalResult = await db.execute(
        sql`select party_b_email, status from proposals where id = ${proposalA.id}`,
      );
      const originalRow = (originalResult.rows || originalResult)[0];
      assert.equal(originalRow.party_b_email, 'alice@example.com', 'A party_b_email must not be overwritten');
      assert.equal(originalRow.status, 'sent', 'A status must remain sent');

      // ── Test 8: Inbox shows separate items for A and B ──
      const listRes = await listProposals(ownerCookie, { tab: 'inbox' });
      assert.equal(listRes.statusCode, 200);
      const proposals = listRes.jsonBody().proposals || [];
      const aItem = proposals.find((p) => p.id === proposalA.id);
      const bItem = proposals.find((p) => p.id === proposalB.id);
      assert.ok(aItem, 'inbox must show item for recipient A');
      assert.ok(bItem, 'inbox must show item for recipient B');
      assert.equal(aItem.party_b_email, 'alice@example.com');
      assert.equal(bItem.party_b_email, 'bob@example.com');

      // ── Test 9: Detail routing uses different IDs ──
      assert.notEqual(aItem.id, bItem.id, 'detail page routes to different proposal IDs');

    } finally {
      stub.restore();
    }
  });

  test('sending same opportunity to two recipients via shared-reports/[token]/send creates independent threads', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeCookie('mr_sr_owner');
    const stub = stubResendEmail();

    try {
      const comparison = await createComparison(ownerCookie, {
        title: 'Multi-Recipient Shared Report Test',
      });
      const proposalId = comparison.proposal_id;
      assert.ok(proposalId, 'comparison should create a linked proposal');

      // Create shared report link for recipient A
      const linkA = await createSharedReportLink(ownerCookie, comparison.id, 'alice@example.com');
      assert.ok(linkA?.token, 'shared report link for A');

      // Mark proposal as sent so the fork condition triggers
      const db = getDb();
      await db.execute(
        sql`update proposals
            set status = 'sent',
                sent_at = now(),
                party_b_email = 'alice@example.com',
                updated_at = now()
            where id = ${proposalId}`,
      );

      // Send via shared report to recipient B — should fork
      const sendBRes = await sendViaSharedReport(ownerCookie, linkA.token, 'bob@example.com');
      assert.equal(sendBRes.statusCode, 200, `send to B failed: ${sendBRes.body}`);
      const sendBBody = sendBRes.jsonBody();

      // The returned token should be different from A's token
      assert.notEqual(sendBBody.token, linkA.token, 'fork must create a new token for B');

      // Verify original proposal is untouched
      const originalResult = await db.execute(
        sql`select party_b_email, status from proposals where id = ${proposalId}`,
      );
      const originalRow = (originalResult.rows || originalResult)[0];
      assert.equal(
        originalRow.party_b_email, 'alice@example.com',
        'original proposal party_b_email must remain alice',
      );

      // Verify a new proposal was created for B
      const allForked = await db.execute(
        sql`select id, party_b_email, source_proposal_id, document_comparison_id
            from proposals
            where source_proposal_id = ${proposalId}`,
      );
      const forked = allForked.rows || allForked;
      assert.ok(
        Array.isArray(forked) && forked.length > 0,
        'should have created a forked proposal for B',
      );
      const forkedProposal = forked[0];
      assert.equal(forkedProposal.party_b_email, 'bob@example.com');
      assert.notEqual(
        forkedProposal.document_comparison_id,
        comparison.id,
        'forked proposal must have a separate document comparison',
      );
    } finally {
      stub.restore();
    }
  });

  test('resending to the SAME recipient does not fork', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeCookie('mr_resend_owner');
    const stub = stubResendEmail();

    try {
      const comparison = await createComparison(ownerCookie, {
        title: 'Resend Same Recipient Test',
      });
      const proposalId = comparison.proposal_id;

      // Send to alice
      const sendARes = await sendProposal(ownerCookie, proposalId, 'alice@example.com');
      assert.equal(sendARes.statusCode, 200);
      const firstProposalId = sendARes.jsonBody().proposal.id;

      // Resend to alice again — should NOT fork
      const resendRes = await sendProposal(ownerCookie, firstProposalId, 'alice@example.com');
      assert.equal(resendRes.statusCode, 200);
      const resendProposalId = resendRes.jsonBody().proposal.id;

      assert.equal(
        firstProposalId,
        resendProposalId,
        'resend to same recipient must reuse the same proposal row',
      );
    } finally {
      stub.restore();
    }
  });
}
