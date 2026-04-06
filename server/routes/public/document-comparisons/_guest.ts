import { createHash } from 'node:crypto';
import { ApiError } from '../../../_lib/errors.js';
import { clientIpForRateLimit } from '../../../_lib/security.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import { buildStoredV2Evaluation } from '../../document-comparisons/_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../../document-comparisons/_limits.js';
import { evaluateWithVertexV2 } from '../../../_lib/vertex-evaluation-v2.js';
import { STAGE1_SHARED_INTAKE_STAGE } from '../../../../src/lib/opportunityReviewStage.js';

export const GUEST_AI_ASSISTANCE_WINDOW_MS = 15 * 60 * 1000;
export const GUEST_AI_ASSISTANCE_SESSION_LIMIT = 4;
export const GUEST_AI_ASSISTANCE_IP_LIMIT = 12;
export const GUEST_AI_MEDIATION_WINDOW_MS = 60 * 60 * 1000;
export const GUEST_AI_MEDIATION_DRAFT_LIMIT = 1;
export const GUEST_AI_MEDIATION_IP_LIMIT = 3;
export const GUEST_AI_LIMIT_MESSAGE =
  'Sign in to continue with more AI runs, save this comparison, and share results.';

const assistanceSessionMap = new Map<string, { count: number; windowStart: number }>();
const assistanceIpMap = new Map<string, { count: number; windowStart: number }>();
const mediationDraftMap = new Map<string, { count: number; firstUsedAt: number }>();
const mediationIpMap = new Map<string, { count: number; windowStart: number }>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MEDIATION_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function toSafeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
}

function countWords(value: string) {
  return String(value || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
}

function hashPrefix(value: string, length = 12) {
  const normalized = String(value || '');
  if (!normalized) {
    return '';
  }
  return createHash('sha256').update(normalized).digest('hex').slice(0, Math.max(1, length));
}

function clearExpiredWindowEntries(map: Map<string, { windowStart: number }>, windowMs: number) {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (!entry || now - Number(entry.windowStart || 0) > windowMs) {
      map.delete(key);
    }
  }
}

function clearExpiredDraftEntries() {
  const now = Date.now();
  for (const [key, entry] of mediationDraftMap.entries()) {
    if (!entry || now - Number(entry.firstUsedAt || 0) > MEDIATION_DRAFT_TTL_MS) {
      mediationDraftMap.delete(key);
    }
  }
}

setInterval(() => {
  clearExpiredWindowEntries(assistanceSessionMap, GUEST_AI_ASSISTANCE_WINDOW_MS);
  clearExpiredWindowEntries(assistanceIpMap, GUEST_AI_ASSISTANCE_WINDOW_MS);
  clearExpiredWindowEntries(mediationIpMap, GUEST_AI_MEDIATION_WINDOW_MS);
  clearExpiredDraftEntries();
}, CLEANUP_INTERVAL_MS).unref();

