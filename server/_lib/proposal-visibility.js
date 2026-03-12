import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { schema } from './db/client.js';

export function normalizeProposalVisibilityEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function getProposalVisibilityUserId(user) {
  return String(user?.id || user?.sub || '').trim();
}

export function matchesSharedReportRecipientEmail(link, currentUser) {
  const currentEmail = normalizeProposalVisibilityEmail(currentUser?.email);
  const invitedEmail = normalizeProposalVisibilityEmail(link?.recipientEmail);
  return Boolean(currentEmail && invitedEmail && currentEmail === invitedEmail);
}

export function matchesSharedReportAuthorizedUser(link, currentUser) {
  const currentUserId = getProposalVisibilityUserId(currentUser);
  return Boolean(
    currentUserId &&
      String(link?.authorizedUserId || '').trim() === currentUserId,
  );
}

export async function listRecipientSharedReportLinks(db, currentUser) {
  const currentUserId = getProposalVisibilityUserId(currentUser);
  const currentEmail = normalizeProposalVisibilityEmail(currentUser?.email);

  const recipientMatchScope =
    currentEmail && currentUserId
      ? or(
          ilike(schema.sharedLinks.recipientEmail, currentEmail),
          eq(schema.sharedLinks.authorizedUserId, currentUserId),
        )
      : currentEmail
        ? ilike(schema.sharedLinks.recipientEmail, currentEmail)
        : currentUserId
          ? eq(schema.sharedLinks.authorizedUserId, currentUserId)
          : null;

  if (!recipientMatchScope) {
    return [];
  }

  return db
    .select({
      proposalId: schema.sharedLinks.proposalId,
      token: schema.sharedLinks.token,
      status: schema.sharedLinks.status,
      expiresAt: schema.sharedLinks.expiresAt,
      createdAt: schema.sharedLinks.createdAt,
      updatedAt: schema.sharedLinks.updatedAt,
      recipientEmail: schema.sharedLinks.recipientEmail,
      authorizedUserId: schema.sharedLinks.authorizedUserId,
    })
    .from(schema.sharedLinks)
    .where(
      and(
        eq(schema.sharedLinks.mode, 'shared_report'),
        ne(schema.sharedLinks.userId, currentUserId || '__no_owner__'),
        recipientMatchScope,
      ),
    )
    .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt));
}

export function getRecipientSharedProposalIds(recipientSharedLinks) {
  return Array.from(
    new Set(
      (Array.isArray(recipientSharedLinks) ? recipientSharedLinks : [])
        .map((row) => String(row?.proposalId || '').trim())
        .filter(Boolean),
    ),
  );
}

export function buildProposalVisibilityScopes(currentUser, recipientSharedProposalIds = [], options = {}) {
  const hasUserEmail = typeof currentUser?.email === 'string' && currentUser.email.trim().length > 0;
  const userEmail = hasUserEmail ? normalizeProposalVisibilityEmail(currentUser.email) : '';
  const userId = getProposalVisibilityUserId(currentUser);
  const isArchivedTab = Boolean(options.isArchivedTab);
  const sharedRecipientScope = recipientSharedProposalIds.length > 0
    ? inArray(schema.proposals.id, recipientSharedProposalIds)
    : null;
  const ownerScope = hasUserEmail
    ? or(
        eq(schema.proposals.userId, userId),
        ilike(schema.proposals.partyAEmail, userEmail),
      )
    : eq(schema.proposals.userId, userId);
  const ownerVisibleScope = and(ownerScope, isNull(schema.proposals.deletedByPartyAAt));
  const directRecipientEmailScope = hasUserEmail
    ? ilike(schema.proposals.partyBEmail, userEmail)
    : null;
  const recipientScope =
    directRecipientEmailScope && sharedRecipientScope
      ? or(directRecipientEmailScope, sharedRecipientScope)
      : directRecipientEmailScope || sharedRecipientScope || eq(schema.proposals.userId, '__no_recipient_scope__');
  const recipientVisibleScope = and(recipientScope, isNull(schema.proposals.deletedByPartyBAt));
  const ownerArchiveFilter = isArchivedTab
    ? isNotNull(schema.proposals.archivedByPartyAAt)
    : isNull(schema.proposals.archivedByPartyAAt);
  const recipientArchiveFilter = isArchivedTab
    ? isNotNull(schema.proposals.archivedByPartyBAt)
    : isNull(schema.proposals.archivedByPartyBAt);

  return {
    hasUserEmail,
    userEmail,
    userId,
    sharedRecipientScope,
    ownerScope,
    ownerVisibleScope,
    directRecipientEmailScope,
    recipientScope,
    recipientVisibleScope,
    ownerArchiveFilter,
    recipientArchiveFilter,
    ownerTabScope: and(ownerVisibleScope, ownerArchiveFilter),
    recipientTabScope: and(recipientVisibleScope, recipientArchiveFilter),
    directReceivedScope: directRecipientEmailScope
      ? and(
          directRecipientEmailScope,
          isNotNull(schema.proposals.sentAt),
          ne(schema.proposals.userId, userId || '__no_owner__'),
          isNull(schema.proposals.deletedByPartyBAt),
          recipientArchiveFilter,
        )
      : eq(schema.proposals.userId, '__no_recipient_scope__'),
    sharedLinkReceivedScope: sharedRecipientScope
      ? and(
          sharedRecipientScope,
          ne(schema.proposals.userId, userId || '__no_owner__'),
          isNull(schema.proposals.deletedByPartyBAt),
          recipientArchiveFilter,
        )
      : null,
  };
}

export function isProposalOwnedByCurrentUser(proposal, currentUser) {
  const userId = getProposalVisibilityUserId(currentUser);
  const userEmail = normalizeProposalVisibilityEmail(currentUser?.email);
  const partyAEmail = normalizeProposalVisibilityEmail(proposal?.partyAEmail || proposal?.party_a_email);
  return (
    String(proposal?.userId || proposal?.user_id || '').trim() === userId ||
    Boolean(userEmail && partyAEmail && userEmail === partyAEmail)
  );
}

export function isProposalReceivedByCurrentUser(proposal, currentUser, sharedReceivedProposalIdSet = new Set()) {
  const userEmail = normalizeProposalVisibilityEmail(currentUser?.email);
  const isOwner = isProposalOwnedByCurrentUser(proposal, currentUser);
  const partyBEmail = normalizeProposalVisibilityEmail(proposal?.partyBEmail || proposal?.party_b_email);
  const proposalId = String(proposal?.id || '').trim();
  return Boolean(
    !isOwner &&
      (
        (proposal?.sentAt && userEmail && partyBEmail && partyBEmail === userEmail) ||
        sharedReceivedProposalIdSet.has(proposalId)
      ),
  );
}

export function getProposalActorRoleFromVisibility(
  proposal,
  currentUser,
  sharedReceivedProposalIdSet = new Set(),
) {
  if (isProposalOwnedByCurrentUser(proposal, currentUser)) {
    return 'party_a';
  }

  if (isProposalReceivedByCurrentUser(proposal, currentUser, sharedReceivedProposalIdSet)) {
    return 'party_b';
  }

  return null;
}
