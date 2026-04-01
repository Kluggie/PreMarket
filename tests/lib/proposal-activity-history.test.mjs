import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProposalActivityHistory,
  buildSharedReportScopedActivityHistory,
} from '../../server/_lib/proposal-activity.js';

test('proposal activity history hides raw update snapshots and keeps meaningful workflow events', () => {
  const history = buildProposalActivityHistory(
    [
      {
        id: 'evt_update',
        eventType: 'proposal.updated',
        actorRole: 'party_a',
        createdAt: '2026-03-25T10:00:00.000Z',
      },
      {
        id: 'evt_requested',
        eventType: 'proposal.outcome.won_requested',
        actorRole: 'party_a',
        createdAt: '2026-03-25T10:01:00.000Z',
      },
      {
        id: 'evt_response',
        eventType: 'proposal.received',
        actorRole: 'party_b',
        createdAt: '2026-03-25T10:02:00.000Z',
      },
      {
        id: 'evt_confirmed',
        eventType: 'proposal.outcome.won_confirmed',
        actorRole: 'party_b',
        createdAt: '2026-03-25T10:03:00.000Z',
      },
    ],
    { accessMode: 'owner', limit: 10 },
  );

  assert.equal(history.some((entry) => entry.event_type === 'proposal.updated'), false);
  assert.deepEqual(
    history.map((entry) => entry.event_type),
    [
      'proposal.outcome.won_confirmed',
      'proposal.received',
      'proposal.outcome.won_requested',
    ],
  );
  assert.equal(history[0].title, 'Agreement Confirmed');
  assert.equal(history[0].description, 'Counterparty confirmed the agreement.');
  assert.equal(history[1].title, 'Recipient Response');
  assert.equal(history[1].description, 'Counterparty submitted updated terms.');
  assert.equal(history[2].title, 'Requested Agreement');
  assert.equal(history[2].description, 'You requested agreement.');
});

test('shared-report scoped activity history excludes sibling-recipient sent/send-back events from the same proposal', () => {
  const scopedHistory = buildSharedReportScopedActivityHistory(
    [
      {
        id: 'evt_send_a',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-25T10:00:00.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          sharedLinks: [{ id: 'share_a', token: 'token_a', recipientEmail: 'a@example.com' }],
        },
      },
      {
        id: 'evt_send_b',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-25T10:01:00.000Z',
        eventData: {
          recipient_email: 'b@example.com',
        },
        versionSnapshot: {
          sharedLinks: [{ id: 'share_b', token: 'token_b', recipientEmail: 'b@example.com' }],
        },
      },
      {
        id: 'evt_back_a',
        eventType: 'proposal.send_back',
        actorRole: 'party_b',
        createdAt: '2026-03-25T10:02:00.000Z',
        versionSnapshot: {
          recipientRevisions: [{ id: 'rev_a', sharedLinkId: 'share_a' }],
        },
      },
      {
        id: 'evt_back_b',
        eventType: 'proposal.send_back',
        actorRole: 'party_b',
        createdAt: '2026-03-25T10:03:00.000Z',
        versionSnapshot: {
          recipientRevisions: [{ id: 'rev_b', sharedLinkId: 'share_b' }],
        },
      },
      {
        id: 'evt_created',
        eventType: 'proposal.created',
        actorRole: 'party_a',
        createdAt: '2026-03-25T09:55:00.000Z',
      },
    ],
    {
      accessMode: 'recipient',
      limit: 10,
      scope: {
        lineageLinkIds: ['share_a'],
        lineageLinkTokens: ['token_a'],
        lineageRecipientEmails: ['a@example.com'],
      },
    },
  );

  assert.equal(
    scopedHistory.filter((entry) => entry.event_type === 'proposal.sent').length,
    1,
  );
  assert.equal(
    scopedHistory.filter((entry) => entry.event_type === 'proposal.send_back').length,
    1,
  );
  assert.equal(
    scopedHistory.some((entry) => entry.event_type === 'proposal.created'),
    true,
  );
});

