function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

const KNOWN_PRIMARY_STATUS_KEYS = new Set([
  'draft',
  'needs_reply',
  'under_review',
  'waiting_on_counterparty',
  'closed_won',
  'closed_lost',
]);

const PRIMARY_STATUS_KEY_ALIASES = {
  needs_response: 'needs_reply',
  waiting_on_other_party: 'waiting_on_counterparty',
  won: 'closed_won',
  lost: 'closed_lost',
};

const PRIMARY_STATUS_LABELS = {
  draft: 'Draft',
  needs_reply: 'Needs Reply',
  under_review: 'Under Review',
  waiting_on_counterparty: 'Waiting on Counterparty',
  closed_won: 'Closed: Won',
  closed_lost: 'Closed: Lost',
};

function normalizePrimaryStatusKey(value) {
  const normalized = asLower(value);
  const aliased = PRIMARY_STATUS_KEY_ALIASES[normalized] || normalized;
  return KNOWN_PRIMARY_STATUS_KEYS.has(aliased) ? aliased : '';
}

function normalizeBucket(value) {
  const normalized = asLower(value);
  if (normalized === 'inbox') return 'inbox';
  if (normalized === 'drafts') return 'drafts';
  if (normalized === 'closed') return 'closed';
  if (normalized === 'archived') return 'archived';
  return '';
}

function deriveFallbackPrimaryStatusKey(proposal, bucket) {
  if (bucket === 'drafts') {
    return 'draft';
  }

  const finalStatus = asLower(proposal?.outcome?.state || proposal?.status);
  if (bucket === 'closed' || finalStatus === 'won' || finalStatus === 'lost') {
    return finalStatus === 'lost' ? 'closed_lost' : 'closed_won';
  }

  const latestDirection = asLower(proposal?.latest_direction);
  const needsResponse = Boolean(proposal?.needs_response);
  const waitingOnOtherParty = Boolean(proposal?.waiting_on_other_party);
  const hasReviewStatus = Boolean(asText(proposal?.review_status));

  const inboundActionNeeded = needsResponse || latestDirection === 'received';

  if (hasReviewStatus && inboundActionNeeded) {
    return 'under_review';
  }
  if (waitingOnOtherParty && !inboundActionNeeded) {
    return 'waiting_on_counterparty';
  }
  if (inboundActionNeeded) {
    return 'needs_reply';
  }
  if (hasReviewStatus) {
    return 'under_review';
  }
  if (waitingOnOtherParty || latestDirection === 'sent') {
    return 'waiting_on_counterparty';
  }
  return 'needs_reply';
}

export function getProposalPrimaryStatusLabel(primaryStatusKey) {
  const normalized = normalizePrimaryStatusKey(primaryStatusKey);
  return PRIMARY_STATUS_LABELS[normalized] || PRIMARY_STATUS_LABELS.needs_reply;
}

export function getProposalThreadUiState(proposal = {}) {
  const explicitKey = normalizePrimaryStatusKey(proposal?.primary_status_key || proposal?.status);
  const explicitBucket = normalizeBucket(proposal?.thread_bucket);
  const primaryStatusKey = explicitKey || deriveFallbackPrimaryStatusKey(proposal, explicitBucket);

  let bucket = explicitBucket;
  if (!bucket) {
    if (primaryStatusKey === 'draft') {
      bucket = 'drafts';
    } else if (primaryStatusKey === 'closed_won' || primaryStatusKey === 'closed_lost') {
      bucket = 'closed';
    } else if (proposal?.archived_at) {
      bucket = 'archived';
    } else {
      bucket = 'inbox';
    }
  }

  const waitingOnCounterparty =
    primaryStatusKey === 'waiting_on_counterparty' || Boolean(proposal?.waiting_on_other_party);
  const needsReply =
    primaryStatusKey === 'needs_reply' ||
    (Boolean(proposal?.needs_response) && !waitingOnCounterparty);
  const underReview = primaryStatusKey === 'under_review';
  const isDraft = bucket === 'drafts' || primaryStatusKey === 'draft';
  const isClosed =
    bucket === 'closed' ||
    primaryStatusKey === 'closed_won' ||
    primaryStatusKey === 'closed_lost';
  const isArchived = bucket === 'archived';
  const requiresViewerAction = needsReply || underReview;
  const primaryStatusLabel =
    asText(proposal?.primary_status_label) || getProposalPrimaryStatusLabel(primaryStatusKey);

  return {
    bucket,
    isArchived,
    isClosed,
    isDraft,
    needsReply,
    primaryStatusKey,
    primaryStatusLabel,
    requiresViewerAction,
    underReview,
    waitingOnCounterparty,
  };
}

export function buildSharedReportStatusBanner({
  proposal,
  counterpartyNoun = 'counterparty',
  sentAtText = '',
} = {}) {
  const threadState = getProposalThreadUiState(proposal);
  const safeCounterparty = asText(counterpartyNoun) || 'counterparty';
  const safeSentAt = asText(sentAtText);

  if (threadState.waitingOnCounterparty) {
    return {
      tone: 'success',
      text: safeSentAt
        ? `Waiting on ${safeCounterparty} - sent on ${safeSentAt}.`
        : `Waiting on ${safeCounterparty}.`,
      blocksSendAction: true,
      threadState,
    };
  }

  if (threadState.needsReply) {
    return {
      tone: 'warning',
      text: 'Needs your reply.',
      blocksSendAction: false,
      threadState,
    };
  }

  if (threadState.underReview) {
    return {
      tone: 'info',
      text: 'Needs your review.',
      blocksSendAction: false,
      threadState,
    };
  }

  if (threadState.isClosed) {
    return {
      tone: threadState.primaryStatusKey === 'closed_won' ? 'success' : 'danger',
      text: threadState.primaryStatusLabel,
      blocksSendAction: true,
      threadState,
    };
  }

  if (threadState.isDraft) {
    return {
      tone: 'neutral',
      text: 'Draft in progress.',
      blocksSendAction: false,
      threadState,
    };
  }

  return null;
}
