export const AGREED_LABEL = 'Agreed';
export const AGREEMENT_REQUESTED_LABEL = 'Agreement Requested';
export const REQUEST_AGREEMENT_LABEL = 'Request Agreement';
export const CONFIRM_AGREEMENT_LABEL = 'Confirm Agreement';

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

export function getAgreementActionLabel(outcome = {}) {
  return outcome?.requested_by_counterparty ? CONFIRM_AGREEMENT_LABEL : REQUEST_AGREEMENT_LABEL;
}

export function shouldConfirmRequestAgreement(outcome = {}) {
  return !Boolean(outcome?.requested_by_counterparty);
}
