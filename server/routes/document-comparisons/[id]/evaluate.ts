import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import {
  ensureComparisonFound,
  mapComparisonRow,
} from '../_helpers.js';

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
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
      .where(
        and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.userId, auth.user.id),
        ),
      )
      .limit(1);

    ensureComparisonFound(existing);

    const evaluation = await evaluateDocumentComparisonWithVertex({
      title: existing.title,
      docAText: existing.docAText || '',
      docBText: existing.docBText || '',
      docASpans: Array.isArray(existing.docASpans) ? existing.docASpans : [],
      docBSpans: Array.isArray(existing.docBSpans) ? existing.docBSpans : [],
      partyALabel: existing.partyALabel || 'Document A',
      partyBLabel: existing.partyBLabel || 'Document B',
    });

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
          source: 'document_comparison',
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
