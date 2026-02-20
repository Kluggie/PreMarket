import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/evaluations', async (context) => {
    ensureMethod(req, ['GET']);

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
    const currentEmail = normalizeEmail(auth.user.email);
    const proposalScope = currentEmail
      ? and(
          eq(schema.proposals.id, proposalId),
          or(
            eq(schema.proposals.userId, auth.user.id),
            ilike(schema.proposals.partyAEmail, currentEmail),
            ilike(schema.proposals.partyBEmail, currentEmail),
          ),
        )
      : and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id));

    const [proposal] = await db.select().from(schema.proposals).where(proposalScope).limit(1);
    if (!proposal) {
      throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
    }

    const rows = await db
      .select()
      .from(schema.proposalEvaluations)
      .where(eq(schema.proposalEvaluations.proposalId, proposalId))
      .orderBy(desc(schema.proposalEvaluations.createdAt))
      .limit(50);

    ok(res, 200, {
      evaluations: rows.map((row) => ({
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
    });
  });
}
