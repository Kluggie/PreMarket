import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCoachLeakGuard,
  applyCoachRelevanceGuard,
  validateCoachResultV1,
} from '../../server/_lib/vertex-coach.ts';

test('validateCoachResultV1 drops malformed suggestions while keeping valid entries', () => {
  const validated = validateCoachResultV1({
    version: 'coach-v1',
    summary: {
      overall: 'Test summary',
      top_priorities: ['A', 'B'],
    },
    suggestions: [
      {
        id: 'good_1',
        scope: 'shared',
        severity: 'info',
        title: 'Good',
        rationale: 'Valid suggestion',
        proposed_change: {
          target: 'doc_b',
          op: 'append',
          text: 'Add clearer acceptance criteria.',
        },
        evidence: {
          shared_quotes: ['Acceptance criteria'],
          confidential_quotes: [],
        },
      },
      {
        id: 'bad_1',
        scope: 'shared',
        severity: 'info',
        title: 'Bad',
        rationale: 'Invalid target for shared scope',
        proposed_change: {
          target: 'doc_a',
          op: 'append',
          text: 'This should be dropped.',
        },
        evidence: {
          shared_quotes: [],
          confidential_quotes: [],
        },
      },
    ],
    concerns: [],
    questions: [],
    negotiation_moves: [],
  });

  assert.equal(validated.suggestions.length, 1);
  assert.equal(validated.suggestions[0].id, 'good_1');
});

test('applyCoachLeakGuard removes shared suggestions that leak confidential phrases', () => {
  const secretPhrase = 'SECRET PRICE 123 with premium escalation clause';
  const coach = validateCoachResultV1({
    version: 'coach-v1',
    summary: {
      overall: 'Summary',
      top_priorities: ['Keep shared suggestions safe'],
    },
    suggestions: [
      {
        id: 'shared_leak',
        scope: 'shared',
        severity: 'warning',
        title: 'Unsafe shared suggestion',
        rationale: 'Should be removed',
        proposed_change: {
          target: 'doc_b',
          op: 'append',
          text: `Add this to shared document: ${secretPhrase}.`,
        },
        evidence: {
          shared_quotes: ['Shared baseline obligation.'],
          confidential_quotes: [],
        },
      },
      {
        id: 'confidential_ok',
        scope: 'confidential',
        severity: 'info',
        title: 'Confidential internal note',
        rationale: 'Owner-only',
        proposed_change: {
          target: 'doc_a',
          op: 'append',
          text: 'Add fallback negotiation threshold internally.',
        },
        evidence: {
          shared_quotes: [],
          confidential_quotes: [secretPhrase],
        },
      },
    ],
    concerns: [],
    questions: [],
    negotiation_moves: [],
  });

  const guarded = applyCoachLeakGuard({
    coachResult: coach,
    confidentialText: `Internal notes include ${secretPhrase} and margin assumptions.`,
    sharedText: 'Shared baseline obligation.',
  });

  assert.equal(guarded.coachResult.suggestions.length, 1);
  assert.equal(guarded.coachResult.suggestions[0].id, 'confidential_ok');
  assert.equal(guarded.withheldCount, 1);
  assert.equal(
    guarded.coachResult.concerns.some((concern) =>
      String(concern.title || '').toLowerCase().includes('withheld shared suggestion'),
    ),
    true,
  );
});

test('applyCoachRelevanceGuard removes empty-document integrity suggestion when docs are non-empty', () => {
  const coach = validateCoachResultV1({
    version: 'coach-v1',
    summary: {
      overall: 'Summary',
      top_priorities: ['Prioritize analysis'],
    },
    suggestions: [
      {
        id: 'integrity_warning',
        scope: 'confidential',
        severity: 'critical',
        title: 'Verify Document Integrity',
        rationale: 'The documents are currently empty.',
        proposed_change: {
          target: 'doc_a',
          op: 'replace_section',
          text: 'Ensure the correct document is loaded for comparison.',
        },
        evidence: {
          shared_quotes: [],
          confidential_quotes: [],
        },
      },
    ],
    concerns: [],
    questions: [],
    negotiation_moves: [],
  });

  const guarded = applyCoachRelevanceGuard({
    coachResult: coach,
    confidentialText: 'Project Orion scope and strategy constraints are documented here.',
    sharedText: 'Shared obligations include deliverables, acceptance criteria, and delivery milestones.',
  });

  assert.equal(guarded.coachResult.suggestions.length, 0);
  assert.equal(guarded.withheldCount, 1);
  assert.equal(
    guarded.coachResult.concerns.some((concern) =>
      String(concern.title || '').toLowerCase().includes('withheld generic empty-document suggestion'),
    ),
    true,
  );
});

test('applyCoachRelevanceGuard allows empty-document integrity suggestion when both docs are empty', () => {
  const coach = validateCoachResultV1({
    version: 'coach-v1',
    summary: {
      overall: 'Summary',
      top_priorities: ['Verify data'],
    },
    suggestions: [
      {
        id: 'integrity_warning_empty',
        scope: 'confidential',
        severity: 'critical',
        title: 'Verify Document Integrity',
        rationale: 'The documents are currently empty.',
        proposed_change: {
          target: 'doc_a',
          op: 'append',
          text: 'Ensure the correct document is loaded for comparison.',
        },
        evidence: {
          shared_quotes: [],
          confidential_quotes: [],
        },
      },
    ],
    concerns: [],
    questions: [],
    negotiation_moves: [],
  });

  const guarded = applyCoachRelevanceGuard({
    coachResult: coach,
    confidentialText: '',
    sharedText: '',
  });

  assert.equal(guarded.coachResult.suggestions.length, 1);
  assert.equal(guarded.coachResult.suggestions[0].id, 'integrity_warning_empty');
  assert.equal(guarded.withheldCount, 0);
});
