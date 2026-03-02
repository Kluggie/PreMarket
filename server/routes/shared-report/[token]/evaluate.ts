import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { schema } from '../../../_lib/db/client.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import {
  buildRecipientSafeEvaluationProjection,
  CONFIDENTIAL_LABEL,
  SHARED_LABEL,
} from '../../document-comparisons/_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../../document-comparisons/_limits.js';
import {
  DRAFT_STATUS,
  RECIPIENT_ROLE,
  SHARED_REPORT_ROUTE,
  assertPayloadSize,
  buildDefaultConfidentialPayload,
  buildDefaultSharedPayload,
  getCurrentRecipientDraft,
  getPayloadText,
  getToken,
  logTokenEvent,
  resolveSharedReportToken,
  toObject,
} from '../_shared.js';

const SHARED_REPORT_EVALUATE_ROUTE = `${SHARED_REPORT_ROUTE}/evaluate`;
const MIN_SHARED_EVALUATION_TEXT_LENGTH = 40;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDocumentComparisonEvaluator() {
  const override = (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
  if (typeof override === 'function') {
    return override as typeof evaluateDocumentComparisonWithVertex;
  }
  return evaluateDocumentComparisonWithVertex;
}

function coercePayloadHtml(payload: unknown, fallbackText = '') {
  const source = toObject(payload);
  const html = asText(source.html);
  if (html) {
    return sanitizeEditorHtml(html);
  }
  const text = getPayloadText(payload, fallbackText);
  return sanitizeEditorHtml(text);
}

function coercePayloadText(payload: unknown, fallbackText = '') {
  const text = getPayloadText(payload, fallbackText);
  if (text) {
    return sanitizeEditorText(text);
  }
  const html = coercePayloadHtml(payload, fallbackText);
  return sanitizeEditorText(htmlToEditorText(html));
}

function buildConfidentialBundle(params: {
  proposerConfidentialText: string;
  recipientConfidentialText: string;
}) {
  const parts: string[] = [];
  if (params.proposerConfidentialText) {
    parts.push(`[Proposer Confidential Information]\n${params.proposerConfidentialText}`);
  }
  if (params.recipientConfidentialText) {
    parts.push(`[Recipient Confidential Information]\n${params.recipientConfidentialText}`);
  }
  return parts.join('\n\n').trim();
}

function toApiError(error: any) {
  if (error instanceof ApiError) {
    return error;
  }
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const safeStatus = Number.isFinite(statusCode) && statusCode >= 400 && statusCode <= 599 ? Math.floor(statusCode) : 500;
  const code = asText(error?.code) || 'evaluation_failed';
  const message = asText(error?.message) || 'Evaluation failed';
  return new ApiError(safeStatus, code, message);
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_EVALUATE_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    logTokenEvent(context, 'evaluate_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: false,
    });

    if (!resolved.link.canReevaluate) {
      throw new ApiError(403, 'reevaluation_not_allowed', 'Re-evaluation is disabled for this link');
    }

    const defaultSharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const defaultConfidentialPayload = buildDefaultConfidentialPayload();

    let currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    const now = new Date();

    if (!currentDraft) {
      const [created] = await resolved.db
        .insert(schema.sharedReportRecipientRevisions)
        .values({
          id: newId('share_rev'),
          sharedLinkId: resolved.link.id,
          proposalId: resolved.proposal.id,
          comparisonId: resolved.comparison?.id || null,
          actorRole: RECIPIENT_ROLE,
          status: DRAFT_STATUS,
          workflowStep: 2,
          sharedPayload: defaultSharedPayload,
          recipientConfidentialPayload: defaultConfidentialPayload,
          editorState: {},
          previousRevisionId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      currentDraft = created || null;
    }

    if (!currentDraft) {
      throw new ApiError(500, 'draft_resolution_failed', 'Unable to resolve recipient draft for evaluation');
    }

    const sharedPayload = toObject(currentDraft.sharedPayload);
    const confidentialPayload = toObject(currentDraft.recipientConfidentialPayload);

    assertPayloadSize(sharedPayload, 'shared_payload');
    assertPayloadSize(confidentialPayload, 'recipient_confidential_payload');

    const sharedFallbackText = String(resolved.comparison?.docBText || defaultSharedPayload.text || '');
    const proposerConfidentialText = sanitizeEditorText(String(resolved.comparison?.docAText || ''));
    const sharedText = coercePayloadText(sharedPayload, sharedFallbackText);
    const sharedHtml = coercePayloadHtml(sharedPayload, sharedText);
    const recipientConfidentialText = coercePayloadText(confidentialPayload, '');
    const confidentialBundle = buildConfidentialBundle({
      proposerConfidentialText,
      recipientConfidentialText,
    });

    if (sharedText.length < MIN_SHARED_EVALUATION_TEXT_LENGTH) {
      throw new ApiError(
        400,
        'invalid_input',
        `Shared Information must be at least ${MIN_SHARED_EVALUATION_TEXT_LENGTH} characters before evaluation.`,
      );
    }

    assertDocumentComparisonWithinLimits({
      docAText: confidentialBundle,
      docBText: sharedText,
    });

    const evaluationRunId = newId('share_eval');
    await resolved.db.insert(schema.sharedReportEvaluationRuns).values({
      id: evaluationRunId,
      sharedLinkId: resolved.link.id,
      proposalId: resolved.proposal.id,
      comparisonId: resolved.comparison?.id || null,
      revisionId: currentDraft.id,
      actorRole: RECIPIENT_ROLE,
      status: 'pending',
      resultPublicReport: {},
      resultJson: {},
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const evaluateComparison = getDocumentComparisonEvaluator();
      const evaluated = await evaluateComparison(
        {
          title: asText(resolved.comparison?.title) || asText(resolved.proposal.title) || 'Shared Report',
          docAText: confidentialBundle,
          docBText: sharedText,
          docASpans: [],
          docBSpans: [],
          partyALabel: CONFIDENTIAL_LABEL,
          partyBLabel: SHARED_LABEL,
        },
        {
          correlationId: context?.requestId || null,
          routeName: SHARED_REPORT_EVALUATE_ROUTE,
          entityId: currentDraft.id,
          inputChars: confidentialBundle.length + sharedText.length,
        },
      );

      const projection = buildRecipientSafeEvaluationProjection({
        evaluationResult: evaluated || {},
        publicReport: evaluated?.report || {},
        confidentialText: confidentialBundle,
        sharedText,
        title: asText(resolved.comparison?.title) || asText(resolved.proposal.title),
      });

      const completedAt = new Date();
      await resolved.db
        .update(schema.sharedReportEvaluationRuns)
        .set({
          status: 'success',
          resultPublicReport: projection.public_report || {},
          resultJson: {
            evaluation_result: projection.evaluation_result || {},
            input_trace: {
              shared_length: sharedText.length,
              confidential_length: confidentialBundle.length,
              proposer_confidential_length: proposerConfidentialText.length,
              recipient_confidential_length: recipientConfidentialText.length,
            },
            shared_snapshot: {
              text: sharedText,
              html: sharedHtml,
            },
          },
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        })
        .where(eq(schema.sharedReportEvaluationRuns.id, evaluationRunId));

      await resolved.db
        .update(schema.sharedReportRecipientRevisions)
        .set({
          workflowStep: 3,
          updatedAt: completedAt,
        })
        .where(eq(schema.sharedReportRecipientRevisions.id, currentDraft.id));

      ok(res, 200, {
        ok: true,
        evaluation_id: evaluationRunId,
        evaluation: {
          public_report: projection.public_report || {},
          evaluation_result: projection.evaluation_result || {},
          status: 'success',
        },
      });

      logTokenEvent(context, 'evaluate_success', token, {
        linkId: resolved.link.id,
        revisionId: currentDraft.id,
        evaluationId: evaluationRunId,
      });
    } catch (error: any) {
      const failure = toApiError(error);
      const failedAt = new Date();
      await resolved.db
        .update(schema.sharedReportEvaluationRuns)
        .set({
          status: 'error',
          errorCode: failure.code,
          errorMessage: failure.message,
          resultJson: {
            error: {
              code: failure.code,
              message: failure.message,
              status_code: failure.statusCode,
            },
          },
          updatedAt: failedAt,
        })
        .where(eq(schema.sharedReportEvaluationRuns.id, evaluationRunId));
      throw failure;
    }
  });
}
