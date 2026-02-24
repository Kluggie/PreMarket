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
import documentComparisonsCoachHandler from '../../server/routes/document-comparisons/[id]/coach.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { schema } from '../../server/_lib/db/client.js';
import { getDocumentComparisonTextLimits } from '../../src/config/aiLimits.js';

ensureTestEnv();
if (!process.env.VERTEX_MOCK) {
  process.env.VERTEX_MOCK = '1';
}

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

function assertContractReportShape(report) {
  assert.equal(Boolean(report && typeof report === 'object' && !Array.isArray(report)), true);
  assert.equal(typeof report.template_id, 'string');
  assert.equal(typeof report.template_name, 'string');
  assert.equal(typeof report.generated_at_iso, 'string');
  assert.equal(typeof report.parties?.a_label, 'string');
  assert.equal(typeof report.parties?.b_label, 'string');
  assert.equal(typeof report.quality?.completeness_a, 'number');
  assert.equal(typeof report.quality?.completeness_b, 'number');
  assert.equal(typeof report.quality?.confidence_overall, 'number');
  assert.equal(Array.isArray(report.quality?.confidence_reasoning), true);
  assert.equal(Array.isArray(report.quality?.missing_high_impact_question_ids), true);
  assert.equal(Array.isArray(report.quality?.disputed_question_ids), true);
  assert.equal(typeof report.summary?.fit_level, 'string');
  assert.equal(Array.isArray(report.summary?.top_fit_reasons), true);
  assert.equal(Array.isArray(report.summary?.top_blockers), true);
  assert.equal(Array.isArray(report.summary?.next_actions), true);
  assert.equal(Array.isArray(report.category_breakdown), true);
  assert.equal(Array.isArray(report.gates), true);
  assert.equal(Array.isArray(report.overlaps_and_constraints), true);
  assert.equal(Array.isArray(report.contradictions), true);
  assert.equal(Array.isArray(report.flags), true);
  assert.equal(
    Boolean(report.verification && typeof report.verification === 'object' && !Array.isArray(report.verification)),
    true,
  );
  assert.equal(
    Boolean(
      report.verification?.summary &&
        typeof report.verification.summary === 'object' &&
        !Array.isArray(report.verification.summary),
    ),
    true,
  );
  assert.equal(Array.isArray(report.verification?.evidence_requested), true);
  assert.equal(Array.isArray(report.followup_questions), true);
  assert.equal(Array.isArray(report.appendix?.field_digest), true);
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
    assert.equal(evaluateRes.jsonBody().evaluation.source, 'proposal_vertex');
    assertContractReportShape(evaluateRes.jsonBody().evaluation.result?.report || {});
    assert.equal(
      Number(evaluateRes.jsonBody().evaluation.result?.report?.quality?.completeness_a) < 1,
      true,
    );
    assert.equal(
      Number(evaluateRes.jsonBody().evaluation.result?.report?.quality?.confidence_overall) <= 0.4,
      true,
    );
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

  test('document comparison draft step can advance to editor without uploads/imports', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_step_owner', 'doc-step@example.com');

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: '',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;
    assert.equal(createRes.jsonBody().comparison.draft_step, 1);
    assert.equal(createRes.jsonBody().comparison.doc_a_text, '');
    assert.equal(createRes.jsonBody().comparison.doc_b_text, '');

    const step2Req = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        draft_step: 2,
      },
    });
    const step2Res = createMockRes();
    await documentComparisonsIdHandler(step2Req, step2Res, comparisonId);
    assert.equal(step2Res.statusCode, 200);
    assert.equal(step2Res.jsonBody().comparison.draft_step, 2);

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getRes = createMockRes();
    await documentComparisonsIdHandler(getReq, getRes, comparisonId);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.jsonBody().comparison.draft_step, 2);
  });

  test('document comparison sanitizes malformed editor JSON payloads to prevent editor crashes', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_json_owner', 'doc-json@example.com');

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Malformed JSON Comparison',
        doc_a_json: {},
        doc_b_json: {},
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getRes = createMockRes();
    await documentComparisonsIdHandler(getReq, getRes, comparisonId);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.jsonBody().comparison.doc_a_json, null);
    assert.equal(getRes.jsonBody().comparison.doc_b_json, null);
  });

  test('document comparison update persists html/text fields and rejects empty patch payloads', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_save_owner', 'doc-save@example.com');

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Save Persistence',
        doc_a_text: 'Initial confidential text',
        doc_b_text: 'Initial shared text',
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

    const updatedDocAHtml = '<p><strong>Updated confidential clause</strong></p>';
    const updatedDocBHtml = '<p><em>Updated shared clause</em></p>';
    const patchReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        doc_a_text: 'Updated confidential text',
        doc_b_text: 'Updated shared text',
        doc_a_html: updatedDocAHtml,
        doc_b_html: updatedDocBHtml,
        draft_step: 2,
      },
    });
    const patchRes = createMockRes();
    await documentComparisonsIdHandler(patchReq, patchRes, comparisonId);
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.jsonBody().comparison.doc_a_text, 'Updated confidential text');
    assert.equal(patchRes.jsonBody().comparison.doc_b_text, 'Updated shared text');
    assert.equal(patchRes.jsonBody().comparison.doc_a_html, updatedDocAHtml);
    assert.equal(patchRes.jsonBody().comparison.doc_b_html, updatedDocBHtml);
    assert.equal(patchRes.jsonBody().comparison.draft_step, 2);

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getRes = createMockRes();
    await documentComparisonsIdHandler(getReq, getRes, comparisonId);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.jsonBody().comparison.doc_a_text, 'Updated confidential text');
    assert.equal(getRes.jsonBody().comparison.doc_b_text, 'Updated shared text');
    assert.equal(getRes.jsonBody().comparison.doc_a_html, updatedDocAHtml);
    assert.equal(getRes.jsonBody().comparison.doc_b_html, updatedDocBHtml);
    assert.equal(getRes.jsonBody().comparison.draft_step, 2);

    const emptyPatchReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {},
    });
    const emptyPatchRes = createMockRes();
    await documentComparisonsIdHandler(emptyPatchReq, emptyPatchRes, comparisonId);
    assert.equal(emptyPatchRes.statusCode, 400);
    assert.equal(emptyPatchRes.jsonBody().error.code, 'invalid_input');
  });

  test('document comparison create rejects payloads beyond Vertex-safe limits', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_limit_owner', 'doc-limit@example.com');
    const limits = getDocumentComparisonTextLimits(process.env.VERTEX_MODEL || '');
    const oversized = 'A'.repeat(limits.perDocumentCharacterLimit + 1);

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Oversized Comparison',
        doc_a_text: oversized,
        doc_b_text: 'short',
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);

    assert.equal(createRes.statusCode, 413);
    assert.equal(createRes.jsonBody().error.code, 'payload_too_large');
  });

  test('document comparison coach route is owner-only, cached, and strips shared confidential leaks', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_coach_owner', 'doc-coach-owner@example.com');
    const confidentialPhrase = 'SECRET PRICE 123 with premium escalation clause';
    const maliciousCoachPayload = {
      version: 'coach-v1',
      summary: {
        overall: 'Coaching summary',
        top_priorities: ['Improve shared clarity'],
      },
      suggestions: [
        {
          id: 'unsafe_shared',
          scope: 'shared',
          severity: 'warning',
          title: 'Unsafe shared edit',
          rationale: 'This should be filtered',
          proposed_change: {
            target: 'doc_b',
            op: 'append',
            text: `Add this exact detail: ${confidentialPhrase}.`,
          },
          evidence: {
            shared_quotes: ['Shared baseline obligation.'],
            confidential_quotes: [],
          },
        },
      ],
      concerns: [],
      questions: [],
      negotiation_moves: [],
    };

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Coach Leak Guard',
        doc_a_text: `Internal memo includes ${confidentialPhrase} and private margin assumptions.`,
        doc_b_text: 'Shared baseline obligation.',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

    const unauthCoachReq = createMockReq({
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/coach`,
      headers: {},
      query: { id: comparisonId },
      body: {
        mode: 'full',
        intent: 'negotiate',
      },
    });
    const unauthCoachRes = createMockRes();
    await documentComparisonsCoachHandler(unauthCoachReq, unauthCoachRes, comparisonId);
    assert.equal(unauthCoachRes.statusCode, 401);

    const originalMockPayload = process.env.VERTEX_COACH_MOCK_RESPONSE;
    process.env.VERTEX_COACH_MOCK_RESPONSE = JSON.stringify(maliciousCoachPayload);
    try {
      const coachReq = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'negotiate',
        },
      });
      const coachRes = createMockRes();
      await documentComparisonsCoachHandler(coachReq, coachRes, comparisonId);
      assert.equal(coachRes.statusCode, 200);
      assert.equal(coachRes.jsonBody().cached, false);
      assert.equal(coachRes.jsonBody().coach.summary.overall.length > 0, true);
      assert.equal(
        coachRes
          .jsonBody()
          .coach.suggestions.every(
            (suggestion) => !String(suggestion?.proposed_change?.text || '').includes(confidentialPhrase),
          ),
        true,
      );
      assert.equal(
        coachRes
          .jsonBody()
          .coach.concerns.some((concern) =>
            String(concern?.title || '').toLowerCase().includes('withheld shared suggestion'),
          ),
        true,
      );

      const cachedReq = createMockReq({
        method: 'POST',
        url: `/api/document-comparisons/${comparisonId}/coach`,
        headers: { cookie: ownerCookie },
        query: { id: comparisonId },
        body: {
          mode: 'full',
          intent: 'negotiate',
        },
      });
      const cachedRes = createMockRes();
      await documentComparisonsCoachHandler(cachedReq, cachedRes, comparisonId);
      assert.equal(cachedRes.statusCode, 200);
      assert.equal(cachedRes.jsonBody().cached, true);
    } finally {
      if (originalMockPayload === undefined) {
        delete process.env.VERTEX_COACH_MOCK_RESPONSE;
      } else {
        process.env.VERTEX_COACH_MOCK_RESPONSE = originalMockPayload;
      }
    }
  });

  test('document comparison workflow persists inputs and stores evaluation output', async () => {
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
        doc_a_source: 'typed',
        doc_b_source: 'typed',
        doc_a_files: [{ filename: 'nda-a.md', mimeType: 'text/markdown', sizeBytes: 20 }],
        doc_b_files: [{ filename: 'nda-b.md', mimeType: 'text/markdown', sizeBytes: 28 }],
        doc_a_url: 'https://example.com/nda-a',
        doc_b_url: 'https://example.com/nda-b',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

    const getInitialReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getInitialRes = createMockRes();
    await documentComparisonsIdHandler(getInitialReq, getInitialRes, comparisonId);
    assert.equal(getInitialRes.statusCode, 200);
    assert.equal(getInitialRes.jsonBody().comparison.doc_a_source, 'typed');
    assert.equal(getInitialRes.jsonBody().comparison.doc_b_source, 'typed');
    assert.equal(getInitialRes.jsonBody().comparison.doc_a_files.length, 1);
    assert.equal(getInitialRes.jsonBody().comparison.doc_b_files.length, 1);
    assert.equal(getInitialRes.jsonBody().permissions.editable_side, 'a');
    assert.equal(getInitialRes.jsonBody().permissions.can_edit_doc_a, true);
    assert.equal(getInitialRes.jsonBody().permissions.can_edit_doc_b, false);

    const updateReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        doc_a_text: 'Confidential obligations and revised payment terms for sender',
        doc_b_text: 'Confidential obligations, payment terms, and support levels for recipient',
        draft_step: 3,
        doc_a_source: 'url',
        doc_b_source: 'uploaded',
        doc_a_url: 'https://example.com/revised-a',
        doc_b_url: '',
      },
    });
    const updateRes = createMockRes();
    await documentComparisonsIdHandler(updateReq, updateRes, comparisonId);
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.jsonBody().comparison.draft_step, 3);
    assert.equal(updateRes.jsonBody().comparison.doc_a_source, 'url');
    assert.equal(updateRes.jsonBody().comparison.doc_b_source, 'uploaded');
    assert.equal(updateRes.jsonBody().comparison.doc_a_url, 'https://example.com/revised-a');

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
    assert.equal(evalRes.jsonBody().comparison.evaluation_result.provider, 'mock');
    assertContractReportShape(evalRes.jsonBody().comparison.evaluation_result?.report || {});
    assert.equal(
      Array.isArray(evalRes.jsonBody().comparison.evaluation_result?.report?.sections),
      true,
    );
    assert.equal(evalRes.jsonBody().comparison.evaluation_result.report.sections.length > 0, true);

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
    assert.equal(getRes.jsonBody().comparison.doc_a_text.length > 0, true);
    assert.equal(getRes.jsonBody().comparison.doc_b_text.length > 0, true);
    assert.equal(typeof getRes.jsonBody().comparison.evaluation_result.score, 'number');
    assert.equal(
      Number(getRes.jsonBody().comparison.doc_a_text.length) +
        Number(getRes.jsonBody().comparison.doc_b_text.length) >
        0,
      true,
    );

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.documentComparisons)
      .where(eq(schema.documentComparisons.id, comparisonId))
      .limit(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'evaluated');
    assert.equal(rows[0].evaluationResult?.provider, 'mock');
    assert.equal(Array.isArray(rows[0].publicReport?.sections), true);
    assert.equal(rows[0].publicReport.sections.length > 0, true);
  });

  test('minimal document inputs keep completeness/confidence low', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_min_owner', 'doc-min@example.com');
    const createReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Tiny Comparison',
        party_a_label: 'A',
        party_b_label: 'B',
        doc_a_text: 'confidential good',
        doc_b_text: 'bad ugly',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await documentComparisonsHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = createRes.jsonBody().comparison.id;

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

    const evaluation = evalRes.jsonBody().comparison.evaluation_result;
    assert.equal(['vertex', 'mock'].includes(String(evaluation?.provider || '')), true);
    assertContractReportShape(evaluation?.report || {});
    assert.equal(Number(evaluation?.report?.quality?.completeness_a) < 1, true);
    assert.equal(Number(evaluation?.report?.quality?.completeness_b) < 1, true);
    assert.equal(Number(evaluation?.report?.quality?.confidence_overall) <= 0.4, true);
  });

  test('proposal document-comparison evaluation persists Vertex-style report output to proposal and comparison', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('proposal_eval_owner', 'proposal-eval@example.com');
    const createdProposal = await createProposal(ownerCookie, {
      title: 'Proposal Linked Comparison',
      status: 'draft',
      proposalType: 'document_comparison',
      partyBEmail: 'recipient@example.com',
    });

    const createComparisonReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        proposalId: createdProposal.id,
        title: 'Linked Comparison',
        party_a_label: 'Document A',
        party_b_label: 'Document B',
        doc_a_text: 'Confidential terms around payment schedules and renewal rights.',
        doc_b_text: 'Confidential terms around payment schedules, renewals, and support coverage.',
      },
    });
    const createComparisonRes = createMockRes();
    await documentComparisonsHandler(createComparisonReq, createComparisonRes);
    assert.equal(createComparisonRes.statusCode, 201);
    const comparisonId = createComparisonRes.jsonBody().comparison.id;

    const evaluateReq = createMockReq({
      method: 'POST',
      url: `/api/proposals/${createdProposal.id}/evaluate`,
      headers: { cookie: ownerCookie },
      query: { id: createdProposal.id },
      body: {},
    });
    const evaluateRes = createMockRes();
    await proposalEvaluateHandler(evaluateReq, evaluateRes, createdProposal.id);
    assert.equal(evaluateRes.statusCode, 200);
    assert.equal(
      ['under_verification', 're_evaluated'].includes(evaluateRes.jsonBody().proposal.status),
      true,
    );
    assert.equal(evaluateRes.jsonBody().evaluation.source, 'document_comparison_vertex');
    assert.equal(
      Array.isArray(evaluateRes.jsonBody().evaluation.result?.report?.sections),
      true,
    );

    const proposalDetailReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${createdProposal.id}`,
      headers: { cookie: ownerCookie },
      query: { id: createdProposal.id },
    });
    const proposalDetailRes = createMockRes();
    await proposalDetailHandler(proposalDetailReq, proposalDetailRes, createdProposal.id);
    assert.equal(proposalDetailRes.statusCode, 200);
    assert.equal(proposalDetailRes.jsonBody().evaluations.length >= 1, true);
    assert.equal(proposalDetailRes.jsonBody().evaluations[0].source, 'document_comparison_vertex');
    assert.equal(
      Array.isArray(proposalDetailRes.jsonBody().evaluations[0]?.result?.report?.sections),
      true,
    );

    const comparisonGetReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const comparisonGetRes = createMockRes();
    await documentComparisonsIdHandler(comparisonGetReq, comparisonGetRes, comparisonId);
    assert.equal(comparisonGetRes.statusCode, 200);
    assert.equal(comparisonGetRes.jsonBody().comparison.status, 'evaluated');
    assert.equal(comparisonGetRes.jsonBody().comparison.evaluation_result.provider, 'mock');
    assert.equal(Array.isArray(comparisonGetRes.jsonBody().comparison.public_report.sections), true);
  });

  test('document comparison token/shared routes return recipient-safe report without confidential leaks', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('doc_token_owner', 'owner@example.com');
    const confidentialPhrase = 'ULTRA_SECRET_CONFIDENTIAL_PHRASE_12345';
    const createdProposal = await createProposal(ownerCookie, {
      title: 'Token Shared Projection Proposal',
      status: 'sent',
      partyBEmail: 'recipient@example.com',
      proposalType: 'document_comparison',
    });

    const createComparisonReq = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        proposalId: createdProposal.id,
        title: 'Token Safe Comparison',
        party_a_label: 'Doc A',
        party_b_label: 'Doc B',
        doc_a_text: `${confidentialPhrase} private obligations`,
        doc_b_text: 'Shared payment terms and service levels for recipient review.',
        createProposal: false,
      },
    });
    const createComparisonRes = createMockRes();
    await documentComparisonsHandler(createComparisonReq, createComparisonRes);
    assert.equal(createComparisonRes.statusCode, 201);
    const comparisonId = createComparisonRes.jsonBody().comparison.id;

    const evaluateReq = createMockReq({
      method: 'POST',
      url: `/api/document-comparisons/${comparisonId}/evaluate`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {},
    });
    const evaluateRes = createMockRes();
    await documentComparisonsEvaluateHandler(evaluateReq, evaluateRes, comparisonId);
    assert.equal(evaluateRes.statusCode, 200);

    const createShareReq = createMockReq({
      method: 'POST',
      url: '/api/shared-links',
      headers: { cookie: ownerCookie },
      body: {
        proposalId: createdProposal.id,
        recipientEmail: 'recipient@example.com',
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: false,
        maxUses: 20,
      },
    });
    const createShareRes = createMockRes();
    await sharedLinksHandler(createShareReq, createShareRes);
    assert.equal(createShareRes.statusCode, 201);
    const token = createShareRes.jsonBody().sharedLink.token;

    const recipientPatchReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      query: { id: comparisonId, token },
      body: {
        token,
        doc_b_text: 'Recipient updated shared terms only.',
      },
    });
    const recipientPatchRes = createMockRes();
    await documentComparisonsIdHandler(recipientPatchReq, recipientPatchRes, comparisonId);
    assert.equal(recipientPatchRes.statusCode, 200);
    assert.equal(recipientPatchRes.jsonBody().comparison.doc_a_text, '');
    assert.equal(recipientPatchRes.jsonBody().comparison.doc_b_text, 'Recipient updated shared terms only.');
    assert.equal(recipientPatchRes.jsonBody().permissions.editable_side, 'b');
    assert.equal(
      Boolean(
        recipientPatchRes.jsonBody().comparison.public_report &&
          Object.keys(recipientPatchRes.jsonBody().comparison.public_report).length > 0,
      ),
      true,
    );

    const forbiddenPatchReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}`,
      query: { id: comparisonId, token },
      body: {
        token,
        doc_a_text: 'attempted confidential overwrite',
      },
    });
    const forbiddenPatchRes = createMockRes();
    await documentComparisonsIdHandler(forbiddenPatchReq, forbiddenPatchRes, comparisonId);
    assert.equal(forbiddenPatchRes.statusCode, 403);
    assert.equal(forbiddenPatchRes.jsonBody().error.code, 'edit_not_allowed');

    const ownerGetReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const ownerGetRes = createMockRes();
    await documentComparisonsIdHandler(ownerGetReq, ownerGetRes, comparisonId);
    assert.equal(ownerGetRes.statusCode, 200);
    assert.equal(ownerGetRes.jsonBody().comparison.doc_a_text.includes(confidentialPhrase), true);
    assert.equal(ownerGetRes.jsonBody().comparison.doc_b_text.length > 0, true);

    const tokenGetReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      query: { id: comparisonId, token },
    });
    const tokenGetRes = createMockRes();
    await documentComparisonsIdHandler(tokenGetReq, tokenGetRes, comparisonId);
    assert.equal(tokenGetRes.statusCode, 200);
    assert.equal(tokenGetRes.jsonBody().comparison.doc_a_text, '');
    assert.equal(tokenGetRes.jsonBody().comparison.doc_b_text.length > 0, true);
    assert.equal(
      Boolean(
        tokenGetRes.jsonBody().comparison.evaluation_result &&
          Object.keys(tokenGetRes.jsonBody().comparison.evaluation_result).length > 0,
      ),
      true,
    );
    assert.equal(
      JSON.stringify(tokenGetRes.jsonBody()).includes(confidentialPhrase),
      false,
    );

    const shareReadReq = createMockReq({
      method: 'GET',
      url: `/api/shared-links/${token}`,
      query: { token, consume: 'true' },
    });
    const shareReadRes = createMockRes();
    await sharedLinksTokenHandler(shareReadReq, shareReadRes, token);
    assert.equal(shareReadRes.statusCode, 200);
    const shareReadBody = shareReadRes.jsonBody();
    assert.equal(Array.isArray(shareReadBody.evaluations), true);
    assert.equal(shareReadBody.evaluations.length > 0, true);
    assert.equal(
      Boolean(
        shareReadBody.evaluations[0]?.result &&
          Object.keys(shareReadBody.evaluations[0].result).length > 0,
      ),
      true,
    );
    assert.equal(
      Boolean(
        shareReadBody.evaluations[0]?.result?.report &&
          Object.keys(shareReadBody.evaluations[0].result.report).length > 0,
      ),
      true,
    );
    assert.equal(JSON.stringify(shareReadBody).includes(confidentialPhrase), false);
    assertContractReportShape(shareReadBody.evaluations[0]?.result?.report || {});
  });
}
