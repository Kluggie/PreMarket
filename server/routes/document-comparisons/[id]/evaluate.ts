import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import { ensureComparisonFound, mapComparisonRow } from '../_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../_limits.js';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_EVALUATION_ATTEMPTS = 2;

type EvaluationFailureCode =
  | 'not_configured'
  | 'vertex_timeout'
  | 'vertex_rate_limited'
  | 'vertex_unavailable'
  | 'vertex_unauthorized'
  | 'vertex_bad_request'
  | 'vertex_invalid_response'
  | 'vertex_internal_error'
  | 'db_write_failed'
  | 'unknown_error';

type EvaluationFailureStage = 'auth' | 'vertex_call' | 'parse' | 'db_write' | 'validation' | 'unknown';

type ClassifiedEvaluationFailure = {
  failureCode: EvaluationFailureCode;
  failureStage: EvaluationFailureStage;
  failureMessage: string;
  httpStatus: number;
  retryable: boolean;
  sourceCode: string;
  upstreamStatus: number | null;
};

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

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function toHttpStatus(value: unknown, fallback = 500) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 100 || numeric > 599) {
    return fallback;
  }
  return Math.floor(numeric);
}

function toSafeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
}

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

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => {
    if (entry === null || entry === undefined) return false;
    const type = typeof entry;
    return type === 'string' || type === 'number' || type === 'boolean' || type === 'object';
  }) as any[];
}

function firstRow<T = any>(value: unknown): T | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return value[0] as T;
}

function resolveEvaluationDraft(params: {
  existing: any;
  body: Record<string, unknown>;
}) {
  const { existing, body } = params;
  const existingInputs =
    existing?.inputs && typeof existing.inputs === 'object' && !Array.isArray(existing.inputs)
      ? existing.inputs
      : {};

  const title = asText(body.title) || asText(existing?.title) || 'Untitled Comparison';
  const rawDocAText =
    body.docAText !== undefined || body.doc_a_text !== undefined
      ? String(body.docAText || body.doc_a_text || '')
      : String(existing?.docAText || '');
  const rawDocBText =
    body.docBText !== undefined || body.doc_b_text !== undefined
      ? String(body.docBText || body.doc_b_text || '')
      : String(existing?.docBText || '');
  const rawDocAHtml =
    body.docAHtml !== undefined || body.doc_a_html !== undefined
      ? asText(body.docAHtml || body.doc_a_html)
      : asText(existingInputs.doc_a_html);
  const rawDocBHtml =
    body.docBHtml !== undefined || body.doc_b_html !== undefined
      ? asText(body.docBHtml || body.doc_b_html)
      : asText(existingInputs.doc_b_html);

  const docAHtml = sanitizeEditorHtml(rawDocAHtml || rawDocAText);
  const docBHtml = sanitizeEditorHtml(rawDocBHtml || rawDocBText);
  const docAText = sanitizeEditorText(rawDocAText || htmlToEditorText(docAHtml));
  const docBText = sanitizeEditorText(rawDocBText || htmlToEditorText(docBHtml));
  const docAJson =
    body.docAJson !== undefined || body.doc_a_json !== undefined
      ? toOptionalJsonObject(body.docAJson || body.doc_a_json)
      : toOptionalJsonObject(existingInputs.doc_a_json);
  const docBJson =
    body.docBJson !== undefined || body.doc_b_json !== undefined
      ? toOptionalJsonObject(body.docBJson || body.doc_b_json)
      : toOptionalJsonObject(existingInputs.doc_b_json);
  const docASource = asText(body.docASource || body.doc_a_source || existingInputs.doc_a_source) || 'typed';
  const docBSource = asText(body.docBSource || body.doc_b_source || existingInputs.doc_b_source) || 'typed';
  const docAFiles = toStringArray(body.docAFiles || body.doc_a_files || existingInputs.doc_a_files);
  const docBFiles = toStringArray(body.docBFiles || body.doc_b_files || existingInputs.doc_b_files);
  const docAUrl = asText(body.docAUrl || body.doc_a_url || existingInputs.doc_a_url) || null;
  const docBUrl = asText(body.docBUrl || body.doc_b_url || existingInputs.doc_b_url) || null;
  const updatedInputs = {
    ...existingInputs,
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
  };

  return {
    title,
    docAText,
    docBText,
    inputs: updatedInputs,
  };
}

