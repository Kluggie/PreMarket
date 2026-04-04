/**
 * Document Comparison V2 evaluator wiring tests
 *
 * Verifies that proposer-only evaluations:
 * 1. Persist as truthful Pre-send Reviews
 * 2. Preserve the same stage in proposal evaluation history
 * 3. Fall back safely without emitting mediation fields
 * 4. Never leak confidential canary text
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import proposalEvaluationsHandler from '../../server/routes/proposals/[id]/evaluations.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function createComparison(cookie, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: 'V2 Evaluate Test',
      doc_a_text: 'Confidential constraints: internal budget guardrails and legal restrictions.',
      doc_b_text: 'Shared draft: scope, milestones, delivery responsibilities.',
      createProposal: true,
      ...overrides,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201, `createComparison failed: ${JSON.stringify(res.jsonBody())}`);
  return res.jsonBody().comparison.id;
}

async function runEvaluate(cookie, comparisonId, queryOverrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/document-comparisons/${comparisonId}/evaluate`,
    headers: { cookie },
    query: { id: comparisonId, ...queryOverrides },
    body: {},
  });
  const res = createMockRes();
  await documentComparisonsEvaluateHandler(req, res, comparisonId);
  return res;
}

async function getProposalEvaluations(cookie, proposalId) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/proposals/${proposalId}/evaluations`,
    headers: { cookie },
    query: { id: proposalId },
  });
  const res = createMockRes();
  await proposalEvaluationsHandler(req, res, proposalId);
  return res;
}

function mockVertexV2Call(mockFn) {
  const original = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = mockFn;
  return () => {
    if (original === undefined) {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = original;
    }
  };
}

function vertexPreSendResponse(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify({
      analysis_stage: 'pre_send_review',
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary:
        'The sender draft is workable, but ownership and commercial assumptions should be clarified before sharing.',
      missing_information: [
        'What is the confirmed go-live date?',
        'What are the measurable KPIs for success?',
      ],
      ambiguous_terms: ['Renewal term ambiguity may confuse the recipient.'],
      likely_recipient_questions: ['Who owns approvals if delivery dependencies slip?'],
      likely_pushback_areas: ['Open-ended renewal language may trigger immediate pushback.'],
      commercial_risks: ['Budget boundaries are not tied to a defined change process.'],
      implementation_risks: ['Unclear dependency ownership may slow execution.'],
      suggested_clarifications: ['Clarify renewal mechanics and ownership before sharing.'],
      ...overrides,
    }),
    finishReason: 'STOP',
    httpStatus: 200,
  };
}

if (!hasDatabaseUrl()) {
  test(
    'document-comparison V2 evaluate wiring tests (skipped: DATABASE_URL missing)',
    { skip: true },
    () => {},
  );
} else {
  test('proposer-only evaluate persists Pre-send Review without mediation fields', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t1_owner', 'v2-eval-t1@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexPreSendResponse());
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got ${res.statusCode}: ${JSON.stringify(res.jsonBody())}`);

      const body = res.jsonBody();
      const evalResult = body.comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};

      assert.equal(report.report_format, 'v2');
      assert.equal(report.analysis_stage, 'pre_send_review');
      assert.equal(report.readiness_status, 'ready_with_clarifications');
      assert.equal(typeof report.send_readiness_summary, 'string');
      assert.equal(Array.isArray(report.missing_information), true);
      assert.equal(Array.isArray(report.likely_recipient_questions), true);
      assert.equal(Array.isArray(report.presentation_sections), true);
      assert.equal(report.presentation_sections.length > 0, true);
      assert.equal('why' in report, false);
      assert.equal('confidence_0_1' in report, false);
      assert.equal('recommendation' in report, false);
      assert.equal(typeof evalResult.score, 'number');
      assert.equal(evalResult.recommendation ?? null, null);
      assert.equal(body.evaluation_provider, 'vertex');
    } finally {
      cleanup();
    }
  });

  test('proposal evaluations preserve pre-send stage and source', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t2_owner', 'v2-eval-t2@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexPreSendResponse());
    try {
      const evalRes = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(evalRes.statusCode, 200, `Evaluate failed: ${JSON.stringify(evalRes.jsonBody())}`);

      const proposalId = evalRes.jsonBody()?.proposal?.id;
      assert.ok(proposalId, 'proposalId must be present in evaluate response');

      const listRes = await getProposalEvaluations(cookie, proposalId);
      assert.equal(listRes.statusCode, 200, `GET evaluations failed: ${JSON.stringify(listRes.jsonBody())}`);

      const latest = (listRes.jsonBody().evaluations ?? [])[0];
      assert.equal(latest?.source, 'document_comparison_pre_send');
      assert.equal(latest?.result?.report?.analysis_stage, 'pre_send_review');
      assert.equal(Array.isArray(latest?.result?.report?.presentation_sections), true);
      assert.equal('why' in (latest?.result?.report ?? {}), false);
    } finally {
      cleanup();
    }
  });

  test('unexpected Vertex throw still returns HTTP 200 with fallback pre-send review', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t3_owner', 'v2-eval-t3@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => {
      throw new Error('Simulated unexpected Vertex SDK failure');
    });
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200 on Vertex failure; got: ${res.statusCode}`);

      const report = res.jsonBody().comparison?.evaluation_result?.report ?? {};
      assert.equal(report.analysis_stage, 'pre_send_review');
      assert.equal(typeof report.send_readiness_summary, 'string');
      assert.equal('why' in report, false);
    } finally {
      cleanup();
    }
  });

  test('confidential canary never appears in proposer-only public output fields', async () => {
    await ensureMigrated();
    await resetTables();

    const CANARY = 'CONFIDENTIAL_CANARY_7f3b9e2a';
    const cookie = authCookie('v2_eval_t4_owner', 'v2-eval-t4@example.com');
    const comparisonId = await createComparison(cookie, {
      doc_a_text: `Internal planning document. ${CANARY} must remain confidential. Budget cap $500k.`,
      doc_b_text: 'Shared obligations: scope of work, milestones, and acceptance criteria.',
    });

    const cleanup = mockVertexV2Call(async () =>
      vertexPreSendResponse({
        send_readiness_summary:
          'The shared draft aligns with stated objectives, but still needs a clearer go-live date before sharing.',
        missing_information: ['What is the confirmed go-live date?'],
        ambiguous_terms: [],
        likely_recipient_questions: ['Who owns the final delivery milestone?'],
        likely_pushback_areas: [],
        suggested_clarifications: ['Add an explicit go-live date to the shared draft.'],
      }),
    );
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got: ${res.statusCode}`);

      const evalResult = res.jsonBody().comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};
      const publicOutput = JSON.stringify({
        send_readiness_summary: report.send_readiness_summary,
        missing_information: report.missing_information,
        ambiguous_terms: report.ambiguous_terms,
        likely_recipient_questions: report.likely_recipient_questions,
        likely_pushback_areas: report.likely_pushback_areas,
        suggested_clarifications: report.suggested_clarifications,
        summary: evalResult.summary,
        report_summary: report.summary,
        sections: report.sections,
        presentation_sections: report.presentation_sections,
        evaluation_inline: res.jsonBody().evaluation,
      });

      assert.equal(
        publicOutput.includes(CANARY),
        false,
        `Canary token "${CANARY}" must NOT appear in any public output field.\nPublic output: ${publicOutput}`,
      );
    } finally {
      cleanup();
    }
  });
}
