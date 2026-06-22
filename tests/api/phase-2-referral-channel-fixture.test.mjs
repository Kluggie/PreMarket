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
 * Phase 2 Fixture: Referral/Channel Partnership
 *
 * Tests negotiation around referral attribution, commission structure, exclusivity,
 * and client ownership. Exercises distinct mediation patterns vs. SaaS/demand-forecasting:
 * - Movement from broad exclusivity toward registered-referral compromise
 * - Stale question pruning around exclusivity (resolved) + refreshed attribution questions
 * - Landing zone specific to referral mechanics (commission rate, vesting, protection period)
 */
test('Phase 2: Referral/channel partnership negotiation with movement from exclusivity to registered-referral', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const proposerCookie = makeOwnerCookie('phase2_referral_channel');
  const recipientEmail = 'partner@test.com';
  const recipientCookie = makeRecipientCookie('phase2_referral_channel', recipientEmail);

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
    let round2Token = '';
    let sendRes = await sendBackRecipientDraft(token, recipientCookie);
    if (sendRes.statusCode !== 200) {
      // Some environments only allow send-back under owner auth.
      sendRes = await sendBackRecipientDraft(token, proposerCookie);
    }
    if (sendRes.statusCode === 200) {
      const sendBody = sendRes.jsonBody() || {};
      round2Token = String(sendBody.return_link?.token || sendBody.returnLinkToken || '');
    }
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

    let round2SaveRes = await saveRecipientDraft(round2Token, proposerCookie, round2Payload);
    let round2EvalCookie = proposerCookie;
    if (round2SaveRes.statusCode >= 500) {
      round2SaveRes = await saveRecipientDraft(round2Token, proposerCookie, round2Payload);
    }
    if (round2SaveRes.statusCode !== 200) {
      round2SaveRes = await saveRecipientDraft(round2Token, recipientCookie, round2Payload);
      round2EvalCookie = recipientCookie;
    }
    assert.equal(round2SaveRes.statusCode, 200, 'Round 2 draft save should succeed');

    // Evaluate Round 2 (later-round mediation)
    const round2EvalRes = await evaluateRecipientDraft(round2Token, round2EvalCookie);
    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');

    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.evaluation_id, 'Round 2 evaluation ID should be present');

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
  }
});
