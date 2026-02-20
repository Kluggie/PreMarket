import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import proposalEvaluateHandler from '../../server/routes/proposals/[id]/evaluate.ts';
import proposalEvaluationsHandler from '../../server/routes/proposals/[id]/evaluations.ts';
import billingStatusHandler from '../../server/routes/billing/status.ts';
import billingCheckoutHandler from '../../server/routes/billing/checkout.ts';
import billingCancelHandler from '../../server/routes/billing/cancel.ts';
import sharedLinksHandler from '../../server/routes/shared-links/index.ts';
import sharedLinksTokenHandler from '../../server/routes/shared-links/[token].ts';
import sharedLinksRespondHandler from '../../server/routes/shared-links/[token]/respond.ts';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsIdHandler from '../../server/routes/document-comparisons/[id].ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { schema } from '../../server/_lib/db/client.js';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function createProposal(cookie, body) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().proposal;
}

if (!hasDatabaseUrl()) {
  test('workflow parity integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('proposal workflow supports draft -> send -> evaluate transitions with persisted history', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('workflow_owner', 'owner@example.com');
    const created = await createProposal(ownerCookie, {
      title: 'Workflow Proposal',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
      summary: 'Baseline workflow test',
    });

    const sendReq = createMockReq({
      method: 'POST',
      url: `/api/proposals/${created.id}/send`,
      headers: { cookie: ownerCookie },
      query: { id: created.id },
      body: {
        recipientEmail: 'recipient@example.com',
        createShareLink: true,
      },
    });
    const sendRes = createMockRes();
    await proposalSendHandler(sendReq, sendRes, created.id);
    assert.equal(sendRes.statusCode, 200);
    assert.equal(sendRes.jsonBody().proposal.status, 'sent');
    assert.equal(Boolean(sendRes.jsonBody().sharedLink?.token), true);

    const evaluateReq = createMockReq({
      method: 'POST',
      url: `/api/proposals/${created.id}/evaluate`,
      headers: { cookie: ownerCookie },
      query: { id: created.id },
      body: {},
    });
    const evaluateRes = createMockRes();
    await proposalEvaluateHandler(evaluateReq, evaluateRes, created.id);
    assert.equal(evaluateRes.statusCode, 200);
    assert.equal(typeof evaluateRes.jsonBody().evaluation.score, 'number');
    assert.equal(
      ['under_verification', 're_evaluated'].includes(evaluateRes.jsonBody().proposal.status),
      true,
    );

    const detailReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${created.id}`,
      headers: { cookie: ownerCookie },
      query: { id: created.id },
    });
    const detailRes = createMockRes();
    await proposalDetailHandler(detailReq, detailRes, created.id);
    assert.equal(detailRes.statusCode, 200);
    const detail = detailRes.jsonBody();
    assert.equal(Array.isArray(detail.evaluations), true);
    assert.equal(detail.evaluations.length >= 1, true);
    assert.equal(Array.isArray(detail.shared_links), true);
    assert.equal(detail.shared_links.length >= 1, true);

    const listEvaluationsReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${created.id}/evaluations`,
      headers: { cookie: ownerCookie },
      query: { id: created.id },
    });
    const listEvaluationsRes = createMockRes();
    await proposalEvaluationsHandler(listEvaluationsReq, listEvaluationsRes, created.id);
    assert.equal(listEvaluationsRes.statusCode, 200);
    assert.equal(listEvaluationsRes.jsonBody().evaluations.length >= 1, true);
  });

  test('billing status is auth-scoped and checkout/cancel return 501 when Stripe is not configured', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('billing_owner', 'billing@example.com');

    const statusReq = createMockReq({
      method: 'GET',
      url: '/api/billing/status',
      headers: { cookie: ownerCookie },
    });
    const statusRes = createMockRes();
    await billingStatusHandler(statusReq, statusRes);
    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.jsonBody().billing.plan_tier, 'starter');

    const unauthReq = createMockReq({
      method: 'GET',
      url: '/api/billing/status',
      headers: {},
    });
    const unauthRes = createMockRes();
    await billingStatusHandler(unauthReq, unauthRes);
    assert.equal(unauthRes.statusCode, 401);

    const originalStripeSecret = process.env.STRIPE_SECRET_KEY;
    const originalPriceId = process.env.PROFESSIONAL_STRIPE_PRICE_ID;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PROFESSIONAL_STRIPE_PRICE_ID;

    try {
      const checkoutReq = createMockReq({
        method: 'POST',
        url: '/api/billing/checkout',
        headers: { cookie: ownerCookie },
        body: {},
      });
      const checkoutRes = createMockRes();
      await billingCheckoutHandler(checkoutReq, checkoutRes);
      assert.equal(checkoutRes.statusCode, 501);
      assert.equal(checkoutRes.jsonBody().error.code, 'not_configured');

      const cancelReq = createMockReq({
        method: 'POST',
        url: '/api/billing/cancel',
        headers: { cookie: ownerCookie },
        body: {},
      });
      const cancelRes = createMockRes();
      await billingCancelHandler(cancelReq, cancelRes);
      assert.equal(cancelRes.statusCode, 501);
      assert.equal(cancelRes.jsonBody().error.code, 'not_configured');
    } finally {
      if (originalStripeSecret !== undefined) {
        process.env.STRIPE_SECRET_KEY = originalStripeSecret;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }

      if (originalPriceId !== undefined) {
        process.env.PROFESSIONAL_STRIPE_PRICE_ID = originalPriceId;
      } else {
        delete process.env.PROFESSIONAL_STRIPE_PRICE_ID;
      }
    }
  });

  test('shared-link recipient responses persist and can trigger re-evaluation', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('share_owner', 'owner@example.com');
    const created = await createProposal(ownerCookie, {
      title: 'Shared workflow proposal',
      status: 'sent',
      partyBEmail: 'recipient@example.com',
    });

    const createShareReq = createMockReq({
      method: 'POST',
      url: '/api/shared-links',
      headers: { cookie: ownerCookie },
      body: {
        proposalId: created.id,
        recipientEmail: 'recipient@example.com',
        maxUses: 10,
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: true,
      },
    });
    const createShareRes = createMockRes();
    await sharedLinksHandler(createShareReq, createShareRes);
    assert.equal(createShareRes.statusCode, 201);
    const token = createShareRes.jsonBody().sharedLink.token;

    const openReq = createMockReq({
      method: 'GET',
      url: `/api/shared-links/${token}`,
      query: { token, consume: 'true' },
    });
    const openRes = createMockRes();
    await sharedLinksTokenHandler(openReq, openRes, token);
    assert.equal(openRes.statusCode, 200);

    const respondReq = createMockReq({
      method: 'POST',
      url: `/api/shared-links/${token}/respond`,
      query: { token },
      body: {
        responderEmail: 'recipient@example.com',
        runEvaluation: true,
        responses: [
          {
            question_id: 'recipient_note',
            value: 'We are aligned and interested.',
            value_type: 'text',
          },
        ],
      },
    });
    const respondRes = createMockRes();
    await sharedLinksRespondHandler(respondReq, respondRes, token);
    assert.equal(respondRes.statusCode, 200);
    assert.equal(respondRes.jsonBody().savedResponses, 1);
    assert.equal(Boolean(respondRes.jsonBody().evaluation), true);

    const detailReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${created.id}`,
      headers: { cookie: ownerCookie },
      query: { id: created.id },
    });
    const detailRes = createMockRes();
    await proposalDetailHandler(detailReq, detailRes, created.id);
    assert.equal(detailRes.statusCode, 200);
    assert.equal(
      detailRes
        .jsonBody()
        .responses.some((row) => row.question_id === 'recipient_note' && row.entered_by_party === 'b'),
      true,
    );
  });

  test('document comparison workflow persists draft fields and evaluation outputs', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_owner', 'docs@example.com');

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'NDA Comparison',
        party_a_label: 'Sender Document',
        party_b_label: 'Recipient Draft',
        doc_a_text: 'Confidential obligations and payment terms',
        doc_b_text: 'Confidential obligations and revised payment terms',
        doc_b_spans: [{ start: 0, end: 12, level: 'confidential' }],
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

    const updateReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        doc_b_text: 'Confidential obligations, payment terms, and support levels',
        draft_step: 3,
      },
    });
    const updateRes = createMockRes();
    await documentComparisonsIdHandler(updateReq, updateRes, comparisonId);
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.jsonBody().comparison.draft_step, 3);

    const evalReq = createMockReq({
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/evaluate`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {},
    });
    const evalRes = createMockRes();
    await documentComparisonsEvaluateHandler(evalReq, evalRes, comparisonId);
    assert.equal(evalRes.statusCode, 200);
    assert.equal(evalRes.jsonBody().comparison.status, 'evaluated');
    assert.equal(typeof evalRes.jsonBody().comparison.evaluation_result.score, 'number');

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getRes = createMockRes();
    await documentComparisonsIdHandler(getReq, getRes, comparisonId);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.jsonBody().comparison.title, 'NDA Comparison');
    assert.equal(getRes.jsonBody().comparison.status, 'evaluated');

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.documentComparisons)
      .where(eq(schema.documentComparisons.id, comparisonId))
      .limit(1);
    assert.equal(rows.length, 1);
  });
}
