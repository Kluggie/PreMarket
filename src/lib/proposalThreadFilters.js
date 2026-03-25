function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

const TAB_ALIASES = {};

const TAB_VALUES = new Set(['inbox', 'drafts', 'closed', 'archived', 'all', 'sent', 'received', 'mutual_interest']);
const STATUS_FILTER_VALUES = new Set([
  'all',
  'needs_reply',
  'under_review',
  'waiting_on_counterparty',
  'win_confirmation_requested',
  'agreement_requested',
  'needs_response',
  'waiting_on_other_party',
  'mutual_interest',
  'closed_won',
  'closed_lost',
  'won',
  'lost',
]);
const STATUS_FILTER_ALIASES = {
  agreement_requested: 'win_confirmation_requested',
  needs_response: 'needs_reply',
  waiting_on_other_party: 'waiting_on_counterparty',
  waiting: 'waiting_on_counterparty',
  pending_win: 'win_confirmation_requested',
};
const ORIGIN_FILTER_VALUES = new Set([
  'all',
  'started_by_you',
  'started_by_counterparty',
]);
const ORIGIN_FILTER_ALIASES = {
  you: 'started_by_you',
  me: 'started_by_you',
  started_by_me: 'started_by_you',
  counterparty: 'started_by_counterparty',
  other: 'started_by_counterparty',
  started_by_other: 'started_by_counterparty',
};

export function normalizeProposalTabValue(value) {
  const nextValue = asLower(value);
  if (TAB_VALUES.has(nextValue)) {
    return nextValue;
  }
  return TAB_ALIASES[nextValue] || 'inbox';
}

export function normalizeProposalStatusFilterValue(value) {
  const nextValue = asLower(value);
  const aliasedValue = STATUS_FILTER_ALIASES[nextValue] || nextValue;
  return STATUS_FILTER_VALUES.has(aliasedValue) ? aliasedValue : 'all';
}

export function normalizeProposalOriginFilterValue(value) {
  const nextValue = asLower(value);
  const aliasedValue = ORIGIN_FILTER_ALIASES[nextValue] || nextValue;
  return ORIGIN_FILTER_VALUES.has(aliasedValue) ? aliasedValue : 'all';
}

export function matchesProposalThreadBucket(proposal, tab) {
  const normalizedTab = normalizeProposalTabValue(tab);
  const bucket = asLower(proposal?.thread_bucket);
  const listType = asLower(proposal?.list_type);

  switch (normalizedTab) {
    case 'inbox':
      return bucket === 'inbox';
    case 'drafts':
      return bucket === 'drafts';
    case 'closed':
      return bucket === 'closed';
    case 'archived':
      return bucket === 'archived';
    case 'sent':
      return bucket !== 'drafts' && bucket !== 'archived' && listType === 'sent';
    case 'received':
      return bucket !== 'drafts' && bucket !== 'archived' && listType === 'received';
    case 'mutual_interest':
      return bucket === 'inbox' && Boolean(proposal?.is_mutual_interest);
    case 'all':
    default:
      return bucket !== 'archived';
  }
}

export function matchesProposalThreadStatus(proposal, statusFilter) {
  const normalizedStatus = normalizeProposalStatusFilterValue(statusFilter);
  if (!normalizedStatus || normalizedStatus === 'all') {
    return true;
  }

  const primaryStatusKey = asLower(proposal?.primary_status_key);
  const latestDirection = asLower(proposal?.latest_direction);
  const directionalStatus = asLower(proposal?.directional_status);

  switch (normalizedStatus) {
    case 'draft':
      return primaryStatusKey === 'draft';
    case 'sent':
      return latestDirection === 'sent';
    case 'received':
      return latestDirection === 'received';
    case 'under_review':
      return primaryStatusKey === 'under_review';
    case 'needs_reply':
      return primaryStatusKey === 'needs_reply';
    case 'waiting_on_counterparty':
      return primaryStatusKey === 'waiting_on_counterparty';
    case 'mutual_interest':
      return Boolean(proposal?.is_mutual_interest);
    case 'win_confirmation_requested':
      return Boolean(proposal?.win_confirmation_requested);
    case 'closed_won':
    case 'won':
      return primaryStatusKey === 'closed_won';
    case 'closed_lost':
    case 'lost':
      return primaryStatusKey === 'closed_lost';
    default:
      return primaryStatusKey === normalizedStatus || directionalStatus === normalizedStatus;
  }
}

export function matchesProposalInboxFilter(proposal, inboxFilter) {
  const normalizedFilter = asLower(inboxFilter);
  if (!normalizedFilter || normalizedFilter === 'all') {
    return true;
  }

  if (asLower(proposal?.thread_bucket) !== 'inbox') {
    return false;
  }

  switch (normalizedFilter) {
    case 'needs_reply':
    case 'needs_response':
      return Boolean(proposal?.needs_response) && !Boolean(proposal?.win_confirmation_requested);
    case 'waiting_on_counterparty':
    case 'waiting_on_other_party':
      return Boolean(proposal?.waiting_on_other_party);
    case 'win_confirmation_requested':
    case 'agreement_requested':
      return Boolean(proposal?.win_confirmation_requested);
    default:
      return true;
  }
}

export function matchesProposalThreadOrigin(proposal, originFilter) {
  const normalizedOrigin = normalizeProposalOriginFilterValue(originFilter);
  if (!normalizedOrigin || normalizedOrigin === 'all') {
    return true;
  }

  const startedByRole = asLower(proposal?.started_by_role);
  if (normalizedOrigin === 'started_by_you') {
    return startedByRole === 'you';
  }
  if (normalizedOrigin === 'started_by_counterparty') {
    return startedByRole === 'counterparty';
  }

  return true;
}

export function matchesProposalSearch(proposal, query) {
  const normalizedQuery = asLower(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    proposal?.title,
    proposal?.template_name,
    proposal?.party_a_email,
    proposal?.party_b_email,
    proposal?.party_b_name,
    proposal?.counterparty_email,
    proposal?.summary,
  ]
    .map((value) => asText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');

  return haystack.includes(normalizedQuery);
}

export function matchesProposalListFilters(proposal, filters = {}) {
  const tab = normalizeProposalTabValue(filters.tab);
  return (
    matchesProposalThreadBucket(proposal, tab) &&
    matchesProposalThreadStatus(proposal, filters.status) &&
    matchesProposalThreadOrigin(proposal, filters.origin) &&
    matchesProposalSearch(proposal, filters.query) &&
    (tab === 'inbox' ? matchesProposalInboxFilter(proposal, filters.inbox) : true)
  );
}

export function getProposalSortTime(proposal) {
  const candidate = new Date(
    proposal?.last_activity_at ||
      proposal?.shared_report_last_updated_at ||
      proposal?.updated_at ||
      proposal?.updated_date ||
      proposal?.created_at ||
      proposal?.created_date ||
      0,
  );

  return Number.isNaN(candidate.getTime()) ? 0 : candidate.getTime();
}

export function sortProposalRowsDesc(left, right) {
  const timeDelta = getProposalSortTime(right) - getProposalSortTime(left);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return String(right?.id || '').localeCompare(String(left?.id || ''));
}