test('shared-report thread scoping ignores broad snapshot sharedLinks and keys off thread-specific recipient scope', () => {
  const sharedLinksSnapshot = [
    { id: 'share_a', token: 'token_a', recipientEmail: 'a@example.com' },
    { id: 'share_b', token: 'token_b', recipientEmail: 'b@example.com' },
    { id: 'share_c', token: 'token_c', recipientEmail: 'c@example.com' },
  ];

  const scopedHistory = buildSharedReportScopedActivityHistory(
    [
      {
        id: 'evt_send_a',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T23:04:06.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'a@example.com',
            documentComparisonId: 'comparison_1',
          },
          // Broad shared-links snapshot (contains sibling recipients too).
          sharedLinks: sharedLinksSnapshot,
        },
      },
      {
        id: 'evt_send_b',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T23:04:23.000Z',
        eventData: {
          recipient_email: 'b@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'b@example.com',
            documentComparisonId: 'comparison_1',
          },
          sharedLinks: sharedLinksSnapshot,
        },
      },
      {
        id: 'evt_send_c',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-21T00:02:30.000Z',
        eventData: {
          recipient_email: 'c@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'c@example.com',
            documentComparisonId: 'comparison_1',
          },
          sharedLinks: sharedLinksSnapshot,
        },
      },
    ],
    {
      accessMode: 'recipient',
      limit: 10,
      scope: {
        lineageLinkIds: ['share_a'],
        lineageLinkTokens: ['token_a'],
        lineageRecipientEmails: ['a@example.com'],
        lineageComparisonIds: ['comparison_1'],
      },
    },
  );

  const sentEvents = scopedHistory.filter((entry) => entry.event_type === 'proposal.sent');
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0]?.created_date || null, '2026-03-20T23:04:06.000Z');
});

test('shared-report sent-event scoping ignores broad snapshot recipient revisions/evaluations for sibling isolation', () => {
  const scopedHistory = buildSharedReportScopedActivityHistory(
    [
      {
        id: 'evt_send_a',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T23:04:06.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'a@example.com',
          },
          recipientRevisions: [
            { id: 'rev_a', sharedLinkId: 'share_a' },
            { id: 'rev_b', sharedLinkId: 'share_b' },
          ],
          evaluations: [
            { id: 'eval_a', sharedLinkId: 'share_a', revisionId: 'rev_a' },
            { id: 'eval_b', sharedLinkId: 'share_b', revisionId: 'rev_b' },
          ],
        },
      },
      {
        id: 'evt_send_b',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T23:04:23.000Z',
        eventData: {
          recipient_email: 'b@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'b@example.com',
          },
          recipientRevisions: [
            { id: 'rev_a', sharedLinkId: 'share_a' },
            { id: 'rev_b', sharedLinkId: 'share_b' },
          ],
          evaluations: [
            { id: 'eval_a', sharedLinkId: 'share_a', revisionId: 'rev_a' },
            { id: 'eval_b', sharedLinkId: 'share_b', revisionId: 'rev_b' },
          ],
        },
      },
    ],
    {
      accessMode: 'recipient',
      limit: 10,
      scope: {
        lineageLinkIds: ['share_a'],
        lineageRecipientEmails: ['a@example.com'],
        lineageRevisionIds: ['rev_a'],
        lineageEvaluationRunIds: ['eval_a'],
      },
    },
  );

  const sentEvents = scopedHistory.filter((entry) => entry.event_type === 'proposal.sent');
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0]?.created_date || null, '2026-03-20T23:04:06.000Z');
});

test('shared-report sent-event fallback keeps only one recipient-scoped event when multiple weak matches exist', () => {
  const scopedHistory = buildSharedReportScopedActivityHistory(
    [
      {
        id: 'evt_sent_old',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T10:00:00.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'a@example.com',
          },
        },
      },
      {
        id: 'evt_sent_new',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T10:05:00.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'a@example.com',
          },
        },
      },
    ],
    {
      accessMode: 'recipient',
      limit: 10,
      scope: {
        lineageRecipientEmails: ['a@example.com'],
      },
    },
  );

  const sentEvents = scopedHistory.filter((entry) => entry.event_type === 'proposal.sent');
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0]?.id || null, 'evt_sent_new');
});

test('shared-report sent-event strong lineage match suppresses weaker recipient-only duplicates', () => {
  const scopedHistory = buildSharedReportScopedActivityHistory(
    [
      {
        id: 'evt_sent_strong',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T10:00:00.000Z',
        eventData: {
          shared_link_id: 'share_a',
          recipient_email: 'a@example.com',
        },
      },
      {
        id: 'evt_sent_weak',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-20T10:05:00.000Z',
        eventData: {
          recipient_email: 'a@example.com',
        },
        versionSnapshot: {
          proposal: {
            partyBEmail: 'a@example.com',
          },
        },
      },
    ],
    {
      accessMode: 'recipient',
      limit: 10,
      scope: {
        lineageLinkIds: ['share_a'],
        lineageRecipientEmails: ['a@example.com'],
      },
    },
  );

  const sentEvents = scopedHistory.filter((entry) => entry.event_type === 'proposal.sent');
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0]?.id || null, 'evt_sent_strong');
});
