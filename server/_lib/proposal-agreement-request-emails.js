import { and, asc, desc, eq, ilike, lte } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { sendCategorizedEmail } from './email-delivery.js';
import { toCanonicalAppUrl } from './env.js';
import { newId } from './ids.js';
import {
  getProposalOutcomeState,
  normalizeEmail,
  PROPOSAL_OUTCOME_PENDING_WON,
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
} from './proposal-outcomes.js';

export const AGREEMENT_REQUEST_EMAIL_GRACE_PERIOD_MS = 5 * 60 * 1000;

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

function sameInstant(left, right) {
  const leftDate = toDateOrNull(left);
  const rightDate = toDateOrNull(right);
  return Boolean(leftDate && rightDate && leftDate.getTime() === rightDate.getTime());
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

export function buildAgreementRequestActionUrl(proposalId) {
  const normalizedProposalId = asText(proposalId);
  if (!normalizedProposalId) {
    return '';
  }

  const returnPath = `/ProposalDetail?id=${encodeURIComponent(normalizedProposalId)}`;
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  return appBaseUrl ? toCanonicalAppUrl(appBaseUrl, returnPath) : returnPath;
}

function getAgreementRequestActorLabel(requestedByRole) {
  return asLower(requestedByRole) === PROPOSAL_PARTY_A ? 'The proposer' : 'The recipient';
}

export function buildAgreementRequestEmailContent(proposal, requestedByRole) {
  const proposalTitle = asText(proposal?.title) || 'your opportunity';
  const actionUrl = buildAgreementRequestActionUrl(proposal?.id);
  const actorLabel = getAgreementRequestActorLabel(requestedByRole);

  return {
    subject: `Agreement Requested — ${proposalTitle}`,
    text: [
      `${actorLabel} requested agreement on "${proposalTitle}" and is waiting for your confirmation.`,
      '',
      actionUrl
        ? `Open the opportunity: ${actionUrl}`
        : 'Sign in to PreMarket to confirm the agreement or continue negotiating.',
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

export async function queueAgreementRequestEmail(params) {
  const db = params.db || getDb();
  const proposalId = asText(params.proposal?.id);
  const requestedByRole = asLower(params.requestedByRole);
  const requestedAt = toDateOrNull(params.requestedAt);
  if (!proposalId || !requestedByRole || !requestedAt) {
    return { queued: false, reason: 'invalid_input' };
  }

  const dedupeKey = buildAgreementRequestEmailDedupeKey({
    proposalId,
    requestedByRole,
    requestedAt,
  });
  if (!dedupeKey) {
    return { queued: false, reason: 'invalid_input' };
  }

  const now = toDateOrNull(params.now) || new Date();
  const deliverAfter = new Date(requestedAt.getTime() + AGREEMENT_REQUEST_EMAIL_GRACE_PERIOD_MS);
  const [created] = await db
    .insert(schema.proposalAgreementRequestEmails)
    .values({
      id: newId('proposal_request_email'),
      proposalId,
      requestedByRole,
      requestedAt,
      recipientUserId: asText(params.recipientUserId) || null,
      recipientEmail: normalizeEmail(params.recipientEmail || null) || null,
      deliverAfter,
      status: 'pending',
      dedupeKey,
      suppressedReason: null,
      suppressedAt: null,
      lastError: null,
      sentAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: schema.proposalAgreementRequestEmails.dedupeKey,
    })
    .returning();

  if (!created) {
    return { queued: false, reason: 'duplicate' };
  }

  return {
    queued: true,
    delivery: created,
  };
}

export async function suppressAgreementRequestEmailCycle(params) {
  const db = params.db || getDb();
  const proposalId = asText(params.proposalId);
  const requestedByRole = asLower(params.requestedByRole);
  const requestedAt = toDateOrNull(params.requestedAt);
  const now = toDateOrNull(params.now) || new Date();
  const suppressedReason = asText(params.reason) || 'suppressed';

  if (!proposalId || !requestedByRole || !requestedAt) {
    return 0;
  }

  const updatedRows = await db
    .update(schema.proposalAgreementRequestEmails)
    .set({
      status: 'suppressed',
      suppressedReason,
      suppressedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.proposalAgreementRequestEmails.proposalId, proposalId),
        eq(schema.proposalAgreementRequestEmails.requestedByRole, requestedByRole),
        eq(schema.proposalAgreementRequestEmails.requestedAt, requestedAt),
        eq(schema.proposalAgreementRequestEmails.status, 'pending'),
      ),
    )
    .returning({ id: schema.proposalAgreementRequestEmails.id });

  return updatedRows.length;
}

export function isAgreementRequestPendingForCycle(proposal, requestedByRole, requestedAt) {
  const outcome = getProposalOutcomeState(proposal);
  return (
    outcome.state === PROPOSAL_OUTCOME_PENDING_WON &&
    asLower(outcome.requestedBy) === asLower(requestedByRole) &&
    sameInstant(outcome.requestedAt, requestedAt)
  );
}

function deriveSuppressedReason(proposal, row) {
  const outcome = getProposalOutcomeState(proposal);
  if (outcome.state !== PROPOSAL_OUTCOME_PENDING_WON) {
    return 'request_resolved';
  }
  if (asLower(outcome.requestedBy) !== asLower(row.requestedByRole)) {
    return 'request_changed';
  }
  if (!sameInstant(outcome.requestedAt, row.requestedAt)) {
    return 'request_replaced';
  }
  return 'request_changed';
}

export async function dispatchDueAgreementRequestEmails(params = {}) {
  const db = params.db || getDb();
  const now = toDateOrNull(params.now) || new Date();
  const limit = Number.isFinite(Number(params.limit)) ? Math.max(1, Math.floor(Number(params.limit))) : 25;
  const dueRows = await db
    .select()
    .from(schema.proposalAgreementRequestEmails)
    .where(
      and(
        eq(schema.proposalAgreementRequestEmails.status, 'pending'),
        lte(schema.proposalAgreementRequestEmails.deliverAfter, now),
      ),
    )
    .orderBy(
      asc(schema.proposalAgreementRequestEmails.deliverAfter),
      asc(schema.proposalAgreementRequestEmails.createdAt),
    )
    .limit(limit);

  const summary = {
    processed: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
  };

  for (const row of dueRows) {
    summary.processed += 1;

    const [proposal] = await db
      .select()
      .from(schema.proposals)
      .where(eq(schema.proposals.id, row.proposalId))
      .limit(1);

    if (!proposal) {
      await suppressAgreementRequestEmailCycle({
        db,
        proposalId: row.proposalId,
        requestedByRole: row.requestedByRole,
        requestedAt: row.requestedAt,
        reason: 'proposal_missing',
        now,
      });
      summary.suppressed += 1;
      continue;
    }

    if (!isAgreementRequestPendingForCycle(proposal, row.requestedByRole, row.requestedAt)) {
      await suppressAgreementRequestEmailCycle({
        db,
        proposalId: row.proposalId,
        requestedByRole: row.requestedByRole,
        requestedAt: row.requestedAt,
        reason: deriveSuppressedReason(proposal, row),
        now,
      });
      summary.suppressed += 1;
      continue;
    }

    const target = await resolveAgreementCounterpartyTarget(db, proposal, row.requestedByRole);
    const recipientEmail = normalizeEmail(target.userEmail || row.recipientEmail || null) || null;
    if (!recipientEmail) {
      await suppressAgreementRequestEmailCycle({
        db,
        proposalId: row.proposalId,
        requestedByRole: row.requestedByRole,
        requestedAt: row.requestedAt,
        reason: 'missing_recipient',
        now,
      });
      summary.suppressed += 1;
      continue;
    }

    const emailContent = buildAgreementRequestEmailContent(proposal, row.requestedByRole);
    const emailResult = await sendCategorizedEmail({
      db,
      category: 'shared_link_activity',
      purpose: 'transactional',
      to: recipientEmail,
      subject: emailContent.subject,
      text: emailContent.text,
      dedupeKey: row.dedupeKey,
    });

    if (emailResult.status === 'sent' || emailResult.status === 'deduped') {
      await db
        .update(schema.proposalAgreementRequestEmails)
        .set({
          recipientUserId: target.userId || row.recipientUserId || null,
          recipientEmail,
          status: 'sent',
          sentAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(schema.proposalAgreementRequestEmails.id, row.id));
      summary.sent += 1;
      continue;
    }

    await db
      .update(schema.proposalAgreementRequestEmails)
      .set({
        recipientUserId: target.userId || row.recipientUserId || null,
        recipientEmail,
        status: 'failed',
        lastError: asText(emailResult.reason) || 'email_send_failed',
        updatedAt: now,
      })
      .where(eq(schema.proposalAgreementRequestEmails.id, row.id));
    summary.failed += 1;
  }

  return summary;
}
