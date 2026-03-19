import {
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
  getProposalArchivedAtForActor,
  mapProposalOutcomeForUser,
} from './proposal-outcomes.js';
import { getProposalThreadActivity } from './proposal-thread-activity.js';

const REVIEW_STATUS_VALUES = new Set(['under_verification', 're_evaluated', 'evaluated']);
const PRIMARY_STATUS_LABELS = {
  draft: 'Draft',
  needs_reply: 'Needs Reply',
  under_review: 'Under Review',
  waiting_on_counterparty: 'Waiting on Counterparty',
  closed_won: 'Closed: Won',
  closed_lost: 'Closed: Lost',
};
const ORIGIN_FILTER_ALIASES = {
  you: 'started_by_you',
  me: 'started_by_you',
  started_by_me: 'started_by_you',
  started_by_you: 'started_by_you',
  counterparty: 'started_by_counterparty',
  other: 'started_by_counterparty',
  started_by_other: 'started_by_counterparty',
  started_by_counterparty: 'started_by_counterparty',
};

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function getPrimaryStatusLabel(value) {
  const normalized = asLower(value);
  return PRIMARY_STATUS_LABELS[normalized] || PRIMARY_STATUS_LABELS.needs_reply;
}

function deriveStartedByRole(proposal, actorRole, currentUser) {
  if (actorRole === PROPOSAL_PARTY_A) {
    return 'you';
  }
  if (actorRole === PROPOSAL_PARTY_B) {
    return 'counterparty';
  }

  const ownerUserId = asText(proposal?.userId || proposal?.user_id);
  const currentUserId = asText(currentUser?.id || currentUser?.userId);
  if (ownerUserId && currentUserId) {
    return ownerUserId === currentUserId ? 'you' : 'counterparty';
  }

  return null;
}

function deriveLastUpdateByRole({ actorRole, latestDirection, threadActivity, isDraft }) {
  if (isDraft) {
    return 'you';
  }
  if (latestDirection === 'sent') {
    return 'you';
  }
  if (latestDirection === 'received') {
    return 'counterparty';
  }

  const activityActorRole = asLower(threadActivity?.actorRole);
  if (activityActorRole && actorRole) {
    return activityActorRole === actorRole ? 'you' : 'counterparty';
  }

  return null;
}

export function deriveProposalPrimaryStatus(input = {}) {
  const bucket = asLower(input.bucket);
  const finalStatus = asLower(input.finalStatus);
  const latestDirection = asLower(input.latestDirection);
  const needsResponse = Boolean(input.needsResponse);
  const waitingOnOtherParty = Boolean(input.waitingOnOtherParty);
  const hasReviewStatus = Boolean(asLower(input.reviewStatus));

  if (bucket === 'drafts') {
    return {
      key: 'draft',
      label: getPrimaryStatusLabel('draft'),
    };
  }

  if (bucket === 'closed') {
    const closedKey = finalStatus === 'lost' ? 'closed_lost' : 'closed_won';
    return {
      key: closedKey,
      label: getPrimaryStatusLabel(closedKey),
    };
  }

  const inboundActionNeeded = needsResponse || latestDirection === 'received';

  if (hasReviewStatus && inboundActionNeeded) {
    return {
      key: 'under_review',
      label: getPrimaryStatusLabel('under_review'),
    };
  }

  if (waitingOnOtherParty && !inboundActionNeeded) {
    return {
      key: 'waiting_on_counterparty',
      label: getPrimaryStatusLabel('waiting_on_counterparty'),
    };
  }

  if (inboundActionNeeded) {
    return {
      key: 'needs_reply',
      label: getPrimaryStatusLabel('needs_reply'),
    };
  }

  if (hasReviewStatus) {
    return {
      key: 'under_review',
      label: getPrimaryStatusLabel('under_review'),
    };
  }

  if (waitingOnOtherParty || latestDirection === 'sent') {
    return {
      key: 'waiting_on_counterparty',
      label: getPrimaryStatusLabel('waiting_on_counterparty'),
    };
  }

  return {
    key: 'needs_reply',
    label: getPrimaryStatusLabel('needs_reply'),
  };
}

export function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const candidate = new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function getMostRecentDate(...values) {
  return values.reduce((latest, value) => {
    const nextValue = toDateOrNull(value);
    if (!nextValue) {
      return latest;
    }
    if (!latest || nextValue.getTime() > latest.getTime()) {
      return nextValue;
    }
    return latest;
  }, null);
}

