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

export function formatStartedByLabel(role) {
  const normalized = normalizePerspectiveRole(role);
  return normalized ? `Started by ${normalized}` : '';
}

export function formatLastUpdateByLabel(role) {
  const normalized = normalizePerspectiveRole(role);
  return normalized ? `Last update from ${normalized}` : '';
}

export function formatExchangeCountLabel(count) {
  const numeric = Number(count);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  const rounded = Math.floor(numeric);
  return `${rounded} exchange${rounded === 1 ? '' : 's'}`;
}

export function buildThreadContextParts(proposal = {}, options = {}) {
  const parts = [];
  const startedBy = formatStartedByLabel(proposal?.started_by_role);
  const lastUpdate = formatLastUpdateByLabel(proposal?.last_update_by_role);
  if (startedBy) {
    parts.push(startedBy);
  }
  if (lastUpdate) {
    parts.push(lastUpdate);
  }
  if (options.includeExchangeCount) {
    const exchanges = formatExchangeCountLabel(proposal?.exchange_count);
    if (exchanges) {
      parts.push(exchanges);
    }
  }
  return parts;
}
