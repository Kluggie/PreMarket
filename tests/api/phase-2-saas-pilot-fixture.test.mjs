import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

const EXPECTED_MEDIATION_PROVIDER = 'openai';
const EXPECTED_MEDIATION_MODEL = 'gpt-5.4';
const EXPECTED_COMPARISON_PROVIDER = 'vertex';
const EXPECTED_COMPARISON_MODEL_HINT = 'gemini';

process.env.MEDIATION_AI_PROVIDER = EXPECTED_MEDIATION_PROVIDER;
process.env.MEDIATION_AI_MODEL = EXPECTED_MEDIATION_MODEL;

/**
 * Provider alignment note:
 * This fixture currently exercises `document-comparisons/[id]/evaluate`,
 * which validates the Stage 1 shared-intake Vertex/Gemini path here.
 * It is not an OpenAI mediation-review route validation.
 */

function makeOwnerCookie(seed) {
  return makeSessionCookie({
    sub: `${seed}_owner`,
    email: `${seed}_owner@example.com`,
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

async function evaluateComparison(cookie, comparisonId, body = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/document-comparisons/${comparisonId}/evaluate`,
    headers: { cookie },
    query: { id: comparisonId, engine: 'v2' },
    body,
  });
  const res = createMockRes();
  await documentComparisonsEvaluateHandler(req, res, comparisonId);
  return res;
}

async function evaluateComparisonWithRetry(cookie, comparisonId, body = {}, maxAttempts = 2) {
  let lastRes = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await evaluateComparison(cookie, comparisonId, body);
    lastRes = res;
    if (res.statusCode < 500) {
      return res;
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return lastRes;
}

function textBlob(report) {
  return JSON.stringify(report || {}).toLowerCase();
}

test('Phase 2: SaaS pilot negotiation (document-comparisons Stage 1 / Vertex-Gemini path)', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const ownerCookie = makeOwnerCookie('phase2_saas_pilot');

  try {
    const comparison = await createComparison(ownerCookie, {
      title: 'SaaS Pilot - Revenue Operations Workflow Platform',
      docAText: `
        We offer a B2B SaaS platform for revenue operations workflow automation.

        INITIAL OFFER:
        - Teams can start with a pilot before full subscription
        - We support implementation with onboarding and training
        - Standard annual subscription is available after pilot
        - Product includes CRM sync, workflow routing, and analytics dashboards
      `,
      docBText: `
        We are interested, but right now this feels like "let us try it and see" rather than a pilot structure.

        CURRENT BUYER POSITION:
        - We are open to piloting before a full subscription commitment
        - We need clarity on what departments and users are included in pilot scope
        - We need pilot duration and timeline
        - We need pilot pricing details versus standard subscription pricing
        - We need measurable success criteria to decide go/no-go
        - We need responsibility split for onboarding, integrations, and support
        - We need explicit data-access and system integration requirements
        - We need conversion, non-conversion, and termination rules
        - We need expansion path if pilot succeeds
      `,
    });

    const comparisonId = comparison.id;
    assert.ok(comparisonId, 'Comparison ID should be returned');

    const round1EvalRes = await evaluateComparisonWithRetry(ownerCookie, comparisonId, {});
    assert.equal(round1EvalRes.statusCode, 200, 'Round 1 evaluation should succeed');
    const round1Body = round1EvalRes.jsonBody();
    assert.ok(round1Body.request_id, 'Round 1 request ID should be present');
    assert.equal(
      String(round1Body.evaluation_provider || '').toLowerCase(),
      EXPECTED_COMPARISON_PROVIDER,
      'Round 1 document-comparisons evaluation should use Vertex provider',
    );
    assert.equal(
      String(round1Body.evaluation_model || '').toLowerCase().includes(EXPECTED_COMPARISON_MODEL_HINT),
      true,
      'Round 1 document-comparisons evaluation should report a Gemini model',
    );

    const round1Report = round1Body.evaluation || {};
    const round1Text = textBlob(round1Report);
    const hasRound1PilotSignals =
      round1Text.includes('pilot') ||
      round1Text.includes('trial') ||
      round1Text.includes('scope') ||
      round1Text.includes('success criteria') ||
      round1Text.includes('pricing');

    assert.equal(
      hasRound1PilotSignals,
      true,
      'Phase 2 SaaS pilot: Round 1 should identify pilot/trial structuring concerns',
    );

    const round2EvalRes = await evaluateComparisonWithRetry(ownerCookie, comparisonId, {
      docBText: `
        We revised the proposal into a structured paid pilot with explicit conversion path.

        PILOT SCOPE:
        - Departments: RevOps and Sales Operations (initial)
        - Users: 35 named users across two regions
        - Locations: US-East and EMEA pilot teams
        - Modules: workflow routing, CRM sync, and executive dashboard package

        PILOT DURATION:
        - 12-week pilot
        - Week 1-2 onboarding and integration setup
        - Week 3-10 active usage and workflow optimization
        - Week 11-12 scorecard review and conversion decision

        PILOT PRICING:
        - Paid pilot fee: $18,000 total for 12 weeks
        - Includes onboarding support and integration assistance
        - Optional additional training billed separately

        SUCCESS CRITERIA:
        - 20% reduction in lead-routing cycle time
        - 15% improvement in SLA compliance for handoffs
        - 80% weekly active use across named users
        - Executive sponsor approval of pilot scorecard

        IMPLEMENTATION AND SUPPORT RESPONSIBILITIES:
        - Vendor: onboarding plan, admin training, integration guidance, weekly office hours
        - Buyer: system admin owner, internal process mapping, user enablement attendance
        - Joint: weekly checkpoint with action log and issue resolution owner

        DATA ACCESS AND INTEGRATION REQUIREMENTS:
        - Read/write API access to CRM sandbox during pilot
        - Access to workflow event logs and historical routing data
        - SSO configuration and role-based permissions setup
        - Security review completed before go-live

        CONVERSION AND NON-CONVERSION RULES:
        - If success criteria are met, pilot converts to annual subscription on day 90
        - Standard subscription pricing: $96,000 annual platform fee + support tier
        - If criteria are partially met, parties may run a 6-week extension with narrowed scope
        - If criteria are not met, pilot ends with no renewal obligation and data export package
        - Either party may terminate for material breach with 15-day cure period

        EXPANSION PATH AFTER PILOT:
        - Phase 2 rollout to Customer Success and Finance Ops teams
        - Expand from 35 to 120 users in two deployment waves
        - Optional advanced analytics module after first quarter of subscription
      `,
      draftStep: 3,
    });

    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');
    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.request_id, 'Round 2 request ID should be present');
    assert.equal(
      String(round2Body.evaluation_provider || '').toLowerCase(),
      EXPECTED_COMPARISON_PROVIDER,
      'Round 2 document-comparisons evaluation should use Vertex provider',
    );
    assert.equal(
      String(round2Body.evaluation_model || '').toLowerCase().includes(EXPECTED_COMPARISON_MODEL_HINT),
      true,
      'Round 2 document-comparisons evaluation should report a Gemini model',
    );

    const round2Report = round2Body.evaluation || {};
    const round2Text = textBlob(round2Report);

    const hasMovementLanguage =
      round2Text.includes('progress') ||
      round2Text.includes('structured') ||
      round2Text.includes('defined') ||
      round2Text.includes('narrowed') ||
      round2Text.includes('addressed');
    assert.equal(
      hasMovementLanguage,
      true,
      'Phase 2 SaaS pilot: Later-round should detect movement from vague trial interest to structured pilot terms',
    );

    assert.equal(
      round2Text.includes('12-week') || round2Text.includes('12 week') || round2Text.includes('pilot duration') || round2Text.includes('trial period'),
      true,
      'Phase 2 SaaS pilot: output should include pilot duration/trial period signals',
    );
    assert.equal(
      round2Text.includes('scope') || round2Text.includes('users') || round2Text.includes('departments') || round2Text.includes('locations'),
      true,
      'Phase 2 SaaS pilot: output should include pilot scope/users/departments/locations signals',
    );
    assert.equal(
      round2Text.includes('success criteria') || round2Text.includes('outcome') || round2Text.includes('scorecard') || round2Text.includes('metrics'),
      true,
      'Phase 2 SaaS pilot: output should include measurable success criteria signals',
    );
    assert.equal(
      round2Text.includes('pilot fee') ||
        round2Text.includes('pilot pricing') ||
        round2Text.includes('$18,000') ||
        round2Text.includes('discounted') ||
        round2Text.includes('paid pilot') ||
        (round2Text.includes('pilot') &&
          (round2Text.includes('pricing') ||
            round2Text.includes('price') ||
            round2Text.includes('fee') ||
            round2Text.includes('commercial'))),
      true,
      'Phase 2 SaaS pilot: output should include pilot pricing signals',
    );
    assert.equal(
      round2Text.includes('annual subscription') || round2Text.includes('standard subscription pricing') || round2Text.includes('$96,000') || round2Text.includes('converts'),
      true,
      'Phase 2 SaaS pilot: output should include standard subscription pricing after pilot signals',
    );
    assert.equal(
      round2Text.includes('onboarding') || round2Text.includes('implementation') || round2Text.includes('support') || round2Text.includes('office hours'),
      true,
      'Phase 2 SaaS pilot: output should include implementation/onboarding/support responsibility signals',
    );
    assert.equal(
      round2Text.includes('data access') || round2Text.includes('integration') || round2Text.includes('api') || round2Text.includes('sso'),
      true,
      'Phase 2 SaaS pilot: output should include data access/integration requirement signals',
    );
    assert.equal(
      round2Text.includes('conversion') || round2Text.includes('termination') || round2Text.includes('non-conversion') || round2Text.includes('renewal'),
      true,
      'Phase 2 SaaS pilot: output should include conversion/termination/non-conversion rule signals',
    );
    const hasExplicitExpansionSignal =
      round2Text.includes('expand') ||
      round2Text.includes('expansion') ||
      round2Text.includes('rollout') ||
      round2Text.includes('phase 2') ||
      round2Text.includes('120 users') ||
      round2Text.includes('scale') ||
      round2Text.includes('broader deployment') ||
      round2Text.includes('additional teams') ||
      round2Text.includes('next phase');
    const hasPostPilotPathSignal =
      (round2Text.includes('after pilot') || round2Text.includes('post-pilot') || round2Text.includes('after the pilot')) &&
      (round2Text.includes('subscription') || round2Text.includes('rollout') || round2Text.includes('deployment') || round2Text.includes('scale'));
    const hasConversionScaleSignal =
      (round2Text.includes('convert') || round2Text.includes('conversion')) &&
      (round2Text.includes('annual subscription') || round2Text.includes('standard subscription'));
    assert.equal(
      hasExplicitExpansionSignal || hasPostPilotPathSignal || hasConversionScaleSignal,
      true,
      'Phase 2 SaaS pilot: output should include expansion path signals',
    );

    const hasStaleBroadQuestions =
      /\bwhat is the pilot for\b/.test(round2Text) ||
      /\bwhat (?:is|are) the pilot pricing details\b/.test(round2Text) ||
      /\bwho will be involved(?: in the pilot)?\b/.test(round2Text);
    assert.equal(
      hasStaleBroadQuestions,
      false,
      'Phase 2 SaaS pilot: Later-round should not keep broad early-stage questions once details are provided',
    );

    const hasSpecificLaterQuestions =
      round2Text.includes('usage or outcome metrics') ||
      round2Text.includes('partially met') ||
      round2Text.includes('convert to') ||
      round2Text.includes('owns onboarding') ||
      round2Text.includes('data access');
    assert.equal(
      hasSpecificLaterQuestions,
      true,
      'Phase 2 SaaS pilot: Later-round should refresh to specific operational/commercial close questions',
    );

    const hasWrongDealFraming =
      round2Text.includes('referral') ||
      round2Text.includes('channel partner') ||
      round2Text.includes('reseller') ||
      round2Text.includes('exclusive territory') ||
      round2Text.includes('consulting engagement') ||
      round2Text.includes('statement of work') ||
      round2Text.includes('data sharing partnership') ||
      round2Text.includes('generic partnership') ||
      round2Text.includes('free trial only');

    assert.equal(
      hasWrongDealFraming,
      false,
      'Phase 2 SaaS pilot: output should not primarily frame this as referral/consulting/data-sharing/reseller/generic or unstructured free-trial deal',
    );

    console.log('✅ Phase 2 SaaS Pilot Fixture PASSED');
    console.log(`   Round 1 Request ID: ${round1Body.request_id}`);
    console.log(`   Round 2 Request ID: ${round2Body.request_id}`);
    console.log(`   Comparison ID: ${comparisonId}`);
  } catch (error) {
    console.error('Phase 2 SaaS pilot fixture error:', error.message);
    throw error;
  }
});