function consumeWindowLimit({
  map,
  key,
  limit,
  windowMs,
  errorCode,
  errorMessage,
  scope,
}: {
  map: Map<string, { count: number; windowStart: number }>;
  key: string;
  limit: number;
  windowMs: number;
  errorCode: string;
  errorMessage: string;
  scope: string;
}) {
  const now = Date.now();
  const normalizedKey = asText(key) || 'unknown';
  const entry = map.get(normalizedKey);

  if (!entry || now - entry.windowStart > windowMs) {
    map.set(normalizedKey, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;
  if (entry.count > limit) {
    throw new ApiError(429, errorCode, errorMessage, {
      sign_in_required_for_more_runs: true,
      scope,
      limit,
      window_ms: windowMs,
      retry_after_seconds: Math.ceil(Math.max(0, windowMs - (now - entry.windowStart)) / 1000),
    });
  }
}

function assertDraftLimitAvailable({
  map,
  key,
  limit,
  errorCode,
  errorMessage,
}: {
  map: Map<string, { count: number; firstUsedAt: number }>;
  key: string;
  limit: number;
  errorCode: string;
  errorMessage: string;
}) {
  const now = Date.now();
  const normalizedKey = asText(key) || 'unknown';
  const entry = map.get(normalizedKey);

  if (!entry || now - entry.firstUsedAt > MEDIATION_DRAFT_TTL_MS) {
    if (entry) {
      map.delete(normalizedKey);
    }
    return;
  }

  if (entry.count >= limit) {
    throw new ApiError(429, errorCode, errorMessage, {
      sign_in_required_for_more_runs: true,
      scope: 'guest_draft',
      limit,
      window_ms: MEDIATION_DRAFT_TTL_MS,
      retry_after_seconds: Math.ceil(MEDIATION_DRAFT_TTL_MS / 1000),
    });
  }
}

function recordDraftLimitUsage({
  map,
  key,
}: {
  map: Map<string, { count: number; firstUsedAt: number }>;
  key: string;
}) {
  const now = Date.now();
  const normalizedKey = asText(key) || 'unknown';
  const entry = map.get(normalizedKey);

  if (!entry || now - entry.firstUsedAt > MEDIATION_DRAFT_TTL_MS) {
    map.set(normalizedKey, { count: 1, firstUsedAt: now });
    return;
  }

  entry.count += 1;
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

export function resolveGuestComparisonPreviewInput(body: Record<string, unknown>) {
  const title = asText(body.title) || 'Untitled';
  const rawDocAText = String(body.docAText || body.doc_a_text || '');
  const rawDocBText = String(body.docBText || body.doc_b_text || '');
  const rawDocAHtml = asText(body.docAHtml || body.doc_a_html);
  const rawDocBHtml = asText(body.docBHtml || body.doc_b_html);
  const docAHtml = sanitizeEditorHtml(rawDocAHtml || rawDocAText);
  const docBHtml = sanitizeEditorHtml(rawDocBHtml || rawDocBText);
  const docAText = sanitizeEditorText(rawDocAText || htmlToEditorText(docAHtml));
  const docBText = sanitizeEditorText(rawDocBText || htmlToEditorText(docBHtml));
  const docAJson = toOptionalJsonObject(body.docAJson || body.doc_a_json);
  const docBJson = toOptionalJsonObject(body.docBJson || body.doc_b_json);
  const docASource = asText(body.docASource || body.doc_a_source) || 'typed';
  const docBSource = asText(body.docBSource || body.doc_b_source) || 'typed';
  const rawDocAFiles = body.docAFiles || body.doc_a_files;
  const rawDocBFiles = body.docBFiles || body.doc_b_files;
  const docAFiles: unknown[] = Array.isArray(rawDocAFiles) ? rawDocAFiles : [];
  const docBFiles: unknown[] = Array.isArray(rawDocBFiles) ? rawDocBFiles : [];
  const guestDraftId = asText(body.guestDraftId || body.guest_draft_id);
  const guestSessionId = asText(body.guestSessionId || body.guest_session_id);
  const companyName = asText(body.companyName || body.company_name || body.companyContextName);
  const companyWebsite = asText(body.companyWebsite || body.company_website || body.companyContextWebsite);

  if (!guestDraftId) {
    throw new ApiError(400, 'invalid_input', 'guestDraftId is required');
  }
  if (!guestSessionId) {
    throw new ApiError(400, 'invalid_input', 'guestSessionId is required');
  }

  return {
    title,
    docAText,
    docBText,
    docAHtml,
    docBHtml,
    docAJson,
    docBJson,
    docASource,
    docBSource,
    docAFiles,
    docBFiles,
    guestDraftId,
    guestSessionId,
    companyName: companyName || undefined,
    companyWebsite: companyWebsite || undefined,
  };
}

export function assertGuestAiAssistanceAllowed(req: any, guestSessionId: string) {
  const ip = clientIpForRateLimit(req);
  consumeWindowLimit({
    map: assistanceSessionMap,
    key: guestSessionId,
    limit: GUEST_AI_ASSISTANCE_SESSION_LIMIT,
    windowMs: GUEST_AI_ASSISTANCE_WINDOW_MS,
    errorCode: 'guest_ai_assistance_limit_reached',
    errorMessage: GUEST_AI_LIMIT_MESSAGE,
    scope: 'guest_session',
  });
  consumeWindowLimit({
    map: assistanceIpMap,
    key: ip,
    limit: GUEST_AI_ASSISTANCE_IP_LIMIT,
    windowMs: GUEST_AI_ASSISTANCE_WINDOW_MS,
    errorCode: 'guest_ai_assistance_limit_reached',
    errorMessage: GUEST_AI_LIMIT_MESSAGE,
    scope: 'trusted_ip',
  });
}

export function assertGuestAiMediationAllowed(req: any, params: { guestDraftId: string; guestSessionId: string }) {
  const ip = clientIpForRateLimit(req);
  assertDraftLimitAvailable({
    map: mediationDraftMap,
    key: `${ip}:${params.guestDraftId}`,
    limit: GUEST_AI_MEDIATION_DRAFT_LIMIT,
    errorCode: 'guest_ai_mediation_limit_reached',
    errorMessage:
      'Guest preview includes 1 AI mediation run per draft. Sign in to continue with more AI runs, save this comparison, and share results.',
  });
  consumeWindowLimit({
    map: mediationIpMap,
    key: ip,
    limit: GUEST_AI_MEDIATION_IP_LIMIT,
    windowMs: GUEST_AI_MEDIATION_WINDOW_MS,
    errorCode: 'guest_ai_mediation_limit_reached',
    errorMessage: GUEST_AI_LIMIT_MESSAGE,
    scope: 'trusted_ip',
  });
}

export function recordGuestAiMediationSuccess(
  req: any,
  params: { guestDraftId: string; guestSessionId: string },
) {
  const ip = clientIpForRateLimit(req);
  recordDraftLimitUsage({
    map: mediationDraftMap,
    key: `${ip}:${params.guestDraftId}`,
  });
}

export function buildEvaluationInputTrace(params: {
  comparisonId: string;
  confidentialText: string;
  sharedText: string;
}) {
  const confidentialText = String(params.confidentialText || '');
  const sharedText = String(params.sharedText || '');
  return {
    comparison_id: params.comparisonId,
    source: 'guest_preview',
    confidential_length: confidentialText.length,
    shared_length: sharedText.length,
    confidential_words: countWords(confidentialText),
    shared_words: countWords(sharedText),
    confidential_hash: hashPrefix(confidentialText),
    shared_hash: hashPrefix(sharedText),
    input_version: null,
    generated_at: new Date().toISOString(),
  };
}

export function buildGuestPreviewComparison(params: {
  guestDraftId: string;
  title: string;
  docAText: string;
  docBText: string;
  docAHtml: string;
  docBHtml: string;
  docAJson?: Record<string, unknown> | null;
  docBJson?: Record<string, unknown> | null;
  docASource?: string;
  docBSource?: string;
  docAFiles?: unknown[];
  docBFiles?: unknown[];
}) {
  return {
    id: params.guestDraftId,
    status: 'evaluated',
    draft_step: 3,
    title: params.title,
    doc_a_text: params.docAText,
    doc_b_text: params.docBText,
    doc_a_html: params.docAHtml,
    doc_b_html: params.docBHtml,
    doc_a_json: params.docAJson || null,
    doc_b_json: params.docBJson || null,
    doc_a_source: params.docASource || 'typed',
    doc_b_source: params.docBSource || 'typed',
    doc_a_files: Array.isArray(params.docAFiles) ? params.docAFiles : [],
    doc_b_files: Array.isArray(params.docBFiles) ? params.docBFiles : [],
    party_a_label: 'Confidential Information',
    party_b_label: 'Shared Information',
    updated_date: new Date().toISOString(),
  };
}

export function convertV2ResponseToEvaluation(v2Result: any): Record<string, unknown> {
  return buildStoredV2Evaluation(v2Result);
}

function getParseErrorKind(error: any) {
  return asLower(error?.extra?.parseErrorKind || error?.extra?.parseErrorName || error?.extra?.reasonCode);
}

type ClassifiedEvaluationFailure = {
  failureCode: string;
  failureStage: string;
  failureMessage: string;
  httpStatus: number;
  retryable: boolean;
  sourceCode: string;
  upstreamStatus: number | null;
};

export function classifyGuestEvaluationFailure(error: any): ClassifiedEvaluationFailure {
  const sourceCode = asLower(error?.code);
  const statusCode = Number(error?.statusCode || error?.status || 0) || 500;
  const upstreamStatus = Number(error?.extra?.upstreamStatus || error?.extra?.status || 0) || 0;
  const loweredMessage = asText(error?.message).toLowerCase();

  if (sourceCode === 'not_configured' || statusCode === 501) {
    return {
      failureCode: 'not_configured',
      failureStage: 'auth',
      failureMessage: asText(error?.message) || 'Vertex AI integration is not configured',
      httpStatus: 501,
      retryable: false,
      sourceCode,
      upstreamStatus: null,
    };
  }

  if (sourceCode === 'invalid_input' || sourceCode === 'payload_too_large' || statusCode === 400 || statusCode === 413) {
    return {
      failureCode: 'vertex_bad_request',
      failureStage: 'validation',
      failureMessage: asText(error?.message) || 'Invalid evaluation request',
      httpStatus: statusCode === 413 ? 413 : 400,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (sourceCode === 'invalid_model_output') {
    const parseErrorKind = getParseErrorKind(error);
    const shouldRetry = parseErrorKind === 'json_parse_error' || !parseErrorKind;
    return {
      failureCode: 'vertex_invalid_response',
      failureStage: 'parse',
      failureMessage: 'Vertex returned an invalid response',
      httpStatus: 502,
      retryable: shouldRetry,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (sourceCode === 'insufficient_detail') {
    return {
      failureCode: 'vertex_generic_output',
      failureStage: 'parse',
      failureMessage: 'Vertex returned a generic report without shared-input references',
      httpStatus: 502,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  if (
    sourceCode === 'vertex_timeout' ||
    loweredMessage.includes('timeout') ||
    loweredMessage.includes('timed out')
  ) {
    return {
      failureCode: 'vertex_timeout',
      failureStage: 'vertex_call',
      failureMessage: 'Vertex request timed out',
      httpStatus: 504,
      retryable: false,
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
      retryable: false,
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
      httpStatus: upstreamStatus || statusCode || 401,
      retryable: false,
      sourceCode,
      upstreamStatus: upstreamStatus || null,
    };
  }

  return {
    failureCode: 'unknown_error',
    failureStage: 'unknown',
    failureMessage: 'Unknown evaluation failure',
    httpStatus: statusCode || 500,
    retryable: false,
    sourceCode,
    upstreamStatus: upstreamStatus || null,
  };
}

export function buildFailedGuestEvaluationResult(params: {
  error: any;
  classified: ClassifiedEvaluationFailure;
  requestId: string;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
}) {
  const { error, classified, requestId, attemptNumber, startedAt, completedAt } = params;
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
        source_code: classified.sourceCode || null,
        upstream_status: classified.upstreamStatus,
        raw_status: Number(error?.statusCode || error?.status || 0) || null,
      },
    },
    attempt: {
      number: attemptNumber,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      request_id: requestId,
      failure_code: classified.failureCode,
      failure_stage: classified.failureStage,
      retry_scheduled: false,
    },
  };
}

export function withGuestAttemptMetadata(params: {
  evaluation: any;
  requestId: string;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date;
  inputTrace?: Record<string, unknown> | null;
}) {
  const rawEvaluation =
    params.evaluation && typeof params.evaluation === 'object' && !Array.isArray(params.evaluation)
      ? params.evaluation
      : {};
  const rawProvider = asLower(
    (rawEvaluation as any).evaluation_provider || (rawEvaluation as any).provider,
  );
  const normalizedProvider: 'vertex' | 'fallback' = rawProvider === 'vertex' ? 'vertex' : 'fallback';
  const normalizedModel =
    asText((rawEvaluation as any).evaluation_model || (rawEvaluation as any).model) || null;
  const normalizedProviderReason =
    normalizedProvider === 'fallback'
      ? asText((rawEvaluation as any).evaluation_provider_reason || (rawEvaluation as any).fallbackReason) ||
        (rawProvider === 'mock' ? 'vertex_mock_enabled' : 'provider_not_vertex')
      : null;
  return {
    ...rawEvaluation,
    evaluation_provider: normalizedProvider,
    evaluation_model: normalizedModel,
    evaluation_provider_model: normalizedModel,
    evaluation_provider_version: normalizedModel,
    evaluation_provider_reason: normalizedProviderReason,
    input_trace:
      params.inputTrace && typeof params.inputTrace === 'object' && !Array.isArray(params.inputTrace)
        ? params.inputTrace
        : null,
    request_id: params.requestId,
    attempt: {
      number: params.attemptNumber,
      started_at: params.startedAt.toISOString(),
      completed_at: params.completedAt.toISOString(),
      request_id: params.requestId,
    },
  };
}

export function toGuestEvaluationApiError(params: {
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

export async function runGuestEvaluationModel(params: {
  title: string;
  docAText: string;
  docBText: string;
  requestId: string;
}) {
  const override = (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
  if (typeof override === 'function') {
    return override({
      title: params.title,
      docAText: params.docAText,
      docBText: params.docBText,
      docASpans: [],
      docBSpans: [],
      partyALabel: 'Confidential Information',
      partyBLabel: 'Shared Information',
    });
  }

  const v2Result = await evaluateWithVertexV2({
    sharedText: params.docBText || '',
    confidentialText: params.docAText || '',
    analysisStage: STAGE1_SHARED_INTAKE_STAGE,
    requestId: params.requestId,
    enforceLeakGuard: false,
    generationModel: asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) || undefined,
    verifierModel: asText(process.env.VERTEX_DOC_COMPARE_VERIFIER_MODEL) || undefined,
    extractModel: asText(process.env.VERTEX_DOC_COMPARE_EXTRACT_MODEL) || undefined,
  });

  if (!v2Result.ok) {
    const error = v2Result.error;
    const details =
      error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? error.details
        : {};
    const failure = new ApiError(
      Number(details?.statusCode || details?.status || 502) || 502,
      asText(details?.code || error?.parse_error_kind || 'invalid_model_output') || 'invalid_model_output',
      'Vertex returned an invalid response',
      {
        parseErrorKind: asText(error?.parse_error_kind) || null,
        reasonCode: asText(details?.code || error?.parse_error_kind) || null,
        status: Number(details?.status || 0) || null,
        upstreamStatus: Number(details?.status || 0) || null,
      },
    );
    throw failure;
  }

  return convertV2ResponseToEvaluation(v2Result);
}

export function assertGuestPreviewEvaluationWithinLimits(params: {
  guestDraftId: string;
  docAText: string;
  docBText: string;
}) {
  assertDocumentComparisonWithinLimits({
    docAText: params.docAText,
    docBText: params.docBText,
  });

  const inputTrace = buildEvaluationInputTrace({
    comparisonId: params.guestDraftId,
    confidentialText: params.docAText,
    sharedText: params.docBText,
  });
  const sharedLength = Number(inputTrace.shared_length || 0);
  const confidentialLength = Number(inputTrace.confidential_length || 0);

  if (sharedLength < 40) {
    throw new ApiError(
      400,
      'invalid_input',
      'Shared information must be at least 40 characters before evaluation.',
    );
  }
  if (confidentialLength < 40) {
    throw new ApiError(
      400,
      'invalid_input',
      'Confidential information must be at least 40 characters before evaluation.',
    );
  }

  return inputTrace;
}

export function __resetGuestPreviewRateLimitsForTest() {
  assistanceSessionMap.clear();
  assistanceIpMap.clear();
  mediationDraftMap.clear();
  mediationIpMap.clear();
}
