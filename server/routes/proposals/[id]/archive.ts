import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import {
  getProposalAccessContext,
  getProposalArchivedAtForActor,
  PROPOSAL_PARTY_A,
} from '../../../_lib/proposal-outcomes.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function mapProposalRow(row, actorRole) {
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
    archived_at: getProposalArchivedAtForActor(row, actorRole),
    closed_at: row.closedAt || null,
    user_id: row.userId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/archive', async (context) => {
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

    const db = getDb();
    const dbIdentity = getDatabaseIdentitySnapshot();
    const now = new Date();
    const access = await getProposalAccessContext({
      db,
      proposalId,
      currentUser: auth.user,
    });
    const actorRole = access.actorRole;
    const archiveValues =
      actorRole === PROPOSAL_PARTY_A
        ? { archivedByPartyAAt: now, updatedAt: now }
        : { archivedByPartyBAt: now, updatedAt: now };

    const [updated] = await db
      .update(schema.proposals)
      .set(archiveValues)
      .where(eq(schema.proposals.id, proposalId))
      .returning();

    console.info(
      JSON.stringify({
        level: 'info',
        route: '/api/proposals/[id]/archive',
        event: 'proposal_archived',
        requestId: context.requestId,
        userId: auth.user.id,
        proposalId: updated.id,
        vercelEnv: dbIdentity.vercelEnv,
        dbHost: dbIdentity.dbHost,
        dbName: dbIdentity.dbName,
        dbSchema: dbIdentity.dbSchema,
      }),
    );

    ok(res, 200, { proposal: mapProposalRow(updated, actorRole) });
  });
}
