import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  applyUpdatedProposalToCaches,
  invalidateProposalThreadQueries,
  removeProposalFromCaches,
} from '../../src/lib/proposalThreadCache.js';

function makeProposal(overrides = {}) {
  return {
    id: 'proposal_cache_test',
    title: 'Cache Test Proposal',
    status: 'sent',
    thread_bucket: 'inbox',
    primary_status_key: 'needs_reply',
    primary_status_label: 'Needs Reply',
    directional_status: 'sent',
    list_type: 'sent',
    latest_direction: 'sent',
    started_by_role: 'you',
    last_update_by_role: 'you',
    exchange_count: 1,
    needs_response: false,
    waiting_on_other_party: true,
    win_confirmation_requested: false,
    review_status: null,
    is_mutual_interest: false,
    is_latest_version: true,
    counterparty_email: 'recipient@example.com',
    party_a_email: 'owner@example.com',
    party_b_email: 'recipient@example.com',
    summary: 'Initial summary',
    document_comparison_id: null,
    last_activity_at: '2026-03-25T10:00:00.000Z',
    created_at: '2026-03-25T09:00:00.000Z',
    updated_at: '2026-03-25T10:00:00.000Z',
    outcome: {
      actor_role: 'party_a',
      state: 'open',
      final_status: null,
      requested_by_current_user: false,
      requested_by_counterparty: false,
    },
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

test('applyUpdatedProposalToCaches moves a lost thread from Inbox to Closed caches', () => {
  const queryClient = createQueryClient();
  const openProposal = makeProposal();
  const lostProposal = makeProposal({
    status: 'lost',
    thread_bucket: 'closed',
    primary_status_key: 'closed_lost',
    primary_status_label: 'Closed: Lost',
    directional_status: 'lost',
    waiting_on_other_party: false,
    last_activity_at: '2026-03-25T11:00:00.000Z',
    outcome: {
      actor_role: 'party_a',
      state: 'lost',
      final_status: 'lost',
      requested_by_current_user: false,
      requested_by_counterparty: false,
    },
  });

  queryClient.setQueryData(['proposals-list', 'inbox', 'all', 'all', '', null], {
    proposals: [openProposal],
    page: { limit: 20, nextCursor: null, hasMore: false },
  });
  queryClient.setQueryData(['proposals-list', 'closed', 'all', 'all', '', null], {
    proposals: [],
    page: { limit: 20, nextCursor: null, hasMore: false },
  });
  queryClient.setQueryData(['dashboard-proposals-all'], [openProposal]);

  applyUpdatedProposalToCaches(queryClient, lostProposal);

  const inboxData = queryClient.getQueryData(['proposals-list', 'inbox', 'all', 'all', '', null]);
  const closedData = queryClient.getQueryData(['proposals-list', 'closed', 'all', 'all', '', null]);
  const dashboardRows = queryClient.getQueryData(['dashboard-proposals-all']);

  assert.equal(inboxData.proposals.some((proposal) => proposal.id === lostProposal.id), false);
  assert.equal(closedData.proposals.some((proposal) => proposal.id === lostProposal.id), true);
  assert.equal(closedData.proposals[0].status, 'lost');
  assert.equal(dashboardRows.some((proposal) => proposal.id === lostProposal.id), true);
  assert.equal(dashboardRows[0].thread_bucket, 'closed');
});

test('applyUpdatedProposalToCaches keeps current-user agreement requests out of review widgets', () => {
  const queryClient = createQueryClient();
  const openProposal = makeProposal();
  const pendingWonProposal = makeProposal({
    status: 'sent',
    thread_bucket: 'inbox',
    primary_status_key: 'waiting_on_counterparty',
    primary_status_label: 'Requested Agreement',
    waiting_on_other_party: true,
    win_confirmation_requested: false,
    last_activity_at: '2026-03-25T11:30:00.000Z',
    outcome: {
      actor_role: 'party_a',
      state: 'pending_won',
      final_status: null,
      requested_by_current_user: true,
      requested_by_counterparty: false,
    },
  });

  queryClient.setQueryData(['proposals-list', 'inbox', 'all', 'all', '', null], {
    proposals: [openProposal],
    page: { limit: 20, nextCursor: null, hasMore: false },
  });
  queryClient.setQueryData(['dashboard-proposals-all'], [openProposal]);
  queryClient.setQueryData(['dashboard-proposals-agreement-requests'], [openProposal]);

  applyUpdatedProposalToCaches(queryClient, pendingWonProposal);

  const inboxData = queryClient.getQueryData(['proposals-list', 'inbox', 'all', 'all', '', null]);
  const dashboardRows = queryClient.getQueryData(['dashboard-proposals-all']);
  const agreementRequests = queryClient.getQueryData(['dashboard-proposals-agreement-requests']);

  assert.equal(inboxData.proposals.some((proposal) => proposal.id === pendingWonProposal.id), true);
  assert.equal(dashboardRows.some((proposal) => proposal.id === pendingWonProposal.id), true);
  assert.equal(agreementRequests.some((proposal) => proposal.id === pendingWonProposal.id), false);
  assert.equal(inboxData.proposals[0].outcome.state, 'pending_won');
  assert.equal(inboxData.proposals[0].primary_status_label, 'Requested Agreement');
});

test('removeProposalFromCaches removes deleted rows from list and dashboard caches', () => {
  const queryClient = createQueryClient();
  const proposal = makeProposal();

  queryClient.setQueryData(['proposals-list', 'inbox', 'all', 'all', '', null], {
    proposals: [proposal],
    page: { limit: 20, nextCursor: null, hasMore: false },
  });
  queryClient.setQueryData(['dashboard-proposals-all'], [proposal]);
  queryClient.setQueryData(['dashboard-proposals-agreement-requests'], [proposal]);

  removeProposalFromCaches(queryClient, proposal.id);

  const inboxData = queryClient.getQueryData(['proposals-list', 'inbox', 'all', 'all', '', null]);
  const dashboardRows = queryClient.getQueryData(['dashboard-proposals-all']);
  const agreementRequests = queryClient.getQueryData(['dashboard-proposals-agreement-requests']);

  assert.equal(inboxData.proposals.some((row) => row.id === proposal.id), false);
  assert.equal(dashboardRows.some((row) => row.id === proposal.id), false);
  assert.equal(agreementRequests.some((row) => row.id === proposal.id), false);
});

test('invalidateProposalThreadQueries targets proposal lists, dashboards, and linked detail caches', async () => {
  const calls = [];
  const queryClient = {
    invalidateQueries: async (filters) => {
      calls.push(filters);
    },
  };

  await invalidateProposalThreadQueries(queryClient, {
    proposalId: 'proposal_cache_test',
    documentComparisonId: 'comparison_cache_test',
  });

  assert.deepEqual(calls, [
    { queryKey: ['proposal-linked-comparison', 'comparison_cache_test'] },
    { queryKey: ['proposal-detail', 'proposal_cache_test'] },
    { queryKey: ['proposals-list'] },
    { queryKey: ['dashboard-summary'] },
    { queryKey: ['dashboard-activity'] },
    { queryKey: ['dashboard-proposals-all'] },
    { queryKey: ['dashboard-proposals-agreement-requests'] },
  ]);
});
