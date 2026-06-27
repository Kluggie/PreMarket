import assert from 'assert';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function makeOwnerCookie(seed) {
  return makeSessionCookie({
    sub: `${seed}_owner`,
    email: `${seed}_owner@example.com`,
  });
}

function makeRecipientCookie(seed, email = `${seed}_recipient@example.com`) {
  return makeSessionCookie({
    sub: `${seed}_recipient`,
    email,
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
      docAText: input.docAText,
      docBText: input.docBText,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
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
      allowRecipientAiReview: true,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

async function saveRecipientDraft(token, recipientCookie, payload) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    headers: { cookie: recipientCookie },
    query: { token },
    body: payload,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function evaluateRecipientDraft(token, recipientCookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    headers: { cookie: recipientCookie },
    query: { token },
    body: {},
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, recipientCookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    headers: { cookie: recipientCookie },
    query: { token },
    body: {},
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
  return res;
}

/**
 * Phase 1.5 Integration Verification (Simplified)
 *
 * Validates Phase 1 fixes through actual evaluation routes without mock complexity.
 * Purpose: Confirm that mediation-progress.ts and vertex-evaluation-v2.ts patches
 * work end-to-end when evaluation routes are invoked with realistic scenarios.
 *
 * Test Strategy: Use realistic proposal and review data that exercises Phase 1 fixes
 * without requiring complex mock setup. The real evaluation API will execute, allowing
 * us to verify the routes don't break and handle the new Phase 1 code paths correctly.
 */

test('Phase 1.5: Demand-forecasting multi-round scenario validates Phase 1 fixes', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const proposerCookie = makeOwnerCookie('phase1_5_test');
  const recipientEmail = 'recipient@test.com';
  const recipientCookie = makeRecipientCookie('phase1_5_test', recipientEmail);

  try {
    // ─── Round 1: Create proposal and shared report link ────────────────
    const comparison = await createComparison(proposerCookie, {
      title: 'Demand Forecasting Integration - Phase 1.5 Verification',
      docAText: `
        We propose an AI-powered demand-forecasting partnership to help you optimize
        inventory planning and reduce stockouts. Our model integrates with your
        historical sales data and provides weekly forecast updates.

        PROPOSAL TERMS:
        - Model accuracy: ~85% baseline
        - Pricing: $8,000/month
        - Annual renewal
        - 4-week implementation
      `,
      docBText: `
        Initial recipient response:

        Thank you for the proposal. We are interested in exploring this partnership.

        KEY ALIGNMENTS:
        - Your weekly forecast cadence aligns with our replenishment cycle.
        - Annual renewal structure works for our budget planning.
        - Data isolation commitment is important and noted.

        OPEN QUESTIONS:
        - What is the baseline accuracy of your model? We need at least 85%.
        - Infrastructure: Can the system run in our cloud environment, or do we need to send data externally?
        - Cost: Our budget is around $7k/month. Can you work within that range?
        - Data governance: After contract end, how is historical data handled?
      `,
    });

    const comparison_id = comparison.id;
    assert.ok(comparison_id, 'Comparison ID should be returned');

    // Create shared report link
    const linkRes = await createSharedReportLink(proposerCookie, comparison_id, recipientEmail);
    const token = linkRes.token;
    assert.ok(token, 'Token should be returned');

    // Save recipient initial response (Round 1)
    const round1SaveRes = await saveRecipientDraft(
      token,
      recipientCookie,
      {
        shared_payload: {
          label: 'Initial Response',
          text: `
            Thank you for the proposal. We are interested in exploring this partnership.

            KEY ALIGNMENTS:
            - Your weekly forecast cadence aligns with our replenishment cycle.
            - Annual renewal structure works for our budget planning.
            - Data isolation commitment is important and noted.

            OPEN QUESTIONS:
            - What is the baseline accuracy of your model? We need at least 85%.
            - Infrastructure: Can the system run in our cloud environment, or do we need to send data externally?
            - Cost: Our budget is around $7k/month. Can you work within that range?
            - Data governance: After contract end, how is historical data handled?
          `,
        },
        workflow_step: 1,
      },
    );
    assert.equal(round1SaveRes.statusCode, 200, 'Round 1 draft save should succeed');

    // Evaluate Round 1 (initial review)
    const round1EvalRes = await evaluateRecipientDraft(token, recipientCookie);
    assert.equal(round1EvalRes.statusCode, 200, 'Round 1 evaluation should succeed');

    const round1Body = round1EvalRes.jsonBody();
    assert.ok(round1Body.evaluation_id, 'Evaluation ID should be present');

    // ─── Phase 1.5 Criteria 1: Initial review quality should not regress ───────
    const round1Report = round1Body.evaluation?.public_report || {};
    const hasRecommendation = Boolean(round1Report.recommendation || round1Report.fit_level);
    assert.equal(hasRecommendation, true, 'Phase 1.5: Round 1 should have recommendation field');

    // ─── Phase 1.5 Criteria 2: Open questions should be current, not stale ───────
    const round1Missing = round1Report.missing || round1Report.why || [];
    const hasTechnicalQuestions =
      String(round1Missing).toLowerCase().includes('accuracy') ||
      String(round1Missing).toLowerCase().includes('infrastructure') ||
      String(round1Missing).toLowerCase().includes('cost');
    assert.equal(
      hasTechnicalQuestions,
      true,
      'Phase 1.5: Round 1 should identify current open questions (accuracy, infrastructure, cost)',
    );

    console.log('✅ Round 1 evaluation completed');
    console.log(`   Evaluation ID: ${round1Body.evaluation_id}`);

    // ─── Send Round 1 draft to proposer for response ─────────────────────────────
    const sendRes = await sendBackRecipientDraft(token, recipientCookie);
    assert.equal(sendRes.statusCode, 200, 'Round 1 send should succeed');

    // Get new token for Round 2 (proposer response)
    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = (
            select proposal_id from document_comparisons where id = ${comparison_id}
          )
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    assert.ok(round2Token, 'Round 2 token should be created');
    assert.notEqual(round2Token, token, 'Round 2 token should be different from Round 1');

    // ─── Round 2: Proposer addresses recipient concerns ────────────────────────
    const round2SaveRes = await saveRecipientDraft(
      round2Token,
      recipientCookie,
      {
        shared_payload: {
          label: 'Proposer Response',
          text: `
            Thank you for your feedback. We have addressed your key concerns:

            ACCURACY: Our model consistently achieves 87% accuracy against historical baselines.
            This is measured monthly with full reconciliation reports.

            INFRASTRUCTURE: We support three deployment models:
            1. Cloud-hosted in your environment (recommended for your scale)
            2. On-premises if required
            3. Hybrid with data lake integration

            PRICING: We can offer $6,500/month for the first 6 months (pilot phase),
            then $8,000/month for months 7-12 and beyond. This allows both sides to
            validate ROI before full deployment.

            DATA GOVERNANCE: Upon contract termination, all historical forecasts and
            model training artifacts revert to you. We retain only anonymized
            aggregate statistics for model improvement (you can opt-out).

            TIMELINE: We can be operational within 4 weeks of contract signing.
            Initial data integration typically takes 2-3 weeks.
          `,
        },
        workflow_step: 2,
      },
    );
    assert.equal(round2SaveRes.statusCode, 200, 'Round 2 draft save should succeed');

    // Evaluate Round 2 (later-round mediation with context)
    const round2EvalRes = await evaluateRecipientDraft(round2Token, recipientCookie);
    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');

    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.evaluation_id, 'Round 2 evaluation ID should be present');

    // ─── Phase 1.5 Criteria 3: Later-round should detect convergence ──────────────
    const round2Report = round2Body.evaluation?.public_report || {};
    const reportText = JSON.stringify(round2Report);

    // Check that the evaluation recognizes movement toward agreement
    const hasConvergenceSignals =
      reportText.toLowerCase().includes('closer') ||
      reportText.toLowerCase().includes('progress') ||
      reportText.toLowerCase().includes('addressed') ||
      reportText.toLowerCase().includes('convergence') ||
      reportText.toLowerCase().includes('align');

    assert.equal(
      hasConvergenceSignals,
      true,
      'Phase 1.5: Later-round should detect convergence (movement toward agreement)',
    );

    // ─── Phase 1.5 Criteria 4: Later-round confidence should not collapse ────────
    const round2Confidence = round2Report.confidence_score || round2Report.confidence_0_1;
    if (round2Confidence !== undefined) {
      const confidenceValue = typeof round2Confidence === 'string' ? parseFloat(round2Confidence) : round2Confidence;
      assert.ok(
        confidenceValue >= 0.4 || round2Report.fit_level !== 'unknown',
        'Phase 1.5: Later-round confidence should not collapse to unknown/0.2',
      );
    }

    // ─── Phase 1.5 Criteria 5: Round 2 questions should be final-stage specific ───
    const round2Missing = round2Report.missing || round2Report.why || [];
    const isStaleQuestion =
      String(round2Missing).toLowerCase().includes('accuracy') &&
      reportText.toLowerCase().includes('87%');

    assert.equal(isStaleQuestion, false, 'Phase 1.5: Round 2 should not repeat prior-round questions (stale-question pruning)');

    // ─── Phase 1.5 Criteria 6: Landing zone should be identified if close ────────
    const hasLandingZone =
      reportText.toLowerCase().includes('$6') ||
      reportText.toLowerCase().includes('$7') ||
      reportText.toLowerCase().includes('$8') ||
      reportText.toLowerCase().includes('pricing') ||
      reportText.toLowerCase().includes('cost') ||
      reportText.toLowerCase().includes('budget') ||
      reportText.toLowerCase().includes('month');

    assert.equal(
      hasLandingZone,
      true,
      'Phase 1.5: Later-round should reference pricing/cost landing zone if close to agreement',
    );

    console.log('✅ Phase 1.5 Integration Verification PASSED');
    console.log(`   Round 1 Evaluation ID: ${round1Body.evaluation_id}`);
    console.log(`   Round 2 Evaluation ID: ${round2Body.evaluation_id}`);
    console.log(`   Comparison ID: ${comparison_id}`);
    console.log('   All Phase 1 fixes validated through production routes');
  } catch (error) {
    console.error('Phase 1.5 test error:', error.message);
    throw error;
  }
});
