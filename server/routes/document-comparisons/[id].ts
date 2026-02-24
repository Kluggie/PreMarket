import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../_lib/document-editor-sanitization.js';
import {
  asText,
  buildRecipientSafeEvaluationProjection,
  CONFIDENTIAL_LABEL,
  SHARED_LABEL,
  ensureComparisonFound,
  isPastDate,
  mapComparisonRow,
  resolveEditableSide,
  parseStep,
  toArray,
  toJsonObject,
} from './_helpers.js';
import { assertDocumentComparisonWithinLimits } from './_limits.js';

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

function toTokenSafeInputs(value: unknown) {
  const inputs =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    doc_b_source:
      typeof inputs.doc_b_source === 'string' && inputs.doc_b_source.trim().length > 0
        ? inputs.doc_b_source
        : 'typed',
    doc_b_files: Array.isArray(inputs.doc_b_files) ? inputs.doc_b_files : [],
    doc_b_url: typeof inputs.doc_b_url === 'string' ? inputs.doc_b_url : null,
    doc_b_html: typeof inputs.doc_b_html === 'string' ? inputs.doc_b_html : null,
    doc_b_json:
      inputs.doc_b_json && typeof inputs.doc_b_json === 'object' && !Array.isArray(inputs.doc_b_json)
        ? inputs.doc_b_json
        : null,
    shared_doc_content: typeof inputs.shared_doc_content === 'string' ? inputs.shared_doc_content : '',
  };
}

function toRecipientSafeComparison(mappedComparison: any) {
  const projection = buildRecipientSafeEvaluationProjection({
    evaluationResult: mappedComparison?.evaluation_result,
    publicReport: mappedComparison?.public_report,
    confidentialText: String(mappedComparison?.doc_a_text || ''),
    sharedText: String(mappedComparison?.doc_b_text || ''),
    title: String(mappedComparison?.title || ''),
  });

  return {
    ...mappedComparison,
    party_a_label: CONFIDENTIAL_LABEL,
    party_b_label: SHARED_LABEL,
    doc_a_text: '',
    doc_a_html: '',
    doc_a_json: null,
    doc_a_source: 'private',
    doc_a_files: [],
    doc_a_url: null,
    doc_a_spans: [],
    evaluation_result: projection.evaluation_result,
    public_report: projection.public_report,
    inputs: toTokenSafeInputs(mappedComparison?.inputs),
  };
}

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
      const mappedComparison = mapComparisonRow(existing);
      ok(res, 200, {
        comparison: accessMode === 'owner' ? mappedComparison : toRecipientSafeComparison(mappedComparison),
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
    const hasDocAText = body.docAText !== undefined || body.doc_a_text !== undefined;
    const hasDocBText = body.docBText !== undefined || body.doc_b_text !== undefined;
    const rawNextDocAText = hasDocAText ? String(body.docAText || body.doc_a_text || '') : existing.docAText || '';
    const rawNextDocBText = hasDocBText ? String(body.docBText || body.doc_b_text || '') : existing.docBText || '';
    const hasDocAHtml = body.docAHtml !== undefined || body.doc_a_html !== undefined;
    const hasDocBHtml = body.docBHtml !== undefined || body.doc_b_html !== undefined;
    const hasDocAJson = body.docAJson !== undefined || body.doc_a_json !== undefined;
    const hasDocBJson = body.docBJson !== undefined || body.doc_b_json !== undefined;
    const hasDocASource = body.docASource !== undefined || body.doc_a_source !== undefined;
    const hasDocAFiles = body.docAFiles !== undefined || body.doc_a_files !== undefined;
    const hasDocAUrl = body.docAUrl !== undefined || body.doc_a_url !== undefined;
    const hasPartyALabel = body.partyALabel !== undefined || body.party_a_label !== undefined;
    const hasPartyBLabel = body.partyBLabel !== undefined || body.party_b_label !== undefined;
    const hasInputsOverride = body.inputs !== undefined;
    const rawNextDocAHtml = hasDocAHtml
      ? asText(body.docAHtml || body.doc_a_html)
      : asText((existing.inputs || {}).doc_a_html);
    const rawNextDocBHtml = hasDocBHtml
      ? asText(body.docBHtml || body.doc_b_html)
      : asText((existing.inputs || {}).doc_b_html);
    const nextDocAHtml = sanitizeEditorHtml(rawNextDocAHtml || rawNextDocAText);
    const nextDocBHtml = sanitizeEditorHtml(rawNextDocBHtml || rawNextDocBText);
    const nextDocAText = sanitizeEditorText(rawNextDocAText || htmlToEditorText(nextDocAHtml));
    const nextDocBText = sanitizeEditorText(rawNextDocBText || htmlToEditorText(nextDocBHtml));
    const nextDocAJson = hasDocAJson
      ? toOptionalJsonObject(body.docAJson || body.doc_a_json)
      : toOptionalJsonObject((existing.inputs || {}).doc_a_json);
    const nextDocBJson = hasDocBJson
      ? toOptionalJsonObject(body.docBJson || body.doc_b_json)
      : toOptionalJsonObject((existing.inputs || {}).doc_b_json);

    if (
      accessMode === 'token' &&
      (
        nextTitle ||
        hasPartyALabel ||
        hasPartyBLabel ||
        hasDocAText ||
        hasDocAHtml ||
        hasDocAJson ||
        hasDocASource ||
        hasDocAFiles ||
        hasDocAUrl ||
        hasInputsOverride
      )
    ) {
      throw new ApiError(403, 'edit_not_allowed', 'Shared token can only update shared information content');
    }

    if (
      editableSide === 'b' &&
      (hasDocAText || hasDocAHtml || hasDocAJson || hasDocASource || hasDocAFiles || hasDocAUrl || hasPartyALabel)
    ) {
      throw new ApiError(403, 'forbidden_side', 'Recipient can only update shared information content');
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
    assertDocumentComparisonWithinLimits({
      docAText: nextDocAText,
      docBText: nextDocBText,
    });

    const updateValues = {
      title: nextTitle || existing.title,
      status: nextStatus || existing.status,
      draftStep:
        body.draftStep === undefined && body.draft_step === undefined
          ? existing.draftStep
          : parseStep(body.draftStep || body.draft_step, existing.draftStep || 1),
      partyALabel: CONFIDENTIAL_LABEL,
      partyBLabel: SHARED_LABEL,
      docAText: nextDocAText,
      docBText: nextDocBText,
      docASpans: [],
      docBSpans: [],
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
        doc_a_html: nextDocAHtml || null,
        doc_b_html: nextDocBHtml || null,
        doc_a_json: nextDocAJson,
        doc_b_json: nextDocBJson,
        doc_a_files: docAFiles,
        doc_b_files: docBFiles,
        doc_a_url: docAUrl,
        doc_b_url: docBUrl,
        confidential_doc_content: nextDocAText,
        shared_doc_content: nextDocBText,
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

    const mappedUpdated = mapComparisonRow(updated);
    ok(res, 200, {
      comparison: accessMode === 'owner' ? mappedUpdated : toRecipientSafeComparison(mappedUpdated),
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
