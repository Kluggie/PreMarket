import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMediationRoundContext,
  buildStoredMediationProgress,
  enrichMediationRoundContext,
  mediationIssueIdForText,
} from '../../server/_lib/mediation-progress.ts';

function priorReport(overrides = {}) {
  return {
    report_format: 'v2',
    analysis_stage: 'mediation_review',
    bilateral_round_number: 1,
    fit_level: 'medium',
    confidence_0_1: 0.58,
    generated_at_iso: '2026-06-10T12:00:00.000Z',
    primary_insight:
      'The pilot is commercially plausible, but customer protection and commission mechanics remain open.',
    why: [
      'Recommendation: Proceed with conditions because the pilot structure is workable once attribution and economics are defined.',
      'Where the Deal Is Stuck: Client protection duration and the commission trigger remain unresolved.',
      'Suggested Bridge: Use registered referrals, a fixed protection window, and commission after an observable customer event.',
      'Next Step: Draft a one-page pilot rules document covering attribution, protection, and payment.',
      'Legacy Diagnostic: A private walk-away threshold exists because of internal pipeline pressure.',
    ],
    missing: [
      'How long does client protection last? — determines when an introduced account remains protected.',
      'When is commission earned and paid? — determines the commercial trigger and payment timing.',
      'What is the confidential maximum acceptable commission?',
    ],
    remaining_deltas: [
      'How long does client protection last?',
      'When is commission earned and paid?',
      'What is the confidential maximum acceptable commission?',
    ],
    resolved_since_last_round: [],
    movement_direction: 'stalled',
    internal_analysis: {
      recommendation: 'SECRET_INTERNAL_RECOMMENDATION',
      hidden_assumptions: ['CONFIDENTIAL_CANARY_42'],
      evidence_used: ['[confidential:raw_123] private pricing limit'],
    },
    evaluation_diagnostics: {
      provider: 'openai',
      rawEvidenceId: 'confidential:raw_123',
    },
    ...overrides,
  };
}

function laterContext(report = priorReport()) {
  return buildMediationRoundContext({
    bilateralRoundNumber: 2,
    priorBilateralRoundId: 'eval_round_1',
    priorReport: report,
  });
}

test('prior review summary is public-safe and includes recommendation continuity fields', () => {
  const context = laterContext();
  const summary = context.prior_review_summary;

  assert.equal(summary.prior_evaluation_id, 'eval_round_1');
  assert.equal(summary.prior_round_number, 1);
  assert.equal(summary.prior_decision_status, 'proceed_with_conditions');
  assert.equal(summary.prior_confidence_0_1, 0.58);
  assert.match(summary.prior_recommendation, /Proceed with conditions/i);
  assert.match(summary.prior_next_step, /one-page pilot rules/i);
  assert.equal(summary.prior_open_questions.length, 2);
  assert.equal(summary.prior_open_questions[0].issue_id, 'client_protection');

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /SECRET_INTERNAL_RECOMMENDATION/);
  assert.doesNotMatch(serialized, /CONFIDENTIAL_CANARY_42/);
  assert.doesNotMatch(serialized, /confidential:raw_123/);
  assert.doesNotMatch(serialized, /evaluation_diagnostics/);
  assert.doesNotMatch(serialized, /internal_analysis/);
  assert.doesNotMatch(serialized, /walk-away threshold/i);
  assert.doesNotMatch(serialized, /pipeline pressure/i);
  assert.doesNotMatch(serialized, /maximum acceptable commission/i);
});

test('first mediation round does not receive fake prior review or delta context', () => {
  const context = buildMediationRoundContext({
    bilateralRoundNumber: 1,
    priorBilateralRoundId: 'should_not_be_used',
    priorReport: priorReport(),
  });
  const enriched = enrichMediationRoundContext({
    mediationRoundContext: context,
    currentSharedText: 'Current first-round material.',
  });

  assert.deepEqual(context, { current_bilateral_round_number: 1 });
  assert.equal(enriched.prior_review_summary, undefined);
  assert.equal(enriched.delta_analysis, undefined);
});