export function getProposalLatestDirection(proposal, actorRole) {
  const threadActivity = getProposalThreadActivity(proposal);
  if (!threadActivity || !actorRole) {
    return null;
  }

  return threadActivity.actorRole === actorRole ? 'sent' : 'received';
}

export function getProposalThreadState(proposal, currentUser, options = {}) {
  const sharedReceivedProposalIdSet =
    options.sharedReceivedProposalIdSet instanceof Set
      ? options.sharedReceivedProposalIdSet
      : new Set(
          Array.isArray(options.sharedReceivedProposalIds) ? options.sharedReceivedProposalIds : [],
        );
  const outcome =
    options.outcome ||
    mapProposalOutcomeForUser(proposal, currentUser, {
      actorRole: options.actorRole,
      sharedReceivedProposalIdSet,
    });
  const actorRole = options.actorRole || outcome.actor_role || null;
  const finalStatus = asLower(outcome.final_status || proposal?.status);
  const sentAt = toDateOrNull(proposal?.sentAt || proposal?.sent_at);
  const receivedAt = toDateOrNull(proposal?.receivedAt || proposal?.received_at);
  const closedAt = toDateOrNull(proposal?.closedAt || proposal?.closed_at);
  const updatedAt = toDateOrNull(proposal?.updatedAt || proposal?.updated_at);
  const createdAt = toDateOrNull(proposal?.createdAt || proposal?.created_at);
  const archivedAt = getProposalArchivedAtForActor(proposal, actorRole);
  const threadActivity = getProposalThreadActivity(proposal);
  const normalizedStatus = asLower(proposal?.status);
  const isDraft = actorRole === PROPOSAL_PARTY_A && !sentAt;
  const isClosed = finalStatus === 'won' || finalStatus === 'lost';
  const isArchived = Boolean(archivedAt);

  let bucket = 'inbox';
  if (isArchived) {
    bucket = 'archived';
  } else if (isDraft) {
    bucket = 'drafts';
  } else if (isClosed) {
    bucket = 'closed';
  }

  const latestDirection = isDraft ? null : getProposalLatestDirection(proposal, actorRole);
  const winConfirmationRequested = Boolean(
    bucket === 'inbox' && outcome.pending && outcome.requested_by_counterparty,
  );
  const waitingOnOtherParty = Boolean(
    bucket === 'inbox' &&
      !winConfirmationRequested &&
      ((outcome.pending && outcome.requested_by_current_user) ||
        (!outcome.pending && latestDirection === 'sent')),
  );
  const needsResponse = Boolean(
    bucket === 'inbox' &&
      (winConfirmationRequested || (!outcome.pending && latestDirection === 'received')),
  );
  const reviewStatus = REVIEW_STATUS_VALUES.has(normalizedStatus) ? normalizedStatus : null;
  const isMutualInterest = normalizedStatus === 'mutual_interest';
  const counterpartyEmail =
    actorRole === PROPOSAL_PARTY_B
      ? asText(proposal?.partyAEmail || proposal?.party_a_email) || null
      : asText(proposal?.partyBEmail || proposal?.party_b_email) || null;
  const listType = isDraft ? 'draft' : actorRole === PROPOSAL_PARTY_B ? 'received' : 'sent';
  let directionalStatus = isDraft ? 'draft' : latestDirection || listType;
  if (reviewStatus === 're_evaluated') {
    directionalStatus = 're_evaluated';
  } else if (reviewStatus) {
    directionalStatus = 'under_verification';
  } else if (isMutualInterest) {
    directionalStatus = 'mutual_interest';
  } else if (isClosed) {
    directionalStatus = finalStatus;
  }
  const primaryStatus = deriveProposalPrimaryStatus({
    bucket,
    finalStatus,
    latestDirection,
    needsResponse,
    waitingOnOtherParty,
    reviewStatus,
  });
  const startedByRole = deriveStartedByRole(proposal, actorRole, currentUser);
  const lastUpdateByRole = deriveLastUpdateByRole({
    actorRole,
    latestDirection,
    threadActivity,
    isDraft,
  });

  return {
    actorRole,
    outcome,
    archivedAt,
    bucket,
    counterpartyEmail,
    directionalStatus,
    isArchived,
    isClosed,
    isDraft,
    isLatestVersion: true,
    isMutualInterest,
    latestDirection,
    lastUpdateByRole,
    needsResponse,
    primaryStatusKey: primaryStatus.key,
    primaryStatusLabel: primaryStatus.label,
    reviewStatus,
    startedByRole,
    sortAt:
      bucket === 'inbox'
        ? threadActivity?.at || createdAt
        : bucket === 'closed'
          ? getMostRecentDate(closedAt, threadActivity?.at, createdAt)
          : bucket === 'archived'
            ? getMostRecentDate(archivedAt, threadActivity?.at, createdAt)
            : getMostRecentDate(updatedAt, createdAt),
    threadActivityAt: threadActivity?.at || null,
    threadActivityType: threadActivity?.activityType || null,
    threadActivityActorRole: threadActivity?.actorRole || null,
    waitingOnOtherParty,
    winConfirmationRequested,
    listType,
  };
}

