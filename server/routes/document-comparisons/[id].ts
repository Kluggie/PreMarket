import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { appendProposalHistory } from '../../_lib/proposal-history.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { loadSharedReportHistory } from '../../_lib/shared-report-history.js';
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
  toSpanArray,
  toJsonObject,
} from './_helpers.js';
import { assertDocumentComparisonWithinLimits } from './_limits.js';
import {
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

function clampResumeStep(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numeric), 1), 3);
}

function hasStep2DraftContent(comparison: any) {
  if (!comparison || typeof comparison !== 'object') {
    return false;
  }

  if (asText(comparison.docAText).length > 0 || asText(comparison.docBText).length > 0) {
    return true;
  }

  const inputs =
    comparison.inputs && typeof comparison.inputs === 'object' && !Array.isArray(comparison.inputs)
      ? (comparison.inputs as Record<string, unknown>)
      : {};
  const inputTextFields = [
    inputs.doc_a_html,
    inputs.doc_b_html,
    inputs.doc_a_url,
    inputs.doc_b_url,
    inputs.shared_doc_content,
  ];
  if (inputTextFields.some((value) => asText(value).length > 0)) {
    return true;
  }
  if (inputs.doc_a_json && typeof inputs.doc_a_json === 'object' && !Array.isArray(inputs.doc_a_json)) {
    return true;
  }
  if (inputs.doc_b_json && typeof inputs.doc_b_json === 'object' && !Array.isArray(inputs.doc_b_json)) {
    return true;
  }
  return (
    (Array.isArray(inputs.doc_a_files) && inputs.doc_a_files.length > 0) ||
    (Array.isArray(inputs.doc_b_files) && inputs.doc_b_files.length > 0)
  );
}

function hasEvaluationProjection(comparison: any) {
  if (!comparison || typeof comparison !== 'object') {
    return false;
  }
  const evaluationResult =
    comparison.evaluationResult &&
    typeof comparison.evaluationResult === 'object' &&
    !Array.isArray(comparison.evaluationResult)
      ? comparison.evaluationResult
      : {};
  const publicReport =
    comparison.publicReport &&
    typeof comparison.publicReport === 'object' &&
    !Array.isArray(comparison.publicReport)
      ? comparison.publicReport
      : {};
  return Object.keys(evaluationResult).length > 0 || Object.keys(publicReport).length > 0;
}

function hasEvaluationStatus(comparison: any) {
  const status = asText(comparison?.status).toLowerCase();
  return (
    status === 'running' ||
    status === 'queued' ||
    status === 'evaluating' ||
    status === 'evaluated' ||
    status === 'failed'
  );
}

