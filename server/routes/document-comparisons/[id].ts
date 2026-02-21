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
  isPastDate,
  mapComparisonRow,
  normalizeSpans,
  resolveEditableSide,
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

    const body = req.method === 'PATCH' ? await readJsonBody(req) : {};
    const token = asText(
      body.sharedToken ||
        body.shared_token ||
        body.token ||
        req.query?.sharedToken ||
        req.query?.shared_token ||
        req.query?.token,
    );

    let auth = null;
    try {
      const authResult = await requireUser(req, res);
      if (authResult.ok) {
        auth = authResult;
        context.userId = auth.user.id;
      }
    } catch (error: any) {
      if (error instanceof ApiError && error.code === 'unauthorized') {
        auth = null;
      } else {
        throw error;
      }
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.documentComparisons)
      .where(eq(schema.documentComparisons.id, comparisonId))
      .limit(1);

    ensureComparisonFound(existing);

    const proposal =
      existing.proposalId
        ? await db
            .select()
            .from(schema.proposals)
            .where(eq(schema.proposals.id, existing.proposalId))
            .limit(1)
            .then((rows) => rows[0] || null)
        : null;

    let accessMode: 'owner' | 'recipient' | 'token' = 'owner';
    let editableSide: 'a' | 'b' = 'a';

    if (auth) {
      const userId = String(auth.user.id || '').trim();
      const userEmail = String(auth.user.email || '').trim().toLowerCase();
      const partyAEmail = String(proposal?.partyAEmail || '').trim().toLowerCase();
      const partyBEmail = String(proposal?.partyBEmail || '').trim().toLowerCase();
      const isOwner =
        String(existing.userId || '').trim() === userId ||
        String(proposal?.userId || '').trim() === userId;
      const isPartyA = Boolean(userEmail && partyAEmail && userEmail === partyAEmail);
      const isPartyB = Boolean(userEmail && partyBEmail && userEmail === partyBEmail);

      if (!isOwner && !isPartyA && !isPartyB) {
        if (!token) {
          throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
        }
        auth = null;
      } else {
        editableSide = resolveEditableSide({ proposal, user: auth.user, comparison: existing });
        accessMode = editableSide === 'b' ? 'recipient' : 'owner';
      }
    }

    if (!auth) {
      if (!token) {
        throw new ApiError(401, 'unauthorized', 'Authentication required');
      }

      if (!existing.proposalId) {
        throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this document comparison');
      }

      const [sharedLink] = await db
        .select()
        .from(schema.sharedLinks)
        .where(
          and(eq(schema.sharedLinks.token, token), eq(schema.sharedLinks.proposalId, existing.proposalId)),
        )
        .limit(1);

      if (!sharedLink) {
        throw new ApiError(404, 'token_not_found', 'Shared link not found');
      }

      if (!sharedLink.canView) {
        throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared link');
      }
      if (req.method === 'PATCH' && !sharedLink.canEdit) {
        throw new ApiError(403, 'edit_not_allowed', 'Editing is disabled for this shared link');
      }
      if (sharedLink.status !== 'active') {
        throw new ApiError(410, 'token_inactive', 'Shared link is inactive');
      }
      if (isPastDate(sharedLink.expiresAt)) {
        throw new ApiError(410, 'token_expired', 'Shared link has expired');
      }
      if (sharedLink.maxUses > 0 && sharedLink.uses >= sharedLink.maxUses) {
        throw new ApiError(410, 'max_uses_reached', 'Shared link has reached its usage limit');
      }

      editableSide = 'b';
      accessMode = 'token';
      context.userId = sharedLink.userId;
    }

    if (req.method === 'GET') {
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
              party_a_email: proposal.partyAEmail,
              party_b_email: proposal.partyBEmail,
              created_date: proposal.createdAt,
              updated_date: proposal.updatedAt,
            }
          : null,
        permissions: {
          access_mode: accessMode,
          editable_side: editableSide,
          can_edit_doc_a: editableSide === 'a',
          can_edit_doc_b: editableSide === 'b',
          has_token_access: accessMode === 'token',
        },
      });
      return;
    }

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

    if (hasDocASpans && editableSide !== 'a') {
      throw new ApiError(403, 'forbidden_side', 'You cannot edit Document A confidentiality spans');
    }
    if (hasDocBSpans && editableSide !== 'b') {
      throw new ApiError(403, 'forbidden_side', 'You cannot edit Document B confidentiality spans');
    }

    if (
      accessMode === 'token' &&
      (hasDocAText || hasDocBText || nextTitle || nextPartyALabel || nextPartyBLabel || hasDocASpans)
    ) {
      throw new ApiError(403, 'edit_not_allowed', 'Shared token can only update recipient confidentiality highlights');
    }

    const rawInputs =
      body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
        ? body.inputs
        : existing.inputs || {};
    const docASource = asText(body.docASource || body.doc_a_source || rawInputs.doc_a_source) || 'typed';
    const docBSource = asText(body.docBSource || body.doc_b_source || rawInputs.doc_b_source) || 'typed';
    const docAFiles = toArray(body.docAFiles || body.doc_a_files || rawInputs.doc_a_files);
    const docBFiles = toArray(body.docBFiles || body.doc_b_files || rawInputs.doc_b_files);
    const docAUrl = asText(body.docAUrl || body.doc_a_url || rawInputs.doc_a_url) || null;
    const docBUrl = asText(body.docBUrl || body.doc_b_url || rawInputs.doc_b_url) || null;

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
      inputs: {
        ...rawInputs,
        doc_a_source: docASource,
        doc_b_source: docBSource,
        doc_a_files: docAFiles,
        doc_b_files: docBFiles,
        doc_a_url: docAUrl,
        doc_b_url: docBUrl,
      },
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
      permissions: {
        access_mode: accessMode,
        editable_side: editableSide,
        can_edit_doc_a: editableSide === 'a',
        can_edit_doc_b: editableSide === 'b',
        has_token_access: accessMode === 'token',
      },
    });
  });
}
