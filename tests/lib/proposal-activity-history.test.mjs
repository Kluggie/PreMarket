import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProposalActivityHistory } from '../../server/_lib/proposal-activity.js';

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
