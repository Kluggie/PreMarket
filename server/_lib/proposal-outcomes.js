import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { ApiError } from './errors.js';

export const PROPOSAL_OUTCOME_WON = 'won';
export const PROPOSAL_OUTCOME_LOST = 'lost';
export const PROPOSAL_OUTCOME_PENDING_WON = 'pending_won';
export const PROPOSAL_OUTCOME_OPEN = 'open';
export const PROPOSAL_PARTY_A = 'party_a';
export const PROPOSAL_PARTY_B = 'party_b';

export function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEmail(value) {
  return asText(value).toLowerCase();
}

export function asLower(value) {
  return asText(value).toLowerCase();
}

export function isProposalClosedStatus(status) {
  const normalized = asLower(status);
  return normalized === PROPOSAL_OUTCOME_WON || normalized === PROPOSAL_OUTCOME_LOST;
}

export function getProposalFinalOutcomeStatus(proposal) {
  const partyAOutcome = asLower(proposal?.partyAOutcome);
  const partyBOutcome = asLower(proposal?.partyBOutcome);
  const legacyStatus = asLower(proposal?.status);

  if (partyAOutcome === PROPOSAL_OUTCOME_LOST || partyBOutcome === PROPOSAL_OUTCOME_LOST) {
    return PROPOSAL_OUTCOME_LOST;
  }
  if (partyAOutcome === PROPOSAL_OUTCOME_WON && partyBOutcome === PROPOSAL_OUTCOME_WON) {
    return PROPOSAL_OUTCOME_WON;
  }
  if (legacyStatus === PROPOSAL_OUTCOME_WON || legacyStatus === PROPOSAL_OUTCOME_LOST) {
    return legacyStatus;
  }
  return null;
}

export function getProposalOutcomeState(proposal) {
  const partyAOutcome = asLower(proposal?.partyAOutcome);
  const partyBOutcome = asLower(proposal?.partyBOutcome);
  const legacyStatus = asLower(proposal?.status);

  if (partyAOutcome === PROPOSAL_OUTCOME_LOST || partyBOutcome === PROPOSAL_OUTCOME_LOST) {
    return {
      state: PROPOSAL_OUTCOME_LOST,
      finalStatus: PROPOSAL_OUTCOME_LOST,
      pending: false,
      requestedBy:
        partyAOutcome === PROPOSAL_OUTCOME_LOST ? PROPOSAL_PARTY_A : PROPOSAL_PARTY_B,
      requestedAt:
        partyAOutcome === PROPOSAL_OUTCOME_LOST
          ? proposal?.partyAOutcomeAt || proposal?.closedAt || null
          : proposal?.partyBOutcomeAt || proposal?.closedAt || null,
    };
  }

  if (partyAOutcome === PROPOSAL_OUTCOME_WON && partyBOutcome === PROPOSAL_OUTCOME_WON) {
    return {
      state: PROPOSAL_OUTCOME_WON,
      finalStatus: PROPOSAL_OUTCOME_WON,
      pending: false,
      requestedBy: null,
      requestedAt: proposal?.closedAt || proposal?.partyBOutcomeAt || proposal?.partyAOutcomeAt || null,
    };
  }

  if (partyAOutcome === PROPOSAL_OUTCOME_WON || partyBOutcome === PROPOSAL_OUTCOME_WON) {
    return {
      state: PROPOSAL_OUTCOME_PENDING_WON,
      finalStatus: null,
      pending: true,
      requestedBy:
        partyAOutcome === PROPOSAL_OUTCOME_WON ? PROPOSAL_PARTY_A : PROPOSAL_PARTY_B,
      requestedAt:
        partyAOutcome === PROPOSAL_OUTCOME_WON
          ? proposal?.partyAOutcomeAt || null
          : proposal?.partyBOutcomeAt || null,
    };
  }

  if (legacyStatus === PROPOSAL_OUTCOME_WON || legacyStatus === PROPOSAL_OUTCOME_LOST) {
    return {
      state: legacyStatus,
      finalStatus: legacyStatus,
      pending: false,
      requestedBy: null,
      requestedAt: proposal?.closedAt || null,
    };
  }

  return {
    state: PROPOSAL_OUTCOME_OPEN,
    finalStatus: null,
    pending: false,
    requestedBy: null,
    requestedAt: null,
  };
}

export function getProposalActorRole(proposal, currentUser, options = {}) {
  const currentUserId = asText(currentUser?.id || currentUser?.sub);
  const currentEmail = normalizeEmail(currentUser?.email);
  const partyAEmail = normalizeEmail(proposal?.partyAEmail);
  const partyBEmail = normalizeEmail(proposal?.partyBEmail);
  const authorizedRecipientUserId = asText(options.authorizedRecipientUserId);

  const isPartyA =
    Boolean(currentUserId && asText(proposal?.userId) === currentUserId) ||
    Boolean(currentEmail && partyAEmail && partyAEmail === currentEmail);
  if (isPartyA) {
    return PROPOSAL_PARTY_A;
  }

  const isPartyB =
    Boolean(currentEmail && partyBEmail && partyBEmail === currentEmail) ||
    Boolean(currentUserId && authorizedRecipientUserId && authorizedRecipientUserId === currentUserId);

  return isPartyB ? PROPOSAL_PARTY_B : null;
}

