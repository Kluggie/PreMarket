import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewContextHistoryState,
  buildDraftContributionEntries,
  buildSharedHistoryComposite,
  formatContributionsForAi,
  HISTORY_AUTHOR_PROPOSER,
  HISTORY_AUTHOR_RECIPIENT,
} from '../../server/_lib/shared-report-history.js';

test('buildDraftContributionEntries preserves authored proposer/recipient visibility metadata', () => {
  const entries = buildDraftContributionEntries({
    authorRole: HISTORY_AUTHOR_RECIPIENT,
    roundNumber: 4,
    sharedPayload: {
      label: 'Shared by Recipient',
      text: 'Recipient round-four shared contribution.',
    },
    confidentialPayload: {
      label: 'Confidential to Recipient',
      notes: 'Recipient-only confidential note.',
    },
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].authorRole, HISTORY_AUTHOR_RECIPIENT);
  assert.equal(entries[0].visibility, 'shared');
  assert.equal(entries[0].roundNumber, 4);
  assert.equal(entries[1].authorRole, HISTORY_AUTHOR_RECIPIENT);
  assert.equal(entries[1].visibility, 'confidential');
  assert.equal(entries[1].contentPayload.notes, 'Recipient-only confidential note.');
});

test('formatContributionsForAi keeps round, visibility, and author attribution in the prompt block', () => {
  const formatted = formatContributionsForAi([
    {
      id: 'contrib_proposer_shared',
      authorRole: HISTORY_AUTHOR_PROPOSER,
      visibility: 'shared',
      roundNumber: 1,
      contentPayload: { text: 'Proposer shared context.' },
    },
    {
      id: 'contrib_recipient_confidential',
      authorRole: HISTORY_AUTHOR_RECIPIENT,
      visibility: 'confidential',
      roundNumber: 2,
      contentPayload: { text: 'Recipient confidential context.' },
    },
  ]);

  assert.equal(formatted.includes('Round 1'), true);
  assert.equal(formatted.includes('Shared Information'), true);
  assert.equal(formatted.includes('Authored by Proposer'), true);
  assert.equal(formatted.includes('Proposer shared context.'), true);
  assert.equal(formatted.includes('Round 2'), true);
  assert.equal(formatted.includes('Confidential Information'), true);
  assert.equal(formatted.includes('Authored by Recipient'), true);
  assert.equal(formatted.includes('Recipient confidential context.'), true);
});

test('buildSharedHistoryComposite renders ordered bilateral shared history without flattening labels away', () => {
  const composite = buildSharedHistoryComposite([
    {
      visibility_label: 'Shared by Proposer',
      text: 'First proposer contribution.',
      html: '<p>First proposer contribution.</p>',
    },
    {
      visibility_label: 'Shared by Recipient',
      text: 'Second recipient contribution.',
      html: '<p>Second recipient contribution.</p>',
    },
  ]);

  assert.equal(composite.text.includes('Shared by Proposer'), true);
  assert.equal(composite.text.includes('First proposer contribution.'), true);
  assert.equal(composite.text.includes('Shared by Recipient'), true);
  assert.equal(composite.text.includes('Second recipient contribution.'), true);
  assert.equal(composite.html.includes('Shared by Proposer'), true);
  assert.equal(composite.html.includes('Shared by Recipient'), true);
});

test('buildReviewContextHistoryState excludes the baseline proposal from prior-round counts', () => {
  const firstRound = buildReviewContextHistoryState({
    contributions: [
      {
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: 'shared',
        roundNumber: 1,
        contentPayload: { text: 'Baseline proposer package.' },
      },
      {
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: 'confidential',
        roundNumber: 1,
        contentPayload: { text: 'Baseline proposer confidential note.' },
      },
    ],
    outgoingRoundNumber: 2,
    previousReviewsConsidered: 0,
  });

  assert.equal(firstRound.initialProposalContextIncluded, true);
  assert.equal(firstRound.priorRoundsConsidered, 0);
  assert.equal(firstRound.previousReviewsConsidered, 0);
  assert.equal(firstRound.priorRoundEntries.length, 0);

  const laterRound = buildReviewContextHistoryState({
    contributions: [
      {
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: 'shared',
        roundNumber: 1,
        contentPayload: { text: 'Baseline proposer package.' },
      },
      {
        authorRole: HISTORY_AUTHOR_RECIPIENT,
        visibility: 'shared',
        roundNumber: 2,
        contentPayload: { text: 'Recipient reply.' },
      },
      {
        authorRole: HISTORY_AUTHOR_RECIPIENT,
        visibility: 'confidential',
        roundNumber: 2,
        contentPayload: { text: 'Recipient private note.' },
      },
      {
        authorRole: HISTORY_AUTHOR_PROPOSER,
        visibility: 'shared',
        roundNumber: 3,
        contentPayload: { text: 'Proposer counter-response.' },
      },
    ],
    outgoingRoundNumber: 4,
    previousReviewsConsidered: 1,
  });

  assert.equal(laterRound.initialProposalContextIncluded, true);
  assert.equal(laterRound.priorRoundsConsidered, 2);
  assert.equal(laterRound.previousReviewsConsidered, 1);
  assert.deepEqual(
    laterRound.priorRoundEntries.map((entry) => entry.roundNumber),
    [2, 2, 3],
  );
});
