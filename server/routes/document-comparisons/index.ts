import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { appendProposalHistory } from '../../_lib/proposal-history.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../_lib/document-editor-sanitization.js';
import {
  asText,
  CONFIDENTIAL_LABEL,
  SHARED_LABEL,
  mapComparisonRow,
  normalizeEmail,
  parseStep,
  toArray,
  toSpanArray,
  toJsonObject,
} from './_helpers.js';
import { assertDocumentComparisonWithinLimits } from './_limits.js';
import {
  assertStarterOpportunityCreateAllowed,
  assertStarterPerOpportunityUploadLimit,
  sumComparisonInputUploadBytes,
} from '../../_lib/starter-entitlements.js';

function toOptionalJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const type = String((value as any).type || '').trim().toLowerCase();
  const content = (value as any).content;
  if (type !== 'doc' || !Array.isArray(content)) {
    return null;
  }
  return value as Record<string, unknown>;
}

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

    const title = asText(body.title) || 'Untitled';
    const proposalId = asText(body.proposalId || body.proposal_id) || null;
    const createLinkedProposal = Boolean(body.createProposal || body.create_proposal);
    const partyALabel = CONFIDENTIAL_LABEL;
    const partyBLabel = SHARED_LABEL;
    const rawDocAText = String(
      body.docAText ||
        body.doc_a_text ||
        body.confidentialDocContent ||
        body.confidential_doc_content ||
        '',
    );
    const rawDocBText = String(
      body.docBText || body.doc_b_text || body.sharedDocContent || body.shared_doc_content || '',
    );
    const draftStep = parseStep(body.draftStep || body.draft_step, 1);
    const metadata = toJsonObject(body.metadata);
    const docASpans = toSpanArray(body.docASpans || body.doc_a_spans);
    const docBSpans = toSpanArray(body.docBSpans || body.doc_b_spans);
    const rawInputs = toJsonObject(body.inputs);
    const recipientName = asText(body.recipientName || body.recipient_name) || null;
    const recipientEmail = normalizeEmail(body.recipientEmail || body.recipient_email) || null;
    const docATitle = asText(body.docATitle || body.doc_a_title || rawInputs.doc_a_title) || null;
    const docBTitle = asText(body.docBTitle || body.doc_b_title || rawInputs.doc_b_title) || null;
    const documentsSession = Array.isArray(body.documents_session) && body.documents_session.length > 0
      ? body.documents_session
      : null;
    const docASource = asText(body.docASource || body.doc_a_source) || asText(rawInputs.doc_a_source) || 'typed';
    const docBSource = asText(body.docBSource || body.doc_b_source) || asText(rawInputs.doc_b_source) || 'typed';
    const rawDocAHtml = asText(body.docAHtml || body.doc_a_html || rawInputs.doc_a_html);
    const rawDocBHtml = asText(body.docBHtml || body.doc_b_html || rawInputs.doc_b_html);
    const docAHtml = sanitizeEditorHtml(rawDocAHtml || rawDocAText);
    const docBHtml = sanitizeEditorHtml(rawDocBHtml || rawDocBText);
    const docAText = sanitizeEditorText(rawDocAText || htmlToEditorText(docAHtml));
    const docBText = sanitizeEditorText(rawDocBText || htmlToEditorText(docBHtml));
    const docAJson = toOptionalJsonObject(body.docAJson || body.doc_a_json || rawInputs.doc_a_json);
    const docBJson = toOptionalJsonObject(body.docBJson || body.doc_b_json || rawInputs.doc_b_json);
    const docAFiles = toArray(body.docAFiles || body.doc_a_files || rawInputs.doc_a_files);
    const docBFiles = toArray(body.docBFiles || body.doc_b_files || rawInputs.doc_b_files);
    const docAUrl = asText(body.docAUrl || body.doc_a_url || rawInputs.doc_a_url) || null;
    const docBUrl = asText(body.docBUrl || body.doc_b_url || rawInputs.doc_b_url) || null;
    assertDocumentComparisonWithinLimits({
      docAText,
      docBText,
    });
    const inputs = {
      ...rawInputs,
      doc_a_source: docASource,
      doc_b_source: docBSource,
      doc_a_html: docAHtml || null,
      doc_b_html: docBHtml || null,
      doc_a_json: docAJson,
      doc_b_json: docBJson,
      doc_a_files: docAFiles,
      doc_b_files: docBFiles,
      doc_a_url: docAUrl,
      doc_b_url: docBUrl,
      confidential_doc_content: docAText,
      shared_doc_content: docBText,
      ...(docATitle !== null ? { doc_a_title: docATitle } : {}),
      ...(docBTitle !== null ? { doc_b_title: docBTitle } : {}),
      ...(documentsSession !== null ? { documents_session: documentsSession } : {}),
    };

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons',
          action: 'create_request_received',
          userId: auth.user.id,
          bodyKeys: Object.keys(body || {}).sort(),
          writeSummary: {
            docATextLength: Number(docAText.length),
            docBTextLength: Number(docBText.length),
            docASpanCount: Number(docASpans.length),
            docBSpanCount: Number(docBSpans.length),
            hasMetadata: Boolean(Object.keys(metadata || {}).length),
          },
        }),
      );
    }

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
      await assertStarterOpportunityCreateAllowed(db, auth.user.id);

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
          partyBEmail: recipientEmail,
          partyBName: recipientName,
          summary: 'Document comparison workflow',
          payload: {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      linkedProposalId = proposal.id;
    }

    if (linkedProposalId) {
      const uploadBytes = sumComparisonInputUploadBytes({
        docAFiles,
        docBFiles,
      });
      await assertStarterPerOpportunityUploadLimit(db, auth.user.id, uploadBytes);
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
        recipientName,
        recipientEmail,
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

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons',
          action: 'create_row_persisted',
          comparisonId: created.id,
          updatedAt: created.updatedAt,
          writeSummary: {
            docATextLength: Number(String(created.docAText || '').length),
            docBTextLength: Number(String(created.docBText || '').length),
            docASpanCount: Number(Array.isArray(created.docASpans) ? created.docASpans.length : 0),
            docBSpanCount: Number(Array.isArray(created.docBSpans) ? created.docBSpans.length : 0),
          },
        }),
      );
    }

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

      const [proposal] = await db
        .select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, linkedProposalId))
        .limit(1);

      if (proposal) {
        await appendProposalHistory(db, {
          proposal,
          actorUserId: auth.user.id,
          actorRole: 'party_a',
          milestone: 'create',
          eventType: 'proposal.created',
          documentComparison: created,
          createdAt: now,
          requestId: context.requestId,
          eventData: {
            source: 'document_comparison',
          },
        });
      }
    }

    ok(res, 201, {
      comparison: mapComparisonRow(created),
    });
  });
}