function sanitizeFailureDiagnostics(extra: unknown) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return null;
  }
  const source = extra as Record<string, unknown>;
  const model = asText(source.model);
  const reasonCode = asText(source.reasonCode);
  const parseErrorName = asText(source.parseErrorName);
  const parseErrorMessage = asText(source.parseErrorMessage);
  const sourceEnvKey = asText(source.sourceEnvKey);
  const diagnostics = {
    model: model || null,
    reason_code: reasonCode || null,
    parse_error_name: parseErrorName || null,
    parse_error_message: parseErrorMessage || null,
    source_env_key: sourceEnvKey || null,
    response_keys: Array.isArray(source.responseKeys)
      ? source.responseKeys.map((value) => asText(value)).filter(Boolean).slice(0, 20)
      : [],
    candidate_count: toSafeInteger(source.candidateCount),
    first_candidate_keys: Array.isArray(source.firstCandidateKeys)
      ? source.firstCandidateKeys.map((value) => asText(value)).filter(Boolean).slice(0, 20)
      : [],
    first_part_keys: Array.isArray(source.firstPartKeys)
      ? source.firstPartKeys.map((value) => asText(value)).filter(Boolean).slice(0, 20)
      : [],
    text_length: toSafeInteger(source.textLength),
    upstream_status: toSafeInteger(source.upstreamStatus),
    status: toSafeInteger(source.status),
  };
  const hasAnyValue =
    Boolean(diagnostics.model) ||
    Boolean(diagnostics.reason_code) ||
    Boolean(diagnostics.parse_error_name) ||
    Boolean(diagnostics.parse_error_message) ||
    Boolean(diagnostics.source_env_key) ||
    diagnostics.response_keys.length > 0 ||
    diagnostics.first_candidate_keys.length > 0 ||
    diagnostics.first_part_keys.length > 0 ||
    Boolean(diagnostics.text_length) ||
    Boolean(diagnostics.upstream_status) ||
    Boolean(diagnostics.status);
  return hasAnyValue ? diagnostics : null;
}

