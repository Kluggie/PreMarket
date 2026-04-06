/**
 * Document Comparison V2 evaluator wiring tests
 *
 * Verifies that one-sided evaluations:
 * 1. Persist as neutral Stage 1 Shared Intake Summaries
 * 2. Preserve the same stage in proposal evaluation history
 * 3. Fall back safely without emitting mediation fields or readiness verdicts
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

function vertexStage1Response(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify({
      analysis_stage: 'stage1_shared_intake',
      submission_summary:
        'The submitting party appears to be proposing a scoped delivery engagement with milestone-based responsibilities and approval checkpoints.',
      scope_snapshot: [
        'Delivery scope and milestone structure are outlined.',
        'Approval ownership and commercial guardrails are referenced but not fully defined.',
      ],
      unanswered_questions: [
        'What is the confirmed go-live date?',
        'What are the measurable KPIs for success?',
      ],
      other_side_needed: ['The responding side should confirm approval ownership and any delivery constraints that materially affect scope.'],
      discussion_starting_points: ['Confirm the initial scope boundary, milestone approvals, and success measures for the next exchange.'],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'Based only on the currently submitted materials. A fuller bilateral mediation analysis becomes possible once the other side responds.',
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
  test('one-sided evaluate persists Shared Intake Summary without mediation fields or readiness verdicts', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t1_owner', 'v2-eval-t1@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexStage1Response());
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got ${res.statusCode}: ${JSON.stringify(res.jsonBody())}`);

      const body = res.jsonBody();
      const evalResult = body.comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};

      assert.equal(report.report_format, 'v2');
      assert.equal(report.analysis_stage, 'stage1_shared_intake');
      assert.equal(typeof report.submission_summary, 'string');
      assert.equal(Array.isArray(report.scope_snapshot), true);
      assert.equal(Array.isArray(report.unanswered_questions), true);
      assert.equal(Array.isArray(report.other_side_needed), true);
      assert.equal(Array.isArray(report.discussion_starting_points), true);
      assert.equal(report.intake_status, 'awaiting_other_side_input');
      assert.equal(typeof report.basis_note, 'string');
      assert.equal(Array.isArray(report.presentation_sections), true);
      assert.equal(report.presentation_sections.length > 0, true);
      assert.equal('why' in report, false);
      assert.equal('confidence_0_1' in report, false);
      assert.equal('recommendation' in report, false);
      assert.equal('readiness_status' in report, false);
      assert.equal('send_readiness_summary' in report, false);
      assert.equal(evalResult.score ?? null, null);
      assert.equal(evalResult.recommendation ?? null, null);
      assert.equal(body.evaluation_provider, 'vertex');
    } finally {
      cleanup();
    }
  });

  test('proposal evaluations preserve Stage 1 shared intake stage and source', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t2_owner', 'v2-eval-t2@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexStage1Response());
    try {
      const evalRes = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(evalRes.statusCode, 200, `Evaluate failed: ${JSON.stringify(evalRes.jsonBody())}`);

      const proposalId = evalRes.jsonBody()?.proposal?.id;
      assert.ok(proposalId, 'proposalId must be present in evaluate response');

      const listRes = await getProposalEvaluations(cookie, proposalId);
      assert.equal(listRes.statusCode, 200, `GET evaluations failed: ${JSON.stringify(listRes.jsonBody())}`);

      const latest = (listRes.jsonBody().evaluations ?? [])[0];
      assert.equal(latest?.source, 'document_comparison_stage1_intake');
      assert.equal(latest?.result?.report?.analysis_stage, 'stage1_shared_intake');
      assert.equal(Array.isArray(latest?.result?.report?.presentation_sections), true);
      assert.equal('why' in (latest?.result?.report ?? {}), false);
      assert.equal('readiness_status' in (latest?.result?.report ?? {}), false);
    } finally {
      cleanup();
    }
  });

  test('unexpected Vertex throw still returns HTTP 200 with fallback Stage 1 shared intake output', async () => {
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
      assert.equal(report.analysis_stage, 'stage1_shared_intake');
      assert.equal(typeof report.submission_summary, 'string');
      assert.equal(report.intake_status, 'awaiting_other_side_input');
      assert.match(report.basis_note || '', /currently submitted materials/i);
      assert.equal('why' in report, false);
      assert.equal('readiness_status' in report, false);
    } finally {
      cleanup();
    }
  });

  test('confidential canary never appears in one-sided shared intake public output fields', async () => {
    await ensureMigrated();
    await resetTables();

    const CANARY = 'CONFIDENTIAL_CANARY_7f3b9e2a';
    const cookie = authCookie('v2_eval_t4_owner', 'v2-eval-t4@example.com');
    const comparisonId = await createComparison(cookie, {
      doc_a_text: `Internal planning document. ${CANARY} must remain confidential. Budget cap $500k.`,
      doc_b_text: 'Shared obligations: scope of work, milestones, and acceptance criteria.',
    });

    const cleanup = mockVertexV2Call(async () =>
      vertexStage1Response({
        submission_summary:
          'The submitting party appears to be proposing a milestone-based engagement, but the timeline and delivery ownership still need clarification.',
        unanswered_questions: ['What is the confirmed go-live date?'],
        other_side_needed: ['The responding side should confirm who owns the final delivery milestone.'],
        discussion_starting_points: ['Confirm the delivery milestone owner and add the go-live date to the next exchange.'],
      }),
    );
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got: ${res.statusCode}`);

      const evalResult = res.jsonBody().comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};
      const publicOutput = JSON.stringify({
        submission_summary: report.submission_summary,
        scope_snapshot: report.scope_snapshot,
        unanswered_questions: report.unanswered_questions,
        other_side_needed: report.other_side_needed,
        discussion_starting_points: report.discussion_starting_points,
        basis_note: report.basis_note,
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
