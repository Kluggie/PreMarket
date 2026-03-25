/**
 * Document Comparison V2 Evaluator Wiring Tests
 *
 * Verifies that new evaluations:
 * 1. Are persisted in V2 format (report_format: "v2", why[], fit_level, confidence_0_1, missing[])
 * 2. Are returned by GET /api/proposals/:id/evaluations with V2 fields
 * 3. Never fail with 5xx — Vertex parse failures produce 200 + fallback V2 report
 * 4. Never leak confidential canary tokens into any output field
 *
 * NOTE: Tests run with NODE_ENV=test (set in package.json test:api:integration).
 * The engine resolver defaults to v1 in NODE_ENV=test for isolation, so every
 * test that exercises V2 must pass ?engine=v2 explicitly via the query.
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

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Create a document comparison (returns comparisonId).
 * Uses createProposal:true so a linked proposal is available for /evaluations.
 */
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

/** POST /api/document-comparisons/:id/evaluate */
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

/** GET /api/proposals/:id/evaluations */
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

// ─── V2 Vertex mock helpers ───────────────────────────────────────────────────

/** Replace the global Vertex V2 call override and return a cleanup function. */
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

/**
 * Valid Pass B Vertex response.
 *
 * Coverage clamp note: the same mock is used for both Pass A and Pass B.
 * Pass A expects a fact-sheet JSON shape; because our mock returns an eval
 * JSON, Pass A validation fails and falls back to an empty fact-sheet
 * (all source_coverage flags false → coverageCount < 3). The low-coverage
 * clamp then downgrades 'high' → 'medium'. Use 'medium' to avoid false
 * clamp-induced assertion failures.
 */
