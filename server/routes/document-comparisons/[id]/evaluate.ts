import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import { sanitizeEditorText } from '../../../_lib/document-editor-sanitization.js';
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
      failureCode: 'vertex_internal_error',
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
    const [existing] = await db
      .select()
      .from(schema.documentComparisons)
      .where(and(eq(schema.documentComparisons.id, comparisonId), eq(schema.documentComparisons.userId, auth.user.id)))
      .limit(1);

    ensureComparisonFound(existing);

    await withDbWriteGuard({
      requestId,
      message: 'Failed to persist document comparison running state',
      operation: () =>
        db
          .update(schema.documentComparisons)
          .set({
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
        const sanitizedDocAText = sanitizeEditorText(existing.docAText || '');
        const sanitizedDocBText = sanitizeEditorText(existing.docBText || '');
        assertDocumentComparisonWithinLimits({
          docAText: sanitizedDocAText,
          docBText: sanitizedDocBText,
        });

        const evaluated = await evaluateComparison({
          title: existing.title,
          docAText: sanitizedDocAText,
          docBText: sanitizedDocBText,
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
    const [updated] = await withDbWriteGuard({
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

    let proposalSummary = null;
    if (existing.proposalId) {
      const [proposal] = await withDbWriteGuard({
        requestId,
        message: 'Failed to persist proposal evaluation status',
        operation: () =>
          db
            .update(schema.proposals)
            .set({
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

      if (proposal) {
        proposalSummary = {
          id: proposal.id,
          status: proposal.status,
          evaluated_at: proposal.evaluatedAt,
        };

        const [savedEvaluation] = await withDbWriteGuard({
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