test('a differently worded concrete client-protection answer resolves the prior question', () => {
  const enriched = enrichMediationRoundContext({
    mediationRoundContext: laterContext(),
    currentSharedText:
      'Accepted introductions remain protected for twelve months. Non-circumvention applies during that protection window.',
  });
  const change = enriched.delta_analysis.issue_changes.find(
    (issue) => issue.issue_id === 'client_protection',
  );

  assert.equal(change.current_status, 'resolved');
  assert.equal(enriched.delta_analysis.resolved_issue_ids.includes('client_protection'), true);
  assert.equal(
    enriched.delta_analysis.unchanged_issue_ids.includes('commission_trigger'),
    true,
  );
});

test('mentioning commission without defining its trigger keeps the prior blocker open', () => {
  const enriched = enrichMediationRoundContext({
    mediationRoundContext: laterContext(),
    currentSharedText:
      'Referral commission will be paid under the pilot. The parties will agree the earning trigger later.',
  });
  const change = enriched.delta_analysis.issue_changes.find(
    (issue) => issue.issue_id === 'commission_trigger',
  );

  assert.equal(
    change.current_status === 'partially_resolved' ||
      change.current_status === 'narrowed' ||
      change.current_status === 'unchanged',
    true,
  );
  assert.equal(enriched.delta_analysis.resolved_issue_ids.includes('commission_trigger'), false);
});

test('a new semi-exclusivity requirement is detected as a newly introduced issue', () => {
  const enriched = enrichMediationRoundContext({
    mediationRoundContext: laterContext(),
    currentSharedText:
      'The recipient now requires semi-exclusivity after the pilot and says a performance threshold must be agreed.',
  });
  const newIssue = enriched.delta_analysis.issue_changes.find(
    (issue) => issue.current_status === 'newly_introduced',
  );

  assert.equal(Boolean(newIssue), true);
  assert.equal(
    newIssue.issue_id === 'post_pilot_rights' || newIssue.issue_id === 'exclusivity',
    true,
  );
});

test('superseded old economics are not treated as the current commission position', () => {
  const enriched = enrichMediationRoundContext({
    mediationRoundContext: laterContext(),
    currentSharedText:
      'The earlier signature-based commission term is replaced by commission earned after the customer pays.',
  });
  const commission = enriched.delta_analysis.issue_changes.find(
    (issue) => issue.issue_id === 'commission_trigger',
  );

  assert.equal(commission.current_status, 'superseded');
  assert.equal(enriched.delta_analysis.superseded_issue_ids.includes('commission_trigger'), true);
});

test('stored progress uses delta analysis when generated progress fields are absent', () => {
  const context = enrichMediationRoundContext({
    mediationRoundContext: laterContext(),
    currentSharedText:
      'Client protection applies for 12 months after an accepted referral. Commission will be paid, but the earning trigger remains to be agreed.',
  });
  const stored = buildStoredMediationProgress({
    currentMissing: ['When is commission earned and paid?'],
    mediationRoundContext: context,
  });

  assert.equal(stored.bilateral_round_number, 2);
  assert.equal(
    stored.resolved_since_last_round.some((item) => /client protection/i.test(item)),
    true,
  );
  assert.equal(
    stored.remaining_deltas.some((item) => /commission/i.test(item)),
    true,
  );
  assert.match(stored.delta_summary, /progress|shared record|resolution/i);
});

test('issue identity is deterministic across equivalent wording', () => {
  assert.equal(
    mediationIssueIdForText('How long does the client protection period last?'),
    mediationIssueIdForText('Define the non-circumvention protection window.'),
  );
  assert.equal(
    mediationIssueIdForText('When is referral commission earned?'),
    'commission_trigger',
  );
});
