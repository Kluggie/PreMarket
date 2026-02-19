import { and, desc, eq, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function mapProposalRow(proposal, ownerEmail) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
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

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/proposals', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    if (req.method === 'GET') {
      const limitRaw = Number(req.query?.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const statusFilter =
        typeof req.query?.status === 'string' && req.query.status.trim().length > 0
          ? req.query.status.trim()
          : null;

      const whereClause = statusFilter
        ? and(eq(schema.proposals.userId, auth.user.id), eq(schema.proposals.status, statusFilter))
        : eq(schema.proposals.userId, auth.user.id);

      const rows = await db
        .select()
        .from(schema.proposals)
        .where(whereClause)
        .orderBy(desc(schema.proposals.createdAt))
        .limit(limit);

      ok(res, 200, {
        proposals: rows.map((row) => mapProposalRow(row, auth.user.email)),
      });
      return;
    }

    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();

    if (!title) {
      throw new ApiError(400, 'invalid_input', 'Proposal title is required');
    }

    const status = String(body.status || 'draft').trim().toLowerCase() || 'draft';
    const templateName = String(body.templateName || body.template_name || '').trim() || null;
    const partyAEmail = String(body.partyAEmail || body.party_a_email || auth.user.email || '').trim() || null;
    const partyBEmail = String(body.partyBEmail || body.party_b_email || '').trim() || null;
    const summary = String(body.summary || '').trim() || null;
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    const now = new Date();
    const proposalId = newId('proposal');

    const [created] = await db
      .insert(schema.proposals)
      .values({
        id: proposalId,
        userId: auth.user.id,
        title,
        status,
        templateName,
        partyAEmail,
        partyBEmail,
        summary,
        payload,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    ok(res, 201, {
      proposal: mapProposalRow(created, auth.user.email),
    });
  });
}
