import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { schema } from './db/client.js';
import { toCanonicalAppUrl } from './env.js';
import {
  asText as asProposalText,
  normalizeEmail,
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
} from './proposal-outcomes.js';
import {
  buildDocumentComparisonReportHref,
  buildSharedReportHref,
} from '../../src/lib/notificationTargets.js';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function isExpired(expiresAt) {
  const expiresAtDate = toDateOrNull(expiresAt);
  return Boolean(expiresAtDate && expiresAtDate.getTime() <= Date.now());
}

function compareLinksByRecency(left, right) {
  const leftUpdatedAt = toDateOrNull(left?.updatedAt);
  const rightUpdatedAt = toDateOrNull(right?.updatedAt);
  const leftUpdatedMs = leftUpdatedAt ? leftUpdatedAt.getTime() : 0;
  const rightUpdatedMs = rightUpdatedAt ? rightUpdatedAt.getTime() : 0;
  if (rightUpdatedMs !== leftUpdatedMs) {
    return rightUpdatedMs - leftUpdatedMs;
  }

  const leftCreatedAt = toDateOrNull(left?.createdAt);
  const rightCreatedAt = toDateOrNull(right?.createdAt);
  const leftCreatedMs = leftCreatedAt ? leftCreatedAt.getTime() : 0;
  const rightCreatedMs = rightCreatedAt ? rightCreatedAt.getTime() : 0;
  return rightCreatedMs - leftCreatedMs;
}

function matchesTargetRecipient(link, options = {}) {
  const targetRecipientUserId = asText(options?.recipientUserId);
  const targetRecipientEmail = normalizeEmail(options?.recipientEmail);
  if (!targetRecipientUserId && !targetRecipientEmail) {
    return false;
  }

  const linkRecipientEmail = normalizeEmail(link?.recipientEmail);
  const linkAuthorizedUserId = asText(link?.authorizedUserId);
  return Boolean(
    (targetRecipientEmail && linkRecipientEmail && targetRecipientEmail === linkRecipientEmail) ||
      (targetRecipientUserId && linkAuthorizedUserId && targetRecipientUserId === linkAuthorizedUserId),
  );
}

export function selectLatestActiveSharedReportLink(links, options = {}) {
  const sortedLinks = (Array.isArray(links) ? links : [])
    .filter((link) => asText(link?.token))
    .filter((link) => asLower(link?.status || 'active') === 'active')
    .filter((link) => !isExpired(link?.expiresAt))
    .sort(compareLinksByRecency);

  if (!sortedLinks.length) {
    return null;
  }

  const recipientScopedLink = sortedLinks.find((link) => matchesTargetRecipient(link, options));
  return recipientScopedLink || sortedLinks[0] || null;
}

export async function listLatestActiveSharedReportLinksByProposalIds(
  db,
  proposalIds = [],
  options = {},
) {
  const normalizedProposalIds = Array.from(
    new Set(
      (Array.isArray(proposalIds) ? proposalIds : [])
        .map((proposalId) => asText(proposalId))
        .filter(Boolean),
    ),
  );
  if (!normalizedProposalIds.length) {
    return new Map();
  }

  const rows = await db
    .select({
      id: schema.sharedLinks.id,
      proposalId: schema.sharedLinks.proposalId,
      token: schema.sharedLinks.token,
      status: schema.sharedLinks.status,
      expiresAt: schema.sharedLinks.expiresAt,
      recipientEmail: schema.sharedLinks.recipientEmail,
      authorizedUserId: schema.sharedLinks.authorizedUserId,
      createdAt: schema.sharedLinks.createdAt,
      updatedAt: schema.sharedLinks.updatedAt,
    })
    .from(schema.sharedLinks)
    .where(
      and(
        inArray(schema.sharedLinks.proposalId, normalizedProposalIds),
        eq(schema.sharedLinks.mode, 'shared_report'),
        eq(schema.sharedLinks.status, 'active'),
      ),
    )
    .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt));

  const linksByProposalId = new Map();
  rows.forEach((row) => {
    const proposalId = asText(row?.proposalId);
    if (!proposalId) {
      return;
    }
    if (!linksByProposalId.has(proposalId)) {
      linksByProposalId.set(proposalId, []);
    }
    linksByProposalId.get(proposalId).push(row);
  });

  const latestByProposalId = new Map();
  normalizedProposalIds.forEach((proposalId) => {
    const selected = selectLatestActiveSharedReportLink(
      linksByProposalId.get(proposalId) || [],
      options,
    );
    if (selected) {
      latestByProposalId.set(proposalId, selected);
    }
  });
  return latestByProposalId;
}

