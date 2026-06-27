import assert from 'node:assert/strict';
import test from 'node:test';
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

const EXPECTED_MEDIATION_PROVIDER = 'openai';
const EXPECTED_MEDIATION_MODEL = 'gpt-5.4';

process.env.MEDIATION_AI_PROVIDER = EXPECTED_MEDIATION_PROVIDER;
process.env.MEDIATION_AI_MODEL = EXPECTED_MEDIATION_MODEL;

function mockOpenAIV2Call(mockFn) {
  const previous = globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
  globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = mockFn;
  return () => {
    if (previous === undefined) {
      delete globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_OPENAI_EVAL_V2_CALL__ = previous;
    }
  };
}

function buildReferralOpenAIV2Mock() {
  return async ({ prompt, preferredModel }) => {
    const normalizedPrompt = String(prompt || '');
    const model = String(preferredModel || EXPECTED_MEDIATION_MODEL);
    const isLeakVerifierPrompt = normalizedPrompt.includes('strict security auditor');
    if (isLeakVerifierPrompt) {
      return {
        model,
        text: JSON.stringify({
          leak: false,
          reason: 'No confidential material appears in the response.',
        }),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }

    const isPassBPrompt =
      normalizedPrompt.includes('Required JSON schema (top-level evaluation keys required') ||
      normalizedPrompt.includes('INITIAL REPORT TO REFINE:');
    const isLaterBilateralRound =
      normalizedPrompt.includes('prior_bilateral_context') ||
      normalizedPrompt.includes('"current_bilateral_round_number": 2');

    if (!isPassBPrompt) {
      return {
        model,
        text: JSON.stringify({
          project_goal: 'Agree a referral partnership with registered attribution instead of broad exclusivity.',
          scope_deliverables: [
            'Registered-referral process',
            'Commission payment terms',
            'Client attribution and protection rules',
          ],
          timeline: {
            start: 'After signature',
            duration: '2-year agreement with annual renewal',
            milestones: ['Referral registration launch', 'Quarterly business review cadence'],
          },
          constraints: [
            'No broad territory exclusivity outside registered prospects.',
            'Commission entitlement must be documented and dispute-ready.',
          ],
          success_criteria_kpis: [
            'Registered referrals are accepted through a documented process.',
            'Commission payment timing and attribution evidence are contractable.',
          ],
          vendor_preferences: [],
          assumptions: [
            'Both sides still want an active channel relationship with recurring commissions.',
          ],
          risks: [
            {
              risk: 'Unclear referral attribution could trigger commission disputes.',
              impact: 'high',
              likelihood: 'med',
            },
          ],
          open_questions: [
            'How is a referral formally registered and timestamped?',
            'What evidence resolves commission disputes or attribution challenges?',
          ],
          missing_info: [
            'Referral registration mechanics and commission-attribution evidence remain open.',
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

    if (!isLaterBilateralRound) {
      return {
        model,
        text: JSON.stringify({
          analysis_stage: 'mediation_review',
          fit_level: 'medium',
          confidence_0_1: 0.67,
          why: [
            'Recommendation: Proceed with conditions because both sides support an ongoing referral relationship, but the current draft still leaves exclusivity scope, referral registration mechanics, and commission entitlement exposed to dispute.',
            'Where the Parties Align: They appear aligned on a recurring commission structure, interest in co-sell support, and the basic idea that qualified referrals should be rewarded over time.',
            'Where the Deal Is Stuck: Broad territory exclusivity, unclear qualified-prospect rules, and ambiguous client attribution create too much room for later disagreement about who owns the referral and when commission is earned.',
            'Suggested Bridge: Replace broad exclusivity with a registered-referral model, define what counts as a qualified prospect, and document the evidence trail for attribution, payment timing, and dispute resolution.',
            'Next Step: Confirm registration mechanics, attribution evidence, and commission-trigger language so the parties can keep the relationship flexible without sacrificing referral protection.',
          ],
          missing: [
            'How is a registered referral submitted and time-stamped? — determines whether attribution can be enforced without exclusivity.',
            'What evidence resolves commission disputes or client-attribution overlap? — determines whether payment entitlement is contractable.',
            'What exact criteria define a qualified prospect? — determines when the recurring commission is earned.',
          ],
          redactions: [],
        }),
        finishReason: 'STOP',
        httpStatus: 200,
      };
    }

    return {
      model,
      text: JSON.stringify({
        analysis_stage: 'mediation_review',
        fit_level: 'high',
        confidence_0_1: 0.82,
        why: [
          'Recommendation: Proceed with conditions because the later-round revisions have addressed the broad exclusivity dispute and converted the deal into a more workable registered-referral structure, with only attribution proof and payment operations left to close.',
          'Where the Parties Align: They now appear aligned on no broad exclusivity, a 15% recurring commission, a shorter termination window, and a documented co-sell relationship with implementation access.',
          'Where the Deal Is Stuck: The remaining friction is no longer territory control. It is now about referral registration evidence, qualified-prospect thresholds, commission payment timing, and how attribution disputes are resolved when multiple channels touch the same account.',
          'Suggested Bridge: Keep the registered-referral compromise, define the exact registration workflow, spell out attribution evidence in the CRM, and record the payment timetable and dispute window tied to commission calculations.',
          'Next Step: Finalize the registration form, attribution proof standard, qualified-referral definition, and monthly commission-payment process so the revised structure can be executed cleanly.',
        ],
        missing: [
          'What exact registration record locks in attribution for a referred account? — determines whether the registered-referral compromise is enforceable.',
          'What evidence and timing govern commission payment after a referral closes? — determines whether payment entitlement is operationally clear.',
          'How are qualified-referral disputes escalated and resolved? — determines whether the parties can manage overlap without reopening exclusivity.',
        ],
        redactions: [],
      }),
      finishReason: 'STOP',
      httpStatus: 200,
    };
  };
}

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
    query: { token, engine: 'v2' },
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

async function getSharedReportEvaluationDiagnostics(evaluationId) {
  const db = getDb();
  const rows = await db.execute(
    sql`select result_json
        from shared_report_evaluation_runs
        where id = ${evaluationId}
        limit 1`,
  );
  return rows.rows[0]?.result_json?.evaluation_diagnostics || {};
}

/**
 * Phase 2 Fixture: Referral/Channel Partnership
 *
 * Provider alignment note:
 * This fixture exercises `shared-report/[token]/evaluate` mediation review,
 * and validates OpenAI / gpt-5.4 behavior when provider is configured.
 *
 * Tests negotiation around referral attribution, commission structure, exclusivity,
 * and client ownership. Exercises distinct mediation patterns vs. SaaS/demand-forecasting:
 * - Movement from broad exclusivity toward registered-referral compromise
 * - Stale question pruning around exclusivity (resolved) + refreshed attribution questions
 * - Landing zone specific to referral mechanics (commission rate, vesting, protection period)
 */
test('Phase 2: Referral/channel mediation (shared-report OpenAI/gpt-5.4 path)', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const proposerCookie = makeOwnerCookie('phase2_referral_channel');
  const proposerEmail = 'phase2_referral_channel_owner@example.com';
  const recipientEmail = 'partner@test.com';
  const recipientCookie = makeRecipientCookie('phase2_referral_channel', recipientEmail);
  const restoreOpenAICall = mockOpenAIV2Call(buildReferralOpenAIV2Mock());

  try {
    // ─── Round 1: Initial referral partnership proposal ────────────────
    const comparison = await createComparison(proposerCookie, {
      title: 'Referral/Channel Partnership - B2B SaaS',
      docAText: `
        We propose a strategic partnership where you serve as our exclusive referral partner
        in your region (Southeast US). You identify qualified prospects and earn 15% recurring
        commission on all referred customers.

        PARTNERSHIP STRUCTURE:
        - Exclusive territory: Southeast US (GA, FL, NC, SC, VA)
        - Commission: 15% of ARR per referral
        - Commission duration: For the life of the customer (recurring)
        - Ramp: First 3 months at 12%, then 15% ongoing
        - Client ownership: We own the direct relationship; you own the referral
        - Exclusivity: Territory exclusive; you cannot refer to competitors
        - Agreement term: 3 years with automatic renewal
        - Kill-switch: Either party can terminate with 90 days notice
      `,
      docBText: `
        Thank you for the proposal. We are interested in exploring this partnership, but have
        several concerns about the structure.

        ALIGNMENT:
        - We support the referral commission model in principle
        - 15% commission rate is reasonable for ongoing support

        CONCERNS:
        - Exclusivity for 3 years locks us into a single vendor; what if we find better partners?
        - "Exclusive territory" prevents us from referring to adjacent markets or verticals
        - How is "qualified prospect" defined? Risk of disputes over commission eligibility
        - Client ownership with us as referral source feels asymmetric; can we get co-marketing?
        - 90-day termination window is too long; we need flexibility to exit earlier
        - Ramp structure (12% → 15%) creates payment unpredictability in first 90 days

        QUESTIONS:
        - Can we move to a "registered referral" model where we register clients upfront
          and lock in commissions, rather than having exclusivity?
        - What happens to existing prospects we've already discussed with your team?
        - Can we get direct access to your implementation team for co-sell opportunities?
        - What is the process for disputing commission calculations?
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
          label: 'Partnership Response',
          text: `
            Thank you for the partnership proposal. We are interested in exploring this opportunity
            but have several strategic concerns about the structure.

            ALIGNMENT:
            - We support the 15% recurring commission model
            - We value your implementation team's expertise

            KEY CONCERNS:
            - Exclusivity for 3 years is too restrictive; we work with multiple partners in adjacent spaces
            - "Qualified prospect" definition needs clarity to prevent commission disputes
            - Client ownership structure feels asymmetric
            - 90-day termination window is longer than we prefer
            - Ramp-up (12% → 15%) creates inconsistent payout structure

            PROPOSED CHANGES:
            - Move from exclusive territory to registered-referral model:
              Register prospects upfront, lock in 15% commission, no exclusivity outside registered scope
            - Shorten termination window to 30 days
            - Streamline co-sell opportunities with quarterly business reviews
            - Define "qualified prospect" with specific qualification criteria
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
    const round1Diagnostics = await getSharedReportEvaluationDiagnostics(round1Body.evaluation_id);
    assert.equal(
      String(round1Diagnostics.provider || '').toLowerCase(),
      EXPECTED_MEDIATION_PROVIDER,
      'Round 1 shared-report evaluate should use OpenAI mediation provider (not Vertex default)',
    );
    assert.equal(
      String(round1Diagnostics.model || '').toLowerCase().includes(EXPECTED_MEDIATION_MODEL),
      true,
      `Round 1 shared-report evaluate should report ${EXPECTED_MEDIATION_MODEL} as mediation model`,
    );

    const round1Report = round1Body.evaluation?.public_report || {};

    // ─── Phase 2 Assertion 1: Round 1 identifies referral mechanics concerns ───
    const round1Summary = String(round1Report.executive_summary || round1Report.why || []).toLowerCase();
    const hasReferralConcerns =
      round1Summary.includes('exclusivity') ||
      round1Summary.includes('territory') ||
      round1Summary.includes('commission') ||
      round1Summary.includes('registered');

    assert.equal(
      hasReferralConcerns,
      true,
      'Phase 2: Round 1 should identify referral-specific concerns (exclusivity, territory, commission)',
    );

    console.log('✅ Round 1 evaluation completed');
    // ─── Round 2: exchange continuation via send-back return link ─────────
    const sendRes = await sendBackRecipientDraft(token, recipientCookie);
    assert.equal(sendRes.statusCode, 200, 'Round 1 send-back should succeed for invited recipient');
    const sendBody = sendRes.jsonBody() || {};
    assert.equal(
      String(sendBody.return_link?.recipient_email || ''),
      proposerEmail,
      'Round 2 return link should hand control back to the proposer email',
    );
    const round2Token = String(sendBody.return_link?.token || sendBody.returnLinkToken || '');
    assert.notEqual(round2Token, '', 'Round 2 token should be present after send-back');

    const round2Payload = {
      shared_payload: {
        label: 'Proposer Response',
        text: `
            Thank you for your detailed feedback. We have revised our partnership structure
            to address your concerns around exclusivity and flexibility.

            REVISED PARTNERSHIP TERMS:

            REFERRAL MODEL:
            - Moving from exclusive territory to registered-referral model as you proposed
            - Partners register prospects upfront in our CRM
            - Once registered, 15% commission is locked in regardless of how we acquire the customer
            - No exclusivity requirements—you can work with our competitors
            - Co-ownership: Registered prospects show in our system as your referrals

            COMMISSION STRUCTURE:
            - 15% recurring commission on all registered referrals (no ramp-up)
            - Commissions paid monthly upon invoice (net 30)
            - Commission disputes resolved within 14 days via CRM records

            TERM & TERMINATION:
            - Agreement term: 2 years (vs. 3 years), automatic renewal annually
            - Either party can terminate with 30 days written notice (vs. 90 days)
            - Existing prospect pipeline: Any prospect you've discussed with us before signature
              is automatically credited as a registered referral

            CO-SELL & SUPPORT:
            - Quarterly business reviews with implementation team
            - Co-marketing: Logo usage, case study opportunities, joint webinar rights
            - Direct integration access: API documentation and technical POC support

            QUALIFICATION FRAMEWORK:
            - Qualified prospect = company profile match + budget confirmation + decision timeline
            - We will provide qualification template before engagement
        `,
      },
      workflow_step: 2,
    };

    const round2SaveRes = await saveRecipientDraft(round2Token, proposerCookie, round2Payload);
    assert.equal(round2SaveRes.statusCode, 200, 'Round 2 draft save should succeed');

    // Evaluate Round 2 (later-round mediation)
    const round2EvalRes = await evaluateRecipientDraft(round2Token, proposerCookie);
    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');

    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.evaluation_id, 'Round 2 evaluation ID should be present');
    const round2Diagnostics = await getSharedReportEvaluationDiagnostics(round2Body.evaluation_id);
    assert.equal(
      String(round2Diagnostics.provider || '').toLowerCase(),
      EXPECTED_MEDIATION_PROVIDER,
      'Round 2 shared-report evaluate should use OpenAI mediation provider (not Vertex default)',
    );
    assert.equal(
      String(round2Diagnostics.model || '').toLowerCase().includes(EXPECTED_MEDIATION_MODEL),
      true,
      `Round 2 shared-report evaluate should report ${EXPECTED_MEDIATION_MODEL} as mediation model`,
    );

    const round2Report = round2Body.evaluation?.public_report || {};
    const round2Summary = String(round2Report.executive_summary || round2Report.why || []).toLowerCase();

    // ─── Phase 2 Assertion 2: Movement from exclusivity to registered-referral ───
    const hasMovementLanguage =
      round2Summary.includes('addressed') ||
      round2Summary.includes('revised') ||
      round2Summary.includes('converged') ||
      round2Summary.includes('narrowed') ||
      round2Summary.includes('progress') ||
      round2Summary.includes('closer') ||
      round2Summary.includes('alignment');

    assert.equal(
      hasMovementLanguage,
      true,
      'Phase 2: Later-round should detect movement from broad exclusivity toward registered-referral compromise',
    );

    // ─── Phase 2 Assertion 3: Stale exclusivity questions pruned, new questions refreshed ───
    const round2Missing = round2Report.missing || round2Report.why || [];
    const round2MissingText = String(round2Missing).toLowerCase();

    // Stale question pruned: exclusivity should NOT be asked again (already resolved)
    const hasStaleExclusivityQuestion =
      round2MissingText.includes('exclusive') && round2MissingText.includes('territory');

    assert.equal(
      hasStaleExclusivityQuestion,
      false,
      'Phase 2: Later-round should NOT repeat exclusivity questions (stale pruning)',
    );

    // New questions refreshed: should focus on registered-referral specifics
    const hasRegisteredReferralQuestions =
      round2MissingText.includes('registration') ||
      round2MissingText.includes('register') ||
      round2MissingText.includes('attribution') ||
      round2MissingText.includes('qualified') ||
      round2MissingText.includes('commission') ||
      round2MissingText.includes('payment');

    const hasAttributionPaymentSignals =
      round2Summary.includes('attribution') ||
      round2Summary.includes('commission') ||
      round2Summary.includes('payment') ||
      round2Summary.includes('register');

    assert.equal(
      hasRegisteredReferralQuestions || hasAttributionPaymentSignals,
      true,
      'Phase 2: Later-round should refresh around attribution/payment entitlement for referral mechanics',
    );

    // Note: This assertion may fail with real API if output doesn't mention registered-referral specifics
    // We expect this might need backend/prompt tuning
    console.log('Phase 2 Fixture - Round 2 Questions:');
    console.log('  Missing items:', round2Missing);
    console.log('  Has registered-referral specifics:', hasRegisteredReferralQuestions);

    // ─── Phase 2 Assertion 4: Landing zone specific to referral mechanics ───
    const hasReferralLandingZone =
      round2Summary.includes('15%') ||
      round2Summary.includes('commission') ||
      round2Summary.includes('30 days') ||
      round2Summary.includes('registered') ||
      round2Summary.includes('referral');

    assert.equal(
      hasReferralLandingZone,
      true,
      'Phase 2: Later-round should reference referral mechanics in landing zone (commission, registration, terms)',
    );

    // ─── Phase 2 Assertion 5: Confidence not collapsed ───
    const round2Confidence = round2Report.confidence_score || round2Report.confidence_0_1;
    if (round2Confidence !== undefined) {
      const confidenceValue = typeof round2Confidence === 'string' ? parseFloat(round2Confidence) : round2Confidence;
      assert.ok(
        confidenceValue >= 0.4 || round2Report.recommendation !== 'unknown',
        'Phase 2: Later-round confidence should not collapse to unknown/0.2',
      );
    }

    console.log('✅ Phase 2 Referral/Channel Fixture PASSED');
    console.log(`   Round 1 Evaluation ID: ${round1Body.evaluation_id}`);
    console.log(`   Round 2 Evaluation ID: ${round2Body.evaluation_id}`);
    console.log(`   Comparison ID: ${comparison_id}`);
    console.log('   Movement detected: broad exclusivity → registered-referral');
    console.log('   Referral mechanics properly identified in landing zone');
  } catch (error) {
    console.error('Phase 2 referral/channel fixture error:', error.message);
    throw error;
  } finally {
    restoreOpenAICall();
  }
});
