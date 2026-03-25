import { eq, desc, ilike } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { sendCategorizedEmail } from '../../../_lib/email-delivery.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { buildProposalHistoryQueries } from '../../../_lib/proposal-history.js';
import {
  applyPrivateModeMask,
  shouldMaskPrivateSender,
} from '../../../_lib/private-mode.js';
import {
  buildContinueNegotiationReset,
  buildOutcomeMutation,
  getProposalAccessContext,
  getProposalArchivedAtForActor,
  getProposalOutcomeEligibility,
  getProposalOutcomeState,
  mapProposalOutcomeForUser,
  normalizeEmail,
  PROPOSAL_OUTCOME_LOST,
  PROPOSAL_OUTCOME_PENDING_WON,
  PROPOSAL_OUTCOME_WON,
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
} from '../../../_lib/proposal-outcomes.js';
import { getProposalThreadState } from '../../../_lib/proposal-thread-state.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function mapProposalRow(proposal, currentUser, options: Record<string, unknown> = {}) {
  const outcome = mapProposalOutcomeForUser(proposal, currentUser, options);
  const effectiveStatus = outcome.final_status || proposal.status;
  const isPrivateMode = Boolean((proposal as any).isPrivateMode);
  const actorRole = asLower(options?.actorRole || outcome?.actor_role || '');
  const threadState = getProposalThreadState(proposal, currentUser, {
    actorRole,
    outcome,
  });
  const archivedAt = getProposalArchivedAtForActor(proposal, actorRole);
  const maskSender = shouldMaskPrivateSender(isPrivateMode, actorRole);

  const base = {
    id: proposal.id,
    title: proposal.title,
    status: effectiveStatus,
    status_reason: proposal.statusReason || null,
    directional_status: threadState.directionalStatus,
    primary_status_key: threadState.primaryStatusKey,
    primary_status_label: threadState.primaryStatusLabel,
    thread_bucket: threadState.bucket,
    latest_direction: threadState.latestDirection,
    started_by_role: threadState.startedByRole || null,
    last_update_by_role: threadState.lastUpdateByRole || null,
    exchange_count: threadState.exchangeCount,
    needs_response: threadState.needsResponse,
    waiting_on_other_party: threadState.waitingOnOtherParty,
    win_confirmation_requested: threadState.winConfirmationRequested,
    review_status: threadState.reviewStatus,
    is_mutual_interest: threadState.isMutualInterest,
    is_latest_version: threadState.isLatestVersion,
    last_activity_at: threadState.sortAt || proposal.createdAt,
    outcome,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    proposal_type: proposal.proposalType || 'standard',
    draft_step: Number(proposal.draftStep || 1),
    source_proposal_id: proposal.sourceProposalId || null,
    document_comparison_id: proposal.documentComparisonId || null,
    party_a_email: proposal.partyAEmail || currentUser?.email || null,
    party_b_email: proposal.partyBEmail,
    party_b_name: (proposal as any).partyBName || null,
    summary: proposal.summary,
    payload: proposal.payload || {},
    recipient_email: proposal.partyBEmail || null,
    counterparty_email: threadState.counterpartyEmail,
    owner_user_id: proposal.userId,
    sent_at: proposal.sentAt || null,
    received_at: proposal.receivedAt || null,
    last_thread_activity_at: proposal.lastThreadActivityAt || null,
    last_thread_actor_role: proposal.lastThreadActorRole || null,
    last_thread_activity_type: proposal.lastThreadActivityType || null,
    evaluated_at: proposal.evaluatedAt || null,
    last_shared_at: proposal.lastSharedAt || null,
    archived_at: archivedAt,
    closed_at: proposal.closedAt || null,
    party_a_outcome: proposal.partyAOutcome || null,
    party_a_outcome_at: proposal.partyAOutcomeAt || null,
    party_b_outcome: proposal.partyBOutcome || null,
    party_b_outcome_at: proposal.partyBOutcomeAt || null,
    is_private_mode: isPrivateMode,
    user_id: proposal.userId,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };

  return maskSender ? applyPrivateModeMask(base) : base;
}

