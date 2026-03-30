const PROPOSER_ROLE = 'proposer';
const RECIPIENT_ROLE = 'recipient';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSharedReportPartyRole(value, fallback = RECIPIENT_ROLE) {
  const normalized = asText(value).toLowerCase();
  if (normalized === PROPOSER_ROLE) {
    return PROPOSER_ROLE;
  }
  if (normalized === RECIPIENT_ROLE) {
    return RECIPIENT_ROLE;
  }
  return asText(fallback).toLowerCase() === PROPOSER_ROLE ? PROPOSER_ROLE : RECIPIENT_ROLE;
}

export function getCounterpartyRole(role) {
  return normalizeSharedReportPartyRole(role) === PROPOSER_ROLE
    ? RECIPIENT_ROLE
    : PROPOSER_ROLE;
}

export function getSharedReportPartyNoun(role) {
  return normalizeSharedReportPartyRole(role) === PROPOSER_ROLE ? 'proposer' : 'recipient';
}

export function getSharedReportPartyLabel(role) {
  return getSharedReportPartyNoun(role) === 'proposer' ? 'Proposer' : 'Recipient';
}

export function buildSharedReportTurnCopy(draftAuthorRole) {
  const actorRole = normalizeSharedReportPartyRole(draftAuthorRole);
  const actorNoun = getSharedReportPartyNoun(actorRole);
  const counterpartyRole = getCounterpartyRole(actorRole);
  const counterpartyNoun = getSharedReportPartyNoun(counterpartyRole);

  return {
    actorRole,
    actorNoun,
    actorLabel: getSharedReportPartyLabel(actorRole),
    counterpartyRole,
    counterpartyNoun,
    counterpartyLabel: getSharedReportPartyLabel(counterpartyRole),
    sendCtaLabel: `Send to ${counterpartyNoun}`,
    sentCtaLabel: `Sent to ${counterpartyNoun}`,
    signInToSendLabel: `Please sign in to send updates to the ${counterpartyNoun}.`,
    step3Description: `Run and review the latest ${actorNoun}-side AI mediation review.`,
    noReportMessage: `No ${actorNoun} mediation review is available yet. Run AI Mediation to generate one.`,
    proposalDetailsDescription: `Read-only current opportunity state after ${actorNoun} edits.`,
  };
}

export function getSharedReportSendActionLabel(draftAuthorRole, { isSent = false, isPending = false } = {}) {
  const copy = buildSharedReportTurnCopy(draftAuthorRole);
  if (isSent) {
    return copy.sentCtaLabel;
  }
  if (isPending) {
    return 'Sending...';
  }
  return copy.sendCtaLabel;
}
