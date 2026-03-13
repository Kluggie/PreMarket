import {
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
  getProposalArchivedAtForActor,
  mapProposalOutcomeForUser,
} from './proposal-outcomes.js';
import { getProposalThreadActivity } from './proposal-thread-activity.js';

const REVIEW_STATUS_VALUES = new Set(['under_verification', 're_evaluated', 'evaluated']);

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
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
    needsResponse,
    reviewStatus,
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
      return threadState.bucket === 'drafts';
    case 'sent':
      return threadState.latestDirection === 'sent';
    case 'received':
      return threadState.latestDirection === 'received';
    case 'under_review':
      return Boolean(threadState.reviewStatus);
    case 'mutual_interest':
      return threadState.isMutualInterest;
    case 'agreement_requested':
    case 'win_confirmation_requested':
      return threadState.winConfirmationRequested;
    case 'needs_response':
      return threadState.needsResponse && !threadState.winConfirmationRequested;
    case 'waiting_on_other_party':
      return threadState.waitingOnOtherParty;
    case 'won':
      return threadState.bucket === 'closed' && threadState.directionalStatus === 'won';
    case 'lost':
      return threadState.bucket === 'closed' && threadState.directionalStatus === 'lost';
    default:
      return asLower(threadState.directionalStatus) === normalizedStatus;
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
    case 'needs_response':
      return threadState.needsResponse && !threadState.winConfirmationRequested;
    case 'waiting_on_other_party':
      return threadState.waitingOnOtherParty;
    case 'win_confirmation_requested':
    case 'agreement_requested':
      return threadState.winConfirmationRequested;
    default:
      return true;
  }
}
