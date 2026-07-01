const PROPOSER_ROLE = 'proposer';
const RECIPIENT_ROLE = 'recipient';
export const RUN_AI_MEDIATION_LABEL = 'Run AI Mediation';
export const RUNNING_AI_MEDIATION_LABEL = 'Running AI Mediation...';
export const RUN_EXTRA_AI_REVIEW_LABEL = 'Run Extra AI Review';
export const RUNNING_EXTRA_AI_REVIEW_LABEL = 'Running Extra AI Review...';
export const RETRY_AI_MEDIATION_LABEL = 'Retry AI Mediation';
export const SEND_WITH_AI_REVIEW_LABEL = 'Send response with AI review';
export const SEND_WITHOUT_AI_REVIEW_LABEL = 'Send without AI review';
export const SEND_UPDATED_WITHOUT_AI_REVIEW_LABEL = 'Send updated response without AI review';
export const SEND_WITHOUT_UPDATED_AI_REVIEW_LABEL = 'Send without updated AI review';
export const EDIT_AGAIN_LABEL = 'Edit again';

// Stale review warnings and helper copy
export const STALE_AI_REVIEW_WARNING = 'This AI review was generated before your latest edits.';
export const EXTRA_REVIEW_DISABLED_HELPER = 'The owner has not enabled an extra AI review for this link. You can still send your updated response without an updated AI review.';
export const EXTRA_REVIEW_USED_HELPER = 'You have already used the extra AI review for this round. You can still send your updated response without an updated AI review.';

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

export function getContextualPartyLabel(role, { viewerRole, proposerName, recipientName } = {}) {
  const normalized = normalizeSharedReportPartyRole(role);
  if (viewerRole && normalizeSharedReportPartyRole(viewerRole) === normalized) {
    return 'You';
  }
  const displayName = normalized === PROPOSER_ROLE ? proposerName : recipientName;
  return displayName || 'Other party';
}

export function buildSharedReportTurnCopy(draftAuthorRole, { counterpartyName } = {}) {
  const actorRole = normalizeSharedReportPartyRole(draftAuthorRole);
  const actorNoun = getSharedReportPartyNoun(actorRole);
  const counterpartyRole = getCounterpartyRole(actorRole);
  const counterpartyNoun = getSharedReportPartyNoun(counterpartyRole);
  const counterpartyDisplay = counterpartyName || 'the other party';

  return {
    actorRole,
    actorNoun,
    actorLabel: getSharedReportPartyLabel(actorRole),
    counterpartyRole,
    counterpartyNoun,
    counterpartyLabel: getSharedReportPartyLabel(counterpartyRole),
    counterpartyDisplay,
    sendCtaLabel: `Send to ${counterpartyDisplay}`,
    sentCtaLabel: `Sent to ${counterpartyDisplay}`,
    signInToSendLabel: `Please sign in to send updates to ${counterpartyDisplay}.`,
    step3Description: 'Review your response package, run AI mediation, then optionally use one extra AI review before sending.',
    noReportMessage: 'No AI mediation review has been generated yet. You can still edit and send your response.',
    proposalDetailsDescription: 'Read-only current opportunity state after your edits.',
  };
}

export function getRecipientAiReviewActionLabel({ isPending = false, isExtraReview = false } = {}) {
  if (!isExtraReview) {
    return isPending ? RUNNING_AI_MEDIATION_LABEL : RUN_AI_MEDIATION_LABEL;
  }
  return getRecipientExtraAiReviewActionLabel({ isPending });
}

export function getRecipientExtraAiReviewActionLabel({ isPending = false } = {}) {
  if (isPending) {
    return RUNNING_EXTRA_AI_REVIEW_LABEL;
  }
  return RUN_EXTRA_AI_REVIEW_LABEL;
}

export function getSharedReportSendActionLabel(draftAuthorRole, { isSent = false, isPending = false, counterpartyName } = {}) {
  const copy = buildSharedReportTurnCopy(draftAuthorRole, { counterpartyName });
  if (isSent) {
    return copy.sentCtaLabel;
  }
  if (isPending) {
    return 'Sending...';
  }
  return copy.sendCtaLabel;
}

/**
 * Determines the AI review state and appropriate UI actions for the recipient.
 * 
 * Returns one of the following states:
 * - NO_REVIEW: No AI review has been run yet
 * - CURRENT_REVIEW: AI review exists and matches current draft
 * - STALE_REVIEW_EXTRA_DISABLED: Review is stale and extra review is disabled
 * - STALE_REVIEW_EXTRA_ENABLED: Review is stale and extra review can be run
 * - STALE_REVIEW_EXTRA_USED: Review is stale and extra review has been used
 */
