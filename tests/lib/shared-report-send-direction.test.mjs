import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSharedReportTurnCopy,
  getContextualPartyLabel,
  getCounterpartyRole,
  getSharedReportSendActionLabel,
  normalizeSharedReportPartyRole,
} from '../../src/lib/sharedReportSendDirection.js';

test('send direction: proposer editing targets recipient (default neutral labels)', () => {
  const copy = buildSharedReportTurnCopy('proposer');
  assert.equal(copy.actorRole, 'proposer');
  assert.equal(copy.counterpartyRole, 'recipient');
  assert.equal(copy.counterpartyDisplay, 'the other party');
  assert.equal(copy.sendCtaLabel, 'Send to the other party');
  assert.equal(copy.sentCtaLabel, 'Sent to the other party');
  assert.equal(copy.signInToSendLabel, 'Please sign in to send updates to the other party.');
  assert.equal(copy.step3Description, 'Run and review your AI mediation review.');
  assert.equal(copy.noReportMessage, 'No mediation review is available yet. Run AI Mediation to generate one.');
  assert.equal(copy.proposalDetailsDescription, 'Read-only current opportunity state after your edits.');
});

test('send direction: recipient editing targets proposer (default neutral labels)', () => {
  const copy = buildSharedReportTurnCopy('recipient');
  assert.equal(copy.actorRole, 'recipient');
  assert.equal(copy.counterpartyRole, 'proposer');
  assert.equal(copy.counterpartyDisplay, 'the other party');
  assert.equal(copy.sendCtaLabel, 'Send to the other party');
  assert.equal(copy.sentCtaLabel, 'Sent to the other party');
  assert.equal(copy.signInToSendLabel, 'Please sign in to send updates to the other party.');
});

test('send direction: counterpartyName overrides neutral fallback', () => {
  const copy = buildSharedReportTurnCopy('recipient', { counterpartyName: 'Acme Corp' });
  assert.equal(copy.counterpartyDisplay, 'Acme Corp');
  assert.equal(copy.sendCtaLabel, 'Send to Acme Corp');
  assert.equal(copy.sentCtaLabel, 'Sent to Acme Corp');
  assert.equal(copy.signInToSendLabel, 'Please sign in to send updates to Acme Corp.');
  // Actor-side labels always use "your" regardless
  assert.equal(copy.step3Description, 'Run and review your AI mediation review.');
});

test('send direction: roles flip correctly over repeated back-and-forth rounds', () => {
  const actorRoles = ['recipient', 'proposer', 'recipient', 'proposer', 'recipient'];
  const expectedTargets = ['proposer', 'recipient', 'proposer', 'recipient', 'proposer'];

  actorRoles.forEach((actorRole, index) => {
    const normalizedActor = normalizeSharedReportPartyRole(actorRole);
    const targetRole = getCounterpartyRole(normalizedActor);
    assert.equal(targetRole, expectedTargets[index]);
    const actionLabel = getSharedReportSendActionLabel(actorRole);
    assert.equal(actionLabel, 'Send to the other party');
  });
});

test('send direction: pending and sent labels stay aligned with computed target', () => {
  assert.equal(
    getSharedReportSendActionLabel('proposer', { isPending: true }),
    'Sending...',
  );
  assert.equal(
    getSharedReportSendActionLabel('proposer', { isSent: true }),
    'Sent to the other party',
  );
  assert.equal(
    getSharedReportSendActionLabel('recipient', { isSent: true }),
    'Sent to the other party',
  );
});

test('send direction: getSharedReportSendActionLabel forwards counterpartyName', () => {
  assert.equal(
    getSharedReportSendActionLabel('proposer', { counterpartyName: 'Globex Inc' }),
    'Send to Globex Inc',
  );
  assert.equal(
    getSharedReportSendActionLabel('proposer', { isSent: true, counterpartyName: 'Globex Inc' }),
    'Sent to Globex Inc',
  );
});

test('contextual party label: returns "You" for viewer role', () => {
  assert.equal(getContextualPartyLabel('recipient', { viewerRole: 'recipient' }), 'You');
  assert.equal(getContextualPartyLabel('proposer', { viewerRole: 'proposer' }), 'You');
});

test('contextual party label: uses proposerName for proposer role', () => {
  assert.equal(
    getContextualPartyLabel('proposer', { viewerRole: 'recipient', proposerName: 'Alice Smith' }),
    'Alice Smith',
  );
});

test('contextual party label: uses recipientName for recipient role', () => {
  assert.equal(
    getContextualPartyLabel('recipient', { viewerRole: 'proposer', recipientName: 'Globex Inc' }),
    'Globex Inc',
  );
});

test('contextual party label: prefers company name over email for display', () => {
  // When company name is provided it should be used, not an email
  assert.equal(
    getContextualPartyLabel('proposer', { viewerRole: 'recipient', proposerName: 'Alice Smith' }),
    'Alice Smith',
  );
  // Only company name should appear — do NOT accept email
  assert.notEqual(
    getContextualPartyLabel('proposer', { viewerRole: 'recipient', proposerName: 'Alice Smith' }),
    'alice@example.com',
  );
});

test('contextual party label: returns "Other party" when no name provided', () => {
  assert.equal(getContextualPartyLabel('proposer', { viewerRole: 'recipient' }), 'Other party');
  assert.equal(getContextualPartyLabel('recipient', { viewerRole: 'proposer' }), 'Other party');
});

test('contextual party label: returns "Other party" with no options', () => {
  assert.equal(getContextualPartyLabel('proposer'), 'Other party');
});