export function isProposalDeletedForActor(proposal, actorRole) {
  if (actorRole === PROPOSAL_PARTY_A) {
    return Boolean(proposal?.deletedByPartyAAt);
  }
  if (actorRole === PROPOSAL_PARTY_B) {
    return Boolean(proposal?.deletedByPartyBAt);
  }
  return false;
}

export function getProposalArchivedAtForActor(proposal, actorRole) {
  if (actorRole === PROPOSAL_PARTY_A) {
    return proposal?.archivedByPartyAAt || proposal?.archivedAt || null;
  }
  if (actorRole === PROPOSAL_PARTY_B) {
    return proposal?.archivedByPartyBAt || null;
  }
  return null;
}

export function isProposalArchivedForActor(proposal, actorRole) {
  return Boolean(getProposalArchivedAtForActor(proposal, actorRole));
}

export function getProposalOutcomeEligibility(proposal, actorRole) {
  const outcome = getProposalOutcomeState(proposal);

  if (!proposal?.sentAt) {
    return {
      eligible: false,
      reason: 'Drafts cannot be marked as agreed or lost.',
    };
  }

  if (!actorRole) {
    return {
      eligible: false,
      reason: 'Only the proposer or recipient can mark an outcome.',
    };
  }

  if (outcome.finalStatus === PROPOSAL_OUTCOME_WON) {
    return {
      eligible: false,
      reason: 'This proposal has already been marked as agreed.',
    };
  }

  if (outcome.finalStatus === PROPOSAL_OUTCOME_LOST) {
    return {
      eligible: false,
      reason: 'This proposal has already been marked as lost.',
    };
  }

  if (actorRole === PROPOSAL_PARTY_B) {
    return {
      eligible: true,
      reason: null,
    };
  }

  if (actorRole === PROPOSAL_PARTY_A && proposal?.receivedAt) {
    return {
      eligible: true,
      reason: null,
    };
  }

  return {
    eligible: false,
    reason: 'The proposer can only mark an outcome after the recipient responds at least once.',
  };
}

export function mapProposalOutcomeForUser(proposal, currentUser, options = {}) {
  const actorRole =
    options.actorRole || getProposalActorRole(proposal, currentUser, options);
  const outcome = getProposalOutcomeState(proposal);
  const eligibility = getProposalOutcomeEligibility(proposal, actorRole);
  const pendingRequestedByCounterparty =
    outcome.pending && outcome.requestedBy && actorRole && outcome.requestedBy !== actorRole;
  const pendingRequestedByCurrentUser =
    outcome.pending && outcome.requestedBy && actorRole && outcome.requestedBy === actorRole;

  return {
    actor_role: actorRole,
    state: outcome.state,
    final_status: outcome.finalStatus,
    pending: outcome.pending,
    requested_by: outcome.requestedBy,
    requested_at: outcome.requestedAt || null,
    requested_by_current_user: Boolean(pendingRequestedByCurrentUser),
    requested_by_counterparty: Boolean(pendingRequestedByCounterparty),
    party_a_outcome: asLower(proposal?.partyAOutcome) || null,
    party_a_outcome_at: proposal?.partyAOutcomeAt || null,
    party_b_outcome: asLower(proposal?.partyBOutcome) || null,
    party_b_outcome_at: proposal?.partyBOutcomeAt || null,
    can_mark_won: eligibility.eligible,
    can_mark_lost: eligibility.eligible,
    can_continue_negotiating: Boolean(actorRole && outcome.pending),
    eligibility_reason: eligibility.reason,
  };
}

export function buildLegacyOutcomeSeed(status, timestamp = new Date()) {
  const normalized = asLower(status);
  if (normalized !== PROPOSAL_OUTCOME_WON && normalized !== PROPOSAL_OUTCOME_LOST) {
    return {
      partyAOutcome: null,
      partyAOutcomeAt: null,
      partyBOutcome: null,
      partyBOutcomeAt: null,
      closedAt: null,
    };
  }

  return {
    partyAOutcome: normalized,
    partyAOutcomeAt: timestamp,
    partyBOutcome: normalized,
    partyBOutcomeAt: timestamp,
    closedAt: timestamp,
  };
}

export function buildPendingWonReset(existing, now = new Date()) {
  const outcome = getProposalOutcomeState(existing);
  if (!outcome.pending) {
    return null;
  }

  const nextPartyAOutcome = asLower(existing?.partyAOutcome);
  const nextPartyBOutcome = asLower(existing?.partyBOutcome);

  const hasPendingWon =
    nextPartyAOutcome === PROPOSAL_OUTCOME_WON || nextPartyBOutcome === PROPOSAL_OUTCOME_WON;
  if (!hasPendingWon) {
    return null;
  }

  return {
    partyAOutcome: nextPartyAOutcome === PROPOSAL_OUTCOME_WON ? null : existing?.partyAOutcome || null,
    partyAOutcomeAt:
      nextPartyAOutcome === PROPOSAL_OUTCOME_WON ? null : existing?.partyAOutcomeAt || null,
    partyBOutcome: nextPartyBOutcome === PROPOSAL_OUTCOME_WON ? null : existing?.partyBOutcome || null,
    partyBOutcomeAt:
      nextPartyBOutcome === PROPOSAL_OUTCOME_WON ? null : existing?.partyBOutcomeAt || null,
    closedAt: null,
    updatedAt: now,
  };
}