async function resolveCounterpartyTarget(db, proposal, actorRole) {
  if (actorRole === PROPOSAL_PARTY_B) {
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

async function notifyCounterparty(params: {
  db: any;
  proposal: any;
  actorRole: string;
  actionUrl: string;
  eventType: 'status_won' | 'status_lost';
  dedupeKey: string;
  title: string;
  message: string;
  emailSubject: string;
  emailText: string;
}) {
  const target = await resolveCounterpartyTarget(params.db, params.proposal, params.actorRole);

  if (target.userId) {
    await createNotificationEvent({
      db: params.db,
      userId: target.userId,
      userEmail: target.userEmail,
      eventType: params.eventType,
      emailCategory: 'shared_link_activity',
      dedupeKey: params.dedupeKey,
      title: params.title,
      message: params.message,
      actionUrl: params.actionUrl,
      emailSubject: params.emailSubject,
      emailText: params.emailText,
    });
    return;
  }

  if (!target.userEmail) {
    return;
  }

  await sendCategorizedEmail({
    category: 'shared_link_activity',
    to: target.userEmail,
    subject: params.emailSubject,
    dedupeKey: params.dedupeKey,
    text: params.emailText,
  });
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/outcome', async (context) => {
    ensureMethod(req, ['POST']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const access = await getProposalAccessContext({
      db,
      proposalId,
      currentUser: auth.user,
    });
    const existing = access.proposal;
    const actorRole = access.actorRole;
    const body = await readJsonBody(req);
    const requestedAction = asLower(
      body.outcome ||
        body.status ||
        body.action ||
        body.decision,
    );

    const currentOutcome = getProposalOutcomeState(existing);
    const now = new Date();

    if (requestedAction === 'continue' || requestedAction === 'continue_negotiating') {
      if (currentOutcome.state !== PROPOSAL_OUTCOME_PENDING_WON) {
        throw new ApiError(
          400,
          'no_pending_outcome',
          'There is no pending agreement request to clear.',
        );
      }

      const continueValues = buildContinueNegotiationReset(existing, now);
      const nextProposal = {
        ...existing,
        ...continueValues,
      };
      const { queries: historyQueries } = buildProposalHistoryQueries(db, {
        proposal: nextProposal,
        actorUserId: auth.user.id,
        actorRole,
        milestone: 'continue_negotiation',
        eventType: 'proposal.outcome.continue_negotiation',
        createdAt: now,
        requestId: context.requestId,
      });
      const [updatedRows] = await db.batch([
        db
          .update(schema.proposals)
          .set(continueValues)
          .where(eq(schema.proposals.id, proposalId))
          .returning(),
        ...historyQueries,
      ]);
      const [updated] = updatedRows;

      await logAuditEventBestEffort({
        eventType: 'proposal.outcome.continue_negotiation',
        userId: auth.user.id,
        req,
        metadata: {
          proposal_id: proposalId,
          actor_role: actorRole,
        },
      });

      ok(res, 200, {
        proposal: mapProposalRow(updated, auth.user, { actorRole }),
      });
      return;
    }

    if (requestedAction !== PROPOSAL_OUTCOME_WON && requestedAction !== PROPOSAL_OUTCOME_LOST) {
      throw new ApiError(
        400,
        'invalid_outcome',
        'Use Request Agreement, Confirm Agreement, Lost, or Continue Negotiating.',
      );
    }

    const eligibility = getProposalOutcomeEligibility(existing, actorRole);
    const requestedActionAllowed =
      requestedAction === PROPOSAL_OUTCOME_WON
        ? Boolean(eligibility.canMarkWon)
        : Boolean(eligibility.canMarkLost);
    if (!requestedActionAllowed) {
      const failureReason =
        requestedAction === PROPOSAL_OUTCOME_WON
          ? eligibility.reasonWon || eligibility.reason
          : eligibility.reasonLost || eligibility.reason;
      throw new ApiError(403, 'outcome_not_allowed', failureReason || 'Outcome not allowed');
    }

    const actorExistingOutcome =
      actorRole === PROPOSAL_PARTY_A ? asLower(existing.partyAOutcome) : asLower(existing.partyBOutcome);
    if (actorExistingOutcome === requestedAction) {
      ok(res, 200, {
        proposal: mapProposalRow(existing, auth.user, { actorRole }),
      });
      return;
    }

    const outcomeValues = buildOutcomeMutation(existing, actorRole, requestedAction, now);
    const nextProposal = {
      ...existing,
      ...outcomeValues,
    };
    const nextOutcomeState = getProposalOutcomeState(nextProposal);
    const historyEventType =
      requestedAction === PROPOSAL_OUTCOME_LOST
        ? 'proposal.outcome.lost'
        : nextOutcomeState.state === PROPOSAL_OUTCOME_PENDING_WON
          ? 'proposal.outcome.won_requested'
          : nextOutcomeState.state === PROPOSAL_OUTCOME_WON
            ? 'proposal.outcome.won_confirmed'
            : 'proposal.outcome.updated';
    const historyMilestone =
      requestedAction === PROPOSAL_OUTCOME_LOST
        ? 'lost'
        : nextOutcomeState.state === PROPOSAL_OUTCOME_PENDING_WON
          ? 'won_requested'
          : nextOutcomeState.state === PROPOSAL_OUTCOME_WON
            ? 'won_confirmed'
            : 'outcome_update';
    const { queries: historyQueries } = buildProposalHistoryQueries(db, {
      proposal: nextProposal,
      actorUserId: auth.user.id,
      actorRole,
      milestone: historyMilestone,
      eventType: historyEventType,
      eventData: {
        requested_action: requestedAction,
      },
      createdAt: now,
      requestId: context.requestId,
    });
    const [updatedRows] = await db.batch([
      db
        .update(schema.proposals)
        .set(outcomeValues)
        .where(eq(schema.proposals.id, proposalId))
        .returning(),
      ...historyQueries,
    ]);
    const [updated] = updatedRows;

    const nextOutcome = getProposalOutcomeState(updated);
    const actionUrl = `/ProposalDetail?id=${encodeURIComponent(updated.id)}`;
    const title = updated.title || 'your proposal';
    const actorLabel =
      actorRole === PROPOSAL_PARTY_A ? 'The proposer' : (auth.user.email || 'The recipient');

    if (requestedAction === PROPOSAL_OUTCOME_LOST) {
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        eventType: 'status_lost',
        dedupeKey: `proposal:${updated.id}:lost:${actorRole}:${now.getTime()}`,
        title: 'Proposal marked as lost',
        message: `${actorLabel} marked "${title}" as lost.`,
        emailSubject: `Proposal marked as lost — ${title}`,
        emailText: [
          `${actorLabel} marked "${title}" as lost.`,
          '',
          'Sign in to PreMarket to review the proposal history.',
        ].join('\n'),
      });

      await logAuditEventBestEffort({
        eventType: 'proposal.outcome.lost',
        userId: auth.user.id,
        req,
        metadata: {
          proposal_id: updated.id,
          actor_role: actorRole,
        },
      });

      const previousStatus = asLower(existing?.status);
      if (previousStatus === 'revealed' || previousStatus === 'under_verification') {
        await logAuditEventBestEffort({
          eventType: 'share.reveal.denied',
          userId: auth.user.id,
          req,
          metadata: {
            proposal_id: updated.id,
            previous_status: previousStatus || null,
            next_status: 'lost',
          },
        });
      }
    } else if (nextOutcome.state === PROPOSAL_OUTCOME_PENDING_WON) {
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        eventType: 'status_won',
        dedupeKey: `proposal:${updated.id}:won_pending:${actorRole}:${now.getTime()}`,
        title: 'Agreement Requested',
        message: `${actorLabel} requested agreement on "${title}" and is waiting for your confirmation.`,
        emailSubject: `Agreement Requested — ${title}`,
        emailText: [
          `${actorLabel} requested agreement on "${title}" and is waiting for your confirmation.`,
          '',
          'Sign in to PreMarket to confirm the agreement or continue negotiating.',
        ].join('\n'),
      });

      await logAuditEventBestEffort({
        eventType: 'proposal.outcome.won_requested',
        userId: auth.user.id,
        req,
        metadata: {
          proposal_id: updated.id,
          actor_role: actorRole,
        },
      });
    } else if (nextOutcome.state === PROPOSAL_OUTCOME_WON) {
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        eventType: 'status_won',
        dedupeKey: `proposal:${updated.id}:won_confirmed:${actorRole}:${now.getTime()}`,
        title: 'Agreed',
        message: `The proposal "${title}" is now agreed.`,
        emailSubject: `Agreed — ${title}`,
        emailText: [
          `The proposal "${title}" is now agreed.`,
          '',
          'Sign in to PreMarket to review the final proposal history.',
        ].join('\n'),
      });

      await logAuditEventBestEffort({
        eventType: 'proposal.outcome.won_confirmed',
        userId: auth.user.id,
        req,
        metadata: {
          proposal_id: updated.id,
          actor_role: actorRole,
        },
      });
    }

    ok(res, 200, {
      proposal: mapProposalRow(updated, auth.user, { actorRole }),
    });
  });
}
