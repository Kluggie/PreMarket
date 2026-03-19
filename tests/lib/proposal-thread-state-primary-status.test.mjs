import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProposalPrimaryStatus } from '../../server/_lib/proposal-thread-state.js';

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
    deriveProposalPrimaryStatus({ bucket: 'closed', finalStatus: 'won' }),
    { key: 'closed_won', label: 'Closed: Won' },
  );
  assert.deepEqual(
    deriveProposalPrimaryStatus({ bucket: 'closed', finalStatus: 'lost' }),
    { key: 'closed_lost', label: 'Closed: Lost' },
  );
});
