import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGREED_LABEL,
  AGREEMENT_REQUESTED_LABEL,
  CONFIRM_AGREEMENT_LABEL,
  CONTINUE_NEGOTIATING_LABEL,
  REQUEST_AGREEMENT_LABEL,
  getAgreementActionLabel,
  getOutcomeHelperText,
  getOutcomeToastMessage,
  getPendingAgreementMessage,
  getPendingAgreementBadgeLabel,
  getVisibleProposalStatusLabel,
  shouldShowContinueNegotiating,
  shouldConfirmRequestAgreement,
} from '../../src/lib/proposalOutcomeUi.js';

test('agreement wording uses agreed for final state and never shows won for pending state labels', () => {
  assert.equal(getVisibleProposalStatusLabel('won'), AGREED_LABEL);
  assert.equal(getPendingAgreementBadgeLabel({ requested_by_counterparty: false }), AGREEMENT_REQUESTED_LABEL);
  assert.equal(getPendingAgreementBadgeLabel({ requested_by_counterparty: true }), AGREEMENT_REQUESTED_LABEL);
  assert.equal(getAgreementActionLabel({ requested_by_counterparty: false }), REQUEST_AGREEMENT_LABEL);
  assert.equal(getAgreementActionLabel({ requested_by_counterparty: true }), CONFIRM_AGREEMENT_LABEL);
  assert.equal(
    shouldShowContinueNegotiating({ requested_by_counterparty: true }),
    true,
  );
  assert.equal(
    shouldShowContinueNegotiating({ requested_by_counterparty: false }),
    false,
  );
  assert.equal(
    shouldConfirmRequestAgreement({ requested_by_counterparty: false }),
    true,
  );
  assert.equal(
    shouldConfirmRequestAgreement({ requested_by_counterparty: true }),
    false,
  );
  assert.match(
    getPendingAgreementMessage({ requested_by_counterparty: true }, 'opportunity'),
    /continue negotiating/i,
  );
  assert.match(
    getOutcomeHelperText({ requested_by_current_user: true }, 'proposal'),
    /Waiting for the counterparty to confirm the agreement\./,
  );
  assert.equal(
    getOutcomeToastMessage({ outcome: { state: 'open' } }),
    'Continued Negotiating',
  );

  const visibleLabels = [
    AGREED_LABEL,
    AGREEMENT_REQUESTED_LABEL,
    CONFIRM_AGREEMENT_LABEL,
    CONTINUE_NEGOTIATING_LABEL,
    REQUEST_AGREEMENT_LABEL,
  ];
  visibleLabels.forEach((label) => {
    assert.equal(/\bwon\b/i.test(label), false);
    assert.equal(/\bterms\b/i.test(label), false);
  });
});
