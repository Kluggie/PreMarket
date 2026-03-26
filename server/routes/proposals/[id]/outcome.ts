import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { sendCategorizedEmail } from '../../../_lib/email-delivery.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import {
  buildAgreementRequestActionUrl,
  buildAgreementRequestEmailContent,
  buildAgreementRequestEmailDedupeKey,
  resolveLatestActiveSharedReportLink,
  resolveAgreementCounterpartyTarget,
} from '../../../_lib/proposal-agreement-request-emails.js';
import { buildProposalHistoryQueries } from '../../../_lib/proposal-history.js';
import {
  buildSharedReportHref,
  buildLegacyOpportunityNotificationHref,
  buildNotificationTargetMetadata,
} from '../../../../src/lib/notificationTargets.js';
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
  PROPOSAL_OUTCOME_CONTINUE_NEGOTIATING,
  PROPOSAL_OUTCOME_LOST,
  PROPOSAL_OUTCOME_PENDING_WON,
  PROPOSAL_OUTCOME_WON,
  PROPOSAL_PARTY_A,
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

function toIsoString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const directText = asText(value);
  if (directText) {
    return directText;
  }
  return '';
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

function buildFinalOutcomeDedupeKey(proposalId: unknown, outcome: 'won' | 'lost') {
  const normalizedProposalId = asText(proposalId);
  return normalizedProposalId ? `proposal:${normalizedProposalId}:final_outcome:${outcome}` : '';
}

function buildFinalOutcomeEmailContent(proposal: any, outcome: 'won' | 'lost') {
  const proposalTitle = asText(proposal?.title) || 'your opportunity';
  const actionUrl = buildAgreementRequestActionUrl(proposal);

  if (outcome === PROPOSAL_OUTCOME_WON) {
    return {
      subject: `Agreement Finalized — ${proposalTitle}`,
      text: [
        `The agreement for "${proposalTitle}" has been confirmed and finalized.`,
        '',
        actionUrl
          ? `Open the opportunity: ${actionUrl}`
          : 'Sign in to PreMarket to review the final proposal history.',
      ].join('\n'),
    };
  }

  return {
    subject: `Opportunity Closed as Lost — ${proposalTitle}`,
    text: [
      `The opportunity "${proposalTitle}" was closed as lost.`,
      '',
      actionUrl
        ? `Open the opportunity: ${actionUrl}`
        : 'Sign in to PreMarket to review the proposal history.',
    ].join('\n'),
  };
}

function buildContinueNegotiationEmailContent(proposal: any, actorRole: string) {
  const proposalTitle = asText(proposal?.title) || 'your opportunity';
  const actionUrl = buildAgreementRequestActionUrl(proposal);
  const actorLabel = actorRole === PROPOSAL_PARTY_A ? 'The proposer' : 'The recipient';

  return {
    subject: `Continue Negotiating — ${proposalTitle}`,
    text: [
      `${actorLabel} wants to continue negotiating on "${proposalTitle}" and did not confirm the agreement request.`,
      '',
      actionUrl
        ? `Open the opportunity: ${actionUrl}`
        : 'Sign in to PreMarket to review the latest negotiation status.',
    ].join('\n'),
  };
}

