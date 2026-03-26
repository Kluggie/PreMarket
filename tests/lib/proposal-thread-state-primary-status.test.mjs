import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProposalPrimaryStatus,
  getProposalThreadState,
  matchesProposalThreadOrigin,
} from '../../server/_lib/proposal-thread-state.js';

test('deriveProposalPrimaryStatus maps active thread states into the canonical model', () => {
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'drafts' }),
    { key: 'draft', label: 'Draft' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'inbox', latestDirection: 'received', needsResponse: true }),
    { key: 'needs_reply', label: 'Needs Reply' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({
      bucket: 'inbox',
      latestDirection: 'received',
      needsResponse: true,
      reviewStatus: 'under_verification',
    }),
    { key: 'under_review', label: 'Under Review' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'inbox', latestDirection: 'sent', waitingOnOtherParty: true }),
    { key: 'waiting_on_counterparty', label: 'Waiting on Counterparty' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({
      bucket: 'inbox',
      latestDirection: 'received',
      waitingOnOtherParty: true,
      reviewStatus: 'under_verification',
      agreementRequestedByCurrentUser: true,
    }),
    { key: 'waiting_on_counterparty', label: 'Requested Agreement' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'closed', finalStatus: 'won' }),
    { key: 'closed_won', label: 'Closed: Won' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'closed', finalStatus: 'lost' }),
    { key: 'closed_lost', label: 'Closed: Lost' },
  );
});

test('thread context derives started-by and last-update roles for each viewer perspective', () => {
  const baseProposal = {
    id: 'proposal_thread_context_test',
    userId: 'owner_user',
    status: 'sent',
    sentAt: '2026-03-19T08:00:00.000Z',
    createdAt: '2026-03-19T08:00:00.000Z',
    updatedAt: '2026-03-19T08:10:00.000Z',
    lastThreadActivityAt: '2026-03-19T08:10:00.000Z',
    lastThreadActorRole: 'party_b',
    lastThreadActivityType: 'proposal.send_back',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'counterparty@example.com',
  };

  const ownerView = getProposalThreadState(
    baseProposal,
    { id: 'owner_user', email: 'owner@example.com' },
    {
      actorRole: 'party_a',
      outcome: {
        actor_role: 'party_a',
        final_status: 'sent',
        pending: false,
        requested_by_current_user: false,
        requested_by_counterparty: false,
      },
    },
  );
  assert.equal(ownerView.startedByRole, 'you');
  assert.equal(ownerView.lastUpdateByRole, 'counterparty');
  assert.equal(ownerView.exchangeCount, 2);
  assert.equal(matchesProposalThreadOrigin(ownerView, 'started_by_you'), true);
  assert.equal(matchesProposalThreadOrigin(ownerView, 'started_by_counterparty'), false);

  const counterpartyView = getProposalThreadState(
    baseProposal,
    { id: 'counterparty_user', email: 'counterparty@example.com' },
    {
      actorRole: 'party_b',
      outcome: {
        actor_role: 'party_b',
        final_status: 'sent',
        pending: false,
        requested_by_current_user: false,
        requested_by_counterparty: false,
      },
    },
  );
  assert.equal(counterpartyView.startedByRole, 'counterparty');
  assert.equal(counterpartyView.lastUpdateByRole, 'you');
  assert.equal(counterpartyView.exchangeCount, 2);
  assert.equal(matchesProposalThreadOrigin(counterpartyView, 'started_by_counterparty'), true);
  assert.equal(matchesProposalThreadOrigin(counterpartyView, 'started_by_you'), false);
});

test('thread context uses canonical exchange count override when provided', () => {
  const proposal = {
    id: 'proposal_thread_exchange_override',
    userId: 'owner_user',
    status: 'sent',
    sentAt: '2026-03-19T08:00:00.000Z',
    createdAt: '2026-03-19T08:00:00.000Z',
    updatedAt: '2026-03-19T08:10:00.000Z',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'counterparty@example.com',
  };
  const threadState = getProposalThreadState(
    proposal,
    { id: 'owner_user', email: 'owner@example.com' },
    {
      actorRole: 'party_a',
      exchangeCount: 7,
      outcome: {
        actor_role: 'party_a',
        final_status: 'sent',
        pending: false,
        requested_by_current_user: false,
        requested_by_counterparty: false,
      },
    },
  );
  assert.equal(threadState.exchangeCount, 7);
});

test('clearing a pending agreement request returns the thread to active review state', () => {
  const proposal = {
    id: 'proposal_thread_continue_negotiating',
    userId: 'owner_user',
    status: 'under_verification',
    sentAt: '2026-03-19T08:00:00.000Z',
    createdAt: '2026-03-19T08:00:00.000Z',
    updatedAt: '2026-03-19T08:20:00.000Z',
    lastThreadActivityAt: '2026-03-19T08:20:00.000Z',
    lastThreadActorRole: 'party_b',
    lastThreadActivityType: 'proposal.outcome.continue_negotiation',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'counterparty@example.com',
  };

  const ownerView = getProposalThreadState(
    proposal,
    { id: 'owner_user', email: 'owner@example.com' },
    {
      actorRole: 'party_a',
      outcome: {
        actor_role: 'party_a',
        state: 'open',
        final_status: null,
        pending: false,
        requested_by_current_user: false,
        requested_by_counterparty: false,
      },
    },
  );
  assert.equal(ownerView.bucket, 'inbox');
  assert.equal(ownerView.isClosed, false);
  assert.equal(ownerView.primaryStatusKey, 'under_review');
  assert.equal(ownerView.primaryStatusLabel, 'Under Review');

  const counterpartyView = getProposalThreadState(
    proposal,
    { id: 'counterparty_user', email: 'counterparty@example.com' },
    {
      actorRole: 'party_b',
      outcome: {
        actor_role: 'party_b',
        state: 'open',
        final_status: null,
        pending: false,
        requested_by_current_user: false,
        requested_by_counterparty: false,
      },
    },
  );
  assert.equal(counterpartyView.bucket, 'inbox');
  assert.equal(counterpartyView.isClosed, false);
  assert.equal(counterpartyView.primaryStatusKey, 'waiting_on_counterparty');
  assert.equal(counterpartyView.primaryStatusLabel, 'Waiting on Counterparty');
});
