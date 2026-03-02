import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { assertProposalOwnership, requireUser } from '../../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

const CLOSED_STATUSES = new Set(['won', 'lost']);

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function mapProposalRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    status_reason: row.statusReason || null,
    template_id: row.templateId,
    template_name: row.templateName,
    proposal_type: row.proposalType || 'standard',
    draft_step: Number(row.draftStep || 1),
    source_proposal_id: row.sourceProposalId || null,
    document_comparison_id: row.documentComparisonId || null,
    party_a_email: row.partyAEmail,
    party_b_email: row.partyBEmail,
    summary: row.summary,
    payload: row.payload || {},
    recipient_email: row.partyBEmail || null,
    owner_user_id: row.userId,
    sent_at: row.sentAt || null,
    received_at: row.receivedAt || null,
    evaluated_at: row.evaluatedAt || null,
    last_shared_at: row.lastSharedAt || null,
    archived_at: row.archivedAt || null,
    closed_at: row.closedAt || null,
    user_id: row.userId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/close', async (context) => {
    ensureMethod(req, ['PATCH']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    await assertProposalOwnership(auth.user.id, proposalId);

    const body = await readJsonBody(req);
    const nextStatus = String(body?.status || '').trim().toLowerCase();

    if (!CLOSED_STATUSES.has(nextStatus)) {
      throw new ApiError(
        400,
        'invalid_status',
        `Status must be one of: ${Array.from(CLOSED_STATUSES).join(', ')}`,
      );
    }

    const db = getDb();
    const dbIdentity = getDatabaseIdentitySnapshot();
    const now = new Date();

    const [updated] = await db
      .update(schema.proposals)
      .set({
        status: nextStatus,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, proposalId))
      .returning();

    console.info(
      JSON.stringify({
        level: 'info',
        route: '/api/proposals/[id]/close',
        event: 'proposal_closed',
        requestId: context.requestId,
        userId: auth.user.id,
        proposalId: updated.id,
        status: nextStatus,
        vercelEnv: dbIdentity.vercelEnv,
        dbHost: dbIdentity.dbHost,
        dbName: dbIdentity.dbName,
        dbSchema: dbIdentity.dbSchema,
      }),
    );

    const eventMap = {
      won: {
        eventType: 'status_won',
        emailCategory: 'shared_link_activity',
        title: 'Proposal marked Won',
        message: `"${updated.title || 'Your proposal'}" was marked as Won.`,
        emailSubject: 'Proposal marked Won',
      },
      lost: {
        eventType: 'status_lost',
        emailCategory: 'shared_link_activity',
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
          emailCategory: eventConfig.emailCategory,
          dedupeKey: `${eventConfig.eventType}:${updated.id}:${nextStatus}`,
          title: eventConfig.title,
          message: eventConfig.message,
          actionUrl: `/ProposalDetail?id=${encodeURIComponent(updated.id)}`,
          emailSubject: eventConfig.emailSubject,
          emailText: [eventConfig.message, '', 'Sign in to PreMarket to review proposal details.'].join(
            '\n',
          ),
        });
      } catch {
        // Best-effort notifications should not block status updates.
      }
    }

    ok(res, 200, { proposal: mapProposalRow(updated) });
  });
}
