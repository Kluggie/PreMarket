export const AGREED_LABEL = 'Agreed';
export const AGREEMENT_REQUESTED_LABEL = 'Agreement Requested';
export const REQUEST_AGREEMENT_LABEL = 'Request Agreement';
export const CONFIRM_TERMS_LABEL = 'Confirm Terms';
export const AWAITING_YOUR_CONFIRMATION_LABEL = 'Awaiting Your Confirmation';

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

export function getPendingAgreementBadgeLabel(outcome = {}) {
  return outcome?.requested_by_counterparty ? CONFIRM_TERMS_LABEL : AGREEMENT_REQUESTED_LABEL;
}

export function getAgreementActionLabel(outcome = {}) {
  return outcome?.requested_by_counterparty ? CONFIRM_TERMS_LABEL : REQUEST_AGREEMENT_LABEL;
}
