import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import { ensureComparisonFound, mapComparisonRow } from '../_helpers.js';

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toFailedResult(error: any) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const code = asText(error?.code) || 'evaluation_failed';
  const message = asText(error?.message) || 'Evaluation failed';

  return {
    error: {
      statusCode,
      code,
      message,
      details: error?.extra && typeof error.extra === 'object' ? error.extra : {},
    },
  };
}

async function persistFailedProposalEvaluation(params: {
  db: any;
  proposalId: string;
  userId: string;
  error: any;
}) {
  const now = new Date();
  await params.db.insert(schema.proposalEvaluations).values({
    id: newId('eval'),
    proposalId: params.proposalId,
    userId: params.userId,
    source: 'document_comparison_vertex',
    status: 'failed',
    score: null,
    summary: asText(params.error?.message) || 'Document comparison evaluation failed',
    result: toFailedResult(params.error),
    createdAt: now,
    updatedAt: now,
  });
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/evaluate', async (context) => {
    ensureMethod(req, ['POST']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.documentComparisons)
      .where(and(eq(schema.documentComparisons.id, comparisonId), eq(schema.documentComparisons.userId, auth.user.id)))
      .limit(1);

    ensureComparisonFound(existing);

    let evaluation: any;
    try {
      evaluation = await evaluateDocumentComparisonWithVertex({
        title: existing.title,
        docAText: existing.docAText || '',
        docBText: existing.docBText || '',
        docASpans: Array.isArray(existing.docASpans) ? existing.docASpans : [],
        docBSpans: Array.isArray(existing.docBSpans) ? existing.docBSpans : [],
        partyALabel: existing.partyALabel || 'Document A',
        partyBLabel: existing.partyBLabel || 'Document B',
      });
    } catch (error: any) {
      await db
        .update(schema.documentComparisons)
        .set({
          status: 'failed',
          evaluationResult: toFailedResult(error),
          updatedAt: new Date(),
        })
        .where(eq(schema.documentComparisons.id, existing.id));

      if (existing.proposalId) {
        await persistFailedProposalEvaluation({
          db,
          proposalId: existing.proposalId,
          userId: auth.user.id,
          error,
        });
      }

      throw error;
    }

    const now = new Date();
    const [updated] = await db
      .update(schema.documentComparisons)
      .set({
        status: 'evaluated',
        draftStep: 4,
        evaluationResult: evaluation,
        publicReport: evaluation.report,
        updatedAt: now,
      })
      .where(eq(schema.documentComparisons.id, existing.id))
      .returning();

    let proposalSummary = null;
    if (existing.proposalId) {
      const [proposal] = await db
        .update(schema.proposals)
        .set({
          status: 'under_verification',
          proposalType: 'document_comparison',
          draftStep: 4,
          evaluatedAt: now,
          documentComparisonId: existing.id,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, existing.proposalId))
        .returning();

      if (proposal) {
        proposalSummary = {
          id: proposal.id,
          status: proposal.status,
          evaluated_at: proposal.evaluatedAt,
        };

        await db.insert(schema.proposalEvaluations).values({
          id: newId('eval'),
          proposalId: proposal.id,
          userId: proposal.userId,
          source: 'document_comparison_vertex',
          status: 'completed',
          score: evaluation.score,
          summary: evaluation.summary,
          result: evaluation,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    ok(res, 200, {
      comparison: mapComparisonRow(updated),
      evaluation: evaluation.report,
      proposal: proposalSummary,
    });
  });
}
