import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  asText,
  mapComparisonRow,
  normalizeSpans,
  normalizeEmail,
  parseStep,
  toArray,
  toJsonObject,
} from './_helpers.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/document-comparisons', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    if (req.method === 'GET') {
      const status = asText(req.query?.status).toLowerCase();
      const limitRaw = Number(req.query?.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;

      const rows = status
        ? await db
            .select()
            .from(schema.documentComparisons)
            .where(
              and(
                eq(schema.documentComparisons.userId, auth.user.id),
                eq(schema.documentComparisons.status, status),
              ),
            )
            .orderBy(desc(schema.documentComparisons.updatedAt))
            .limit(limit)
        : await db
            .select()
            .from(schema.documentComparisons)
            .where(eq(schema.documentComparisons.userId, auth.user.id))
            .orderBy(desc(schema.documentComparisons.updatedAt))
            .limit(limit);

      ok(res, 200, {
        comparisons: rows.map(mapComparisonRow),
      });
      return;
    }

    const body = await readJsonBody(req);
    const now = new Date();

    const title = asText(body.title) || 'Untitled Comparison';
    const proposalId = asText(body.proposalId || body.proposal_id) || null;
    const createLinkedProposal = Boolean(body.createProposal || body.create_proposal);
    const partyALabel = asText(body.partyALabel || body.party_a_label) || 'Document A';
    const partyBLabel = asText(body.partyBLabel || body.party_b_label) || 'Document B';
    const docAText = String(body.docAText || body.doc_a_text || '');
    const docBText = String(body.docBText || body.doc_b_text || '');
    const draftStep = parseStep(body.draftStep || body.draft_step, 1);
    const metadata = toJsonObject(body.metadata);
    const rawInputs = toJsonObject(body.inputs);
    const docASource = asText(body.docASource || body.doc_a_source) || asText(rawInputs.doc_a_source) || 'typed';
    const docBSource = asText(body.docBSource || body.doc_b_source) || asText(rawInputs.doc_b_source) || 'typed';
    const docAFiles = toArray(body.docAFiles || body.doc_a_files || rawInputs.doc_a_files);
    const docBFiles = toArray(body.docBFiles || body.doc_b_files || rawInputs.doc_b_files);
    const docAUrl = asText(body.docAUrl || body.doc_a_url || rawInputs.doc_a_url) || null;
    const docBUrl = asText(body.docBUrl || body.doc_b_url || rawInputs.doc_b_url) || null;
    const inputs = {
      ...rawInputs,
      doc_a_source: docASource,
      doc_b_source: docBSource,
      doc_a_files: docAFiles,
      doc_b_files: docBFiles,
      doc_a_url: docAUrl,
      doc_b_url: docBUrl,
    };
    const docASpans = normalizeSpans(toArray(body.docASpans || body.doc_a_spans), docAText);
    const docBSpans = normalizeSpans(toArray(body.docBSpans || body.doc_b_spans), docBText);

    let linkedProposalId = proposalId;
    if (linkedProposalId) {
      const [proposal] = await db
        .select()
        .from(schema.proposals)
        .where(and(eq(schema.proposals.id, linkedProposalId), eq(schema.proposals.userId, auth.user.id)))
        .limit(1);
      if (!proposal) {
        throw new ApiError(404, 'proposal_not_found', 'Linked proposal not found');
      }
    } else if (createLinkedProposal) {
      const [proposal] = await db
        .insert(schema.proposals)
        .values({
          id: newId('proposal'),
          userId: auth.user.id,
          title,
          status: 'draft',
          templateId: null,
          templateName: 'Document Comparison',
          proposalType: 'document_comparison',
          draftStep: 1,
          sourceProposalId: null,
          documentComparisonId: null,
          partyAEmail: normalizeEmail(auth.user.email) || null,
          partyBEmail: null,
          summary: 'Document comparison workflow',
          payload: {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      linkedProposalId = proposal.id;
    }

    const [created] = await db
      .insert(schema.documentComparisons)
      .values({
        id: newId('comparison'),
        userId: auth.user.id,
        proposalId: linkedProposalId,
        title,
        status: 'draft',
        draftStep,
        partyALabel,
        partyBLabel,
        docAText,
        docBText,
        docASpans,
        docBSpans,
        evaluationResult: {},
        publicReport: {},
        inputs,
        metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (linkedProposalId) {
      await db
        .update(schema.proposals)
        .set({
          title,
          proposalType: 'document_comparison',
          draftStep,
          documentComparisonId: created.id,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, linkedProposalId));
    }

    ok(res, 201, {
      comparison: mapComparisonRow(created),
    });
  });
}
