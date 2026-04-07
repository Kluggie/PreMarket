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
  assert.match(prompt, /Mediation Summary/i);
  assert.match(prompt, /Decision Readiness/i);
  assert.match(prompt, /OUTPUT SHAPE/i);
  assert.match(prompt, /mediat/i);
  assert.match(prompt, /analysis_stage must be "mediation_review"/i);
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
  assert.match(prompt, /prior_bilateral_context/i);
  assert.match(prompt, /movement_direction/i);
});
