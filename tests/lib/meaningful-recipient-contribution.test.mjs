import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMeaningfulPayloadContribution,
  hasMeaningfulRecipientContribution,
  resolveReviewStageFromRecipientContribution,
} from '../../server/_lib/meaningful-recipient-contribution.ts';

test('mirrored baseline and whitespace-only edits do not count as meaningful recipient contribution', () => {
  const baseline = {
    text: 'Shared proposer draft with scope, milestones, and responsibilities.',
  };

  const mirrored = evaluateMeaningfulPayloadContribution({
    payload: {
      text: '  Shared proposer draft with scope, milestones, and responsibilities.  ',
    },
    baselinePayload: baseline,
    visibility: 'shared',
    defaultLabel: 'Shared by Recipient',
  });
  assert.equal(mirrored.hasMeaningfulContribution, false);

  const punctuationOnly = evaluateMeaningfulPayloadContribution({
    payload: {
      text: 'Shared proposer draft with scope, milestones, and responsibilities !',
    },
    baselinePayload: baseline,
    visibility: 'shared',
    defaultLabel: 'Shared by Recipient',
  });
  assert.equal(punctuationOnly.hasMeaningfulContribution, false);
});

test('cosmetic HTML-only changes do not count as meaningful recipient contribution', () => {
  const result = evaluateMeaningfulPayloadContribution({
    payload: {
      html: '<p><strong>Shared proposer draft with scope, milestones, and responsibilities.</strong></p>',
    },
    baselinePayload: {
      text: 'Shared proposer draft with scope, milestones, and responsibilities.',
    },
    visibility: 'shared',
    defaultLabel: 'Shared by Recipient',
  });

  assert.equal(result.hasMeaningfulContribution, false);
});

test('recipient-authored text, structured answers, and files count as meaningful contribution', () => {
  const textDelta = evaluateMeaningfulPayloadContribution({
    payload: {
      text: 'Recipient adds delivery sequencing, acceptance dependencies, and rollback ownership.',
    },
    baselinePayload: {
      text: 'Shared proposer draft with scope, milestones, and responsibilities.',
    },
    visibility: 'shared',
    defaultLabel: 'Shared by Recipient',
  });
  assert.equal(textDelta.hasMeaningfulContribution, true);

  const structuredDelta = evaluateMeaningfulPayloadContribution({
    payload: {
      json: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Recipient requires SOC 2 before production access.' }],
          },
        ],
      },
    },
    baselinePayload: {
      json: {
        type: 'doc',
        content: [],
      },
    },
    visibility: 'confidential',
    defaultLabel: 'Confidential to Recipient',
  });
  assert.equal(structuredDelta.hasMeaningfulContribution, true);

  const fileDelta = evaluateMeaningfulPayloadContribution({
    payload: {
      files: [
        {
          documentId: 'doc_recipient_terms',
          filename: 'recipient-terms.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
      ],
    },
    baselinePayload: {
      files: [],
    },
    visibility: 'shared',
    defaultLabel: 'Shared by Recipient',
  });
  assert.equal(fileDelta.hasMeaningfulContribution, true);
});

test('review stage resolves to mediation only when recipient contribution is meaningful', () => {
  const preSendStage = resolveReviewStageFromRecipientContribution({
    recipientAuthorRole: 'recipient',
    historyBaselinePayloads: {
      shared: {
        text: 'Shared proposer draft with scope, milestones, and responsibilities.',
      },
    },
    historyContributions: [
      {
        id: 'hist_1',
        authorRole: 'recipient',
        visibility: 'shared',
        contentPayload: {
          text: '  Shared proposer draft with scope, milestones, and responsibilities.  ',
        },
      },
    ],
  });
  assert.equal(preSendStage, 'pre_send_review');

  const mediationStage = resolveReviewStageFromRecipientContribution({
    recipientAuthorRole: 'recipient',
    historyContributions: [
      {
        id: 'hist_2',
        authorRole: 'recipient',
        visibility: 'shared',
        contentPayload: {
          text: 'Recipient adds delivery sequencing, acceptance dependencies, and rollback ownership.',
        },
      },
    ],
  });
  assert.equal(mediationStage, 'mediation_review');
});

test('aggregate helper reports meaningful history and draft signals separately', () => {
  const result = hasMeaningfulRecipientContribution({
    recipientAuthorRole: 'recipient',
    historyContributions: [
      {
        id: 'hist_meaningful',
        authorRole: 'recipient',
        visibility: 'confidential',
        contentPayload: {
          text: 'Recipient internal note sets liability cap and approval sequencing.',
        },
      },
    ],
    draftPayloads: [
      {
        key: 'shared',
        payload: {
          html: '<p><strong>Shared proposer draft with scope, milestones, and responsibilities.</strong></p>',
        },
        baselinePayload: {
          text: 'Shared proposer draft with scope, milestones, and responsibilities.',
        },
        visibility: 'shared',
        defaultLabel: 'Shared by Recipient',
      },
      {
        key: 'confidential',
        payload: {
          files: [{ documentId: 'doc_2', filename: 'recipient-redlines.docx', sizeBytes: 5120 }],
        },
        baselinePayload: {
          files: [],
        },
        visibility: 'confidential',
        defaultLabel: 'Confidential to Recipient',
      },
    ],
  });

  assert.equal(result.hasMeaningfulContribution, true);
  assert.deepEqual(result.historyContributionIds, ['hist_meaningful']);
  assert.deepEqual(
    result.draftSignals.map((entry) => entry.key),
    ['confidential'],
  );
});
