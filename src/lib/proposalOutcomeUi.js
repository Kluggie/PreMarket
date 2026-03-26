export const AGREED_LABEL = 'Agreed';
export const AGREEMENT_REQUESTED_LABEL = 'Agreement Requested';
export const REQUEST_AGREEMENT_LABEL = 'Request Agreement';
export const CONFIRM_AGREEMENT_LABEL = 'Confirm Agreement';
export const CONTINUE_NEGOTIATING_LABEL = 'Continue Negotiating';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getVisibleProposalStatusLabel(status) {
  const normalized = asText(status).toLowerCase();
  if (normalized === 'won') {
    return AGREED_LABEL;
  }
  return '';
}

export function getPendingAgreementBadgeLabel() {
  return AGREEMENT_REQUESTED_LABEL;
}

export function isCounterpartyAgreementRequestPending(outcome = {}) {
  return Boolean(outcome?.requested_by_counterparty);
}

export function getAgreementActionLabel(outcome = {}) {
  return isCounterpartyAgreementRequestPending(outcome)
    ? CONFIRM_AGREEMENT_LABEL
    : REQUEST_AGREEMENT_LABEL;
}

export function shouldConfirmRequestAgreement(outcome = {}) {
  return !isCounterpartyAgreementRequestPending(outcome);
}

export function shouldShowContinueNegotiating(outcome = {}) {
  return isCounterpartyAgreementRequestPending(outcome);
}

export function getPendingAgreementMessage(outcome = {}, entityLabel = 'opportunity') {
  const normalizedEntityLabel = asText(entityLabel) || 'opportunity';
  if (isCounterpartyAgreementRequestPending(outcome)) {
    return `The counterparty requested agreement on this ${normalizedEntityLabel}. Confirm the agreement, continue negotiating, or mark it lost.`;
  }
  if (outcome?.requested_by_current_user) {
    return `You requested agreement on this ${normalizedEntityLabel}. It becomes ${AGREED_LABEL.toLowerCase()} only after the counterparty confirms the agreement.`;
  }
  return '';
}

export function getOutcomeHelperText(outcome = {}, entityLabel = 'opportunity') {
  const normalizedEntityLabel = asText(entityLabel) || 'opportunity';
  if (outcome?.requested_by_current_user) {
    return 'Waiting for the counterparty to confirm the agreement.';
  }
  if (isCounterpartyAgreementRequestPending(outcome)) {
    return `The counterparty requested agreement on this ${normalizedEntityLabel}. Confirm the agreement, continue negotiating, or mark it lost.`;
  }
  if (!outcome?.can_mark_won) {
    return asText(outcome?.eligibility_reason_won) || asText(outcome?.eligibility_reason);
  }
  if (!outcome?.can_mark_lost) {
    return asText(outcome?.eligibility_reason_lost) || asText(outcome?.eligibility_reason);
  }
  if (shouldShowContinueNegotiating(outcome) && !outcome?.can_continue_negotiating) {
    return (
      asText(outcome?.eligibility_reason_continue_negotiating) ||
      asText(outcome?.eligibility_reason)
    );
  }
  return '';
}

export function getOutcomeToastMessage(proposal = {}) {
  const normalizedState = asText(proposal?.outcome?.state || proposal?.status).toLowerCase();
  if (normalizedState === 'pending_won') {
    return AGREEMENT_REQUESTED_LABEL;
  }
  if (normalizedState === 'won') {
    return 'Marked as Agreed';
  }
  if (normalizedState === 'lost') {
    return 'Marked as Lost';
  }
  return 'Continued Negotiating';
}