function getDocumentComparisonEvaluator() {
  const override = (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
  if (typeof override === 'function') {
    return override as typeof evaluateDocumentComparisonWithVertex;
  }
  return evaluateDocumentComparisonWithVertex;
}

function getRetryDelayMs(attemptNumber: number) {
  const baseMs = 500 * Math.max(1, Math.pow(2, Math.max(0, attemptNumber - 1)));
  const jitterMs = Math.floor(Math.random() * 1001);
  return Math.min(1500, baseMs + jitterMs);
}

async function waitMs(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function classifyEvaluationFailure(error: any): ClassifiedEvaluationFailure {
  const sourceCode = asLower(error?.code);
  const statusCode = toHttpStatus(error?.statusCode || error?.status || 0, 500);
  const upstreamStatus = toHttpStatus(error?.extra?.upstreamStatus || error?.extra?.status || 0, 0);
  const normalizedMessage = asText(error?.message) || 'Evaluation failed';
  const loweredMessage = normalizedMessage.toLowerCase();
  const safeConfiguredMessage = normalizedMessage.slice(0, 200);

  if (sourceCode === 'not_configured' || statusCode === 501) {
    return {
      failureCode: 'not_configured',
      failureStage: 'auth',
      failureMessage: safeConfiguredMessage || 'Vertex AI integration is not configured',
      httpStatus: 501,
      retryable: false,
      sourceCode,
      upstreamStatus: null,
    };
  }

  const timeoutLikeCodes = new Set([
    'vertex_timeout',
    'timeout',
    'timed_out',
    'etimedout',
    'request_timeout',
    'abort_error',
    'aborted',
  ]);
  if (
    timeoutLikeCodes.has(sourceCode) ||
    loweredMessage.includes('timeout') ||
    loweredMessage.includes('timed out')
  ) {
    return {
      failureCode: 'vertex_timeout',
      failureStage: 'vertex_call',
      failureMessage: 'Vertex request timed out',
      httpStatus: 504,
      retryable: true,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (upstreamStatus === 429 || statusCode === 429) {
    return {
      failureCode: 'vertex_rate_limited',
      failureStage: 'vertex_call',
      failureMessage: 'Vertex rate limited this request',
      httpStatus: 429,
      retryable: true,
      sourceCode,
      upstreamStatus: upstreamStatus || statusCode,
    };
  }

  if (
    upstreamStatus === 401 ||
    upstreamStatus === 403 ||
    sourceCode === 'vertex_auth_failed' ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return {
      failureCode: 'vertex_unauthorized',
      failureStage: 'auth',
      failureMessage: 'Vertex authentication failed',
      httpStatus: upstreamStatus || (statusCode === 401 || statusCode === 403 ? statusCode : 401),
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (
    upstreamStatus === 400 ||
    statusCode === 400 ||
    sourceCode === 'invalid_input' ||
    sourceCode === 'payload_too_large'
  ) {
    return {
      failureCode: 'vertex_bad_request',
      failureStage: 'validation',
      failureMessage: 'Invalid evaluation request',
      httpStatus: statusCode === 413 ? 413 : 400,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (sourceCode === 'invalid_model_output') {
    return {
      failureCode: 'vertex_invalid_response',
      failureStage: 'parse',
      failureMessage: 'Vertex returned an invalid response',
      httpStatus: 502,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (
    [502, 503, 504].includes(upstreamStatus) ||
    [502, 503, 504].includes(statusCode) ||
    sourceCode === 'vertex_request_failed'
  ) {
    return {
      failureCode: 'vertex_unavailable',
      failureStage: 'vertex_call',
      failureMessage: 'Vertex service is temporarily unavailable',
      httpStatus: [502, 503, 504].includes(upstreamStatus)
        ? upstreamStatus
        : [502, 503, 504].includes(statusCode)
          ? statusCode
          : 503,
      retryable: true,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if ((upstreamStatus >= 500 && upstreamStatus <= 599) || (statusCode >= 500 && statusCode <= 599)) {
    return {
      failureCode: 'vertex_internal_error',
      failureStage: 'vertex_call',
      failureMessage: 'Vertex returned a server error',
      httpStatus: (upstreamStatus >= 500 && upstreamStatus <= 599 ? upstreamStatus : statusCode) || 500,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  return {
    failureCode: 'unknown_error',
    failureStage: 'unknown',
    failureMessage: 'Unknown evaluation failure',
    httpStatus: 500,
    retryable: false,
    sourceCode,
    upstreamStatus: upstreamStatus || null,
  };
}

function buildFailedEvaluationResult(params: {
  error: any;
  classified: ClassifiedEvaluationFailure;
  requestId: string;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
  retryScheduled: boolean;
}) {
  const { error, classified, requestId, attemptNumber, startedAt, completedAt, retryScheduled } = params;
  return {
    error: {
      statusCode: classified.httpStatus,
      code: classified.failureCode,
      message: classified.failureMessage,
      failure_code: classified.failureCode,
      failure_stage: classified.failureStage,
      http_status: classified.httpStatus,
      requestId,
      retryable: classified.retryable,
      details: {
        attempt: attemptNumber,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        retry_scheduled: retryScheduled,
        source_code: classified.sourceCode || null,
        upstream_status: classified.upstreamStatus,
        raw_status: toHttpStatus(error?.statusCode || error?.status || 0, 0) || null,
        diagnostics: sanitizeFailureDiagnostics(error?.extra),
      },
    },
    attempt: {
      number: attemptNumber,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      request_id: requestId,
      failure_code: classified.failureCode,
      failure_stage: classified.failureStage,
      retry_scheduled: retryScheduled,
    },
  };
}

function withAttemptMetadata(params: {
  evaluation: any;
  requestId: string;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
}) {
  const base =
    params.evaluation && typeof params.evaluation === 'object' && !Array.isArray(params.evaluation)
      ? params.evaluation
      : {};
  return {
    ...base,
    request_id: params.requestId,
    attempt: {
      number: params.attemptNumber,
      started_at: params.startedAt.toISOString(),
      completed_at: params.completedAt.toISOString(),
      request_id: params.requestId,
    },
  };
}

function toApiFailureError(params: {
  classified: ClassifiedEvaluationFailure;
  requestId: string;
  attemptCount: number;
}) {
  return new ApiError(params.classified.httpStatus, params.classified.failureCode, params.classified.failureMessage, {
    requestId: params.requestId,
    failure_code: params.classified.failureCode,
    failure_stage: params.classified.failureStage,
    http_status: params.classified.httpStatus,
    attempt_count: params.attemptCount,
    retryable: params.classified.retryable,
  });
}

async function withDbWriteGuard<T>(params: {
  requestId: string;
  message: string;
  operation: () => Promise<T>;
}) {
  try {
    return await params.operation();
  } catch {
    throw new ApiError(500, 'db_write_failed', params.message, {
      requestId: params.requestId,
      failure_code: 'db_write_failed',
      failure_stage: 'db_write',
      http_status: 500,
    });
  }
}

async function persistFailedProposalEvaluationAttempt(params: {
  db: any;
  proposalId: string;
  userId: string;
  requestId: string;
  classifiedFailure: ClassifiedEvaluationFailure;
  failedResult: Record<string, unknown>;
  completedAt: Date;
}) {
  const now = params.completedAt;
  await params.db.insert(schema.proposalEvaluations).values({
    id: newId('eval'),
    proposalId: params.proposalId,
    userId: params.userId,
    source: 'document_comparison_vertex',
    status: 'failed',
    score: null,
    summary: params.classifiedFailure.failureMessage || 'Document comparison evaluation failed',
    result: {
      ...params.failedResult,
      request_id: params.requestId,
    },
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
    const requestId = asText((context as any)?.requestId) || newId('request');

    const db = getDb();
    const existingRows = await db
      .select()
      .from(schema.documentComparisons)
      .where(and(eq(schema.documentComparisons.id, comparisonId), eq(schema.documentComparisons.userId, auth.user.id)))
      .limit(1);
    const existing = firstRow(existingRows);

    ensureComparisonFound(existing);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const draft = resolveEvaluationDraft({
      existing,
      body,
    });
    assertDocumentComparisonWithinLimits({
      docAText: draft.docAText,
      docBText: draft.docBText,
    });

    await withDbWriteGuard({
      requestId,
      message: 'Failed to persist document comparison running state',
      operation: () =>
        db
          .update(schema.documentComparisons)
          .set({
            title: draft.title,
            draftStep: 2,
            partyALabel: CONFIDENTIAL_LABEL,
            partyBLabel: SHARED_LABEL,
            docAText: draft.docAText,
            docBText: draft.docBText,
            docASpans: [],
            docBSpans: [],
            inputs: draft.inputs,
            status: 'running',
            updatedAt: new Date(),
          })
          .where(eq(schema.documentComparisons.id, existing.id)),
    });

    const evaluateComparison = getDocumentComparisonEvaluator();
    let attemptCount = 0;
    let evaluation: any = null;
    let latestFailedResult: Record<string, unknown> | null = null;
    let latestFailedClassification: ClassifiedEvaluationFailure | null = null;

    while (attemptCount < MAX_EVALUATION_ATTEMPTS) {
      attemptCount += 1;
      const attemptStartedAt = new Date();

      try {
        const evaluated = await evaluateComparison({
          title: draft.title,
          docAText: draft.docAText,
          docBText: draft.docBText,
          docASpans: [],
          docBSpans: [],
          partyALabel: CONFIDENTIAL_LABEL,
          partyBLabel: SHARED_LABEL,
        });
        const attemptCompletedAt = new Date();

        evaluation = withAttemptMetadata({
          evaluation: evaluated,
          requestId,
          attemptNumber: attemptCount,
          startedAt: attemptStartedAt,
          completedAt: attemptCompletedAt,
        });
        latestFailedResult = null;
        latestFailedClassification = null;
        break;
      } catch (error: any) {
        const attemptCompletedAt = new Date();
        const classified = classifyEvaluationFailure(error);
        const retryScheduled = classified.retryable && attemptCount < MAX_EVALUATION_ATTEMPTS;
        const diagnostics = sanitizeFailureDiagnostics(error?.extra);
        console.error(
          JSON.stringify({
            level: 'error',
            route: '/api/document-comparisons/[id]/evaluate',
            requestId,
            comparisonId: existing.id,
            attempt: attemptCount,
            failureCode: classified.failureCode,
            failureStage: classified.failureStage,
            retryScheduled,
            diagnostics,
          }),
        );
        const failedResult = buildFailedEvaluationResult({
          error,
          classified,
          requestId,
          attemptNumber: attemptCount,
          startedAt: attemptStartedAt,
          completedAt: attemptCompletedAt,
          retryScheduled,
        });

        latestFailedResult = failedResult;
        latestFailedClassification = classified;

        if (existing.proposalId) {
          await withDbWriteGuard({
            requestId,
            message: 'Failed to persist proposal evaluation failure history',
            operation: () =>
              persistFailedProposalEvaluationAttempt({
                db,
                proposalId: existing.proposalId,
                userId: auth.user.id,
                requestId,
                classifiedFailure: classified,
                failedResult,
                completedAt: attemptCompletedAt,
              }),
          });
        }

        if (retryScheduled) {
          await waitMs(getRetryDelayMs(attemptCount));
          continue;
        }

        break;
      }
    }

    if (!evaluation) {
      const fallbackFailure: ClassifiedEvaluationFailure =
        latestFailedClassification || {
          failureCode: 'unknown_error',
          failureStage: 'unknown',
          failureMessage: 'Evaluation failed',
          httpStatus: 500,
          retryable: false,
          sourceCode: 'unknown_error',
          upstreamStatus: null,
        };
      const failedEvaluationResult =
        latestFailedResult ||
        buildFailedEvaluationResult({
          error: null,
          classified: fallbackFailure,
          requestId,
          attemptNumber: Math.max(1, attemptCount),
          startedAt: new Date(),
          completedAt: new Date(),
          retryScheduled: false,
        });

      await withDbWriteGuard({
        requestId,
        message: 'Failed to persist document comparison evaluation failure',
        operation: () =>
          db
            .update(schema.documentComparisons)
            .set({
              status: 'failed',
              evaluationResult: failedEvaluationResult,
              publicReport: {},
              updatedAt: new Date(),
            })
            .where(eq(schema.documentComparisons.id, existing.id)),
      });

      throw toApiFailureError({
        classified: fallbackFailure,
        requestId,
        attemptCount: Math.max(1, attemptCount),
      });
    }

    const now = new Date();
    const updatedRows = await withDbWriteGuard({
      requestId,
      message: 'Failed to persist document comparison evaluation success',
      operation: () =>
        db
          .update(schema.documentComparisons)
          .set({
            status: 'evaluated',
            draftStep: 3,
            partyALabel: CONFIDENTIAL_LABEL,
            partyBLabel: SHARED_LABEL,
            evaluationResult: evaluation,
            publicReport: evaluation.report,
            updatedAt: now,
          })
          .where(eq(schema.documentComparisons.id, existing.id))
          .returning(),
    });
    const updated = firstRow(updatedRows);
    if (!updated) {
      throw new ApiError(500, 'db_write_failed', 'Failed to persist document comparison evaluation success', {
        requestId,
        failure_code: 'db_write_failed',
        failure_stage: 'db_write',
        http_status: 500,
      });
    }

    let proposalSummary = null;
    if (existing.proposalId) {
      const proposalRows = await withDbWriteGuard({
        requestId,
        message: 'Failed to persist proposal evaluation status',
        operation: () =>
          db
            .update(schema.proposals)
            .set({
              title: updated.title,
              status: 'under_verification',
              proposalType: 'document_comparison',
              draftStep: 3,
              evaluatedAt: now,
              documentComparisonId: existing.id,
              updatedAt: now,
            })
            .where(eq(schema.proposals.id, existing.proposalId))
            .returning(),
      });
      const proposal = firstRow(proposalRows);

      if (proposal) {
        proposalSummary = {
          id: proposal.id,
          status: proposal.status,
          evaluated_at: proposal.evaluatedAt,
        };

        const savedEvaluationRows = await withDbWriteGuard({
          requestId,
          message: 'Failed to persist proposal evaluation history',
          operation: () =>
            db
              .insert(schema.proposalEvaluations)
              .values({
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
              })
              .returning({
                id: schema.proposalEvaluations.id,
              }),
        });
        const savedEvaluation = firstRow(savedEvaluationRows);

        try {
          await createNotificationEvent({
            db,
            userId: proposal.userId,
            userEmail: proposal.partyAEmail || auth.user.email,
            eventType: 'evaluation_update',
            emailCategory: 'evaluation_complete',
            dedupeKey: `evaluation_update:${proposal.id}:${existing.id}:${savedEvaluation?.id || 'document_comparison'}`,
            title: 'Evaluation complete',
            message: `Evaluation finished for "${proposal.title || 'your proposal'}".`,
            actionUrl: `/ProposalDetail?id=${encodeURIComponent(proposal.id)}`,
            emailSubject: 'Proposal evaluation complete',
            emailText: [
              `Your proposal "${proposal.title || 'Untitled Proposal'}" has a new evaluation.`,
              '',
              `Score: ${evaluation.score ?? 'N/A'}`,
              '',
              'Sign in to PreMarket to review the full report.',
            ].join('\n'),
          });
        } catch {
          // Best-effort notifications should not block evaluation responses.
        }
      }
    }

    ok(res, 200, {
      comparison: mapComparisonRow(updated),
      evaluation: evaluation.report,
      proposal: proposalSummary,
      request_id: requestId,
      attempt_count: attemptCount,
    });
  });
}
