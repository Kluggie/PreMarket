import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceToSmallSchema,
  validateResponseSchema,
} from '../../server/_lib/vertex-evaluation-v2-schema.ts';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
} from '../../src/lib/opportunityReviewStage.js';

test('pre-send schema validation accepts the intended shape and rejects mediation stage payloads', () => {
  const valid = validateResponseSchema(
    {
      analysis_stage: PRE_SEND_REVIEW_STAGE,
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary: 'The sender draft is workable but still needs tighter ownership wording.',
      missing_information: ['Who owns final acceptance?'],
      ambiguous_terms: ['Success criteria remain implied.'],
      likely_recipient_questions: ['Which approvals are required before kickoff?'],
      likely_pushback_areas: ['Open-ended remediation ownership may draw resistance.'],
      commercial_risks: ['Commercial guardrails still need explicit change treatment.'],
      implementation_risks: ['Launch sequencing depends on unstated approvals.'],
      suggested_clarifications: ['Define milestone sign-off before sending.'],
    },
    PRE_SEND_REVIEW_STAGE,
  );

  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.normalized.analysis_stage, PRE_SEND_REVIEW_STAGE);

  const wrongStage = validateResponseSchema(
    {
      analysis_stage: MEDIATION_REVIEW_STAGE,
      fit_level: 'medium',
      confidence_0_1: 0.6,
      why: ['Executive Summary: Bilateral summary.'],
      missing: ['Who owns launch approval?'],
      redactions: [],
    },
    PRE_SEND_REVIEW_STAGE,
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
