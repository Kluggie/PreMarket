import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSharedReportTurnCopy,
  getCounterpartyRole,
  getSharedReportSendActionLabel,
  normalizeSharedReportPartyRole,
} from '../../src/lib/sharedReportSendDirection.js';

test('send direction: proposer editing targets recipient', () => {
  const copy = buildSharedReportTurnCopy('proposer');
  assert.equal(copy.actorRole, 'proposer');
  assert.equal(copy.counterpartyRole, 'recipient');
  assert.equal(copy.sendCtaLabel, 'Send to recipient');
  assert.equal(copy.sentCtaLabel, 'Sent to recipient');
  assert.equal(copy.signInToSendLabel, 'Please sign in to send updates to the recipient.');
});

test('send direction: recipient editing targets proposer', () => {
  const copy = buildSharedReportTurnCopy('recipient');
  assert.equal(copy.actorRole, 'recipient');
  assert.equal(copy.counterpartyRole, 'proposer');
  assert.equal(copy.sendCtaLabel, 'Send to proposer');
  assert.equal(copy.sentCtaLabel, 'Sent to proposer');
  assert.equal(copy.signInToSendLabel, 'Please sign in to send updates to the proposer.');
});

test('send direction: roles flip correctly over repeated back-and-forth rounds', () => {
  const actorRoles = ['recipient', 'proposer', 'recipient', 'proposer', 'recipient'];
  const expectedTargets = ['proposer', 'recipient', 'proposer', 'recipient', 'proposer'];

  actorRoles.forEach((actorRole, index) => {
    const normalizedActor = normalizeSharedReportPartyRole(actorRole);
    const targetRole = getCounterpartyRole(normalizedActor);
    assert.equal(targetRole, expectedTargets[index]);
    const actionLabel = getSharedReportSendActionLabel(actorRole);
    assert.equal(actionLabel, `Send to ${expectedTargets[index]}`);
  });
});

test('send direction: pending and sent labels stay aligned with computed target', () => {
  assert.equal(
    getSharedReportSendActionLabel('proposer', { isPending: true }),
    'Sending...',
  );
  assert.equal(
    getSharedReportSendActionLabel('proposer', { isSent: true }),
    'Sent to recipient',
  );
  assert.equal(
    getSharedReportSendActionLabel('recipient', { isSent: true }),
    'Sent to proposer',
  );
});
