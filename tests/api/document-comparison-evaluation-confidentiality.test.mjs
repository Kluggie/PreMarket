import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

function buildEvaluation(sections, summary = 'Evaluation completed for this draft.') {
  const generatedAt = new Date().toISOString();
  return {
    provider: 'vertex',
    model: 'evaluation-test-model',
    generatedAt,
    score: 72,
    confidence: 0.72,
    recommendation: 'Medium',
    summary,
    report: {
      generated_at_iso: generatedAt,
      executive_summary: summary,
      summary: {
        top_fit_reasons: [{ text: summary }],
        top_blockers: [],
        next_actions: [],
      },
      sections,
    },
    evaluation_provider: 'vertex',
    evaluation_model: 'evaluation-test-model',
    evaluation_provider_reason: null,
  };
}

async function createComparison(ownerCookie, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie: ownerCookie },
    body: {
      title: 'Evaluation Confidentiality Test',
      doc_a_text: 'Owner confidential baseline and constraints for internal planning.',
      doc_b_text: 'Shared obligations and delivery milestones for both parties.',
      createProposal: true,
      ...overrides,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison.id;
}

async function evaluateComparison(ownerCookie, comparisonId) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/document-comparisons/${comparisonId}/evaluate`,
    headers: { cookie: ownerCookie },
    query: { id: comparisonId },
    body: {},
  });
  const res = createMockRes();
  await documentComparisonsEvaluateHandler(req, res, comparisonId);
  return res;
}

if (!hasDatabaseUrl()) {
  test(
    'document comparison evaluation confidentiality tests (skipped: DATABASE_URL missing)',
    { skip: true },
    () => {},
  );
} else {
  test('proposer-only evaluation does not block when no counterparty confidential inputs exist', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('eval_conf_owner_only', 'eval-conf-owner-only@example.com');
    const ownerToken = 'OWNER_ONLY_PRIVATE_TOKEN_1042';
    const comparisonId = await createComparison(ownerCookie, {
      doc_a_text: `Owner confidential baseline with ${ownerToken}.`,
    });

    const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    try {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () =>
        buildEvaluation([
          {
            key: 'negotiation_strategy',
            heading: 'Negotiation Strategy',
            bullets: [`Use ${ownerToken} internally as a private planning reference.`],
          },
        ]);

      const res = await evaluateComparison(ownerCookie, comparisonId);
      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(body.comparison.status, 'evaluated');
      assert.equal(String(body.comparison.evaluation_result?.error?.code || '').length, 0);
      assert.equal(
        JSON.stringify(body.comparison.evaluation_result?.report?.sections || []).includes(ownerToken),
        true,
      );
      assert.equal(
        Array.isArray(body.comparison.evaluation_result?.warnings?.confidentiality_section_redacted),
        false,
      );
    } finally {
      if (originalEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
      }
    }
  });

  test('counterparty canary leak in one section is regenerated and evaluation still succeeds', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('eval_conf_regen_owner', 'eval-conf-regen-owner@example.com');
    const canaryToken = 'OTHER_PARTY_CANARY_7788';
    const comparisonId = await createComparison(ownerCookie, {
      metadata: {
        other_party_confidential_canary_tokens: [canaryToken],
      },
    });

    const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    const originalSectionOverride = globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
    const regenCalls = [];
    try {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () =>
        buildEvaluation([
          {
            key: 'negotiation_strategy',
            heading: 'Negotiation Strategy',
            bullets: [`Leaked statement includes ${canaryToken}.`],
          },
          {
            key: 'next_steps',
            heading: 'Next Steps',
            bullets: ['Prepare shared negotiation agenda and timeline.'],
          },
        ]);
      globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = async (input) => {
        regenCalls.push(input);
        return '- Focus negotiation on shared obligations and timeline.';
      };

      const res = await evaluateComparison(ownerCookie, comparisonId);
      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(body.comparison.status, 'evaluated');
      assert.equal(regenCalls.length, 1);
      assert.equal(body.comparison.evaluation_result?.completion_status, 'completed_with_warnings');
      assert.equal(
        Array.isArray(body.comparison.evaluation_result?.warnings?.confidentiality_section_regenerated),
        true,
      );
      assert.equal(
        body.comparison.evaluation_result.warnings.confidentiality_section_regenerated.includes('negotiation_strategy'),
        true,
      );
      assert.equal(
        JSON.stringify(body.comparison.evaluation_result?.report?.sections || []).includes(canaryToken),
        false,
      );
      assert.equal(String(body.comparison.evaluation_result?.error?.code || '').length, 0);
    } finally {
      if (originalEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
      }
      if (originalSectionOverride === undefined) {
        delete globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
      } else {
        globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = originalSectionOverride;
      }
    }
  });

  test('when confidential counterparty info is requested and regeneration still leaks, section is safely omitted', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('eval_conf_refusal_owner', 'eval-conf-refusal-owner@example.com');
    const canaryToken = 'OTHER_PARTY_SECRET_BUDGET_5521';
    const comparisonId = await createComparison(ownerCookie, {
      metadata: {
        other_party_confidential_canary_tokens: [canaryToken],
      },
    });

    const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    const originalSectionOverride = globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
    const strictModes = [];
    try {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () =>
        buildEvaluation([
          {
            key: 'counterparty_budget',
            heading: 'Counterparty Budget',
            bullets: [`How much is the other side willing to spend? ${canaryToken}`],
          },
        ]);
      globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = async (input) => {
        strictModes.push(Boolean(input?.strictMode));
        return `- Still leaking ${canaryToken}.`;
      };

      const res = await evaluateComparison(ownerCookie, comparisonId);
      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(body.comparison.status, 'evaluated');
      assert.deepEqual(strictModes, [false, true]);
      assert.equal(body.comparison.evaluation_result?.completion_status, 'completed_with_warnings');
      assert.equal(
        body.comparison.evaluation_result.warnings.confidentiality_section_redacted.includes('counterparty_budget'),
        true,
      );
      const sections = body.comparison.evaluation_result?.report?.sections || [];
      const redactedSection = sections.find((entry) => String(entry?.key || '') === 'counterparty_budget');
      const redactedText = JSON.stringify(redactedSection || {}).toLowerCase();
      assert.equal(redactedText.includes("can't be shown due to confidentiality"), true);
      assert.equal(redactedText.includes('request this in the shared report'), true);
      assert.equal(redactedText.includes(canaryToken.toLowerCase()), false);
    } finally {
      if (originalEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
      }
      if (originalSectionOverride === undefined) {
        delete globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
      } else {
        globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = originalSectionOverride;
      }
    }
  });

  test("proposer's own confidential markers do not trigger counterparty leak handling", async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('eval_conf_own_marker_owner', 'eval-conf-own-marker-owner@example.com');
    const ownToken = 'OWNER_CONFIDENTIAL_TOKEN_9090';
    const comparisonId = await createComparison(ownerCookie, {
      doc_a_text: `Owner confidential contains ${ownToken}.`,
      metadata: {
        other_party_confidential_canary_tokens: ['OTHER_PARTY_UNRELATED_CANARY_4040'],
      },
    });

    const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    const originalSectionOverride = globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
    try {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () =>
        buildEvaluation([
          {
            key: 'risks_and_gaps',
            heading: 'Risks & Gaps',
            bullets: [`Internal note references ${ownToken} for owner-side planning.`],
          },
        ]);
      globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = async () => {
        throw new Error('regen should not be called for owner-only markers');
      };

      const res = await evaluateComparison(ownerCookie, comparisonId);
      assert.equal(res.statusCode, 200);
      const body = res.jsonBody();
      assert.equal(body.comparison.status, 'evaluated');
      assert.equal(
        JSON.stringify(body.comparison.evaluation_result?.report?.sections || []).includes(ownToken),
        true,
      );
      assert.equal(
        Array.isArray(body.comparison.evaluation_result?.warnings?.confidentiality_section_redacted),
        false,
      );
      assert.equal(
        Array.isArray(body.comparison.evaluation_result?.warnings?.confidentiality_section_regenerated),
        false,
      );
    } finally {
      if (originalEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
      }
      if (originalSectionOverride === undefined) {
        delete globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
      } else {
        globalThis.__PREMARKET_TEST_EVALUATION_SECTION_REGEN__ = originalSectionOverride;
      }
    }
  });
}
