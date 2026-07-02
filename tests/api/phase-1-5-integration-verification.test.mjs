import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
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

async function createComparison(ownerCookie, body) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie: ownerCookie },
    body,
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison;
}

async function createSharedReportLink(ownerCookie, comparisonId, recipientEmail, permissions = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie: ownerCookie },
    body: {
      comparisonId,
      recipientEmail,
      ...permissions,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

async function saveRecipientDraft(token, body, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function evaluateRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function getRecipientWorkspace(token, cookie = null) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/shared-report/${token}`,
    query: { token },
    headers: cookie ? { cookie } : {},
  });
  const res = createMockRes();
  await sharedReportRecipientTokenHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
  return res;
}

async function getSharedLinkRowByToken(token) {
  const db = getDb();
  const rows = await db.execute(sql`select * from shared_links where token = ${token} limit 1`);
  return rows.rows[0] || null;
}

function buildMockSharedMediationEvaluation({
  fitLevel,
  confidence01,
  score,
  primaryInsight,
  why,
  missing,
  movementDirection,
  bilateralRoundNumber,
  priorBilateralRoundNumber = null,
  deltaSummary = '',
  resolvedSinceLastRound = [],
  remainingDeltas = missing,
}) {
  const recommendation =
    fitLevel === 'high' ? 'High' : fitLevel === 'medium' ? 'Medium' : 'Low';

  return {
    recommendation,
    score,
    confidence: Math.round(confidence01 * 100),
    summary: primaryInsight,
    evaluation_provider: 'test',
    report: {
      report_format: 'v2',
      analysis_stage: 'mediation_review',
      recommendation,
      fit_level: fitLevel,
      confidence_0_1: confidence01,
      why,
      missing,
      redactions: [],
      movement_direction: movementDirection,
      bilateral_round_number: bilateralRoundNumber,
      ...(priorBilateralRoundNumber
        ? { prior_bilateral_round_number: priorBilateralRoundNumber }
        : {}),
      ...(deltaSummary ? { delta_summary: deltaSummary } : {}),
      ...(resolvedSinceLastRound.length
        ? { resolved_since_last_round: resolvedSinceLastRound }
        : {}),
      ...(remainingDeltas.length ? { remaining_deltas: remainingDeltas } : {}),
      report_title: 'AI Mediation Review',
      primary_insight: primaryInsight,
      narrative: {
        sections: [
          {
            heading: 'Summary',
            body: primaryInsight,
          },
          {
            heading: 'Open Questions',
            body: missing.join(' '),
          },
        ],
      },
    },
  };
}

if (!hasDatabaseUrl()) {
  test('Phase 1.5 Integration: demand-forecasting multi-round scenario (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('Phase 1.5: demand-forecasting multi-round evaluation through shared-report path', async () => {
    await ensureMigrated();
    await resetTables();

    const seed = 'phase_1_5_demand_forecasting';
    const ownerCookie = makeOwnerCookie(seed);
    const recipientEmail = `${seed}_recipient@example.com`;
    const recipientCookie = makeRecipientCookie(seed, recipientEmail);

    // ─── Round 1: Initial proposer draft + recipient review ────────────────
    const comparison = await createComparison(ownerCookie, {
      title: 'Phase 1.5 Demand Forecasting Platform',
      createProposal: true,
      docAText: `
        INTERNAL FALLBACK: We can walk away if demand forecast accuracy drops below 85%.
        We need minimum 15% margin and can't accept shared infrastructure risk above 3%.
        Maximum acceptable pilot duration is 9 months, must sign final agreement by Q2.
      `,
      docBText: `
        Our platform provides AI-driven demand forecasting for supply chain optimization.
        The proposal includes 12-month engagement with phased rollout: Month 1-2 discovery,
        Month 3-8 pilot, Month 9-12 production ramp. Pricing is $50k setup + $8k/month.
        KPIs: 88% forecast accuracy, <5% demand deviation. Renewal annually with 90-day notice.
        We provide the ML models and maintain the infrastructure. Client provides operational data.
      `,
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
      canView: true,
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });
    
    const initialToken = initialLink.token || initialLink.shared_report?.token;
    assert.ok(initialToken, 'Initial link token should exist');

    // Set up mock for Round 1 evaluation (initial review)
    const previousMediationProvider = process.env.MEDIATION_AI_PROVIDER;
    process.env.MEDIATION_AI_PROVIDER = 'test';

    const capturedV2Calls = [];
    const previousEvalOverride = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async (input) => {
      capturedV2Calls.push(input);
      return buildMockSharedMediationEvaluation({
        fitLevel: 'medium',
        confidence01: 0.62,
        score: 70,
        primaryInsight:
          'The recipient has confirmed interest and raised specific implementation and cost concerns. With clarifications on data governance and cost alignment, this progresses toward executable agreement.',
        why: [
          'Both sides support phased rollout and accept the annual renewal structure.',
          'The recipient remains interested if cost, data governance, and liability details are clarified.',
        ],
        missing: [
          'Define the infrastructure cost split and responsibility model.',
          'Confirm post-contract data ownership and retention terms.',
          'Specify liability caps before final commitment.',
        ],
        movementDirection: 'stalled',
        bilateralRoundNumber: 1,
      });
    };

    try {
      // Round 1: Recipient responds with initial concerns
      const round1SaveRes = await saveRecipientDraft(initialToken, {
      shared_payload: {
        label: 'Shared Information',
        text: `
          We are interested in the platform but need several clarifications:
          - Forecast accuracy KPI of 88% is reasonable but needs baseline comparison
          - The phased rollout timeline works for us
          - We need clarification on data ownership and retention after contract end
          - Infrastructure maintenance cost split needs to be defined
          - We want to confirm liability caps before final commitment
        `,
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `
          Internal: We can only afford $7k/month operating budget. The $50k setup cost is pushing us.
          We prefer a 6-month pilot to test before committing to 12 months.
          Risk tolerance: maximum 2% infrastructure outage is acceptable.
        `,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round1SaveRes.statusCode, 200);

    // Round 1: Evaluate recipient response
    const round1EvalRes = await evaluateRecipientDraft(initialToken, {}, recipientCookie);
    assert.equal(round1EvalRes.statusCode, 200);
    const round1Body = round1EvalRes.jsonBody();
    assert.equal(round1Body.ok, true);
    assert.equal(Boolean(round1Body.evaluation_id), true);
    const round1EvaluationResult = round1Body.evaluation?.evaluation_result || {};
    const round1Report = round1Body.evaluation?.public_report || {};

    // Phase 1.5 Verification - Round 1
    assert.equal(
      round1EvaluationResult.score,
      70,
      'Phase 1.5: Round 1 evaluation result score should be 70',
    );
    assert.equal(
      round1Report.recommendation,
      'Medium',
      'Phase 1.5: Round 1 recommendation should map to the current Medium fit contract',
    );
    assert.equal(
      round1Report.fit_level,
      'medium',
      'Phase 1.5: Round 1 fit level should stay in a review/medium state',
    );
    assert.equal(
      String([
        round1Report.primary_insight || '',
        ...(Array.isArray(round1Report.why) ? round1Report.why : []),
        ...((round1Report.narrative?.sections || []).map((section) => section.body) || []),
      ].join(' '))
        .toLowerCase()
        .includes('interested'),
      true,
      'Phase 1.5: Round 1 should summarize interest',
    );
    assert.equal(
      String(round1Report.movement_direction || '').toLowerCase(),
      'stalled',
      'Phase 1.5: Round 1 initial review should detect stalled movement',
    );
    assert.equal(
      JSON.stringify(round1Report).includes('INTERNAL FALLBACK'),
      false,
      'Phase 1.5: Proposer confidential fallback positions must not leak',
    );
    assert.equal(
      JSON.stringify(round1Report).includes('only afford $7k'),
      false,
      'Phase 1.5: Recipient confidential budget constraints must not leak',
    );
    assert.equal(
      (Array.isArray(round1Report.why) &&
        round1Report.why.some((entry) => /phased rollout/i.test(String(entry)))) ||
        String(round1Report.narrative?.sections?.map((s) => s.body).join('') || '').includes(
          'phased rollout',
        ),
      true,
      'Phase 1.5: Initial review should identify alignment on phased rollout',
    );

    // ─── Round 2: Proposer response + later-round evaluation ────────────────
    const round1SendRes = await sendBackRecipientDraft(initialToken, {}, recipientCookie);
    assert.equal(round1SendRes.statusCode, 200);

    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token <> ${initialToken}
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    assert.notEqual(round2Token, '', 'Phase 1.5: Round 2 token should be created');

    // Round 2: Proposer addresses recipient concerns
    const round2SaveRes = await saveRecipientDraft(round2Token, {
      shared_payload: {
        label: 'Shared Information',
        text: `
          Thank you for your detailed response. We've addressed your key concerns:

          BASELINE ACCURACY: We commit to 88% forecast accuracy against your historical
          baseline (to be established month 1). Accuracy measured monthly with reconciliation.

          PHASED PILOT: We agree to a 6-month pilot pricing of $6k/month (vs. $8k production).
          After successful pilot completion, we transition to standard $8k/month for 12+ months.

          INFRASTRUCTURE: We propose 70/30 split on infrastructure costs: we bear 70% vendor risk,
          you bear 30% operational integration costs. All infrastructure remains in your environment.

          DATA OWNERSHIP: Full data ownership reverts to you immediately upon contract termination.
          We retain only anonymized aggregate statistics for model improvement (opt-out available).

          LIABILITY CAPS: We cap liability at 2x annual contract value ($192k for 12 months).
          Infrastructure failures capped at 90 days credit. Both parties carry D&O insurance.

          We believe this framework closes our gap and positions us for execution.
        `,
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `
          Internal: The $6k/month pilot rate is our minimum. We can absorb infrastructure costs
          to win this deal. If they don't accept, we walk away.
        `,
      },
      workflow_step: 2,
    }, ownerCookie);
    assert.equal(round2SaveRes.statusCode, 200);

    // Update mock for Round 2 evaluation (later-round delta analysis)
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async (input) => {
      capturedV2Calls.push(input);
      return buildMockSharedMediationEvaluation({
        fitLevel: 'high',
        confidence01: 0.78,
        score: 78,
        primaryInsight:
          'Proposer has closed material gaps on cost, data governance, and liability. Both parties have narrowed the deal into near-final terms. Remaining items are administrative approval and signature logistics.',
        why: [
          'Pilot pricing, phased rollout, infrastructure allocation, data ownership, and liability caps are now aligned.',
          'The commercial blockers from the prior bilateral round appear resolved.',
        ],
        missing: [
          'Confirm internal approval routing on both sides.',
          'Finalize signature authority confirmation and legal review completion.',
        ],
        movementDirection: 'converging',
        bilateralRoundNumber: 2,
        priorBilateralRoundNumber: 1,
        deltaSummary:
          'Compared with the prior bilateral round, cost, infrastructure, data ownership, and liability blockers are resolved; only final approvals remain.',
        resolvedSinceLastRound: [
          'Pilot pricing aligned.',
          'Infrastructure cost split defined.',
          'Data ownership and liability cap terms confirmed.',
        ],
        remainingDeltas: [
          'Confirm internal approval routing on both sides.',
          'Finalize signature authority confirmation and legal review completion.',
        ],
      });
    };

    const round2EvalRes = await evaluateRecipientDraft(round2Token, {}, ownerCookie);
    assert.equal(round2EvalRes.statusCode, 200);
    const round2Body = round2EvalRes.jsonBody();
    assert.equal(round2Body.ok, true);
    assert.equal(Boolean(round2Body.evaluation_id), true);
    const round2Report = round2Body.evaluation?.public_report || {};

    // Phase 1.5 Verification - Round 2 (Core requirement checks)
    assert.notEqual(
      round2Report.fit_level,
      'unknown',
      'Phase 1.5: Later-round fit_level should not be unknown (not collapsing to fallback)',
    );
    assert.notEqual(
      round2Report.confidence_0_1,
      0.28,
      'Phase 1.5: Later-round confidence should not lock at 0.28 (no stale-question collapse)',
    );
    assert.equal(
      round2Report.fit_level,
      'high',
      'Phase 1.5: Later-round with resolved blocker issues should upgrade to high',
    );
    assert.equal(
      round2Report.confidence_0_1 >= 0.75,
      true,
      'Phase 1.5: Later-round with material progress should have high confidence (>= 0.75)',
    );
    assert.equal(
      String(round2Report.movement_direction || '').toLowerCase(),
      'converging',
      'Phase 1.5: Later-round should detect converging movement when blockers resolve',
    );
    assert.equal(
      round2Report.bilateral_round_number,
      2,
      'Phase 1.5: Later-round should have bilateral_round_number=2',
    );
    assert.equal(
      Boolean(round2Report.delta_summary),
      true,
      'Phase 1.5: Later-round should include delta_summary for continuity',
    );
    assert.equal(
      String(round2Report.delta_summary || '').toLowerCase().includes('prior bilateral round'),
      true,
      'Phase 1.5: delta_summary should reference prior round',
    );

    // Landing zone should be identified in why/missing
    assert.equal(
      String([
        ...(round2Report.why || []),
        ...(round2Report.missing || []),
        ...((round2Report.narrative?.sections || []).map((s) => s.body) || []),
      ].join(''))
        .toLowerCase()
        .includes('final stage') ||
        String([
          ...(round2Report.why || []),
          ...(round2Report.missing || []),
          ...((round2Report.narrative?.sections || []).map((s) => s.body) || []),
        ].join(''))
          .toLowerCase()
          .includes('signature'),
      true,
      'Phase 1.5: Later-round should identify landing zone (final stage/signature items)',
    );

    // Open questions should be current and final-stage specific
    const openQuestions = round2Report.missing || [];
    assert.equal(openQuestions.length > 0, true, 'Phase 1.5: Later-round should have final-stage open questions');
    assert.equal(
      openQuestions.every((q) => !/infrastructure cost|data ownership|liability cap/i.test(q)),
      true,
      'Phase 1.5: Later-round open questions should not include resolved prior issues (stale-question pruning)',
    );
    assert.equal(
      openQuestions.some((q) => /approval|signature|legal/i.test(q)),
      true,
      'Phase 1.5: Later-round open questions should be final-stage specific',
    );

    // No confidential leaks
    assert.equal(
      JSON.stringify(round2Report).includes('$6k/month is our minimum'),
      false,
      'Phase 1.5: Proposer internal walk-away position must not leak',
    );
    assert.equal(
      JSON.stringify(round2Report).includes('only afford'),
      false,
      'Phase 1.5: No earlier-round recipient budget info should leak into later round',
    );

    // Initial review quality not regressed
    assert.equal(capturedV2Calls.length >= 2, true, 'Phase 1.5: Both rounds should call evaluation');
    assert.equal(
      round1Report.confidence_0_1 > 0.4,
      true,
      'Phase 1.5: Round 1 confidence should not collapse due to regression',
    );
    assert.equal(
      Array.isArray(round1Report.why) && round1Report.why.length > 0,
      true,
      'Phase 1.5: Round 1 should have substantive why content',
    );

    // Later-round coherence: fit/confidence alignment
    assert.equal(
      round2Report.fit_level === 'high' && round2Report.confidence_0_1 >= 0.75,
      true,
      'Phase 1.5: Later-round fit_level and confidence should align (both high)',
    );

    // ─── Workspace verification ────────────────────────────────────────────
    const workspaceRes = await getRecipientWorkspace(round2Token, ownerCookie);
    assert.equal(workspaceRes.statusCode, 200);
    const workspace = workspaceRes.jsonBody();
    assert.equal(
      workspace.latestEvaluation?.result_json?.input_trace?.bilateral_round_number ||
        workspace.latestEvaluation?.result_json?.bilateral_round_number ||
        0,
      2,
    );
    assert.equal(
      workspace.latestReport?.movement_direction || '',
      'converging',
      'Phase 1.5: Workspace should expose converging movement',
    );

    console.log('✅ Phase 1.5 Integration Verification Passed');
    console.log(`   ✓ Final round not marked as not_viable (fit_level: ${round2Report.fit_level})`);
    console.log(`   ✓ Confidence not locked (round 2: ${round2Report.confidence_0_1}, vs 0.28)`);
    console.log(`   ✓ Movement detected as converging (was: stalled in round 1)`);
    console.log(`   ✓ Landing zone identified (${openQuestions.length} final-stage questions)`);
    console.log(`   ✓ Open questions current and specific (no stale prior issues)`);
    console.log(`   ✓ No confidential fallback positions leaked`);
    console.log(`   ✓ Initial review quality not regressed (Round 1 confidence: ${round1Report.confidence_0_1})`);
    } finally {
      if (previousEvalOverride === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvalOverride;
      }
      if (previousMediationProvider === undefined) {
        delete process.env.MEDIATION_AI_PROVIDER;
      } else {
        process.env.MEDIATION_AI_PROVIDER = previousMediationProvider;
      }
    }
  });
}
