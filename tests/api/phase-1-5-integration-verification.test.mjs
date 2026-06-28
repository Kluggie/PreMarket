import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportsTokenHandler from '../../server/routes/shared-reports/[token].ts';
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

async function updateSharedReportLink(token, ownerCookie, body = {}) {
  const req = createMockReq({
    method: 'PATCH',
    url: `/api/sharedReports/${token}`,
    query: { token },
    headers: { cookie: ownerCookie },
    body,
  });
  const res = createMockRes();
  await sharedReportsTokenHandler(req, res, token);
  return res;
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

async function evaluateRecipientDraft(token, body = {}, cookie = null, queryOverrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token, ...queryOverrides },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

function mockVertexV2Call(mockFn) {
  const previous = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = mockFn;
  return () => {
    if (previous === undefined) {
      delete globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__ = previous;
    }
  };
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
      allowRecipientAiReview: true,
      maxUses: 30,
    });

    const initialToken = initialLink.token || initialLink.shared_report?.token;
    assert.ok(initialToken, 'Initial link token should exist');

    const previousMediationProvider = process.env.MEDIATION_AI_PROVIDER;
    process.env.MEDIATION_AI_PROVIDER = 'vertex';
    let passBCount = 0;
    const cleanup = mockVertexV2Call(async ({ prompt }) => {
      const normalizedPrompt = String(prompt || '');
      const isRefinementPrompt = normalizedPrompt.includes('INITIAL REPORT TO REFINE:');
      const isPassBPrompt =
        normalizedPrompt.includes('Required JSON schema (top-level evaluation keys required') ||
        isRefinementPrompt;
      const isLaterBilateralRound =
        normalizedPrompt.includes('prior_bilateral_context') ||
        normalizedPrompt.includes('"current_bilateral_round_number": 2');

      if (!isPassBPrompt) {
        return {
          model: 'gemini-2.5-flash-lite',
          text: JSON.stringify({
            project_goal: 'Launch a demand forecasting pilot with clear accuracy, pricing, and governance terms.',
            scope_deliverables: [
              'AI demand forecasting pilot',
              'Baseline accuracy measurement',
              'Infrastructure and governance terms',
            ],
            timeline: {
              start: 'After legal and executive approval',
              duration: '6-month pilot followed by production ramp',
              milestones: ['Discovery baseline', 'Pilot launch', 'Production decision'],
            },
            constraints: [
              'Pilot pricing and production pricing must be explicit.',
              'Infrastructure responsibility and liability caps must be bounded.',
            ],
            success_criteria_kpis: [
              'Forecast accuracy remains above baseline-adjusted target.',
              'Pilot economics and governance terms remain executable for both sides.',
            ],
            vendor_preferences: [],
            assumptions: [
              'Both sides remain open to a phased rollout if risk allocation is explicit.',
            ],
            risks: [
              {
                risk: 'Unclear infrastructure or liability ownership could block execution.',
                impact: 'high',
                likelihood: 'med',
              },
            ],
            open_questions: [
              'What pilot economics close the budget gap?',
              'Who owns infrastructure and final approval?',
            ],
            missing_info: [
              'Pilot pricing, infrastructure split, and approval routing remain material.',
            ],
            source_coverage: {
              has_scope: true,
              has_timeline: true,
              has_kpis: true,
              has_constraints: true,
              has_risks: true,
            },
          }),
          finishReason: 'STOP',
          httpStatus: 200,
        };
      }

      passBCount += 1;

      return {
        model: 'gemini-2.5-pro',
        text: JSON.stringify(
          isLaterBilateralRound
            ? {
                analysis_stage: 'mediation_review',
                recommendation: 'High',
                fit_level: 'high',
                confidence_0_1: 0.79,
                why: [
                  'Recommendation: Proceed with final approvals because pilot pricing, infrastructure allocation, data ownership, and liability structure are now materially aligned. The remaining work is limited to approval routing and signature logistics.',
                  'Where the Parties Align: Both sides now support the 6-month pilot, the phased timeline, the 70/30 infrastructure split, data ownership reversion, and the 2x annual-fee liability cap.',
                  'Where the Deal Is Stuck: The remaining work is administrative rather than commercial. Final approval routing, legal sign-off timing, and signature logistics still need to be scheduled.',
                  'Suggested Bridge: Confirm who gives final approval on each side, circulate the signature package, and lock the legal-review deadline.',
                  'Next Step: Complete executive approval routing and move the agreement to signature.',
                ],
                missing: [
                  'Which executive gives final approval on each side?',
                  'What is the legal-signoff date for signature circulation?',
                ],
                redactions: [],
                internal_analysis: {
                  recommendation: 'Proceed with final approvals',
                  confidence: 0.79,
                  decision_status: 'proceed_with_conditions',
                  core_thesis: 'The deal is near final once approval routing and signature timing are confirmed.',
                  commercial_rationale: ['The pilot economics and risk allocation are now closeable.'],
                  strongest_arguments_for: ['The parties resolved the core economic and governance blockers.'],
                  strongest_arguments_against: ['Approval routing and signature timing still need explicit owners.'],
                  key_risks: ['Delayed approvals could slow the signature package.'],
                  hidden_assumptions: ['Both sides can complete legal review without re-opening resolved economics.'],
                  unresolved_questions: ['Who gives final approval on each side?'],
                  negotiation_leverage: ['The phased pilot structure keeps exposure bounded while enabling execution.'],
                  suggested_next_actions: ['Lock approval owners and circulate signature-ready paper.'],
                  evidence_used: ['The latest shared draft closes pricing, governance, and liability gaps.'],
                  missing_information: ['Final approval routing and signature timing.'],
                  tone_profile: 'constructive',
                  output_mode: 'executive_memo',
                },
                narrative: {
                  title: 'The deal is now closeable, pending approvals',
                  sections: [
                    {
                      heading: 'The substantive blockers are now resolved',
                      paragraphs: [
                        'Since the prior bilateral round, the proposer closed the material gaps on pilot pricing, infrastructure allocation, data ownership, and liability caps. That moves the negotiation from commercial uncertainty to final-stage execution planning.',
                        'The phased rollout now has a credible pilot structure that both sides can carry into final approval without reopening the core economics.',
                      ],
                    },
                    {
                      heading: 'Only final-stage mechanics remain',
                      paragraphs: [
                        'The remaining work is administrative: confirm approval owners, complete legal review, and circulate the signature package.',
                        'Those items matter, but they no longer look like substantive commercial blockers.',
                      ],
                    },
                  ],
                  closing: 'Confirm the final approval path and signature timing so the agreement can move to execution.',
                },
                delta_summary:
                  'Since the prior bilateral round, proposer closed the cost, infrastructure, data-governance, and liability gaps; only approval routing and signature logistics remain.',
                resolved_since_last_round: [
                  'Pilot pricing is now aligned around a 6-month entry phase.',
                  'Infrastructure allocation and post-termination data ownership are now explicit.',
                  'Liability caps are now defined.',
                ],
                remaining_deltas: [
                  'Executive approval routing still needs explicit owners.',
                  'Legal sign-off timing still needs to be scheduled.',
                ],
                new_open_issues: [
                  'Signature logistics are now the main execution dependency.',
                ],
                movement_direction: 'converging',
              }
            : {
                analysis_stage: 'mediation_review',
                recommendation: 'Low',
                fit_level: 'low',
                confidence_0_1: 0.58,
                why: [
                  'Recommendation: Review before proceeding because the phased rollout is promising, but cost alignment, infrastructure responsibility, liability caps, and post-contract data handling are still open enough to block execution.',
                  'Where the Parties Align: Both sides support a phased rollout and are open to measuring forecast accuracy against a shared baseline.',
                  'Where the Deal Is Stuck: Pilot economics, infrastructure ownership, post-termination data handling, and liability caps remain unresolved.',
                  'Suggested Bridge: Convert the pilot to a lower-cost 6-month phase and define infrastructure, data, and liability terms explicitly.',
                  'Next Step: The proposer should answer with concrete pilot pricing, cost allocation, and governance language.',
                ],
                missing: [
                  'What pilot price and duration would close the budget gap?',
                  'How will infrastructure costs be split during the pilot?',
                  'What liability cap and post-termination data rule will govern the deal?',
                ],
                redactions: [],
                internal_analysis: {
                  recommendation: 'Review before proceeding',
                  confidence: 0.58,
                  decision_status: 'review',
                  core_thesis: 'The direction is commercially interesting, but execution blockers remain unresolved.',
                  commercial_rationale: ['The phased rollout is workable if pricing and risk allocation become explicit.'],
                  strongest_arguments_for: ['The recipient remains interested and accepts the rollout structure.'],
                  strongest_arguments_against: ['Pilot economics and governance responsibilities are still open.'],
                  key_risks: ['Unclear cost and liability structure could prevent execution.'],
                  hidden_assumptions: ['The proposer can flex pilot economics without re-opening the whole deal.'],
                  unresolved_questions: ['How will infrastructure and liability be allocated?'],
                  negotiation_leverage: ['The recipient already accepts the overall phased shape.'],
                  suggested_next_actions: ['Respond with concrete pilot pricing and governance terms.'],
                  evidence_used: ['The recipient confirmed interest but identified cost and governance blockers.'],
                  missing_information: ['Pilot pricing, infrastructure split, and liability caps.'],
                  tone_profile: 'constructive',
                  output_mode: 'executive_memo',
                },
                narrative: {
                  title: 'Promising direction, but execution blockers remain',
                  sections: [
                    {
                      heading: 'The parties see a viable shape',
                      paragraphs: [
                        'Both sides support a phased rollout and accept the need for baseline accuracy measurement. That gives the deal a workable structure even before the commercial details are fully closed.',
                        'The recipient also remains interested, which keeps the negotiation active rather than stalled.',
                      ],
                    },
                    {
                      heading: 'The economics and governance still need work',
                      paragraphs: [
                        'Pilot pricing, infrastructure cost allocation, data handling after contract end, and liability caps remain unresolved. Those items are material enough to justify another review round before treating the deal as closeable.',
                        'The missing information is specific: the parties still need explicit pilot pricing, infrastructure cost allocation, and liability and post-termination data terms before the deal can move into final approvals.',
                        'A concrete proposer response on pricing and governance would likely determine whether the discussion can move into final approvals.',
                      ],
                    },
                  ],
                  closing: 'The proposer should respond with concrete pilot economics, infrastructure allocation, and governance terms before the deal advances.',
                },
              },
        ),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    });

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

      const round1EvalRes = await evaluateRecipientDraft(initialToken, {}, recipientCookie, { engine: 'v2' });
      assert.equal(round1EvalRes.statusCode, 200);
      const round1Body = round1EvalRes.jsonBody();
      assert.equal(round1Body.ok, true);
      assert.equal(Boolean(round1Body.evaluation_id), true);
      assert.equal(round1Body.evaluation?.status, 'success');
      const round1Report = round1Body.evaluation?.public_report || {};

      assert.equal(round1Report.analysis_stage, 'mediation_review');
      assert.notEqual(round1Report.fit_level, 'unknown', 'Phase 1.5: Round 1 fit_level should remain populated');
      assert.notEqual(round1Report.fit_level, 'high', 'Phase 1.5: Round 1 should not present unresolved blockers as a high-fit match');
      assert.equal(
        String(round1Report.recommendation || '').toLowerCase(),
        String(round1Report.fit_level || '').toLowerCase(),
        'Phase 1.5: Round 1 public recommendation should mirror the public fit label',
      );
      assert.equal(
        round1Body.evaluation?.evaluation_result?.recommendation,
        round1Report.recommendation,
        'Phase 1.5: Public report and projected evaluation result should agree on the fit label',
      );
      assert.equal(
        'internal_analysis' in round1Report,
        false,
        'Phase 1.5: Public reports should not expose internal analysis fields',
      );
      assert.notEqual(
        String(round1Report.fit_level || '').toLowerCase(),
        String(round1Body.evaluation?.status || '').toLowerCase(),
        'Phase 1.5: Round 1 fit label and transport status must remain separate concepts',
      );
      assert.equal(
        typeof round1Report.confidence_0_1,
        'number',
        'Phase 1.5: Round 1 confidence should remain a numeric public field',
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

      // ─── Round 2: Proposer response + later-round recipient evaluation ─────────
      const round1SendRes = await sendBackRecipientDraft(initialToken, {}, recipientCookie);
      assert.equal(round1SendRes.statusCode, 200);
      const ownerReturnToken = String(round1SendRes.jsonBody()?.return_link?.token || '');
      assert.notEqual(ownerReturnToken, '', 'Phase 1.5: Owner return token should be created');

      const ownerRoundSaveRes = await saveRecipientDraft(ownerReturnToken, {
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
      assert.equal(ownerRoundSaveRes.statusCode, 200);

      const ownerSendBackRes = await sendBackRecipientDraft(ownerReturnToken, {}, ownerCookie);
      assert.equal(ownerSendBackRes.statusCode, 200);
      const recipientRoundTwoToken = String(ownerSendBackRes.jsonBody()?.return_link?.token || '');
      assert.notEqual(recipientRoundTwoToken, '', 'Phase 1.5: Later-round recipient token should be created');

      const recipientRoundTwoLink = await getSharedLinkRowByToken(recipientRoundTwoToken);
      const recipientRoundTwoMetadata =
        recipientRoundTwoLink?.report_metadata &&
        typeof recipientRoundTwoLink.report_metadata === 'object' &&
        !Array.isArray(recipientRoundTwoLink.report_metadata)
          ? recipientRoundTwoLink.report_metadata
          : {};
      assert.equal(
        recipientRoundTwoMetadata.allow_recipient_ai_review,
        false,
        'Phase 1.5: Later-round recipient links should still default to disabled AI review',
      );

      const recipientRoundTwoSaveRes = await saveRecipientDraft(recipientRoundTwoToken, {
        shared_payload: {
          label: 'Shared Information',
          text: `
            This addresses the material blockers. The 6-month pilot, explicit infrastructure split,
            data ownership reversion, and liability cap give us a workable path.
            We only need final approval routing, legal sign-off timing, and signature logistics to close.
          `,
        },
        recipient_confidential_payload: {
          label: 'Confidential Information',
          notes: `
            Internal: If final approvals stay lightweight, we can move quickly.
            We do not need to reopen pricing if signature timing is clean.
          `,
        },
        workflow_step: 2,
      }, recipientCookie);
      assert.equal(recipientRoundTwoSaveRes.statusCode, 200);

      const blockedLaterRoundEvalRes = await evaluateRecipientDraft(
        recipientRoundTwoToken,
        {},
        recipientCookie,
        { engine: 'v2' },
      );
      assert.equal(blockedLaterRoundEvalRes.statusCode, 403);
      assert.equal(blockedLaterRoundEvalRes.jsonBody()?.error?.code, 'recipient_ai_review_not_enabled');

      const enableLaterRoundReviewRes = await updateSharedReportLink(recipientRoundTwoToken, ownerCookie, {
        allowRecipientAiReview: true,
      });
      assert.equal(enableLaterRoundReviewRes.statusCode, 200);
      assert.equal(enableLaterRoundReviewRes.jsonBody()?.sharedReport?.allow_recipient_ai_review, true);

      const round2EvalRes = await evaluateRecipientDraft(recipientRoundTwoToken, {}, recipientCookie, { engine: 'v2' });
      assert.equal(round2EvalRes.statusCode, 200);
      const round2Body = round2EvalRes.jsonBody();
      assert.equal(round2Body.ok, true);
      assert.equal(Boolean(round2Body.evaluation_id), true);
      assert.equal(round2Body.evaluation?.status, 'success');
      const round2Report = round2Body.evaluation?.public_report || {};

      assert.notEqual(
        round2Report.fit_level,
        'unknown',
        'Phase 1.5: Later-round fit_level should not be unknown (not collapsing to fallback)',
      );
      assert.equal(
        String(round2Report.recommendation || '').toLowerCase(),
        String(round2Report.fit_level || '').toLowerCase(),
        'Phase 1.5: Later-round public recommendation should mirror the public fit label',
      );
      assert.notEqual(
        round2Report.confidence_0_1,
        0.28,
        'Phase 1.5: Later-round confidence should not lock at 0.28 (no stale-question collapse)',
      );
      assert.equal(
        'internal_analysis' in round2Report,
        false,
        'Phase 1.5: Later-round public report should not expose internal analysis fields',
      );
      assert.equal(
        typeof round2Report.confidence_0_1,
        'number',
        'Phase 1.5: Later-round confidence should remain a numeric public field',
      );
      assert.equal(
        round2Report.bilateral_round_number,
        2,
        'Phase 1.5: Later-round should have bilateral_round_number=2',
      );
      assert.equal(
        Array.isArray(round2Report.remaining_deltas),
        true,
        'Phase 1.5: Later-round should retain bilateral delta metadata even when fallback projection is used',
      );

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

      assert.equal(passBCount >= 2, true, 'Phase 1.5: Both rounds should complete the V2 mediation review pass');
      assert.equal(
        String(round1Report.why || []).length > 0,
        true,
        'Phase 1.5: Round 1 should have substantive why content',
      );
      assert.notEqual(
        String(round2Report.recommendation || '').toLowerCase(),
        String(round2Body.evaluation?.status || '').toLowerCase(),
        'Phase 1.5: Public fit label and transport status must remain separate concepts',
      );

    // ─── Workspace verification ────────────────────────────────────────────
    const workspaceRes = await getRecipientWorkspace(recipientRoundTwoToken, recipientCookie);
    assert.equal(workspaceRes.statusCode, 200);
    const workspace = workspaceRes.jsonBody();
    assert.equal(
      workspace.latestReport?.bilateral_round_number || workspace.latestEvaluation?.public_report?.bilateral_round_number || 0,
      2,
    );

    console.log('✅ Phase 1.5 Integration Verification Passed');
    console.log(`   ✓ Later-round fit label stayed separate from transport status (fit_level: ${round2Report.fit_level})`);
    console.log(`   ✓ Confidence not locked (round 2: ${round2Report.confidence_0_1}, vs 0.28)`);
    console.log(`   ✓ Later-round bilateral metadata persisted (round ${round2Report.bilateral_round_number})`);
    console.log(`   ✓ No confidential fallback positions leaked`);
    console.log(`   ✓ Initial review quality remained structured (Round 1 confidence: ${round1Report.confidence_0_1})`);
    } finally {
      cleanup();
      if (previousMediationProvider === undefined) {
        delete process.env.MEDIATION_AI_PROVIDER;
      } else {
        process.env.MEDIATION_AI_PROVIDER = previousMediationProvider;
      }
    }
  });
}
