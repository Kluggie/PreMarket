import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceToSmallSchema,
  validateResponseSchema,
} from '../../server/_lib/vertex-evaluation-v2-schema.ts';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
} from '../../src/lib/opportunityReviewStage.js';

test('stage1 shared intake schema validation accepts the intended shape and rejects mediation stage payloads', () => {
  const valid = validateResponseSchema(
    {
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary: 'The submitting party appears to be proposing a phased implementation with milestone-based acceptance.',
      scope_snapshot: ['Initial implementation phase', 'Milestone-based acceptance', 'Budget approval dependency'],
      unanswered_questions: ['Who owns final acceptance?', 'Which approvals are required before kickoff?'],
      other_side_needed: ['Clarification on approval ownership and any non-negotiable delivery constraints.'],
      discussion_starting_points: ['Confirm the initial scope boundary and the approval path for kickoff.'],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    },
    STAGE1_SHARED_INTAKE_STAGE,
  );

  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.normalized.analysis_stage, STAGE1_SHARED_INTAKE_STAGE);
  assert.equal('confidence_0_1' in valid.normalized, false);
  assert.equal('recommendation' in valid.normalized, false);
  assert.equal('compatibility_assessment' in valid.normalized, false);

  const wrongStage = validateResponseSchema(
    {
      analysis_stage: MEDIATION_REVIEW_STAGE,
      fit_level: 'medium',
      confidence_0_1: 0.6,
      why: ['Executive Summary: Bilateral summary.'],
      missing: ['Who owns launch approval?'],
      redactions: [],
    },
    STAGE1_SHARED_INTAKE_STAGE,
  );

  assert.equal(wrongStage.ok, false);
  assert.equal(wrongStage.invalidFields.includes('analysis_stage'), true);
});

test('mediation schema validation preserves normalization of compatibility, dealbreaker, and movement fields', () => {
  const result = validateResponseSchema(
    {
      analysis_stage: MEDIATION_REVIEW_STAGE,
      fit_level: 'medium',
      confidence_0_1: 0.62,
      why: ['Executive Summary: The deal is workable with adjustments.'],
      missing: ['Who owns final launch approval?'],
      redactions: [],
      movement_direction: 'Converging',
      negotiation_analysis: {
        proposing_party: {
          demands: ['Named approval owner'],
          priorities: ['Timeline certainty'],
          dealbreakers: [{ title: 'Open-ended liability', basis: 'Strongly Implied' }],
          flexibility: ['Optional scope can move later'],
        },
        counterparty: {
          demands: ['Commercial guardrails'],
          priorities: ['Liability control'],
          dealbreakers: [{ text: 'Undefined milestone ownership', support: 'not clearly established' }],
          flexibility: ['Pilot packaging is possible'],
        },
        compatibility_assessment: 'uncertain due to missing info',
        compatibility_rationale: 'Compatibility is still uncertain while approval ownership remains open.',
        bridgeability_notes: ['Tie approval authority to milestone completion.'],
        critical_incompatibilities: [],
      },
    },
    MEDIATION_REVIEW_STAGE,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.normalized.movement_direction, 'converging');
  assert.equal(
    result.normalized.negotiation_analysis?.compatibility_assessment,
    'uncertain_due_to_missing_information',
  );
  assert.equal(
    result.normalized.negotiation_analysis?.proposing_party.dealbreakers[0]?.basis,
    'strongly_implied',
  );
  assert.equal(
    result.normalized.negotiation_analysis?.counterparty.dealbreakers[0]?.basis,
    'not_clearly_established',
  );
});

test('legacy mediation coercion keeps mediation stage and extracts redacted flags conservatively', () => {
  const result = coerceToSmallSchema(
    {
      summary: {
        top_fit_reasons: ['Structured scope exists.'],
        top_blockers: ['Approval ownership is still open.'],
      },
      quality: {
        confidence_overall: 82,
      },
      flags: [
        { detail_level: 'redacted', title: 'Internal pricing flexibility' },
        { detail_level: 'public', title: 'Visible risk item' },
      ],
      answer: 'yes',
      movement_direction: 'stalled',
    },
    MEDIATION_REVIEW_STAGE,
  );

  assert.equal(result.coerced, true);
  assert.equal(result.candidate.analysis_stage, MEDIATION_REVIEW_STAGE);
  assert.equal(result.candidate.fit_level, 'high');
  assert.equal(result.candidate.confidence_0_1, 0.82);
  assert.deepEqual(result.candidate.redactions, ['Internal pricing flexibility']);
  assert.equal(result.candidate.movement_direction, 'stalled');
});

test('stage1 shared intake coercion maps legacy aliases into the neutral intake schema', () => {
  const result = coerceToSmallSchema(
    {
      status: 'Awaiting other side input',
      summary: 'The current submission outlines a phased rollout with milestone approvals.',
      scope: ['Phased rollout', 'Milestone approvals'],
      still_unanswered: ['Who approves final go-live?'],
      clarifications_needed: ['Clarification on any launch-window constraints.'],
      discussion_points: ['Confirm the first-phase scope and approval sequence.'],
      disclaimer:
        'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.',
    },
    STAGE1_SHARED_INTAKE_STAGE,
  );

  assert.equal(result.coerced, true);
  assert.equal(result.candidate.analysis_stage, STAGE1_SHARED_INTAKE_STAGE);
  assert.equal(result.candidate.intake_status, 'awaiting_other_side_input');
  assert.equal(result.candidate.submission_summary, 'The current submission outlines a phased rollout with milestone approvals.');
  assert.deepEqual(result.candidate.scope_snapshot, ['Phased rollout', 'Milestone approvals']);
  assert.deepEqual(result.candidate.unanswered_questions, ['Who approves final go-live?']);
  assert.deepEqual(
    result.candidate.other_side_needed,
    ['Clarification on any launch-window constraints.'],
  );
  assert.deepEqual(
    result.candidate.discussion_starting_points,
    ['Confirm the first-phase scope and approval sequence.'],
  );
});

test('legacy pre-send coercion keeps pre-send stage and sender-side readiness semantics', () => {
  const result = coerceToSmallSchema(
    {
      status: 'ready to share',
      summary: 'The draft is ready to share once acceptance language is preserved.',
      missing: ['Who owns final sign-off?'],
      ambiguities: ['Acceptance wording is still broad.'],
      recipient_questions: ['Which milestone triggers billing?'],
      pushback: ['Open-ended support obligations may draw resistance.'],
      commercial_flags: ['Commercial exposure remains too open.'],
      implementation_flags: ['Sequencing depends on unstated approvals.'],
      clarifications: ['Tie billing to milestone sign-off.'],
    },
    PRE_SEND_REVIEW_STAGE,
  );

  assert.equal(result.coerced, true);
  assert.equal(result.candidate.analysis_stage, PRE_SEND_REVIEW_STAGE);
  assert.equal(result.candidate.readiness_status, 'ready_to_send');
  assert.deepEqual(result.candidate.missing_information, ['Who owns final sign-off?']);
});
