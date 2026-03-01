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

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function toSafeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
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
        ...(function mapEvaluationInputTrace() {
          const trace =
            row?.result?.input_trace && typeof row.result.input_trace === 'object' && !Array.isArray(row.result.input_trace)
              ? row.result.input_trace
              : {};
          return {
            input_shared_hash: row.inputSharedHash || asText(trace.shared_hash) || null,
            input_conf_hash: row.inputConfHash || asText(trace.confidential_hash) || null,
            input_shared_len: row.inputSharedLen ?? toSafeInteger(trace.shared_length),
            input_conf_len: row.inputConfLen ?? toSafeInteger(trace.confidential_length),
            input_version: row.inputVersion ?? toSafeInteger(trace.input_version),
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
    });
  });
}
