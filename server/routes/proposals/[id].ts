import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { assertProposalOwnership, requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { createNotificationEvent } from '../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function mapProposalRow(proposal, ownerEmail) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    status_reason: proposal.statusReason || null,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    proposal_type: proposal.proposalType || 'standard',
    draft_step: Number(proposal.draftStep || 1),
    source_proposal_id: proposal.sourceProposalId || null,
    document_comparison_id: proposal.documentComparisonId || null,
    party_a_email: proposal.partyAEmail || ownerEmail,
    party_b_email: proposal.partyBEmail,
    summary: proposal.summary,
    payload: proposal.payload || {},
    sent_at: proposal.sentAt || null,
    received_at: proposal.receivedAt || null,
    evaluated_at: proposal.evaluatedAt || null,
    last_shared_at: proposal.lastSharedAt || null,
    user_id: proposal.userId,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
      const currentEmail = normalizeEmail(auth.user.email);
      const readScope = currentEmail
        ? and(
            eq(schema.proposals.id, proposalId),
            or(
              eq(schema.proposals.userId, auth.user.id),
              ilike(schema.proposals.partyAEmail, currentEmail),
              ilike(schema.proposals.partyBEmail, currentEmail),
            ),
          )
        : and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id));

      const [existing] = await db.select().from(schema.proposals).where(readScope).limit(1);
      if (!existing) {
        throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
      }

      const [responses, evaluations, sharedLinks] = await Promise.all([
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
      ]);

      ok(res, 200, {
        proposal: mapProposalRow(existing, auth.user.email),
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
          can_reevaluate: Boolean(row.canReevaluate),
          can_send_back: Boolean(row.canSendBack),
          expires_at: row.expiresAt,
          created_date: row.createdAt,
          updated_date: row.updatedAt,
        })),
      });
      return;
    }

    const db = getDb();
    const existing = await assertProposalOwnership(auth.user.id, proposalId);

    if (req.method === 'DELETE') {
      await db.delete(schema.proposals).where(eq(schema.proposals.id, proposalId));
      ok(res, 200, { deleted: true });
      return;
    }

    const body = await readJsonBody(req);
    const nextTitle = body.title === undefined ? existing.title : String(body.title || '').trim();

    if (!nextTitle) {
      throw new ApiError(400, 'invalid_input', 'Proposal title is required');
    }

    const updateValues = {
      title: nextTitle,
      status:
        body.status === undefined
          ? existing.status
          : String(body.status || '').trim().toLowerCase() || existing.status,
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
      sentAt:
        body.sentAt === undefined && body.sent_at === undefined
          ? existing.sentAt
          : parseDateOrNull(body.sentAt || body.sent_at),
      receivedAt:
        body.receivedAt === undefined && body.received_at === undefined
          ? existing.receivedAt
          : parseDateOrNull(body.receivedAt || body.received_at),
      evaluatedAt:
        body.evaluatedAt === undefined && body.evaluated_at === undefined
          ? existing.evaluatedAt
          : parseDateOrNull(body.evaluatedAt || body.evaluated_at),
      lastSharedAt:
        body.lastSharedAt === undefined && body.last_shared_at === undefined
          ? existing.lastSharedAt
          : parseDateOrNull(body.lastSharedAt || body.last_shared_at),
      updatedAt: new Date(),
    };

    const previousStatus = String(existing.status || '').trim().toLowerCase();
    const nextStatus = String(updateValues.status || '').trim().toLowerCase();

    const [updated] = await db
      .update(schema.proposals)
      .set(updateValues)
      .where(eq(schema.proposals.id, proposalId))
      .returning();

    if (nextStatus && previousStatus !== nextStatus) {
      const eventMap = {
        revealed: {
          eventType: 'reveal_request',
          title: 'Reveal request update',
          message: `Reveal workflow updated for "${updated.title || 'your proposal'}".`,
          emailSubject: 'Reveal request update',
        },
        mutual_interest: {
          eventType: 'mutual_interest',
          title: 'Mutual interest update',
          message: `Mutual interest was marked for "${updated.title || 'your proposal'}".`,
          emailSubject: 'Mutual interest update',
        },
        won: {
          eventType: 'status_won',
          title: 'Proposal marked Won',
          message: `"${updated.title || 'Your proposal'}" was marked as Won.`,
          emailSubject: 'Proposal marked Won',
        },
        lost: {
          eventType: 'status_lost',
          title: 'Proposal marked Lost',
          message: `"${updated.title || 'Your proposal'}" was marked as Lost.`,
          emailSubject: 'Proposal marked Lost',
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
            dedupeKey: `${eventConfig.eventType}:${updated.id}:${nextStatus}`,
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
    }

    ok(res, 200, {
      proposal: mapProposalRow(updated, auth.user.email),
    });
  });
}
