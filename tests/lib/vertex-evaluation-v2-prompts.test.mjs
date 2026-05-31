import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvalPromptFromFactSheet,
  buildPreSendPromptFromFactSheet,
  buildStage1SharedIntakePromptFromFactSheet,
  selectReportStyle,
} from '../../server/_lib/vertex-evaluation-v2-prompts.ts';

function factSheet(overrides = {}) {
  return {
    project_goal: 'Deliver a phased implementation with milestone-based acceptance.',
    scope_deliverables: ['Implementation plan', 'Milestone rollout', 'Acceptance checklist'],
    timeline: {
      start: '2026-Q3',
      duration: '12 weeks',
      milestones: ['Kickoff', 'Pilot sign-off', 'Full rollout'],
    },
    constraints: ['Budget approval required', 'Hard launch window applies'],
    success_criteria_kpis: ['Pilot approved by both teams', 'Launch checklist completed'],
    vendor_preferences: ['Fixed price preferred'],
    assumptions: ['Access to stakeholder approvals remains available'],
    risks: [{ risk: 'Approval bottleneck', impact: 'med', likelihood: 'med' }],
    open_questions: [],
    missing_info: [],
    source_coverage: {
      has_scope: true,
      has_timeline: true,
      has_kpis: true,
      has_constraints: true,
      has_risks: true,
    },
    ...overrides,
  };
}

function chunks() {
  return {
    sharedChunks: [{ evidence_id: 'shared:line_001', text: 'Shared delivery terms.' }],
    confidentialChunks: [{ evidence_id: 'conf:line_001', text: 'Internal pricing flexibility.' }],
  };
}

function saasReferralPartnershipFactSheet() {
  return factSheet({
    project_goal:
      'Run a non-exclusive six-month SaaS referral/channel partnership pilot with implementation partner support.',
    scope_deliverables: [
      'Party A proposes referral commission for signed SaaS customers introduced by Party B.',
      'Party B would provide implementation partner support, training, onboarding, and customer handoff help.',
      'Implementation fees would be retained by the implementation partner.',
      'Recurring revenue share may apply if the partner remains actively involved in support and expansion.',
      'Lead ownership, client attribution, client protection, non-circumvention, and possible semi-exclusivity need definition.',
    ],
    timeline: {
      start: '2026-Q3',
      duration: 'six-month pilot',
      milestones: ['Pilot launch', 'Referral performance review', 'Performance-based renegotiation'],
    },
    constraints: [
      'Pilot should remain non-exclusive during the first six months.',
      'Semi-exclusivity may be considered only after documented referral performance.',
      'The parties need a shared referral tracking process.',
    ],
    success_criteria_kpis: [
      'Qualified referred leads tracked through attribution records.',
      'Signed customers from referred leads.',
      'Documented ongoing partner support for any recurring revenue share.',
    ],
    vendor_preferences: ['No upfront fees during the pilot'],
    assumptions: [
      'Both sides support a pilot before broader channel commitments.',
      'Training obligations and sales/support responsibilities will be defined before launch.',
    ],
    risks: [
      {
        risk: 'The SaaS company could receive an introduction and later dispute attribution.',
        impact: 'high',
        likelihood: 'med',
      },
      {
        risk: 'The partner may ask for semi-exclusivity before proving referral performance.',
        impact: 'med',
        likelihood: 'med',
      },
    ],
    open_questions: [
      'What counts as a successful referral?',
      'How long does client protection last after an introduction?',
      'When does recurring revenue share apply?',
      'What performance threshold justifies semi-exclusivity after the pilot?',
    ],
    missing_info: [
      'Commission trigger and level are unresolved.',
      'Referral attribution records are not defined.',
      'Customer handoff and ongoing support responsibilities are not allocated.',
    ],
  });
}

test('stage1 shared intake prompt stays explicitly one-sided, neutral, and non-evaluative', () => {
  const prompt = buildStage1SharedIntakePromptFromFactSheet({
    factSheet: factSheet(),
    reportStyle: selectReportStyle(42),
  });

  assert.match(prompt, /Stage 1 Initial Review writer/i);
  assert.match(prompt, /based only on materials currently submitted by one side/i);
  assert.match(prompt, /preliminary summary intended to help structure the next exchange/i);
  assert.match(prompt, /NOT bilateral mediation, NOT a verdict, and NOT a compatibility judgment/i);
  assert.match(prompt, /Do NOT make confidence, compatibility, bridgeability, or final risk judgments/i);
  assert.match(prompt, /Do NOT predict likely pushback or likely response from the other side/i);
  assert.match(prompt, /Status: provide a short neutral status only/i);
  assert.match(prompt, /scope_snapshot should be concise sentence-style items that combine naturally into compact paragraph prose/i);
  assert.match(prompt, /other_side_needed must stay neutral\. Write a single flowing prose paragraph/i);
  assert.match(prompt, /basis_note must say exactly:/i);
  assert.match(prompt, /preliminary summary intended to help structure the next exchange/i);
  assert.match(prompt, /analysis_stage must be "stage1_shared_intake"/i);
  assert.match(prompt, /intake_status must be "awaiting_other_side_input"/i);
  assert.doesNotMatch(prompt, /confidence_0_1/i);
  assert.doesNotMatch(prompt, /ready_to_send/i);
});