async function notifyCounterparty(params: {
  db: any;
  proposal: any;
  actorRole: string;
  actionUrl: string;
  metadata?: Record<string, unknown> | null;
  eventType: 'status_won' | 'status_lost' | 'status_continue_negotiating';
  dedupeKey: string;
  title: string;
  message: string;
  emailSubject: string;
  emailText: string;
  emailPurpose?: 'general' | 'transactional';
  sendEmail?: boolean;
}) {
  const target = await resolveAgreementCounterpartyTarget(
    params.db,
    params.proposal,
    params.actorRole,
  );
  const sendEmail = params.sendEmail !== false;

  if (target.userId) {
    await createNotificationEvent({
      db: params.db,
      userId: target.userId,
      userEmail: target.userEmail,
      eventType: params.eventType,
      emailCategory: 'shared_link_activity',
      emailPurpose: sendEmail ? params.emailPurpose || 'general' : undefined,
      dedupeKey: params.dedupeKey,
      title: params.title,
      message: params.message,
      actionUrl: params.actionUrl,
      metadata: params.metadata || null,
      emailSubject: params.emailSubject,
      emailText: params.emailText,
      sendEmail,
    });
    return;
  }

  if (!target.userEmail || !sendEmail) {
    return;
  }

  await sendCategorizedEmail({
    category: 'shared_link_activity',
    purpose: params.emailPurpose || 'general',
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
    const existingOutcome = getProposalOutcomeState(existing);
    const body = await readJsonBody(req);
    const requestedAction = asLower(
      body.outcome ||
        body.status ||
        body.action ||
        body.decision,
    );
    const requestedContinueNegotiating =
      requestedAction === 'continue' || requestedAction === PROPOSAL_OUTCOME_CONTINUE_NEGOTIATING;

    const now = new Date();

    if (
      !requestedContinueNegotiating &&
      requestedAction !== PROPOSAL_OUTCOME_WON &&
      requestedAction !== PROPOSAL_OUTCOME_LOST
    ) {
      throw new ApiError(
        400,
        'invalid_outcome',
        'Use Request Agreement, Confirm Agreement, Continue Negotiating, or Lost.',
      );
    }

    const eligibility = getProposalOutcomeEligibility(existing, actorRole);
    const requestedActionAllowed =
      requestedContinueNegotiating
        ? Boolean(eligibility.canContinueNegotiating)
        : requestedAction === PROPOSAL_OUTCOME_WON
        ? Boolean(eligibility.canMarkWon)
        : Boolean(eligibility.canMarkLost);
    if (!requestedActionAllowed) {
      const failureReason = requestedContinueNegotiating
        ? eligibility.reasonContinueNegotiating || eligibility.reason
        : requestedAction === PROPOSAL_OUTCOME_WON
          ? eligibility.reasonWon || eligibility.reason
          : eligibility.reasonLost || eligibility.reason;
      throw new ApiError(403, 'outcome_not_allowed', failureReason || 'Outcome not allowed');
    }

    const actorExistingOutcome = requestedContinueNegotiating
      ? null
      : actorRole === PROPOSAL_PARTY_A
        ? asLower(existing.partyAOutcome)
        : asLower(existing.partyBOutcome);
    if (actorExistingOutcome && actorExistingOutcome === requestedAction) {
      ok(res, 200, {
        proposal: mapProposalRow(existing, auth.user, { actorRole }),
      });
      return;
    }

    const outcomeValues = requestedContinueNegotiating
      ? buildContinueNegotiationReset(existing, actorRole, now)
      : buildOutcomeMutation(existing, actorRole, requestedAction, now);
    if (!outcomeValues) {
      throw new ApiError(409, 'outcome_not_allowed', 'Outcome not allowed');
    }
    const nextProposal = {
      ...existing,
      ...outcomeValues,
    };
    const nextOutcomeState = getProposalOutcomeState(nextProposal);
    const historyEventType = requestedContinueNegotiating
      ? 'proposal.outcome.continue_negotiation'
      : requestedAction === PROPOSAL_OUTCOME_LOST
        ? 'proposal.outcome.lost'
        : nextOutcomeState.state === PROPOSAL_OUTCOME_PENDING_WON
          ? 'proposal.outcome.won_requested'
          : nextOutcomeState.state === PROPOSAL_OUTCOME_WON
            ? 'proposal.outcome.won_confirmed'
            : 'proposal.outcome.updated';
    const historyMilestone = requestedContinueNegotiating
      ? PROPOSAL_OUTCOME_CONTINUE_NEGOTIATING
      : requestedAction === PROPOSAL_OUTCOME_LOST
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
    const comparisonId = asText(updated.documentComparisonId || existing.documentComparisonId);
    const isComparisonNotification =
      asLower(updated.proposalType || existing.proposalType) === 'document_comparison' &&
      Boolean(comparisonId);
    const latestSharedReportLink = isComparisonNotification
      ? await resolveLatestActiveSharedReportLink(db, updated.id)
      : null;
    const sharedReportToken = asText(latestSharedReportLink?.token);
    const legacyActionUrl = buildLegacyOpportunityNotificationHref({
      proposalId: updated.id,
    });
    const actionUrl = isComparisonNotification
      ? buildSharedReportHref(sharedReportToken) || legacyActionUrl
      : legacyActionUrl || `/ProposalDetail?id=${encodeURIComponent(updated.id)}`;
    const notificationMetadata = isComparisonNotification && sharedReportToken
      ? buildNotificationTargetMetadata({
          route: 'SharedReport',
          workflowType: 'document_comparison',
          entityType: 'document_comparison',
          comparisonId,
          proposalId: updated.id,
          sharedReportToken,
          legacyActionUrl,
        })
      : null;
    const title = updated.title || 'your proposal';
    const actorLabel =
      actorRole === PROPOSAL_PARTY_A ? 'The proposer' : (auth.user.email || 'The recipient');

    if (requestedAction === PROPOSAL_OUTCOME_LOST) {
      const emailContent = buildFinalOutcomeEmailContent(updated, PROPOSAL_OUTCOME_LOST);
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        metadata: notificationMetadata,
        eventType: 'status_lost',
        dedupeKey: buildFinalOutcomeDedupeKey(updated.id, PROPOSAL_OUTCOME_LOST),
        title: 'Proposal marked as lost',
        message: `${actorLabel} marked "${title}" as lost.`,
        emailSubject: emailContent.subject,
        emailText: emailContent.text,
        emailPurpose: 'transactional',
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
      const emailContent = buildAgreementRequestEmailContent(
        {
          ...updated,
          sharedReportToken,
        },
        actorRole,
      );
      const agreementRequestDedupeKey =
        buildAgreementRequestEmailDedupeKey({
          proposalId: updated.id,
          requestedByRole: actorRole,
          requestedAt: nextOutcome.requestedAt,
        }) ||
        `proposal:${updated.id}:won_pending:${actorRole}`;
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        metadata: notificationMetadata,
        eventType: 'status_won',
        dedupeKey: agreementRequestDedupeKey,
        title: 'Agreement Requested',
        message: `${actorLabel} requested agreement on "${title}" and is waiting for your confirmation.`,
        emailSubject: emailContent.subject,
        emailText: emailContent.text,
        emailPurpose: 'transactional',
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
    } else if (requestedContinueNegotiating) {
      const emailContent = buildContinueNegotiationEmailContent(updated, actorRole);
      const continueDedupeKey =
        `proposal:${updated.id}:continue_negotiating:${actorRole}:${toIsoString(existingOutcome.requestedAt || now)}`;
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        metadata: notificationMetadata,
        eventType: 'status_continue_negotiating',
        dedupeKey: continueDedupeKey,
        title: 'Continue Negotiating',
        message: `${actorLabel} wants to continue negotiating on "${title}" and did not confirm the agreement request.`,
        emailSubject: emailContent.subject,
        emailText: emailContent.text,
        emailPurpose: 'transactional',
      });

      await logAuditEventBestEffort({
        eventType: 'proposal.outcome.continue_negotiation',
        userId: auth.user.id,
        req,
        metadata: {
          proposal_id: updated.id,
          actor_role: actorRole,
        },
      });
    } else if (nextOutcome.state === PROPOSAL_OUTCOME_WON) {
      const emailContent = buildFinalOutcomeEmailContent(updated, PROPOSAL_OUTCOME_WON);
      await notifyCounterparty({
        db,
        proposal: updated,
        actorRole,
        actionUrl,
        metadata: notificationMetadata,
        eventType: 'status_won',
        dedupeKey: buildFinalOutcomeDedupeKey(updated.id, PROPOSAL_OUTCOME_WON),
        title: 'Agreed',
        message: `The proposal "${title}" is now agreed.`,
        emailSubject: emailContent.subject,
        emailText: emailContent.text,
        emailPurpose: 'transactional',
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
