import { PROPOSAL_PARTY_A, PROPOSAL_PARTY_B } from './proposal-outcomes.js';

export const PROPOSAL_THREAD_ACTIVITY_SENT = 'proposal.sent';
export const PROPOSAL_THREAD_ACTIVITY_RECEIVED = 'proposal.received';
export const PROPOSAL_THREAD_ACTIVITY_SEND_BACK = 'proposal.send_back';
export const PROPOSAL_THREAD_ACTIVITY_REEVALUATED_RECEIVE = 'proposal.re_evaluated';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toThreadActivityDateOrNull(value) {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

export function buildProposalThreadActivityValues(params = {}) {
  const activityAt = toThreadActivityDateOrNull(params.activityAt || params.lastThreadActivityAt);
  const actorRole = asText(params.actorRole || params.lastThreadActorRole).toLowerCase() || null;
  const activityType =
    asText(params.activityType || params.lastThreadActivityType).toLowerCase() || null;

  return {
    lastThreadActivityAt: activityAt,
    lastThreadActorRole: actorRole,
    lastThreadActivityType: activityType,
  };
}

export function seedProposalThreadActivityFromTimeline(params = {}) {
  const sentAt = toThreadActivityDateOrNull(params.sentAt);
  const receivedAt = toThreadActivityDateOrNull(params.receivedAt);

  if (!sentAt && !receivedAt) {
    return buildProposalThreadActivityValues();
  }

  if (receivedAt && (!sentAt || receivedAt.getTime() >= sentAt.getTime())) {
    return buildProposalThreadActivityValues({
      activityAt: receivedAt,
      actorRole: PROPOSAL_PARTY_B,
      activityType: PROPOSAL_THREAD_ACTIVITY_RECEIVED,
    });
  }

  return buildProposalThreadActivityValues({
    activityAt: sentAt,
    actorRole: PROPOSAL_PARTY_A,
    activityType: PROPOSAL_THREAD_ACTIVITY_SENT,
  });
}

export function getProposalThreadActivity(proposal) {
  const activityAt = toThreadActivityDateOrNull(
    proposal?.lastThreadActivityAt || proposal?.last_thread_activity_at,
  );
  const actorRole = asText(
    proposal?.lastThreadActorRole || proposal?.last_thread_actor_role,
  ).toLowerCase() || null;
  const activityType = asText(
    proposal?.lastThreadActivityType || proposal?.last_thread_activity_type,
  ).toLowerCase() || null;

  if (!activityAt || !actorRole) {
    return null;
  }

  return {
    at: activityAt,
    actorRole,
    activityType,
  };
}