function vertexV2Response(overrides = {}) {
  return {
    model: 'gemini-2.0-flash-001',
    text: JSON.stringify({
      fit_level: 'medium',
      confidence_0_1: 0.72,
      why: [
        'Executive Summary: Obligations align reasonably with internal constraints.',
        'Key Strengths: Scope is clearly defined with measurable milestones.',
        'Key Risks: Renewal term ambiguity may require renegotiation.',
        'Decision Readiness: Near-ready pending clarification on renewal clause.',
        'Recommendations: Confirm renewal terms before signature.',
      ],
      missing: [
        'What is the confirmed go-live date?',
        'What are the measurable KPIs for success?',
      ],
      redactions: ['Internal budget cap details'],
      ...overrides,
    }),
    finishReason: 'STOP',
    httpStatus: 200,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

if (!hasDatabaseUrl()) {
  test(
    'document-comparison V2 evaluate wiring tests (skipped: DATABASE_URL missing)',
    { skip: true },
    () => {},
  );
} else {
  // ── Test 1: Route persists V2 report (report_format: "v2") ────────────────

  test('Test 1 — evaluate persists V2 report with report_format "v2" and V2 fields', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t1_owner', 'v2-eval-t1@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexV2Response());
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got ${res.statusCode}: ${JSON.stringify(res.jsonBody())}`);

      const body = res.jsonBody();
      const evalResult = body.comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};

      // Version marker.
      assert.equal(
        report.report_format,
        'v2',
        `report.report_format must be "v2"; got: ${report.report_format}`,
      );

      // V2 narrative fields.
      assert.equal(
        Array.isArray(report.why) && report.why.length > 0,
        true,
        `report.why must be a non-empty array; got: ${JSON.stringify(report.why)}`,
      );
      assert.equal(
        ['high', 'medium', 'low', 'unknown'].includes(report.fit_level),
        true,
        `report.fit_level must be valid V2 value; got: ${report.fit_level}`,
      );
      assert.equal(
        typeof report.confidence_0_1 === 'number' && report.confidence_0_1 >= 0,
        true,
        `report.confidence_0_1 must be a number >= 0; got: ${report.confidence_0_1}`,
      );
      assert.equal(Array.isArray(report.missing), true, `report.missing must be an array`);
      assert.equal(
        ['balanced_trade_off', 'risk_dominant', 'strong_alignment', 'gap_analysis', 'strategic_framing'].includes(report.report_archetype),
        true,
        `report.report_archetype must be a known archetype; got: ${report.report_archetype}`,
      );
      assert.equal(
        typeof report.primary_insight === 'string' && report.primary_insight.length > 0,
        true,
        'report.primary_insight must be a non-empty string',
      );
      assert.equal(
        Array.isArray(report.presentation_sections) && report.presentation_sections.length > 0,
        true,
        'report.presentation_sections must be a non-empty array',
      );

      // Score derived from confidence_0_1.
      assert.equal(
        typeof evalResult.score === 'number' && evalResult.score >= 0 && evalResult.score <= 100,
        true,
        `evalResult.score must be 0-100; got: ${evalResult.score}`,
      );
      assert.equal(
        evalResult.score,
        Math.round(report.confidence_0_1 * 100),
        `score must equal round(confidence_0_1*100); score=${evalResult.score} confidence=${report.confidence_0_1}`,
      );

      // Must not be legacy only.
      const templateId = String(evalResult.template_id ?? report.template_id ?? '');
      assert.notEqual(templateId, 'document_comparison_v1', 'Must not store legacy template_id');
      assert.equal(body.evaluation_provider, 'vertex', 'Provider must be vertex');
    } finally {
      cleanup();
    }
  });

  // ── Test 2: GET /api/proposals/:id/evaluations returns V2 ─────────────────

  test('Test 2 — GET /api/proposals/:id/evaluations returns stored V2 report fields', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t2_owner', 'v2-eval-t2@example.com');
    const comparisonId = await createComparison(cookie);

    const cleanup = mockVertexV2Call(async () => vertexV2Response());
    try {
      // Run evaluation and extract the linked proposalId.
      const evalRes = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(evalRes.statusCode, 200, `Evaluate failed: ${JSON.stringify(evalRes.jsonBody())}`);

      const proposalId = evalRes.jsonBody()?.proposal?.id;
      assert.ok(proposalId, 'proposalId must be present in evaluate response');

      // Fetch the evaluations list.
      const listRes = await getProposalEvaluations(cookie, proposalId);
      assert.equal(listRes.statusCode, 200, `GET evaluations failed: ${JSON.stringify(listRes.jsonBody())}`);

      const evaluations = listRes.jsonBody().evaluations ?? [];
      assert.equal(evaluations.length >= 1, true, 'At least one evaluation must be stored');

      const latest = evaluations[0];
      const storedReport = latest?.result?.report ?? {};

      // V2 version marker in stored result.
      assert.equal(
        storedReport.report_format,
        'v2',
        `Stored result.report.report_format must be "v2"; got: ${storedReport.report_format}`,
      );

      // V2 fields present.
      assert.equal(
        Array.isArray(storedReport.why) && storedReport.why.length > 0,
        true,
        `Stored report.why must be non-empty; got: ${JSON.stringify(storedReport.why)}`,
      );
      assert.equal(
        ['high', 'medium', 'low', 'unknown'].includes(storedReport.fit_level),
        true,
        `Stored fit_level must be valid V2; got: ${storedReport.fit_level}`,
      );
      assert.equal(Array.isArray(storedReport.missing), true, `Stored report.missing must be an array`);
      assert.equal(
        Array.isArray(storedReport.presentation_sections) && storedReport.presentation_sections.length > 0,
        true,
        'Stored V2 report must include dynamic presentation sections',
      );

      // Must not be legacy-only.
      const storedTemplateId = String(latest?.result?.template_id ?? storedReport.template_id ?? '');
      assert.notEqual(storedTemplateId, 'document_comparison_v1', 'Stored result must not be legacy v1 only');
    } finally {
      cleanup();
    }
  });

  // ── Test 3: Never-fail ────────────────────────────────────────────────────

  test('Test 3 — never-fail: unexpected Vertex SDK throw produces HTTP 200 + fallback V2', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('v2_eval_t3_owner', 'v2-eval-t3@example.com');
    const comparisonId = await createComparison(cookie);

    // Every call throws.  This exercises the hard try/catch fallback path.
    const cleanup = mockVertexV2Call(async () => {
      throw new Error('Simulated unexpected Vertex SDK failure (test 3)');
    });
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });

      // Must be 200 — never 502.
      assert.equal(res.statusCode, 200, `Expected 200 on Vertex failure; got: ${res.statusCode}`);

      const body = res.jsonBody();
      const report = body.comparison?.evaluation_result?.report ?? {};
      const evalResult = body.comparison?.evaluation_result ?? {};

      // Fallback report must be V2-shaped.
      assert.equal(
        Array.isArray(report.why) && report.why.length > 0,
        true,
        `Fallback report.why must be non-empty; got: ${JSON.stringify(report.why)}`,
      );
      // Score must be a number.
      assert.equal(typeof evalResult.score, 'number', 'Fallback evalResult.score must be a number');
    } finally {
      cleanup();
    }
  });

  // ── Test 4: Anti-leak ────────────────────────────────────────────────────

  test('Test 4 — anti-leak: confidential canary never appears in V2 output fields', async () => {
    await ensureMigrated();
    await resetTables();

    const CANARY = 'CONFIDENTIAL_CANARY_7f3b9e2a';
    const cookie = authCookie('v2_eval_t4_owner', 'v2-eval-t4@example.com');
    const comparisonId = await createComparison(cookie, {
      doc_a_text: `Internal planning document. ${CANARY} must remain confidential. Budget cap $500k.`,
      doc_b_text: 'Shared obligations: scope of work, milestones, and acceptance criteria.',
    });

    // Mock V2 to return clean output with no canary.
    const cleanup = mockVertexV2Call(async () =>
      vertexV2Response({
        why: [
          'Executive Summary: The shared draft aligns with stated objectives.',
          'Key Strengths: Clear scope and acceptance criteria.',
          'Key Risks: No explicit timeline found in shared portion.',
          'Decision Readiness: Near-ready with minor clarification needed.',
          'Recommendations: Add an explicit go-live date to the shared draft.',
        ],
        missing: ['What is the confirmed go-live date?'],
        redactions: [],
      }),
    );
    try {
      const res = await runEvaluate(cookie, comparisonId, { engine: 'v2' });
      assert.equal(res.statusCode, 200, `Expected 200; got: ${res.statusCode}`);

      const body = res.jsonBody();
      const evalResult = body.comparison?.evaluation_result ?? {};
      const report = evalResult.report ?? {};

      // Serialise everything that is returned to the client to catch any leak.
      const publicOutput = JSON.stringify({
        why: report.why,
        missing: report.missing,
        redactions: report.redactions,
        summary: evalResult.summary,
        recommendation: evalResult.recommendation,
        report_summary: report.summary,
        sections: report.sections,
        report_archetype: report.report_archetype,
        report_title: report.report_title,
        primary_insight: report.primary_insight,
        presentation_sections: report.presentation_sections,
        evaluation_inline: body.evaluation,
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
