import { and, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { assertProposalOwnership, requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
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
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    party_a_email: proposal.partyAEmail || ownerEmail,
    party_b_email: proposal.partyBEmail,
    summary: proposal.summary,
    payload: proposal.payload || {},
    user_id: proposal.userId,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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

      ok(res, 200, {
        proposal: mapProposalRow(existing, auth.user.email),
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
      templateId:
        body.templateId === undefined && body.template_id === undefined
          ? existing.templateId
          : String(body.templateId || body.template_id || '').trim() || null,
      templateName:
        body.templateName === undefined && body.template_name === undefined
          ? existing.templateName
          : String(body.templateName || body.template_name || '').trim() || null,
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
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(schema.proposals)
      .set(updateValues)
      .where(eq(schema.proposals.id, proposalId))
      .returning();

    ok(res, 200, {
      proposal: mapProposalRow(updated, auth.user.email),
    });
  });
}
