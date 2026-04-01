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
        versionSnapshot: {
          sharedLinks: [{ id: 'share_a', token: 'token_a', recipientEmail: 'a@example.com' }],
        },
      },
      {
        id: 'evt_send_b',
        eventType: 'proposal.sent',
        actorRole: 'party_a',
        createdAt: '2026-03-25T10:01:00.000Z',
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
