function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function normalizePerspectiveRole(value) {
  const normalized = asLower(value);
  if (normalized === 'you') {
    return 'you';
  }
  if (normalized === 'counterparty') {
    return 'counterparty';
  }
  return '';
}

function normalizeActorRole(value) {
  const normalized = asLower(value);
  if (normalized === 'party_a') {
    return 'party_a';
  }
  if (normalized === 'party_b') {
    return 'party_b';
  }
  return '';
}

export function formatProposalOwnershipLabel(proposal = {}) {
  const startedBy = normalizePerspectiveRole(proposal?.started_by_role);
  if (startedBy === 'you') {
    return 'Our proposal';
  }
  if (startedBy === 'counterparty') {
    return 'Their proposal';
  }

  const actorRole = normalizeActorRole(proposal?.outcome?.actor_role);
  if (actorRole === 'party_a') {
    return 'Our proposal';
  }
  if (actorRole === 'party_b') {
    return 'Their proposal';
  }

  return 'Our proposal';
}

export function formatExchangeCountLabel(count) {
  const numeric = Number(count);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '0 exchanges';
  }
  const rounded = Math.floor(numeric);
  return `${rounded} exchange${rounded === 1 ? '' : 's'}`;
}

export function buildCompactProposalSubtitle(proposal = {}) {
  const ownership = formatProposalOwnershipLabel(proposal);
  const exchanges = formatExchangeCountLabel(proposal?.exchange_count);
  return `${ownership} · ${exchanges}`;
}