function normalizeOriginFilter(value) {
  const normalized = asLower(value);
  if (!normalized || normalized === 'all') {
    return 'all';
  }
  return ORIGIN_FILTER_ALIASES[normalized] || normalized;
}

export function matchesProposalThreadBucket(threadState, tab) {
  const normalizedTab = asLower(tab) || 'all';

  switch (normalizedTab) {
    case 'inbox':
      return threadState.bucket === 'inbox';
    case 'drafts':
      return threadState.bucket === 'drafts';
    case 'closed':
      return threadState.bucket === 'closed';
    case 'archived':
      return threadState.bucket === 'archived';
    case 'sent':
      return !threadState.isDraft && !threadState.isArchived && threadState.actorRole === PROPOSAL_PARTY_A;
    case 'received':
      return !threadState.isDraft && !threadState.isArchived && threadState.actorRole === PROPOSAL_PARTY_B;
    case 'mutual_interest':
      return threadState.bucket === 'inbox' && threadState.isMutualInterest;
    case 'all':
    default:
      return threadState.bucket !== 'archived';
  }
}

export function matchesProposalThreadStatus(threadState, statusFilter) {
  const normalizedStatus = asLower(statusFilter);
  if (!normalizedStatus || normalizedStatus === 'all') {
    return true;
  }

  switch (normalizedStatus) {
    case 'draft':
      return threadState.primaryStatusKey === 'draft';
    case 'sent':
      return threadState.latestDirection === 'sent';
    case 'received':
      return threadState.latestDirection === 'received';
    case 'under_review':
      return threadState.primaryStatusKey === 'under_review';
    case 'needs_reply':
    case 'needs_response':
      return threadState.primaryStatusKey === 'needs_reply';
    case 'waiting_on_counterparty':
    case 'waiting_on_other_party':
      return threadState.primaryStatusKey === 'waiting_on_counterparty';
    case 'mutual_interest':
      return threadState.isMutualInterest;
    case 'agreement_requested':
    case 'win_confirmation_requested':
      return threadState.winConfirmationRequested;
    case 'closed_won':
      return threadState.primaryStatusKey === 'closed_won';
    case 'closed_lost':
      return threadState.primaryStatusKey === 'closed_lost';
    case 'won':
      return threadState.primaryStatusKey === 'closed_won';
    case 'lost':
      return threadState.primaryStatusKey === 'closed_lost';
    default:
      return (
        asLower(threadState.primaryStatusKey) === normalizedStatus ||
        asLower(threadState.directionalStatus) === normalizedStatus
      );
  }
}

export function matchesProposalInboxFilter(threadState, inboxFilter) {
  const normalizedFilter = asLower(inboxFilter);
  if (!normalizedFilter || normalizedFilter === 'all') {
    return true;
  }

  if (threadState.bucket !== 'inbox') {
    return false;
  }

  switch (normalizedFilter) {
    case 'needs_reply':
    case 'needs_response':
      return threadState.needsResponse && !threadState.winConfirmationRequested;
    case 'waiting_on_counterparty':
    case 'waiting_on_other_party':
      return threadState.waitingOnOtherParty;
    case 'win_confirmation_requested':
    case 'agreement_requested':
      return threadState.winConfirmationRequested;
    default:
      return true;
  }
}

export function matchesProposalThreadOrigin(threadState, originFilter) {
  const normalizedOrigin = normalizeOriginFilter(originFilter);
  if (!normalizedOrigin || normalizedOrigin === 'all') {
    return true;
  }

  if (normalizedOrigin === 'started_by_you') {
    return asLower(threadState.startedByRole) === 'you';
  }
  if (normalizedOrigin === 'started_by_counterparty') {
    return asLower(threadState.startedByRole) === 'counterparty';
  }

  return true;
}