export function buildAgreementRequestEmailDedupeKey({
  proposalId,
  requestedByRole,
  requestedAt,
}) {
  const normalizedProposalId = asText(proposalId);
  const normalizedRole = asLower(requestedByRole);
  const normalizedRequestedAt = toDateOrNull(requestedAt);

  if (!normalizedProposalId || !normalizedRole || !normalizedRequestedAt) {
    return '';
  }

  return `proposal:${normalizedProposalId}:agreement_request_email:${normalizedRole}:${normalizedRequestedAt.toISOString()}`;
}

export function buildAgreementRequestActionUrl(proposalOrId) {
  const proposal =
    proposalOrId && typeof proposalOrId === 'object' && !Array.isArray(proposalOrId)
      ? proposalOrId
      : null;
  const normalizedProposalId = asText(proposal?.id || proposalOrId);
  if (!normalizedProposalId) {
    return '';
  }

  const comparisonId = asText(
    proposal?.documentComparisonId || proposal?.document_comparison_id || '',
  );
  const sharedReportToken = asText(
    proposal?.sharedReportToken || proposal?.shared_report_token || '',
  );
  const proposalType = asLower(proposal?.proposalType || proposal?.proposal_type || '');
  const comparisonHref =
    proposalType === 'document_comparison' && sharedReportToken
      ? buildSharedReportHref(sharedReportToken)
      : proposalType === 'document_comparison' && comparisonId
        ? buildDocumentComparisonReportHref(comparisonId)
      : '';
  const returnPath =
    comparisonHref || `/ProposalDetail?id=${encodeURIComponent(normalizedProposalId)}`;
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  return appBaseUrl ? toCanonicalAppUrl(appBaseUrl, returnPath) : returnPath;
}

export async function resolveLatestActiveSharedReportLink(db, proposalId, options = {}) {
  const normalizedProposalId = asText(proposalId);
  if (!normalizedProposalId) {
    return null;
  }
  const byProposalId = await listLatestActiveSharedReportLinksByProposalIds(
    db,
    [normalizedProposalId],
    options,
  );
  return byProposalId.get(normalizedProposalId) || null;
}

function getAgreementRequestActorLabel(requestedByRole) {
  return asLower(requestedByRole) === PROPOSAL_PARTY_A ? 'The proposer' : 'The recipient';
}

export function buildAgreementRequestEmailContent(proposal, requestedByRole) {
  const proposalTitle = asProposalText(proposal?.title) || 'your opportunity';
  const actionUrl = buildAgreementRequestActionUrl(proposal);
  const actorLabel = getAgreementRequestActorLabel(requestedByRole);

  return {
    subject: `Agreement Requested — ${proposalTitle}`,
    text: [
      `${actorLabel} requested agreement on "${proposalTitle}" and is waiting for your confirmation.`,
      '',
      actionUrl
        ? `Open the opportunity: ${actionUrl}`
        : 'Sign in to PreMarket to review the agreement request.',
    ].join('\n'),
  };
}

export async function resolveAgreementCounterpartyTarget(db, proposal, actorRole) {
  if (asLower(actorRole) === PROPOSAL_PARTY_B) {
    const [ownerUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, proposal.userId))
      .limit(1);

    return {
      userId: ownerUser?.id || null,
      userEmail: normalizeEmail(ownerUser?.email || proposal.partyAEmail || null) || null,
    };
  }

  const partyBEmail = normalizeEmail(proposal.partyBEmail || null) || null;
  const [authorizedLink] = await db
    .select({
      authorizedUserId: schema.sharedLinks.authorizedUserId,
      recipientEmail: schema.sharedLinks.recipientEmail,
    })
    .from(schema.sharedLinks)
    .where(eq(schema.sharedLinks.proposalId, proposal.id))
    .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt))
    .limit(1);

  if (authorizedLink?.authorizedUserId) {
    const [recipientUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, authorizedLink.authorizedUserId))
      .limit(1);

    if (recipientUser) {
      return {
        userId: recipientUser.id,
        userEmail: normalizeEmail(recipientUser.email) || partyBEmail,
      };
    }
  }

  if (!partyBEmail) {
    return { userId: null, userEmail: null };
  }

  const [recipientUser] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(ilike(schema.users.email, partyBEmail))
    .limit(1);

  return {
    userId: recipientUser?.id || null,
    userEmail: normalizeEmail(recipientUser?.email || partyBEmail) || null,
  };
}