export function buildOutcomeMutation(existing, actorRole, requestedOutcome, now = new Date()) {
  const normalizedOutcome = asLower(requestedOutcome);
  if (normalizedOutcome !== PROPOSAL_OUTCOME_WON && normalizedOutcome !== PROPOSAL_OUTCOME_LOST) {
    throw new ApiError(400, 'invalid_outcome', 'Outcome must be "won" or "lost"');
  }

  const currentPartyAOutcome = asLower(existing?.partyAOutcome) || null;
  const currentPartyBOutcome = asLower(existing?.partyBOutcome) || null;

  const nextPartyAOutcome =
    actorRole === PROPOSAL_PARTY_A ? normalizedOutcome : currentPartyAOutcome;
  const nextPartyBOutcome =
    actorRole === PROPOSAL_PARTY_B ? normalizedOutcome : currentPartyBOutcome;

  const nextPartyAOutcomeAt =
    actorRole === PROPOSAL_PARTY_A
      ? now
      : currentPartyAOutcome
        ? existing?.partyAOutcomeAt || now
        : null;
  const nextPartyBOutcomeAt =
    actorRole === PROPOSAL_PARTY_B
      ? now
      : currentPartyBOutcome
        ? existing?.partyBOutcomeAt || now
        : null;

  let nextStatus = existing?.status;
  let nextClosedAt = existing?.closedAt || null;

  if (nextPartyAOutcome === PROPOSAL_OUTCOME_LOST || nextPartyBOutcome === PROPOSAL_OUTCOME_LOST) {
    nextStatus = PROPOSAL_OUTCOME_LOST;
    nextClosedAt = existing?.closedAt || now;
  } else if (
    nextPartyAOutcome === PROPOSAL_OUTCOME_WON &&
    nextPartyBOutcome === PROPOSAL_OUTCOME_WON
  ) {
    nextStatus = PROPOSAL_OUTCOME_WON;
    nextClosedAt = existing?.closedAt || now;
  } else {
    nextClosedAt = null;
  }

  return {
    partyAOutcome: nextPartyAOutcome,
    partyAOutcomeAt: nextPartyAOutcomeAt,
    partyBOutcome: nextPartyBOutcome,
    partyBOutcomeAt: nextPartyBOutcomeAt,
    status: nextStatus,
    closedAt: nextClosedAt,
    updatedAt: now,
  };
}

export function buildContinueNegotiationReset(existing, now = new Date()) {
  return {
    partyAOutcome: null,
    partyAOutcomeAt: null,
    partyBOutcome: null,
    partyBOutcomeAt: null,
    closedAt: null,
    updatedAt: now,
  };
}

export function assertProposalOpenForNegotiation(proposal) {
  const finalStatus = getProposalFinalOutcomeStatus(proposal);
  if (finalStatus === PROPOSAL_OUTCOME_WON) {
    throw new ApiError(
      409,
      'proposal_closed_won',
      'This proposal has already been marked as agreed and can no longer be updated.',
    );
  }
  if (finalStatus === PROPOSAL_OUTCOME_LOST) {
    throw new ApiError(
      409,
      'proposal_closed_lost',
      'This proposal has already been marked as lost and can no longer be updated.',
    );
  }
}

export async function getProposalAccessContext({
  db = getDb(),
  proposalId,
  currentUser,
  allowDeleted = false,
}) {
  const [proposal] = await db
    .select()
    .from(schema.proposals)
    .where(eq(schema.proposals.id, proposalId))
    .limit(1);

  if (!proposal) {
    throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
  }

  const currentUserId = asText(currentUser?.id || currentUser?.sub);
  let authorizedRecipientUserId = null;

  if (currentUserId) {
    const [authorizedLink] = await db
      .select({
        authorizedUserId: schema.sharedLinks.authorizedUserId,
      })
      .from(schema.sharedLinks)
      .where(
        and(
          eq(schema.sharedLinks.proposalId, proposalId),
          eq(schema.sharedLinks.authorizedUserId, currentUserId),
        ),
      )
      .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt))
      .limit(1);
    authorizedRecipientUserId = asText(authorizedLink?.authorizedUserId) || null;
  }

  const actorRole = getProposalActorRole(proposal, currentUser, {
    authorizedRecipientUserId,
  });

  if (!actorRole) {
    throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
  }

  if (!allowDeleted && isProposalDeletedForActor(proposal, actorRole)) {
    throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
  }

  return {
    proposal,
    actorRole,
    authorizedRecipientUserId,
  };
}
