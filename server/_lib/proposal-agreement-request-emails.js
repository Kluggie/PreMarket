import { and, desc, eq, ilike } from 'drizzle-orm';
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

export async function resolveLatestActiveSharedReportLink(db, proposalId) {
  const normalizedProposalId = asText(proposalId);
  if (!normalizedProposalId) {
    return null;
  }

  const [latestActiveLink] = await db
    .select({
      id: schema.sharedLinks.id,
      token: schema.sharedLinks.token,
      status: schema.sharedLinks.status,
      createdAt: schema.sharedLinks.createdAt,
      updatedAt: schema.sharedLinks.updatedAt,
    })
    .from(schema.sharedLinks)
    .where(
      and(
        eq(schema.sharedLinks.proposalId, normalizedProposalId),
        eq(schema.sharedLinks.mode, 'shared_report'),
        eq(schema.sharedLinks.status, 'active'),
      ),
    )
    .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt))
    .limit(1);

  return latestActiveLink || null;
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