export function getRecipientAiReviewState({
  hasCurrentReview = false,
  hasStaleReview = false,
  canRunExtraReview = false,
  extraReviewUsed = false,
  extraReviewEnabled = false,
} = {}) {
  if (hasCurrentReview) {
    return 'CURRENT_REVIEW';
  }
  if (hasStaleReview) {
    if (extraReviewUsed) {
      return 'STALE_REVIEW_EXTRA_USED';
    }
    if (canRunExtraReview) {
      return 'STALE_REVIEW_EXTRA_ENABLED';
    }
    return 'STALE_REVIEW_EXTRA_DISABLED';
  }
  return 'NO_REVIEW';
}

/**
 * Gets the primary action button configuration for the recipient's response.
 */
export function getRecipientPrimaryActionButton(reviewState, { isPending = false } = {}) {
  const state = typeof reviewState === 'string' ? reviewState : getRecipientAiReviewState(reviewState);
  
  switch (state) {
    case 'NO_REVIEW':
      return {
        label: isPending ? RUNNING_AI_MEDIATION_LABEL : RUN_AI_MEDIATION_LABEL,
        action: 'run_ai_mediation',
        isPending,
      };
    case 'CURRENT_REVIEW':
      return {
        label: isPending ? 'Sending...' : SEND_WITH_AI_REVIEW_LABEL,
        action: 'send_with_ai_review',
        isPending,
      };
    case 'STALE_REVIEW_EXTRA_DISABLED':
      return {
        label: isPending ? 'Sending...' : SEND_UPDATED_WITHOUT_AI_REVIEW_LABEL,
        action: 'send_without_updated_ai_review',
        isPending,
      };
    case 'STALE_REVIEW_EXTRA_ENABLED':
      return {
        label: isPending ? RUNNING_EXTRA_AI_REVIEW_LABEL : RUN_EXTRA_AI_REVIEW_LABEL,
        action: 'run_extra_ai_review',
        isPending,
      };
    case 'STALE_REVIEW_EXTRA_USED':
      return {
        label: isPending ? 'Sending...' : SEND_UPDATED_WITHOUT_AI_REVIEW_LABEL,
        action: 'send_without_updated_ai_review',
        isPending,
      };
    default:
      return {
        label: RUN_AI_MEDIATION_LABEL,
        action: 'run_ai_mediation',
        isPending: false,
      };
  }
}

/**
 * Gets the secondary action button (if any) for the recipient.
 */
export function getRecipientSecondaryActionButton(reviewState) {
  const state = typeof reviewState === 'string' ? reviewState : getRecipientAiReviewState(reviewState);
  
  switch (state) {
    case 'NO_REVIEW':
      return {
        label: SEND_WITHOUT_AI_REVIEW_LABEL,
        action: 'send_without_ai_review',
      };
    case 'CURRENT_REVIEW':
      return {
        label: EDIT_AGAIN_LABEL,
        action: 'edit_again',
      };
    case 'STALE_REVIEW_EXTRA_DISABLED':
      return {
        label: EDIT_AGAIN_LABEL,
        action: 'edit_again',
      };
    case 'STALE_REVIEW_EXTRA_ENABLED':
      return {
        label: SEND_WITHOUT_UPDATED_AI_REVIEW_LABEL,
        action: 'send_without_updated_ai_review',
      };
    case 'STALE_REVIEW_EXTRA_USED':
      return null; // No secondary action needed
    default:
      return null;
  }
}

/**
 * Gets the helper/warning copy to display based on review state.
 */
export function getRecipientReviewHelperCopy(reviewState) {
  const state = typeof reviewState === 'string' ? reviewState : getRecipientAiReviewState(reviewState);
  
  switch (state) {
    case 'NO_REVIEW':
      return null;
    case 'CURRENT_REVIEW':
      return null;
    case 'STALE_REVIEW_EXTRA_DISABLED':
      return {
        warning: STALE_AI_REVIEW_WARNING,
        helper: EXTRA_REVIEW_DISABLED_HELPER,
      };
    case 'STALE_REVIEW_EXTRA_ENABLED':
      return {
        warning: STALE_AI_REVIEW_WARNING,
        helper: null,
      };
    case 'STALE_REVIEW_EXTRA_USED':
      return {
        warning: STALE_AI_REVIEW_WARNING,
        helper: EXTRA_REVIEW_USED_HELPER,
      };
    default:
      return null;
  }
}
