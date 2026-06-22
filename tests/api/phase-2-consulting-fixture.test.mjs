import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

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
    query: { id: comparisonId },
    body,
  });
  const res = createMockRes();
  await documentComparisonsEvaluateHandler(req, res, comparisonId);
  return res;
}

function textBlob(report) {
  return JSON.stringify(report || {}).toLowerCase();
}

test('Phase 2: Consulting/services negotiation moves from broad advisory support to structured scoped engagement', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip();
    return;
  }

  await resetTables();
  await ensureMigrated();

  const ownerCookie = makeOwnerCookie('phase2_consulting');

  try {
    const comparison = await createComparison(ownerCookie, {
      title: 'Consulting Engagement - Analytics Workflow Improvement',
      docAText: `
        We propose a consulting engagement to help your operations and analytics teams improve
        workflow automation, reporting, and AI-assisted decision support.

        INITIAL CONSULTING MODEL:
        - Broad advisory support across analytics operations, tooling, and team processes
        - Flexible timeline based on stakeholder availability and evolving discovery
        - Blended strategy + implementation support
        - Milestone payments tied generally to project phases
        - Consultant-led recommendations, playbooks, and working sessions
        - Scope may expand as new optimization opportunities are identified
        - Handover to be defined during the engagement
      `,
      docBText: `
        We are interested in external support, but the current consulting structure is too open-ended.

        BUYER CONCERNS:
        - Scope is too broad; we need a defined workplan and clear boundaries
        - Deliverables are not concrete enough for internal approval
        - The timeline is flexible, but we need milestones for budgeting and staffing
        - Payment tied loosely to phases is not sufficient; we need objective milestone triggers
        - Acceptance criteria for each deliverable are missing
        - No clear process exists for change requests or out-of-scope work
        - Ownership and handover responsibilities are not defined
        - We do not want this to become indefinite advisory work without measurable outputs

        INITIAL QUESTIONS:
        - What exact deliverables would you provide in the first phase?
        - What responsibilities remain with our internal team versus your consultants?
        - How will overruns, extra workshops, or scope changes be handled?
        - What are the acceptance criteria for each delivery milestone?
      `,
    });

    const comparisonId = comparison.id;
    assert.ok(comparisonId, 'Comparison ID should be returned');

    const round1EvalRes = await evaluateComparison(ownerCookie, comparisonId, {});
    assert.equal(round1EvalRes.statusCode, 200, 'Round 1 evaluation should succeed');
    const round1Body = round1EvalRes.jsonBody();
    assert.ok(round1Body.request_id, 'Round 1 request ID should be present');

    const round1Report = round1Body.evaluation || round1Body.evaluation?.public_report || {};
    const round1Text = textBlob(round1Report);
    const hasRound1ConsultingSignals =
      round1Text.includes('scope') ||
      round1Text.includes('deliverable') ||
      round1Text.includes('milestone') ||
      round1Text.includes('acceptance') ||
      round1Text.includes('change');

    assert.equal(
      hasRound1ConsultingSignals,
      true,
      'Phase 2 consulting: Round 1 should identify services-style concerns around scope, deliverables, milestones, and acceptance',
    );

    console.log('✅ Round 1 evaluation completed');

    const round2EvalRes = await evaluateComparison(ownerCookie, comparisonId, {
      docBText: `
        We revised the engagement into a defined consulting services structure in response to the buyer's concerns.

        PHASE 1 SCOPE:
        - Current-state analytics workflow assessment
        - Stakeholder interviews across reporting, operations, and planning
        - Future-state workflow design for KPI reporting and exception handling
        - Dashboard requirements specification
        - Implementation playbook with role-based handoff instructions

        DELIVERABLES:
        - Workflow assessment memo
        - Future-state process map
        - Dashboard requirements document
        - Implementation playbook and handover checklist

        TIMELINE AND MILESTONES:
        - Week 1-2: discovery and workflow mapping
        - Week 3: future-state design review
        - Week 4: dashboard requirements draft
        - Week 5: implementation playbook and final handoff package

        PAYMENT SCHEDULE:
        - 30% at kickoff
        - 30% on delivery of future-state design and approved requirements
        - 40% on final delivery of playbook, checklist, and handoff session

        ACCEPTANCE CRITERIA:
        - Deliverables accepted within 5 business days against agreed review checklist
        - Buyer provides one consolidated feedback round per milestone
        - Final milestone requires sign-off on playbook completeness and handoff readiness

        CHANGE CONTROL:
        - Requests outside listed deliverables are documented as change requests
        - Additional workshops, new dashboards, or rollout support require written scope approval
        - Timeline shifts caused by added scope trigger revised milestone dates and fees

        RESPONSIBILITY SPLIT:
        - Consultant: analysis, facilitation, artifacts, recommendations, handoff package
        - Buyer: stakeholder access, source-system context, data validation, approval decisions, rollout ownership
      `,
      draftStep: 2,
    });
    assert.equal(round2EvalRes.statusCode, 200, 'Round 2 evaluation should succeed');

    const round2Body = round2EvalRes.jsonBody();
    assert.ok(round2Body.request_id, 'Round 2 request ID should be present');

    const round2Report = round2Body.evaluation || round2Body.evaluation?.public_report || {};
    const round2Text = textBlob(round2Report);

    const hasMovementLanguage =
      round2Text.includes('addressed') ||
      round2Text.includes('defined') ||
      round2Text.includes('structured') ||
      round2Text.includes('narrowed') ||
      round2Text.includes('scoped') ||
      round2Text.includes('progress');
    assert.equal(
      hasMovementLanguage,
      true,
      'Phase 2 consulting: Later-round should detect movement from broad advisory support toward structured services agreement',
    );

    assert.equal(
      round2Text.includes('scope') || round2Text.includes('workplan') || round2Text.includes('workflow assessment'),
      true,
      'Phase 2 consulting: output should include defined scope/workplan signals',
    );
    assert.equal(
      round2Text.includes('deliverable') || round2Text.includes('playbook') || round2Text.includes('requirements'),
      true,
      'Phase 2 consulting: output should include deliverables/outputs signals',
    );
    assert.equal(
      round2Text.includes('milestone') || round2Text.includes('week 1') || round2Text.includes('timeline'),
      true,
      'Phase 2 consulting: output should include milestones/timeline signals',
    );
    assert.equal(
      round2Text.includes('acceptance') || round2Text.includes('sign-off') || round2Text.includes('review checklist'),
      true,
      'Phase 2 consulting: output should include acceptance criteria signals',
    );
    assert.equal(
      round2Text.includes('change request') || round2Text.includes('out-of-scope') || round2Text.includes('scope approval'),
      true,
      'Phase 2 consulting: output should include change request/out-of-scope handling signals',
    );
    assert.equal(
      round2Text.includes('payment') || round2Text.includes('30%') || round2Text.includes('kickoff'),
      true,
      'Phase 2 consulting: output should include milestone-based payment signals',
    );
    assert.equal(
      round2Text.includes('responsibility') ||
        round2Text.includes('responsibilities') ||
        round2Text.includes('buyer') ||
        round2Text.includes('consultant') ||
        round2Text.includes('ownership') ||
        round2Text.includes('internal team') ||
        round2Text.includes('client') ||
        round2Text.includes('role'),
      true,
      'Phase 2 consulting: output should include buyer/consultant responsibility split signals',
    );

    assert.equal(
      round2Text.includes('what do you want help with') || round2Text.includes('what support do you need'),
      false,
      'Phase 2 consulting: Later-round should not repeat broad early questions once scope signals are provided',
    );
    assert.equal(
      round2Text.includes('what is the budget') || round2Text.includes('what is the timeline'),
      false,
      'Phase 2 consulting: Later-round should not keep repeating generic budget/timeline questions once those are supplied',
    );

    const hasSpecificLaterSignals =
      round2Text.includes('acceptance') ||
      round2Text.includes('handover') ||
      round2Text.includes('ownership') ||
      round2Text.includes('change request') ||
      round2Text.includes('out-of-scope');
    assert.equal(
      hasSpecificLaterSignals,
      true,
      'Phase 2 consulting: Later-round should focus on scope boundaries, acceptance, ownership, and change control',
    );

    const hasWrongDealFraming =
      round2Text.includes('pilot') ||
      round2Text.includes('referral') ||
      round2Text.includes('reseller') ||
      round2Text.includes('channel partner') ||
      round2Text.includes('exclusive territory') ||
      round2Text.includes('data sharing partnership');
    assert.equal(
      hasWrongDealFraming,
      false,
      'Phase 2 consulting: output should not primarily frame this as SaaS pilot/referral/data-sharing/partnership deal',
    );

    console.log('✅ Phase 2 Consulting Fixture PASSED');
    console.log(`   Round 1 Request ID: ${round1Body.request_id}`);
    console.log(`   Round 2 Request ID: ${round2Body.request_id}`);
    console.log(`   Comparison ID: ${comparisonId}`);
    console.log('   Movement detected: broad consulting support → scoped services engagement');
    console.log('   Consulting mechanics identified: scope, deliverables, milestones, acceptance, change control');
  } catch (error) {
    console.error('Phase 2 consulting fixture error:', error.message);
    throw error;
  }
});
