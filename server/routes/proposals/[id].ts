import { and, asc, desc, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { logAuditEventBestEffort } from '../../_lib/audit-events.js';
import { assertProposalOwnership, requireUser } from '../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { createNotificationEvent } from '../../_lib/notifications.js';
import {
  buildProposalHistoryQueries,
  getDocumentComparisonSnapshotFromVersion,
  getProposalSnapshotFromVersion,
} from '../../_lib/proposal-history.js';
import {
  buildProposalThreadActivityValues,
} from '../../_lib/proposal-thread-activity.js';
import {
  getProposalAccessContext,
  getProposalArchivedAtForActor,
  getProposalFinalOutcomeStatus,
  mapProposalOutcomeForUser,
  PROPOSAL_PARTY_A,
} from '../../_lib/proposal-outcomes.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function mapProposalRow(proposal, currentUser, options: Record<string, unknown> = {}) {
  const outcome = mapProposalOutcomeForUser(proposal, currentUser, options);
  const effectiveStatus = outcome.final_status || proposal.status;
  const archivedAt = getProposalArchivedAtForActor(proposal, outcome.actor_role);
  return {
    id: proposal.id,
    title: proposal.title,
    status: effectiveStatus,
    status_reason: proposal.statusReason || null,
    outcome,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    proposal_type: proposal.proposalType || 'standard',
    draft_step: Number(proposal.draftStep || 1),
    source_proposal_id: proposal.sourceProposalId || null,
    document_comparison_id: proposal.documentComparisonId || null,
    party_a_email: proposal.partyAEmail || currentUser?.email || null,
    party_b_email: proposal.partyBEmail,
    summary: proposal.summary,
    payload: proposal.payload || {},
    recipient_email: proposal.partyBEmail || null,
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
    user_id: proposal.userId,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function parseDateOrNull(value: unknown) {
  if (!value) {
    return null;
  }

  const candidate = new Date(String(value));
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate;
}

function toTitleCase(value: unknown) {
  return asText(value)
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
}

function mapVersionSnapshotProposal(snapshotProposal: Record<string, any> | null, fallbackProposal: any) {
  const source = snapshotProposal || fallbackProposal || {};
  return {
    id: source.id || fallbackProposal?.id || null,
    title: source.title || fallbackProposal?.title || null,
    status: source.status || fallbackProposal?.status || 'draft',
    status_reason: source.statusReason || source.status_reason || fallbackProposal?.statusReason || null,
    template_id: source.templateId || source.template_id || fallbackProposal?.templateId || null,
    template_name: source.templateName || source.template_name || fallbackProposal?.templateName || null,
    proposal_type: source.proposalType || source.proposal_type || fallbackProposal?.proposalType || 'standard',
    summary: source.summary || fallbackProposal?.summary || null,
    payload: source.payload && typeof source.payload === 'object' ? source.payload : {},
    party_a_email: source.partyAEmail || source.party_a_email || fallbackProposal?.partyAEmail || null,
    party_b_email: source.partyBEmail || source.party_b_email || fallbackProposal?.partyBEmail || null,
    sent_at: source.sentAt || source.sent_at || fallbackProposal?.sentAt || null,
    received_at: source.receivedAt || source.received_at || fallbackProposal?.receivedAt || null,
    updated_at: source.updatedAt || source.updated_at || fallbackProposal?.updatedAt || null,
  };
}

function mapVersionSnapshotComparison(snapshotComparison: Record<string, any> | null) {
  if (!snapshotComparison) {
    return null;
  }

  return {
    id: snapshotComparison.id || null,
    party_a_label: snapshotComparison.partyALabel || snapshotComparison.party_a_label || null,
    party_b_label: snapshotComparison.partyBLabel || snapshotComparison.party_b_label || null,
    doc_a_text: snapshotComparison.docAText || snapshotComparison.doc_a_text || '',
    doc_a_html: snapshotComparison.docAHtml || snapshotComparison.doc_a_html || '',
    doc_a_source: snapshotComparison.docASource || snapshotComparison.doc_a_source || null,
    doc_b_text: snapshotComparison.docBText || snapshotComparison.doc_b_text || '',
    doc_b_html: snapshotComparison.docBHtml || snapshotComparison.doc_b_html || '',
    doc_b_source: snapshotComparison.docBSource || snapshotComparison.doc_b_source || null,
    updated_at: snapshotComparison.updatedAt || snapshotComparison.updated_at || null,
  };
}

function mapProposalVersionRow(versionRow: any, index: number, totalVersions: number, liveProposal: any) {
  const snapshotProposal = getProposalSnapshotFromVersion(versionRow);
  const snapshotComparison = getDocumentComparisonSnapshotFromVersion(versionRow);
  const snapshotMeta =
    versionRow?.snapshotMeta && typeof versionRow.snapshotMeta === 'object' && !Array.isArray(versionRow.snapshotMeta)
      ? versionRow.snapshotMeta
      : {};
  const actorRole = asLower(versionRow?.actorRole);
  const proposalSnapshot = mapVersionSnapshotProposal(snapshotProposal, liveProposal);
  const actorEmail =
    actorRole === 'party_b'
      ? proposalSnapshot.party_b_email
      : actorRole === 'party_a'
        ? proposalSnapshot.party_a_email
        : null;

  return {
    id: versionRow.id,
    version_number: Math.max(totalVersions - index, 1),
    is_latest_version: index === 0,
    read_only: index !== 0,
    actor_role: actorRole || null,
    actor_label:
      actorRole === 'party_a'
        ? 'Proposer'
        : actorRole === 'party_b'
          ? 'Counterparty'
          : 'System',
    actor_email: actorEmail || null,
    milestone: versionRow.milestone || null,
    milestone_label: toTitleCase(versionRow.milestone || snapshotMeta.milestone || ''),
    event_type: asText(snapshotMeta.event_type) || null,
    status: proposalSnapshot.status || versionRow.status || 'draft',
    created_date: versionRow.createdAt,
    has_document_snapshot: Boolean(snapshotComparison),
    snapshot_proposal: proposalSnapshot,
    snapshot_document_comparison: mapVersionSnapshotComparison(snapshotComparison),
  };
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]', async (context) => {
    ensureMethod(req, ['GET', 'PATCH', 'DELETE']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    if (req.method === 'GET') {
      const db = getDb();
      const access = await getProposalAccessContext({
        db,
        proposalId,
        currentUser: auth.user,
      });
      const existing = access.proposal;

      const [responses, evaluations, sharedLinks, versions] = await Promise.all([
        db
          .select()
          .from(schema.proposalResponses)
          .where(eq(schema.proposalResponses.proposalId, proposalId))
          .orderBy(asc(schema.proposalResponses.createdAt)),
        db
          .select()
          .from(schema.proposalEvaluations)
          .where(eq(schema.proposalEvaluations.proposalId, proposalId))
          .orderBy(desc(schema.proposalEvaluations.createdAt))
          .limit(20),
        db
          .select()
          .from(schema.sharedLinks)
          .where(eq(schema.sharedLinks.proposalId, proposalId))
          .orderBy(desc(schema.sharedLinks.createdAt))
          .limit(20),
        db
          .select()
          .from(schema.proposalVersions)
          .where(eq(schema.proposalVersions.proposalId, proposalId))
          .orderBy(desc(schema.proposalVersions.createdAt))
          .limit(25),
      ]);

      ok(res, 200, {
        proposal: mapProposalRow(existing, auth.user, { actorRole: access.actorRole }),
        responses: responses.map((row) => ({
          id: row.id,
          proposal_id: row.proposalId,
          question_id: row.questionId,
          section_id: row.sectionId,
          value: row.value,
          value_type: row.valueType,
          range_min: row.rangeMin,
          range_max: row.rangeMax,
          visibility: row.visibility,
          claim_type: row.claimType,
          entered_by_party: row.enteredByParty,
          created_date: row.createdAt,
          updated_date: row.updatedAt,
        })),
        evaluations: evaluations.map((row) => ({
          ...(function mapProviderMeta() {
            const result = row?.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result : {};
            const provider = asText((result as any).provider);
            const model = asText((result as any).model || (result as any).evaluation_model);
            const evaluationProvider =
              asLower((result as any).evaluation_provider || provider) === 'vertex' ? 'vertex' : 'fallback';
            const evaluationProviderReason =
              evaluationProvider === 'fallback'
                ? asText((result as any).evaluation_provider_reason || (result as any).fallbackReason) ||
                  (asLower(provider) === 'mock' ? 'vertex_mock_enabled' : 'provider_not_vertex')
                : null;
            return {
              evaluation_provider: evaluationProvider,
              evaluation_model: model || null,
              evaluation_provider_model: model || null,
              evaluation_provider_version: model || null,
              evaluation_provider_reason: evaluationProviderReason,
            };
          })(),
          id: row.id,
          proposal_id: row.proposalId,
          source: row.source,
          status: row.status,
          score: row.score,
          summary: row.summary,
          result: row.result || {},
          created_date: row.createdAt,
          updated_date: row.updatedAt,
        })),
        shared_links: sharedLinks.map((row) => ({
          id: row.id,
          token: row.token,
          status: row.status,
          mode: row.mode,
          recipient_email: row.recipientEmail,
          max_uses: row.maxUses,
          uses: row.uses,
          can_view: Boolean(row.canView),
          can_edit: Boolean(row.canEdit),
          can_edit_confidential: Boolean(row.canEditConfidential),
          can_reevaluate: Boolean(row.canReevaluate),
          can_send_back: Boolean(row.canSendBack),
          expires_at: row.expiresAt,
          created_date: row.createdAt,
          updated_date: row.updatedAt,
        })),
        versions: versions.map((row, index) =>
          mapProposalVersionRow(row, index, versions.length, existing),
        ),
      });
      return;
    }

    const db = getDb();
    const dbIdentity = getDatabaseIdentitySnapshot();

    if (req.method === 'DELETE') {
      const access = await getProposalAccessContext({
        db,
        proposalId,
        currentUser: auth.user,
      });
      const existing = access.proposal;
      const actorRole = access.actorRole;
      const now = new Date();

      if (!existing.sentAt) {
        if (actorRole !== PROPOSAL_PARTY_A) {
          throw new ApiError(403, 'forbidden', 'Only the proposer can delete an unsent draft');
        }

        const linkedComparison =
          existing.documentComparisonId
            ? await db
                .select()
                .from(schema.documentComparisons)
                .where(
                  and(
                    eq(schema.documentComparisons.id, existing.documentComparisonId),
                    eq(schema.documentComparisons.userId, auth.user.id),
                  ),
                )
                .limit(1)
                .then((rows) => rows[0] || null)
            : null;

        const { queries: historyQueries } = buildProposalHistoryQueries(db, {
          proposal: {
            ...existing,
            updatedAt: now,
          },
          actorUserId: auth.user.id,
          actorRole,
          milestone: 'delete_hard',
          eventType: 'proposal.deleted.hard',
          eventData: {
            document_comparison_id: existing.documentComparisonId || null,
          },
          documentComparison: linkedComparison,
          createdAt: now,
          requestId: context.requestId,
          snapshotMeta: {
            deletion_mode: 'hard',
          },
        });

        const queries = [];
        if (linkedComparison) {
          queries.push(
            db
              .delete(schema.documentComparisons)
              .where(
                and(
                  eq(schema.documentComparisons.id, existing.documentComparisonId),
                  eq(schema.documentComparisons.userId, auth.user.id),
                ),
              ),
          );
        }
        queries.push(db.delete(schema.proposals).where(eq(schema.proposals.id, proposalId)));
        queries.push(...historyQueries);
        await db.batch(queries);
        ok(res, 200, { deleted: true, mode: 'hard' });
        return;
      }

      const deleteValues =
        actorRole === PROPOSAL_PARTY_A
          ? {
              deletedByPartyAAt: now,
              updatedAt: now,
            }
          : {
              deletedByPartyBAt: now,
              updatedAt: now,
            };

      const updatedProposal = {
        ...existing,
        ...deleteValues,
      };
      const { queries: historyQueries } = buildProposalHistoryQueries(db, {
        proposal: updatedProposal,
        actorUserId: auth.user.id,
        actorRole,
        milestone: 'delete_soft',
        eventType: 'proposal.deleted.soft',
        eventData: {
          deletion_mode: 'soft',
        },
        createdAt: now,
        requestId: context.requestId,
        snapshotMeta: {
          deletion_mode: 'soft',
        },
      });

      await db.batch([
        db
          .update(schema.proposals)
          .set(deleteValues)
          .where(eq(schema.proposals.id, proposalId)),
        ...historyQueries,
      ]);

      ok(res, 200, {
        deleted: true,
        mode: 'soft',
        actor_role: actorRole,
      });
      return;
    }

    const existing = await assertProposalOwnership(auth.user.id, proposalId);

    const body = await readJsonBody(req);
    const attemptedThreadFieldUpdate = [
      'sentAt',
      'sent_at',
      'receivedAt',
      'received_at',
      'lastThreadActivityAt',
      'last_thread_activity_at',
      'lastThreadActorRole',
      'last_thread_actor_role',
      'lastThreadActivityType',
      'last_thread_activity_type',
    ].some((key) => Object.prototype.hasOwnProperty.call(body || {}, key));
    if (attemptedThreadFieldUpdate) {
      throw new ApiError(
        400,
        'thread_activity_server_controlled',
        'sent_at, received_at, and thread activity fields are server-controlled.',
      );
    }
    const nextTitle = body.title === undefined ? existing.title : String(body.title || '').trim();

    if (!nextTitle) {
      throw new ApiError(400, 'invalid_input', 'Proposal title is required');
    }

    // Canonical status values accepted by this endpoint.
    const ALLOWED_STATUSES = new Set([
      'draft', 'sent', 'received', 'mutual_interest', 'revealed',
      'won', 'lost', 'under_verification', 're_evaluated', 'evaluated',
    ]);
    const CLOSED_STATUSES = new Set(['won', 'lost']);

    const incomingStatus = body.status === undefined
      ? null
      : (String(body.status || '').trim().toLowerCase() || null);

    if (incomingStatus === 'won' || incomingStatus === 'lost') {
      throw new ApiError(
        400,
        'use_outcome_route',
        'Use /api/proposals/[id]/outcome to mark a proposal as agreed or lost.',
      );
    }

    if (incomingStatus !== null && !ALLOWED_STATUSES.has(incomingStatus)) {
      throw new ApiError(400, 'invalid_status', `Invalid status "${incomingStatus}". Allowed: ${Array.from(ALLOWED_STATUSES).join(', ')}`);
    }

    const currentStatusNorm = getProposalFinalOutcomeStatus(existing) || String(existing.status || '').trim().toLowerCase();
    if (CLOSED_STATUSES.has(currentStatusNorm) && incomingStatus !== null && !CLOSED_STATUSES.has(incomingStatus)) {
      throw new ApiError(400, 'invalid_status_transition', `Cannot change status from "${currentStatusNorm}" to "${incomingStatus}". Use the archive action or contact support to reopen a closed proposal.`);
    }

    const updateValues = {
      title: nextTitle,
      status: incomingStatus ?? existing.status,
      statusReason:
        body.statusReason === undefined && body.status_reason === undefined
          ? existing.statusReason
          : String(body.statusReason || body.status_reason || '').trim() || null,
      templateId:
        body.templateId === undefined && body.template_id === undefined
          ? existing.templateId
          : String(body.templateId || body.template_id || '').trim() || null,
      templateName:
        body.templateName === undefined && body.template_name === undefined
          ? existing.templateName
          : String(body.templateName || body.template_name || '').trim() || null,
      proposalType:
        body.proposalType === undefined && body.proposal_type === undefined
          ? existing.proposalType
          : String(body.proposalType || body.proposal_type || '').trim().toLowerCase() ||
            existing.proposalType ||
            'standard',
      draftStep:
        body.draftStep === undefined && body.draft_step === undefined
          ? existing.draftStep
          : (() => {
              const raw = Number(body.draftStep || body.draft_step || existing.draftStep || 1);
              if (!Number.isFinite(raw)) return existing.draftStep || 1;
              return Math.min(Math.max(Math.floor(raw), 1), 4);
            })(),
      sourceProposalId:
        body.sourceProposalId === undefined && body.source_proposal_id === undefined
          ? existing.sourceProposalId
          : String(body.sourceProposalId || body.source_proposal_id || '').trim() || null,
      documentComparisonId:
        body.documentComparisonId === undefined && body.document_comparison_id === undefined
          ? existing.documentComparisonId
          : String(body.documentComparisonId || body.document_comparison_id || '').trim() || null,
      partyAEmail:
        body.partyAEmail === undefined && body.party_a_email === undefined
          ? existing.partyAEmail
          : normalizeEmail(body.partyAEmail || body.party_a_email || '') || null,
      partyBEmail:
        body.partyBEmail === undefined && body.party_b_email === undefined
          ? existing.partyBEmail
          : normalizeEmail(body.partyBEmail || body.party_b_email || '') || null,
      summary:
        body.summary === undefined ? existing.summary : String(body.summary || '').trim() || null,
      payload:
        body.payload && typeof body.payload === 'object' ? body.payload : existing.payload || {},
      evaluatedAt:
        body.evaluatedAt === undefined && body.evaluated_at === undefined
          ? existing.evaluatedAt
          : parseDateOrNull(body.evaluatedAt || body.evaluated_at),
      lastSharedAt:
        body.lastSharedAt === undefined && body.last_shared_at === undefined
          ? existing.lastSharedAt
          : parseDateOrNull(body.lastSharedAt || body.last_shared_at),
      ...buildProposalThreadActivityValues({
        activityAt: existing.lastThreadActivityAt,
        actorRole: existing.lastThreadActorRole,
        activityType: existing.lastThreadActivityType,
      }),
      updatedAt: new Date(),
    };

    const previousStatus = String(existing.status || '').trim().toLowerCase();
    const nextStatus = String(updateValues.status || '').trim().toLowerCase();

    const projectedProposal = {
      ...existing,
      ...updateValues,
    };
    const { queries: historyQueries } = buildProposalHistoryQueries(db, {
      proposal: projectedProposal,
      actorUserId: auth.user.id,
      actorRole: PROPOSAL_PARTY_A,
      milestone: 'update',
      eventType: 'proposal.updated',
      eventData: {
        previous_status: previousStatus || null,
        next_status: nextStatus || null,
      },
      createdAt: updateValues.updatedAt,
      requestId: context.requestId,
    });

    const [updatedRows] = await db.batch([
      db
        .update(schema.proposals)
        .set(updateValues)
        .where(eq(schema.proposals.id, proposalId))
        .returning(),
      ...historyQueries,
    ]);
    const [updated] = updatedRows;

    console.info(
      JSON.stringify({
        level: 'info',
        route: '/api/proposals/[id]',
        event: 'proposal_updated',
        requestId: context.requestId,
        userId: auth.user.id,
        proposalId: updated.id,
        previousStatus,
        nextStatus,
        sentAt: updated.sentAt ? new Date(updated.sentAt).toISOString() : null,
        vercelEnv: dbIdentity.vercelEnv,
        dbHost: dbIdentity.dbHost,
        dbName: dbIdentity.dbName,
        dbSchema: dbIdentity.dbSchema,
        dbUrlHash: dbIdentity.dbUrlHash,
      }),
    );

    if (nextStatus && previousStatus !== nextStatus) {
      const eventMap = {
        revealed: {
          eventType: 'reveal_request',
          emailCategory: 'shared_link_activity',
          title: 'Reveal request update',
          message: `Reveal workflow updated for "${updated.title || 'your proposal'}".`,
          emailSubject: 'Reveal request update',
        },
        mutual_interest: {
          eventType: 'mutual_interest',
          emailCategory: 'mutual_interest',
          title: 'Mutual interest update',
          message: `Mutual interest was marked for "${updated.title || 'your proposal'}".`,
          emailSubject: 'Mutual interest update',
        },
      } as const;

      const eventConfig = eventMap[nextStatus as keyof typeof eventMap];
      if (eventConfig) {
        try {
          await createNotificationEvent({
            db,
            userId: updated.userId,
            userEmail: updated.partyAEmail || auth.user.email,
            eventType: eventConfig.eventType,
            emailCategory: eventConfig.emailCategory,
            dedupeKey: `proposal:${updated.id}:event:${eventConfig.eventType}:status:${nextStatus}`,
            title: eventConfig.title,
            message: eventConfig.message,
            actionUrl: `/ProposalDetail?id=${encodeURIComponent(updated.id)}`,
            emailSubject: eventConfig.emailSubject,
            emailText: [
              eventConfig.message,
              '',
              'Sign in to PreMarket to review proposal details.',
            ].join('\n'),
          });
        } catch {
          // Best-effort notifications should not block status updates.
        }
      }

      if (nextStatus === 'revealed') {
        await logAuditEventBestEffort({
          eventType: 'share.reveal.requested',
          userId: auth.user.id,
          req,
          metadata: {
            proposal_id: updated.id,
            previous_status: previousStatus || null,
            next_status: nextStatus,
          },
        });
      } else if (nextStatus === 'mutual_interest') {
        await logAuditEventBestEffort({
          eventType: 'share.reveal.approved',
          userId: auth.user.id,
          req,
          metadata: {
            proposal_id: updated.id,
            previous_status: previousStatus || null,
            next_status: nextStatus,
          },
        });
      } else if (nextStatus === 'lost' && (previousStatus === 'revealed' || previousStatus === 'under_verification')) {
        await logAuditEventBestEffort({
          eventType: 'share.reveal.denied',
          userId: auth.user.id,
          req,
          metadata: {
            proposal_id: updated.id,
            previous_status: previousStatus || null,
            next_status: nextStatus,
          },
        });
      }
    }

    ok(res, 200, {
      proposal: mapProposalRow(updated, auth.user, { actorRole: PROPOSAL_PARTY_A }),
    });
  });
}
