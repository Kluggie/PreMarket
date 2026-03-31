import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSharedReportStatusBanner,
  getProposalThreadUiState,
} from '../../src/lib/proposalThreadStatusUi.js';

test('thread status UI state honors canonical primary status fields from the API row', () => {
  const threadState = getProposalThreadUiState({
    thread_bucket: 'inbox',
    primary_status_key: 'waiting_on_counterparty',
    primary_status_label: 'Requested Agreement',
    waiting_on_other_party: true,
    needs_response: false,
  });

  assert.equal(threadState.bucket, 'inbox');
  assert.equal(threadState.primaryStatusKey, 'waiting_on_counterparty');
  assert.equal(threadState.primaryStatusLabel, 'Requested Agreement');
  assert.equal(threadState.waitingOnCounterparty, true);
  assert.equal(threadState.requiresViewerAction, false);
});

test('thread status UI state derives fallback direction semantics when canonical key is missing', () => {
  const needsReply = getProposalThreadUiState({
    thread_bucket: 'inbox',
    latest_direction: 'received',
    needs_response: true,
    waiting_on_other_party: false,
  });
  assert.equal(needsReply.primaryStatusKey, 'needs_reply');
  assert.equal(needsReply.requiresViewerAction, true);
  assert.equal(needsReply.waitingOnCounterparty, false);

  const waiting = getProposalThreadUiState({
    thread_bucket: 'inbox',
    latest_direction: 'sent',
    needs_response: false,
    waiting_on_other_party: true,
  });
  assert.equal(waiting.primaryStatusKey, 'waiting_on_counterparty');
  assert.equal(waiting.requiresViewerAction, false);
  assert.equal(waiting.waitingOnCounterparty, true);
});

test('shared report banner copy does not claim sent state when canonical status says viewer must reply', () => {
  const banner = buildSharedReportStatusBanner({
    proposal: {
      thread_bucket: 'inbox',
      primary_status_key: 'needs_reply',
      primary_status_label: 'Needs Reply',
    },
    counterpartyNoun: 'proposer',
    sentAtText: '3/30/2026, 9:14:20 PM',
  });

  assert.equal(banner?.text, 'Needs your reply.');
  assert.equal(String(banner?.text || '').toLowerCase().includes('sent on'), false);
});

test('shared report banner copy reflects waiting state with send timestamp only when waiting is canonical', () => {
  const banner = buildSharedReportStatusBanner({
    proposal: {
      thread_bucket: 'inbox',
      primary_status_key: 'waiting_on_counterparty',
      primary_status_label: 'Waiting on Counterparty',
    },
    counterpartyNoun: 'proposer',
    sentAtText: '3/30/2026, 9:14:20 PM',
  });

  assert.equal(banner?.tone, 'success');
  assert.equal(banner?.text, 'Waiting on proposer - sent on 3/30/2026, 9:14:20 PM.');
});