test('legacy pre-send prompt remains explicitly unilateral for historical compatibility', () => {
  const prompt = buildPreSendPromptFromFactSheet({
    factSheet: factSheet(),
    reportStyle: selectReportStyle(7),
  });

  assert.match(prompt, /unilateral draft-readiness review/i);
  assert.match(prompt, /must NOT assess bilateral compatibility/i);
  assert.match(prompt, /analysis_stage\": \"pre_send_review\"/i);
});

test('mediation prompt keeps the stable bilateral structure and required headings', () => {
  const prompt = buildEvalPromptFromFactSheet({
    factSheet: factSheet(),
    chunks: chunks(),
    reportStyle: selectReportStyle(91),
  });

  assert.match(prompt, /shared neutral artifact/i);
  assert.match(prompt, /Recommendation, Where the Parties Align, Where the Deal Is Stuck, Suggested Bridge, Open Questions, Next Step/i);
  assert.match(prompt, /Do NOT create a visible "Mediation Summary" section/i);
  assert.match(prompt, /Do NOT create a visible "Progress Since Prior Review" section/i);
  assert.doesNotMatch(prompt, /Required: .*Mediation Summary/i);
  assert.doesNotMatch(prompt, /What Changed Since Last Round, Where the Parties Align/i);
  assert.match(prompt, /OUTPUT SHAPE/i);
  assert.match(prompt, /mediat/i);
  assert.match(prompt, /analysis_stage must be "mediation_review"/i);
});

test('mediation prompt steers SaaS referral partnership reviews toward deal-specific terms', () => {
  const prompt = buildEvalPromptFromFactSheet({
    factSheet: saasReferralPartnershipFactSheet(),
    chunks: chunks(),
    reportStyle: selectReportStyle(55),
  });

  for (const term of [
    'referral commission',
    'recurring revenue share',
    'implementation fees',
    'lead ownership',
    'client attribution',
    'client protection',
    'non-circumvention',
    'semi-exclusivity',
    'pilot success criteria',
    'customer handoff',
    'performance-based renegotiation',
  ]) {
    assert.equal(prompt.includes(term), true, `Stage 2 prompt should include "${term}"`);
  }

  assert.match(prompt, /DEAL ARCHETYPE FIRST/i);
  assert.match(prompt, /SaaS referral\/channel partnership/i);
  assert.match(prompt, /Do NOT default to project delivery/i);
  assert.match(prompt, /ANTI-GENERIC STAGE 2 RULE/i);
  assert.match(prompt, /Do NOT default to generic project-management or delivery-contract language/i);
  assert.match(prompt, /key deliverables/i);
  assert.match(prompt, /acceptance criteria for deliverables/i);
  assert.match(prompt, /delivery sequencing/i);
  assert.match(prompt, /change exposure/i);
  assert.match(prompt, /scope control/i);
  assert.match(prompt, /current phase/i);
  assert.match(prompt, /sign-off/i);
  assert.match(prompt, /dependency ownership/i);
  assert.match(prompt, /unless they are specifically relevant to the inferred deal archetype/i);
});

test('mediation prompt protects private walk-away and hidden-limit information', () => {
  const prompt = buildEvalPromptFromFactSheet({
    factSheet: saasReferralPartnershipFactSheet(),
    chunks: chunks(),
    reportStyle: selectReportStyle(56),
  });

  assert.match(prompt, /Never quote confidential text verbatim/i);
  assert.match(prompt, /Never disclose confidential numbers, IDs, dates, emails, pricing, or exact identifiers/i);
  assert.match(
    prompt,
    /Do NOT describe any issue as a walk-away point, hard limit, maximum, minimum, fallback, or private concession unless that status appears in shared\/public materials/i,
  );
  assert.match(
    prompt,
    /Shared mediation output may say an issue is central, material, important, or must be resolved/i,
  );
  assert.match(prompt, /must NOT disclose that it is a private walk-away point, hidden limit, or confidential fallback/i);
  assert.match(prompt, /Hidden commission limits/i);
  assert.match(prompt, /private willingness to concede/i);
  assert.match(prompt, /private pipeline pressure/i);
  assert.match(prompt, /private resourcing concerns/i);
  assert.match(prompt, /internal maximum\/minimum positions/i);
  assert.match(prompt, /private walk-away points must remain confidential/i);
});

test('later bilateral mediation prompt becomes progress-aware without changing report family', () => {
  const prompt = buildEvalPromptFromFactSheet({
    factSheet: factSheet(),
    chunks: chunks(),
    reportStyle: selectReportStyle(123),
    mediationRoundContext: {
      current_bilateral_round_number: 3,
      prior_bilateral_round_id: 'eval_prev_2',
      prior_bilateral_round_number: 2,
      prior_primary_insight: 'Liability and launch ownership remained open last round.',
      prior_missing: ['Who owns launch approval?'],
      prior_bridgeability_notes: ['Tie launch authority to milestone sign-off.'],
    },
  });

  assert.match(prompt, /progress across rounds/i);
  assert.match(prompt, /output shape/i);
  assert.match(prompt, /What Changed Since Last Round/i);
  assert.match(prompt, /Do NOT use "Progress Since Prior Review"/i);
  assert.match(prompt, /prior_bilateral_context/i);
  assert.match(prompt, /movement_direction/i);
});
