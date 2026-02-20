import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  asText,
  ensureComparisonFound,
  mapComparisonRow,
  normalizeSpans,
  parseStep,
  toArray,
  toJsonObject,
} from './_helpers.js';

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]', async (context) => {
    ensureMethod(req, ['GET', 'PATCH']);

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

    if (req.method === 'GET') {
      const proposal =
        existing.proposalId
          ? await db
              .select()
              .from(schema.proposals)
              .where(eq(schema.proposals.id, existing.proposalId))
              .limit(1)
              .then((rows) => rows[0] || null)
          : null;

      ok(res, 200, {
        comparison: mapComparisonRow(existing),
        proposal: proposal
          ? {
              id: proposal.id,
              title: proposal.title,
              status: proposal.status,
              proposal_type: proposal.proposalType,
              draft_step: proposal.draftStep,
              document_comparison_id: proposal.documentComparisonId,
              updated_date: proposal.updatedAt,
            }
          : null,
      });
      return;
    }

    const body = await readJsonBody(req);
    const nextTitle = asText(body.title);
    const nextStatus = asText(body.status).toLowerCase();
    const nextPartyALabel = asText(body.partyALabel || body.party_a_label);
    const nextPartyBLabel = asText(body.partyBLabel || body.party_b_label);
    const hasDocAText = body.docAText !== undefined || body.doc_a_text !== undefined;
    const hasDocBText = body.docBText !== undefined || body.doc_b_text !== undefined;
    const nextDocAText = hasDocAText ? String(body.docAText || body.doc_a_text || '') : existing.docAText || '';
    const nextDocBText = hasDocBText ? String(body.docBText || body.doc_b_text || '') : existing.docBText || '';
    const hasDocASpans = body.docASpans !== undefined || body.doc_a_spans !== undefined;
    const hasDocBSpans = body.docBSpans !== undefined || body.doc_b_spans !== undefined;

    const updateValues = {
      title: nextTitle || existing.title,
      status: nextStatus || existing.status,
      draftStep:
        body.draftStep === undefined && body.draft_step === undefined
          ? existing.draftStep
          : parseStep(body.draftStep || body.draft_step, existing.draftStep || 1),
      partyALabel: nextPartyALabel || existing.partyALabel,
      partyBLabel: nextPartyBLabel || existing.partyBLabel,
      docAText: nextDocAText,
      docBText: nextDocBText,
      docASpans: hasDocASpans
        ? normalizeSpans(toArray(body.docASpans || body.doc_a_spans), nextDocAText)
        : existing.docASpans || [],
      docBSpans: hasDocBSpans
        ? normalizeSpans(toArray(body.docBSpans || body.doc_b_spans), nextDocBText)
        : existing.docBSpans || [],
      evaluationResult:
        body.evaluationResult && typeof body.evaluationResult === 'object'
          ? body.evaluationResult
          : body.evaluation_result && typeof body.evaluation_result === 'object'
            ? body.evaluation_result
            : existing.evaluationResult || {},
      publicReport:
        body.publicReport && typeof body.publicReport === 'object'
          ? body.publicReport
          : body.public_report && typeof body.public_report === 'object'
            ? body.public_report
            : existing.publicReport || {},
      inputs:
        body.inputs && typeof body.inputs === 'object' ? body.inputs : existing.inputs || {},
      metadata:
        body.metadata && typeof body.metadata === 'object' ? body.metadata : existing.metadata || {},
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(schema.documentComparisons)
      .set(updateValues)
      .where(eq(schema.documentComparisons.id, existing.id))
      .returning();

    if (existing.proposalId) {
      await db
        .update(schema.proposals)
        .set({
          title: updated.title,
          status: updated.status === 'evaluated' ? 'under_verification' : 'draft',
          draftStep: updated.draftStep,
          proposalType: 'document_comparison',
          documentComparisonId: updated.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.proposals.id, existing.proposalId));
    }

    ok(res, 200, {
      comparison: mapComparisonRow(updated),
    });
  });
}