function resolveComparisonResumeStep(params: {
  comparison: any;
  proposalDraftStep: unknown;
  hasEvaluationAttempt: boolean;
}) {
  const fallbackStep = clampResumeStep(params.proposalDraftStep, 1);
  const comparisonDraftStep = clampResumeStep(params.comparison?.draftStep, 1);
  if (
    params.hasEvaluationAttempt ||
    comparisonDraftStep >= 3 ||
    hasEvaluationStatus(params.comparison) ||
    hasEvaluationProjection(params.comparison)
  ) {
    return 3;
  }
  if (comparisonDraftStep >= 2 || hasStep2DraftContent(params.comparison) || fallbackStep >= 2) {
    return 2;
  }
  return 1;
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
    // Strip canonical documents_session — contains confidential content.
    documents_session: null,
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

function hasAnyWritablePatchField(body: Record<string, unknown>) {
  const writableKeys = [
    'title',
    'status',
    'draftStep',
    'draft_step',
    'partyALabel',
    'party_a_label',
    'partyBLabel',
    'party_b_label',
    'docAText',
    'doc_a_text',
    'docBText',
    'doc_b_text',
    'docAHtml',
    'doc_a_html',
    'docBHtml',
    'doc_b_html',
    'docAJson',
    'doc_a_json',
    'docBJson',
    'doc_b_json',
    'docASource',
    'doc_a_source',
    'docBSource',
    'doc_b_source',
    'docAFiles',
    'doc_a_files',
    'docBFiles',
    'doc_b_files',
    'docAUrl',
    'doc_a_url',
    'docBUrl',
    'doc_b_url',
    'docASpans',
    'doc_a_spans',
    'docBSpans',
    'doc_b_spans',
    'evaluationResult',
    'evaluation_result',
    'publicReport',
    'public_report',
    'metadata',
    'inputs',
    'recipientName',
    'recipient_name',
    'recipientEmail',
    'recipient_email',
    'documents_session',
  ];

  return writableKeys.some((key) => body[key] !== undefined);
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]', async (context) => {
    ensureMethod(req, ['GET', 'PATCH']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const body = req.method === 'PATCH' ? await readJsonBody(req) : {};
    if (req.method === 'PATCH' && !hasAnyWritablePatchField(body as Record<string, unknown>)) {
      throw new ApiError(
        400,
        'invalid_input',
        'At least one writable field is required for update',
      );
    }
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
      if (error instanceof ApiError && (error.code === 'unauthorized' || error.code === 'mfa_required')) {
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
      const sharedHistory = proposal
        ? await loadSharedReportHistory({
            db,
            proposal,
            comparison: existing,
          })
        : {
            sharedEntries: [],
            maxRoundNumber: 0,
          };
      const hasEvaluationAttempt = proposal?.id
        ? await db
            .select({ id: schema.proposalEvaluations.id })
            .from(schema.proposalEvaluations)
            .where(eq(schema.proposalEvaluations.proposalId, proposal.id))
            .limit(1)
            .then((rows) => rows.length > 0)
        : false;
      const resumeStep = resolveComparisonResumeStep({
        comparison: existing,
        proposalDraftStep: proposal?.draftStep,
        hasEvaluationAttempt,
      });
      const mappedComparison = {
        ...mapComparisonRow(existing),
        resume_step: resumeStep,
      };
      if (process.env.NODE_ENV !== 'production') {
        console.info(
          JSON.stringify({
            level: 'info',
            route: '/api/document-comparisons/[id]',
            action: 'get_draft_loaded',
            comparisonId: existing.id,
            accessMode,
            editableSide,
            readSummary: {
              draftStep: Number(existing.draftStep || 1),
              updatedAt: existing.updatedAt || null,
              docATextLength: Number(String(existing.docAText || '').length),
              docBTextLength: Number(String(existing.docBText || '').length),
              docASpanCount: Number(Array.isArray(existing.docASpans) ? existing.docASpans.length : 0),
              docBSpanCount: Number(Array.isArray(existing.docBSpans) ? existing.docBSpans.length : 0),
            },
          }),
        );
      }
      ok(res, 200, {
        comparison: accessMode === 'owner' ? mappedComparison : toRecipientSafeComparison(mappedComparison),
        proposal: proposal
          ? {
              id: proposal.id,
              title: proposal.title,
              status: proposal.status,
              proposal_type: proposal.proposalType,
              draft_step: proposal.draftStep,
              resume_step: resumeStep,
              document_comparison_id: proposal.documentComparisonId,
              party_a_email: proposal.partyAEmail,
              party_b_email: proposal.partyBEmail,
              party_b_name: (proposal as any).partyBName || null,
              created_date: proposal.createdAt,
              updated_date: proposal.updatedAt,
            }
          : null,
        shared_history: {
          entries: sharedHistory.sharedEntries,
          max_round_number: sharedHistory.maxRoundNumber,
        },
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
    const hasDocASpans = body.docASpans !== undefined || body.doc_a_spans !== undefined;
    const hasDocBSpans = body.docBSpans !== undefined || body.doc_b_spans !== undefined;
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
    const nextDocASpans = hasDocASpans
      ? toSpanArray(body.docASpans || body.doc_a_spans)
      : toSpanArray(existing.docASpans);
    const nextDocBSpans = hasDocBSpans
      ? toSpanArray(body.docBSpans || body.doc_b_spans)
      : toSpanArray(existing.docBSpans);

    if (
      accessMode === 'token' &&
      (
        nextTitle ||
        hasPartyALabel ||
        hasPartyBLabel ||
        hasDocAText ||
        hasDocAHtml ||
        hasDocAJson ||
        hasDocASpans ||
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
      (
        hasDocAText ||
        hasDocAHtml ||
        hasDocAJson ||
        hasDocASpans ||
        hasDocASource ||
        hasDocAFiles ||
        hasDocAUrl ||
        hasPartyALabel
      )
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
    const docATitle = asText(body.docATitle || body.doc_a_title || rawInputs.doc_a_title) || null;
    const docBTitle = asText(body.docBTitle || body.doc_b_title || rawInputs.doc_b_title) || null;
    const hasDocumentsSession = body.documents_session !== undefined;
    const documentsSession = hasDocumentsSession && Array.isArray(body.documents_session) && body.documents_session.length > 0
      ? body.documents_session
      : (!hasDocumentsSession && Array.isArray(rawInputs.documents_session) && rawInputs.documents_session.length > 0
          ? rawInputs.documents_session
          : null);
    const hasRecipientName = body.recipientName !== undefined || body.recipient_name !== undefined;
    const hasRecipientEmail = body.recipientEmail !== undefined || body.recipient_email !== undefined;
    const nextRecipientName = hasRecipientName
      ? (asText(body.recipientName || body.recipient_name) || null)
      : (existing.recipientName ?? null);
    const nextRecipientEmail = hasRecipientEmail
      ? (asText(body.recipientEmail || body.recipient_email).toLowerCase() || null)
      : (existing.recipientEmail ?? null);
    assertDocumentComparisonWithinLimits({
      docAText: nextDocAText,
      docBText: nextDocBText,
    });

    if (existing.proposalId) {
      const uploadBytes = sumComparisonInputUploadBytes({
        docAFiles,
        docBFiles,
      });
      await assertStarterPerOpportunityUploadLimit(db, existing.userId, uploadBytes);
    }

    const updateValues = {
      title: nextTitle || existing.title,
      status: nextStatus || existing.status,
      draftStep:
        body.draftStep === undefined && body.draft_step === undefined
          ? existing.draftStep
          : parseStep(body.draftStep || body.draft_step, existing.draftStep || 1),
      partyALabel: CONFIDENTIAL_LABEL,
      partyBLabel: SHARED_LABEL,
      recipientName: nextRecipientName,
      recipientEmail: nextRecipientEmail,
      docAText: nextDocAText,
      docBText: nextDocBText,
      docASpans: nextDocASpans,
      docBSpans: nextDocBSpans,
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
        ...(docATitle !== null ? { doc_a_title: docATitle } : {}),
        ...(docBTitle !== null ? { doc_b_title: docBTitle } : {}),
        ...(documentsSession !== null ? { documents_session: documentsSession } : {}),
      },
      metadata:
        body.metadata && typeof body.metadata === 'object' ? body.metadata : existing.metadata || {},
      updatedAt: new Date(),
    };

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons/[id]',
          action: 'patch_request_received',
          comparisonId: existing.id,
          accessMode,
          editableSide,
          bodyKeys: Object.keys(body || {}).sort(),
          writeSummary: {
            docATextLength: Number(nextDocAText.length),
            docBTextLength: Number(nextDocBText.length),
            docASpanCount: Number(nextDocASpans.length),
            docBSpanCount: Number(nextDocBSpans.length),
            hasMetadata: Boolean(
              updateValues.metadata &&
                typeof updateValues.metadata === 'object' &&
                Object.keys(updateValues.metadata).length,
            ),
          },
        }),
      );
    }

    const [updated] = await db
      .update(schema.documentComparisons)
      .set(updateValues)
      .where(eq(schema.documentComparisons.id, existing.id))
      .returning();

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons/[id]',
          action: 'patch_row_persisted',
          comparisonId: updated?.id || existing.id,
          updatedAt: updated?.updatedAt || null,
          draftStep: updated?.draftStep || existing.draftStep,
          stateChange: {
            previousStatus: existing.status,
            nextStatus: updated?.status || existing.status,
            previousDraftStep: existing.draftStep,
            nextDraftStep: updated?.draftStep || existing.draftStep,
          },
          writeSummary: {
            docATextLength: Number(String(updated?.docAText || nextDocAText).length),
            docBTextLength: Number(String(updated?.docBText || nextDocBText).length),
            docASpanCount: Number(Array.isArray(updated?.docASpans) ? updated.docASpans.length : nextDocASpans.length),
            docBSpanCount: Number(Array.isArray(updated?.docBSpans) ? updated.docBSpans.length : nextDocBSpans.length),
          },
        }),
      );
    }

    if (existing.proposalId) {
      const proposalUpdatedAt = new Date();
      await db
        .update(schema.proposals)
        .set({
          title: updated.title,
          status: updated.status === 'evaluated' ? 'under_verification' : 'draft',
          draftStep: updated.draftStep,
          proposalType: 'document_comparison',
          documentComparisonId: updated.id,
          ...(nextRecipientEmail !== null && nextRecipientEmail !== (proposal?.partyBEmail ?? null)
            ? { partyBEmail: nextRecipientEmail }
            : {}),
          ...(nextRecipientName !== null && nextRecipientName !== ((proposal as any)?.partyBName ?? null)
            ? { partyBName: nextRecipientName }
            : {}),
          updatedAt: proposalUpdatedAt,
        })
        .where(eq(schema.proposals.id, existing.proposalId));

      if (proposal) {
        await appendProposalHistory(db, {
          proposal: {
            ...proposal,
            title: updated.title,
            status: updated.status === 'evaluated' ? 'under_verification' : 'draft',
            draftStep: updated.draftStep,
            proposalType: 'document_comparison',
            documentComparisonId: updated.id,
            updatedAt: proposalUpdatedAt,
          },
          actorUserId: auth?.user?.id || proposal.userId,
          actorRole: editableSide === 'b' ? 'party_b' : 'party_a',
          milestone: 'update',
          eventType: 'proposal.updated',
          documentComparison: updated,
          createdAt: proposalUpdatedAt,
          requestId: context.requestId,
          eventData: {
            source: 'document_comparison',
            access_mode: accessMode,
            editable_side: editableSide,
          },
        });
      }
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
