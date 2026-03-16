import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { appendProposalHistory } from '../../../_lib/proposal-history.js';
import { assertProposalOpenForNegotiation, buildPendingWonReset } from '../../../_lib/proposal-outcomes.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import { evaluateWithVertexV2 } from '../../../_lib/vertex-evaluation-v2.js';
import { getVertexConfig } from '../../../_lib/integrations.js';
import { generateDocumentComparisonCoach } from '../../../_lib/vertex-coach.js';
import {
  buildCounterpartyLeakGuard,
  detectCounterpartyLeak,
  healEvaluationReportSections,
} from '../../../_lib/evaluation-confidentiality.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import {
  buildMediationReviewSections,
  ensureComparisonFound,
  mapComparisonRow,
} from '../_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../_limits.js';
import { assertStarterAiEvaluationAllowed } from '../../../_lib/starter-entitlements.js';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_EVALUATION_ATTEMPTS = 2;
const MIN_SHARED_EVALUATION_TEXT_LENGTH = 40;
const MIN_CONFIDENTIAL_EVALUATION_TEXT_LENGTH = 40;

type ApiRouteContext = {
  requestId?: string;
  route?: string;
  startMs?: number;
  userId?: string | null;
};

type AuthedUser = {
  id: string;
  email?: string | null;
};

type DocumentComparisonRow = {
  id: string;
  userId: string;
  proposalId: string | null;
  title: string | null;
  docAText: string | null;
  docBText: string | null;
  inputs: unknown;
  metadata: unknown;
  status: string | null;
  draftStep: number | null;
  updatedAt: Date | string | null;
};

type EvaluationDraft = {
  title: string;
  docAText: string;
  docBText: string;
  draftStep: number | null;
  inputs: Record<string, unknown>;
};

type EvaluationFailureCode =
  | 'not_configured'
  | 'empty_inputs'
  | 'vertex_timeout'
  | 'vertex_rate_limited'
  | 'vertex_unavailable'
  | 'vertex_unauthorized'
  | 'vertex_bad_request'
  | 'vertex_invalid_response'
  | 'vertex_generic_output'
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

function parseJsonObject(value: unknown) {
  const text = asText(value);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed diagnostics payloads
  }
  return null;
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

function hasRequestInputOverride(body: Record<string, unknown>) {
  const keys = [
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
  ];
  return keys.some((key) => body[key] !== undefined);
}

function buildEvaluationInputTrace(params: {
  comparisonId: string;
  source: 'db' | 'request_body';
  confidentialText: string;
  sharedText: string;
  inputVersion: number | null;
}) {
  const confidentialText = String(params.confidentialText || '');
  const sharedText = String(params.sharedText || '');
  const inputVersion = Number(params.inputVersion);
  return {
    comparison_id: params.comparisonId,
    source: params.source,
    confidential_length: confidentialText.length,
    shared_length: sharedText.length,
    confidential_words: countWords(confidentialText),
    shared_words: countWords(sharedText),
    confidential_hash: hashPrefix(confidentialText),
    shared_hash: hashPrefix(sharedText),
    input_version: Number.isFinite(inputVersion) && inputVersion > 0 ? Math.floor(inputVersion) : null,
    generated_at: new Date().toISOString(),
  };
}

function getInputVersionFromMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>).input_version ?? (value as Record<string, unknown>).inputVersion;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function getEvaluationAttemptInputFields(inputTrace: Record<string, unknown>) {
  const inputSharedHash = asText(inputTrace.shared_hash) || null;
  const inputConfHash = asText(inputTrace.confidential_hash) || null;
  const inputSharedLen = toSafeInteger(inputTrace.shared_length);
  const inputConfLen = toSafeInteger(inputTrace.confidential_length);
  const inputVersion = toSafeInteger(inputTrace.input_version);

  return {
    inputSharedHash,
    inputConfHash,
    inputSharedLen,
    inputConfLen,
    inputVersion,
  };
}

function logEvaluationInputTrace(params: {
  requestId: string;
  comparisonId: string;
  source: 'db' | 'request_body';
  inputTrace: Record<string, unknown>;
}) {
  const payload: Record<string, unknown> = {
    level: 'info',
    route: '/api/document-comparisons/[id]/evaluate',
    requestId: params.requestId,
    comparisonId: params.comparisonId,
    source: params.source,
    inputTrace: params.inputTrace,
  };
  console.info(JSON.stringify(payload));
}

function resolveEvaluationDraft(params: {
  existing: DocumentComparisonRow | null;
  body: Record<string, unknown>;
}): EvaluationDraft {
  const { existing, body } = params;
  const existingInputs: Record<string, unknown> =
    existing?.inputs && typeof existing.inputs === 'object' && !Array.isArray(existing.inputs)
      ? (existing.inputs as Record<string, unknown>)
      : {};

  const title = asText(body.title) || asText(existing?.title) || 'Untitled';
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
  const rawDraftStep = body.draftStep ?? body.draft_step ?? existing?.draftStep ?? null;
  const parsedDraftStep = Number(rawDraftStep);
  const draftStep =
    Number.isFinite(parsedDraftStep) && parsedDraftStep > 0 ? Math.floor(parsedDraftStep) : null;
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
    draftStep,
    inputs: updatedInputs,
  };
}

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function toTokenStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const unique = new Set<string>();
  value.forEach((entry) => {
    const token = asText(entry).toLowerCase();
    if (!token) {
      return;
    }
    unique.add(token);
  });
  return [...unique].slice(0, 120);
}

function resolveOtherPartyCanaryTokens(existing: any, existingInputs: Record<string, unknown>) {
  const metadata = toRecord(existing?.metadata);
  const metadataTokenCandidates = [
    metadata.other_party_confidential_canary_tokens,
    metadata.otherPartyConfidentialCanaryTokens,
    metadata.other_party_canary_tokens,
    metadata.otherPartyCanaryTokens,
  ];
  const inputTokenCandidates = [
    existingInputs.other_party_confidential_canary_tokens,
    existingInputs.otherPartyConfidentialCanaryTokens,
    existingInputs.other_party_canary_tokens,
    existingInputs.otherPartyCanaryTokens,
  ];

  return [...metadataTokenCandidates, ...inputTokenCandidates].flatMap((candidate) =>
    toTokenStringArray(candidate),
  );
}

function extractPayloadText(payload: unknown) {
  const source = toRecord(payload);
  const directText = asText(source.text);
  if (directText) {
    return directText;
  }
  const notes = asText(source.notes);
  if (notes) {
    return notes;
  }
  const content = asText(source.content);
  if (content) {
    return content;
  }
  return '';
}

async function getLatestRecipientConfidentialText(db: any, comparisonId: string) {
  if (!comparisonId) {
    return '';
  }

  const [latest] = await db
    .select()
    .from(schema.sharedReportRecipientRevisions)
    .where(
      and(
        eq(schema.sharedReportRecipientRevisions.comparisonId, comparisonId),
        eq(schema.sharedReportRecipientRevisions.actorRole, 'recipient'),
        eq(schema.sharedReportRecipientRevisions.status, 'sent'),
      ),
    )
    .orderBy(
      desc(schema.sharedReportRecipientRevisions.updatedAt),
      desc(schema.sharedReportRecipientRevisions.createdAt),
    )
    .limit(1);

  return sanitizeEditorText(extractPayloadText(latest?.recipientConfidentialPayload)).slice(0, 20000);
}

function resolveCounterpartyConfidentialText(params: {
  existing: any;
  existingInputs: Record<string, unknown>;
  recipientConfidentialText: string;
}) {
  const metadata = toRecord(params.existing?.metadata);
  const values = [
    metadata.other_party_confidential_note,
    metadata.otherPartyConfidentialNote,
    metadata.other_party_confidential_text,
    metadata.otherPartyConfidentialText,
    params.existingInputs.other_party_confidential_note,
    params.existingInputs.otherPartyConfidentialNote,
    params.existingInputs.other_party_confidential_text,
    params.existingInputs.otherPartyConfidentialText,
    params.recipientConfidentialText,
  ];

  const unique = new Set<string>();
  values.forEach((entry) => {
    const text = sanitizeEditorText(asText(entry)).slice(0, 20000);
    if (!text) {
      return;
    }
    unique.add(text);
  });
  return [...unique].join('\n\n').trim();
}

function resolveComparisonCompanyContext(existing: any, existingInputs: Record<string, unknown>) {
  const metadata = toRecord(existing?.metadata);
  const companyName = asText(
    existing?.companyName ||
      existingInputs.company_name ||
      existingInputs.companyName ||
      metadata.company_name ||
      metadata.companyName,
  );
  const companyWebsite = asText(
    existing?.companyWebsite ||
      existingInputs.company_website ||
      existingInputs.companyWebsite ||
      metadata.company_website ||
      metadata.companyWebsite,
  );
  return {
    companyName: companyName || undefined,
    companyWebsite: companyWebsite || undefined,
  };
}

function buildSectionRegenerationPrompt(params: {
  sectionKey: string;
  sectionHeading: string;
  sectionBullets: string[];
  strictMode: boolean;
}) {
  const fallbackRefusal =
    "That information is confidential and can't be displayed here. You can request it in the shared report / ask the counterparty to share it.";
  const strictLines = params.strictMode
    ? [
        'Strict retry mode:',
        '- Do not reveal any counterparty confidential details.',
        `- If safe completion is not possible, return exactly: "${fallbackRefusal}"`,
      ]
    : [];

  return [
    'You are rewriting one section of an internal evaluation report.',
    'Regenerate the section so it is useful, concise, and safe.',
    `Section key: ${params.sectionKey || 'unknown'}`,
    `Section heading: ${params.sectionHeading || 'Section'}`,
    'Original bullets:',
    ...(params.sectionBullets.length > 0
      ? params.sectionBullets.map((line) => `- ${line}`)
      : ['- (no bullets provided)']),
    'Rules:',
    '- Use only provided shared and requester-confidential context.',
    '- Never reveal counterparty confidential information.',
    '- If the section asks for counterparty confidential details, refuse safely and suggest requesting it via the shared report.',
    '- Return only bullets, one per line, no heading.',
    ...strictLines,
  ].join('\n');
}

async function regenerateEvaluationSection(params: {
  title: string;
  sharedText: string;
  requesterConfidentialText: string;
  sectionKey: string;
  sectionHeading: string;
  sectionBullets: string[];
  strictMode: boolean;
  companyName?: string;
  companyWebsite?: string;
  counterpartyCanaryTokens: string[];
}) {
  const override = (globalThis as any).__PREMARKET_TEST_EVALUATION_SECTION_REGEN__;
  if (typeof override === 'function') {
    const overrideResult = await override({
      ...params,
    });
    return asText(overrideResult?.text || overrideResult?.feedback || overrideResult);
  }

  const promptText = buildSectionRegenerationPrompt({
    sectionKey: params.sectionKey,
    sectionHeading: params.sectionHeading,
    sectionBullets: params.sectionBullets,
    strictMode: params.strictMode,
  });

  const generated = await generateDocumentComparisonCoach({
    title: params.title || 'Document Comparison',
    docAText: params.requesterConfidentialText,
    docBText: params.sharedText,
    mode: 'full',
    intent: 'custom_prompt',
    promptText,
    companyName: params.companyName,
    companyWebsite: params.companyWebsite,
    otherPartyCanaryTokens: params.counterpartyCanaryTokens,
  });

  return asText(
    (generated?.result as any)?.custom_feedback || (generated?.result as any)?.summary?.overall || '',
  );
}

async function applyCounterpartyConfidentialitySelfHeal(params: {
  evaluation: Record<string, any>;
  title: string;
  sharedText: string;
  requesterConfidentialText: string;
  counterpartyConfidentialText: string;
  counterpartyCanaryTokens: string[];
  companyName?: string;
  companyWebsite?: string;
}) {
  const baseEvaluation =
    params.evaluation && typeof params.evaluation === 'object' && !Array.isArray(params.evaluation)
      ? { ...params.evaluation }
      : {};

  const report =
    baseEvaluation.report && typeof baseEvaluation.report === 'object' && !Array.isArray(baseEvaluation.report)
      ? baseEvaluation.report
      : {};
  const guard = buildCounterpartyLeakGuard({
    sharedText: params.sharedText,
    counterpartyConfidentialText: params.counterpartyConfidentialText,
    counterpartyCanaryTokens: params.counterpartyCanaryTokens,
  });

  if (!guard.hasForbiddenContent) {
    return {
      evaluation: baseEvaluation,
      warnings: {
        confidentiality_section_redacted: [],
        confidentiality_section_regenerated: [],
        retries_used: {},
      },
    };
  }

  const healed = await healEvaluationReportSections({
    report,
    guard,
    regenerateSection: async ({ section, strictMode }) =>
      regenerateEvaluationSection({
        title: params.title,
        sharedText: params.sharedText,
        requesterConfidentialText: params.requesterConfidentialText,
        sectionKey: section.key,
        sectionHeading: section.heading,
        sectionBullets: section.bullets,
        strictMode,
        companyName: params.companyName,
        companyWebsite: params.companyWebsite,
        counterpartyCanaryTokens: params.counterpartyCanaryTokens,
      }),
    maxRetries: 2,
  });

  const warningCount =
    healed.warnings.confidentiality_section_redacted.length +
    healed.warnings.confidentiality_section_regenerated.length;
  const nextEvaluation = {
    ...baseEvaluation,
    report: healed.report,
  } as Record<string, any>;

  if (detectCounterpartyLeak(asText(nextEvaluation.summary), guard)) {
    nextEvaluation.summary = 'Some sections were omitted due to confidentiality policy.';
  }

  if (warningCount > 0) {
    nextEvaluation.warnings = healed.warnings;
    nextEvaluation.completion_status = 'completed_with_warnings';
  } else if (!asText(nextEvaluation.completion_status)) {
    nextEvaluation.completion_status = 'completed';
  }

  return {
    evaluation: nextEvaluation,
    warnings: healed.warnings,
  };
}

function sanitizeFailureDiagnostics(extra: unknown) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return null;
  }
  const source = extra as Record<string, unknown>;
  const parsedParseErrorDetails = parseJsonObject(source.parseErrorMessage);
  const parseErrorKindFromMessage = asText(parsedParseErrorDetails?.parse_error_kind);
  const schemaMissingKeysFromMessage = Array.isArray(parsedParseErrorDetails?.schema_missing_keys)
    ? parsedParseErrorDetails.schema_missing_keys
    : [];
  const model = asText(source.model);
  const reasonCode = asText(source.reasonCode);
  const parseErrorKind = asText(source.parseErrorKind) || parseErrorKindFromMessage || reasonCode;
  const parseErrorName = asText(source.parseErrorName);
  const parseErrorMessage = asText(source.parseErrorMessage);
  const sourceEnvKey = asText(source.sourceEnvKey);
  const diagnostics = {
    model: model || null,
    reason_code: reasonCode || null,
    parse_error_kind: parseErrorKind || null,
    parse_error_name: parseErrorName || null,
    parse_error_message: parseErrorMessage || null,
    raw_text_length: toSafeInteger(source.rawTextLength ?? parsedParseErrorDetails?.raw_text_length),
    had_json_fence:
      source.hadJsonFence !== undefined
        ? Boolean(source.hadJsonFence)
        : parsedParseErrorDetails?.had_json_fence !== undefined
          ? Boolean(parsedParseErrorDetails.had_json_fence)
          : null,
    finish_reason: asText(source.finishReason || parsedParseErrorDetails?.finish_reason) || null,
    schema_missing_keys: Array.isArray(source.schemaMissingKeys)
      ? source.schemaMissingKeys.map((value) => asText(value)).filter(Boolean).slice(0, 40)
      : schemaMissingKeysFromMessage.map((value) => asText(value)).filter(Boolean).slice(0, 40),
    category_count: toSafeInteger(source.categoryCount ?? parsedParseErrorDetails?.category_count),
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
    raw_model_text:
      process.env.NODE_ENV !== 'production' && String(process.env.EVAL_SAVE_RAW_MODEL_OUTPUT || '').trim() === '1'
        ? asText(source.rawModelText).slice(0, 12000) || null
        : null,
  };
  const hasAnyValue =
    Boolean(diagnostics.model) ||
    Boolean(diagnostics.reason_code) ||
    Boolean(diagnostics.parse_error_kind) ||
    Boolean(diagnostics.parse_error_name) ||
    Boolean(diagnostics.parse_error_message) ||
    Boolean(diagnostics.raw_text_length) ||
    diagnostics.had_json_fence !== null ||
    Boolean(diagnostics.finish_reason) ||
    diagnostics.schema_missing_keys.length > 0 ||
    Boolean(diagnostics.category_count) ||
    Boolean(diagnostics.source_env_key) ||
    diagnostics.response_keys.length > 0 ||
    diagnostics.first_candidate_keys.length > 0 ||
    diagnostics.first_part_keys.length > 0 ||
    Boolean(diagnostics.text_length) ||
    Boolean(diagnostics.upstream_status) ||
    Boolean(diagnostics.status) ||
    Boolean(diagnostics.raw_model_text);
  return hasAnyValue ? diagnostics : null;
}

function getParseErrorKind(error: any) {
  const fromExtra = asLower(error?.extra?.parseErrorKind || error?.extra?.parseErrorName || error?.extra?.reasonCode);
  if (fromExtra) {
    return fromExtra;
  }
  const parsedMessage = parseJsonObject(error?.extra?.parseErrorMessage);
  return asLower(parsedMessage?.parse_error_kind);
}

function getDocumentComparisonEvaluator() {
  const override = (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
  if (typeof override === 'function') {
    return override as typeof evaluateDocumentComparisonWithVertex;
  }
  return evaluateDocumentComparisonWithVertex;
}

function resolveDocumentComparisonEngine(req: any): 'v1' | 'v2' {
  const queryEngine = asLower(req.query?.engine || '');
  if (queryEngine === 'v1' || queryEngine === 'v2') {
    return queryEngine;
  }

  const runtimeEnv = asLower(process.env.NODE_ENV || '');
  const configuredEngine = asLower(process.env.EVAL_ENGINE || '');
  if (runtimeEnv !== 'test' && (configuredEngine === 'v1' || configuredEngine === 'v2')) {
    return configuredEngine;
  }

  // NODE_ENV=test is the only environment that keeps v1 for test isolation.
  // Every other environment — including unset NODE_ENV (local Vercel dev) — uses v2.
  // Force v1 via EVAL_ENGINE=v1 or ?engine=v1 if ever needed.
  if (runtimeEnv === 'test') {
    return 'v1';
  }
  return 'v2';
}

function convertV2ResponseToEvaluation(v2Result: any): Record<string, unknown> {
  const { data } = v2Result;
  const confidence = Number(data?.confidence_0_1);
  const normalizedConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const fitLevel = asLower(data?.fit_level);
  const recommendation = fitLevel === 'high' ? 'High' : fitLevel === 'medium' ? 'Medium' : 'Low';
  const why = Array.isArray(data?.why) ? data.why.map((entry: unknown) => asText(entry)).filter(Boolean) : [];
  const missing = Array.isArray(data?.missing)
    ? data.missing.map((entry: unknown) => asText(entry)).filter(Boolean)
    : [];
  const redactions = Array.isArray(data?.redactions)
    ? data.redactions.map((entry: unknown) => asText(entry)).filter(Boolean)
    : [];
  const generatedAt = new Date().toISOString();
  // generation_model = what was configured/intended; model = what Vertex actually used
  const generationModel =
    asText(v2Result?.generation_model) ||
    asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) ||
    asText(process.env.VERTEX_MODEL) ||
    'gemini-2.5-pro';
  const providerModel = asText(v2Result?.model) || generationModel;
  const report = {
    report_format: 'v2' as const,
    fit_level: fitLevel === 'high' || fitLevel === 'medium' || fitLevel === 'low' ? fitLevel : 'unknown',
    confidence_0_1: normalizedConfidence,
    why,
    missing,
    redactions,
    generated_at_iso: generatedAt,
    summary: {
      fit_level: fitLevel === 'high' || fitLevel === 'medium' || fitLevel === 'low' ? fitLevel : 'unknown',
      top_fit_reasons: why.map((text: string) => ({ text })),
      top_blockers: missing.map((text: string) => ({ text })),
      next_actions: missing.length > 0 ? ['Resolve the open questions and re-run AI mediation.'] : [],
    },
    sections: buildMediationReviewSections({ why, missing, redactions }),
    recommendation,
  };
  return {
    provider: 'vertex',
    model: providerModel,
    generatedAt: generatedAt,
    score: Math.round(normalizedConfidence * 100),
    confidence: normalizedConfidence,
    recommendation,
    summary: why[0] || 'AI mediation review complete',
    report,
    evaluation_provider: 'vertex',
    evaluation_model: generationModel,
    evaluation_provider_model: providerModel,
    evaluation_provider_reason: null,
  };
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
  const normalizedMessage = asText(error?.message) || 'AI mediation failed';
  const loweredMessage = normalizedMessage.toLowerCase();
  const safeConfiguredMessage = normalizedMessage.slice(0, 200);

  if (sourceCode === 'empty_inputs') {
    return {
      failureCode: 'empty_inputs',
      failureStage: 'validation',
      failureMessage: 'Nothing to evaluate. Please add content first.',
      httpStatus: 400,
      retryable: false,
      sourceCode,
      upstreamStatus: null,
    };
  }

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
    const parseErrorKind = getParseErrorKind(error);
    const retryableFromError =
      typeof (error as any)?.extra?.retryable === 'boolean' ? Boolean((error as any).extra.retryable) : null;
    // The evaluator already retries most malformed output internally.
    // Route-level retry is reserved for parser drift unless evaluator explicitly marks retryable.
    const shouldRetry =
      retryableFromError !== null ? retryableFromError : parseErrorKind === 'json_parse_error' || !parseErrorKind;
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
  const base =
    rawEvaluation && typeof rawEvaluation === 'object' && !Array.isArray(rawEvaluation) ? rawEvaluation : {};
  return {
    ...base,
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

function toApiFailureError(params: {
  classified: ClassifiedEvaluationFailure;
  requestId: string;
  attemptCount: number;
  diagnostics?: Record<string, unknown> | null;
}) {
  const diagnostics =
    params.diagnostics && typeof params.diagnostics === 'object' && !Array.isArray(params.diagnostics)
      ? params.diagnostics
      : null;
  return new ApiError(params.classified.httpStatus, params.classified.failureCode, params.classified.failureMessage, {
    requestId: params.requestId,
    failure_code: params.classified.failureCode,
    failure_stage: params.classified.failureStage,
    http_status: params.classified.httpStatus,
    attempt_count: params.attemptCount,
    retryable: params.classified.retryable,
    parse_error_kind: asText((diagnostics as any)?.parse_error_kind) || null,
    raw_text_length: toSafeInteger((diagnostics as any)?.raw_text_length),
    had_json_fence:
      diagnostics && (diagnostics as any).had_json_fence !== undefined
        ? Boolean((diagnostics as any).had_json_fence)
        : null,
    finish_reason: asText((diagnostics as any)?.finish_reason) || null,
    schema_missing_keys: Array.isArray((diagnostics as any)?.schema_missing_keys)
      ? (diagnostics as any).schema_missing_keys.map((value: unknown) => asText(value)).filter(Boolean).slice(0, 40)
      : [],
    category_count: toSafeInteger((diagnostics as any)?.category_count),
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
  inputTrace: Record<string, unknown>;
}) {
  const now = params.completedAt;
  const inputFields = getEvaluationAttemptInputFields(params.inputTrace);
  await params.db.insert(schema.proposalEvaluations).values({
    id: newId('eval'),
    proposalId: params.proposalId,
    userId: params.userId,
    source: 'document_comparison_vertex',
    status: 'failed',
    score: null,
    summary: params.classifiedFailure.failureMessage || 'Document comparison evaluation failed',
    inputSharedHash: inputFields.inputSharedHash,
    inputConfHash: inputFields.inputConfHash,
    inputSharedLen: inputFields.inputSharedLen,
    inputConfLen: inputFields.inputConfLen,
    inputVersion: inputFields.inputVersion,
    result: {
      ...params.failedResult,
      request_id: params.requestId,
    },
    createdAt: now,
    updatedAt: now,
  });
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/evaluate', async (context: ApiRouteContext) => {
    ensureMethod(req, ['POST']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const auth = (await requireUser(req, res)) as {
      ok: boolean;
      user?: AuthedUser;
    };
    if (!auth.ok) {
      return;
    }
    const user = auth.user;
    if (!user?.id) {
      throw new ApiError(401, 'unauthorized', 'Authentication required');
    }
    context.userId = user.id;
    const requestId = asText((context as any)?.requestId) || newId('request');

    // Log evaluation start with Vertex config status
    if (process.env.NODE_ENV !== 'production') {
      const vertexConfig = getVertexConfig();
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_request_start',
          requestId,
          comparisonId,
          vertexConfigured: vertexConfig.ready,
          vertexModel: vertexConfig.model,
          configErrorCode: vertexConfig.configErrorCode || null,
        }),
      );
    }

    const db = getDb();
    const existingRows = await db
      .select()
      .from(schema.documentComparisons)
      .where(and(eq(schema.documentComparisons.id, comparisonId), eq(schema.documentComparisons.userId, user.id)))
      .limit(1);
    const existingRow = firstRow<DocumentComparisonRow>(existingRows);
    ensureComparisonFound(existingRow);
    const existing = existingRow as DocumentComparisonRow;

    await assertStarterAiEvaluationAllowed(db, {
      userId: existing.userId,
      userEmail: user.email || null,
    });

    let linkedProposal = null;
    if (existing.proposalId) {
      const proposalRows = await db
        .select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, existing.proposalId))
        .limit(1);
      linkedProposal = firstRow(proposalRows);
      if (linkedProposal) {
        assertProposalOpenForNegotiation(linkedProposal);
      }
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const draft = resolveEvaluationDraft({
      existing,
      body,
    });
    const existingInputs = toRecord(existing?.inputs);
    const companyContext = resolveComparisonCompanyContext(existing, existingInputs);
    const recipientConfidentialText = await getLatestRecipientConfidentialText(db, existing.id);
    const counterpartyConfidentialText = resolveCounterpartyConfidentialText({
      existing,
      existingInputs,
      recipientConfidentialText,
    });
    const counterpartyCanaryTokens = resolveOtherPartyCanaryTokens(existing, existingInputs);
    const inputSource = hasRequestInputOverride(body) ? 'request_body' : 'db';
    const inputVersion = getInputVersionFromMetadata(existing?.metadata);
    const evaluationInputTrace = buildEvaluationInputTrace({
      comparisonId: existing.id,
      source: inputSource,
      confidentialText: draft.docAText,
      sharedText: draft.docBText,
      inputVersion,
    });
    logEvaluationInputTrace({
      requestId,
      comparisonId: existing.id,
      source: inputSource,
      inputTrace: evaluationInputTrace,
    });
    assertDocumentComparisonWithinLimits({
      docAText: draft.docAText,
      docBText: draft.docBText,
    });
    const sharedLength = Number(evaluationInputTrace.shared_length || 0);
    const confidentialLength = Number(evaluationInputTrace.confidential_length || 0);

    // Dev logging: Track evaluation request
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_input_validated',
          requestId,
          comparisonId: existing.id,
          inputSource,
          inputSummary: {
            confidentialLength,
            sharedLength,
            draftStep: draft.draftStep,
          },
        }),
      );
    }

    if (sharedLength < MIN_SHARED_EVALUATION_TEXT_LENGTH) {
      throw new ApiError(
        400,
        'invalid_input',
        `Shared information must be at least ${MIN_SHARED_EVALUATION_TEXT_LENGTH} characters before evaluation.`,
        {
          requestId,
          input_shared_len: sharedLength,
          input_conf_len: confidentialLength,
        },
      );
    }
    if (confidentialLength < MIN_CONFIDENTIAL_EVALUATION_TEXT_LENGTH) {
      throw new ApiError(
        400,
        'invalid_input',
        `Confidential information must be at least ${MIN_CONFIDENTIAL_EVALUATION_TEXT_LENGTH} characters before evaluation.`,
        {
          requestId,
          input_shared_len: sharedLength,
          input_conf_len: confidentialLength,
        },
      );
    }
    if (
      confidentialLength >= MIN_CONFIDENTIAL_EVALUATION_TEXT_LENGTH &&
      sharedLength >= MIN_SHARED_EVALUATION_TEXT_LENGTH &&
      asText(evaluationInputTrace.confidential_hash) === asText(evaluationInputTrace.shared_hash)
    ) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          route: '/api/document-comparisons/[id]/evaluate',
          requestId,
          comparisonId: existing.id,
          message: 'confidential_and_shared_hash_match',
          source: inputSource,
        }),
      );
    }

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

    const engine = resolveDocumentComparisonEngine(req);
    const useV2 = engine === 'v2';
    const evaluateComparison = useV2 ? null : getDocumentComparisonEvaluator();
    let attemptCount = 0;
    let evaluation: any = null;
    let latestFailedResult: Record<string, unknown> | null = null;
    let latestFailedClassification: ClassifiedEvaluationFailure | null = null;

    while (attemptCount < MAX_EVALUATION_ATTEMPTS) {
      attemptCount += 1;
      const attemptStartedAt = new Date();

      try {
        if (process.env.NODE_ENV !== 'production') {
          const vertexConfig = getVertexConfig();
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/document-comparisons/[id]/evaluate',
              event: 'evaluation_vertex_call_start',
              requestId,
              comparisonId: existing.id,
              attempt: attemptCount,
              engine,
              model: asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) || vertexConfig.model || process.env.VERTEX_MODEL || null,
              generation_model: asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) || 'gemini-2.5-pro',
              verifier_model: asText(process.env.VERTEX_DOC_COMPARE_VERIFIER_MODEL) || 'gemini-2.5-flash-lite',
              region: vertexConfig.location || process.env.GCP_LOCATION || null,
              prompt_length: null,
              total_input_chars: confidentialLength + sharedLength,
              safety_settings: 'platform_default',
            }),
          );
        }

        let evaluated: any = null;
        if (useV2) {
          // Wrap call in a hard try-catch so any unexpected evaluator throw also
          // produces a valid (completed_with_warnings) result rather than a 502.
          let v2Result: any;
          try {
            v2Result = await evaluateWithVertexV2({
              sharedText: draft.docBText || '',
              confidentialText: draft.docAText || '',
              requestId,
              enforceLeakGuard: false,
              // Model routing — resolved inside the lib via env vars if not set here.
              // Providing them explicitly lets the route override via query/body in future.
              generationModel: asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) || undefined,
              verifierModel: asText(process.env.VERTEX_DOC_COMPARE_VERIFIER_MODEL) || undefined,
              extractModel: asText(process.env.VERTEX_DOC_COMPARE_EXTRACT_MODEL) || undefined,
            });
          } catch (unexpectedError: any) {
            console.error(
              JSON.stringify({
                level: 'error',
                route: '/api/document-comparisons/[id]/evaluate',
                event: 'vertex_v2_unexpected_throw',
                requestId,
                comparisonId: existing.id,
                message: asText(unexpectedError?.message) || 'unknown',
              }),
            );
            // Build a minimal ok:true fallback so we never 502 on an unexpected throw.
            v2Result = {
              ok: true,
              data: {
                fit_level: 'unknown',
                confidence_0_1: 0.2,
                why: [
                  'Executive Summary: The AI mediation review could not be generated due to an unexpected internal error.',
                  'Key Strengths: Unable to assess — model call failed unexpectedly.',
                  'Key Risks: Unable to assess — insufficient data.',
                  'Decision Readiness: Incomplete. Please address missing items and retry.',
                  'Recommendations: Review the missing items below and re-run AI mediation.',
                ],
                missing: [
                  'What is the confirmed scope and set of deliverables?',
                  'What is the confirmed timeline and go-live date?',
                  'What are the measurable success criteria (KPIs)?',
                ],
                redactions: [],
              },
              attempt_count: 1,
              model: null,
              _internal: {
                warnings: ['vertex_unexpected_error_fallback_used'],
                failure_kind: 'unexpected_error',
              },
            };
          }

          if (!v2Result.ok) {
            const error = v2Result.error;
            const parseKind = asLower(error.parse_error_kind);

            // Confidential leak is a security hard failure — never return a
            // partially-generated result that might contain leaked data.
            if (parseKind === 'confidential_leak_detected') {
              const v2Error = new ApiError(400, 'confidential_leak_detected', 'Vertex evaluation failed: confidential data leak detected', {
                reasonCode: parseKind,
                parseErrorKind: parseKind,
                parseErrorName: parseKind,
                parseErrorMessage: JSON.stringify({
                  parse_error_kind: parseKind || null,
                  raw_text_length: toSafeInteger(error.raw_text_length) || 0,
                  had_json_fence: null,
                  finish_reason: asText(error.finish_reason) || null,
                  schema_missing_keys: [],
                  category_count: null,
                }),
              });
              throw v2Error;
            }

            // For all other ok:false cases (e.g. not_configured) — use a
            // completed_with_warnings fallback so the API returns 200, not 502.
            const details =
              error.details && typeof error.details === 'object' && !Array.isArray(error.details)
                ? (error.details as Record<string, unknown>)
                : {};
            const warningKey =
              parseKind === 'not_configured' || (details as any).code === 'not_configured'
                ? 'vertex_not_configured_fallback_used'
                : 'vertex_invalid_response_fallback_used';
            console.warn(
              JSON.stringify({
                level: 'warn',
                route: '/api/document-comparisons/[id]/evaluate',
                event: 'vertex_v2_ok_false_using_fallback',
                requestId,
                comparisonId: existing.id,
                parseKind,
                warningKey,
              }),
            );
            v2Result = {
              ok: true,
              data: {
                fit_level: 'unknown',
                confidence_0_1: 0.2,
                why: [
                  'Executive Summary: The AI mediation review could not be generated. This review is incomplete.',
                  'Key Strengths: Unable to assess due to model configuration or availability issue.',
                  'Key Risks: Unable to assess — please retry or contact support if issue persists.',
                  'Decision Readiness: Incomplete. Address missing items below.',
                  'Recommendations: Retry AI mediation once the underlying issue is resolved.',
                ],
                missing: [
                  'What is the confirmed scope and set of deliverables?',
                  'What is the confirmed timeline and go-live date?',
                  'What are the measurable success criteria (KPIs)?',
                  'What budget and resource constraints apply?',
                  'What are the key risks and their mitigations?',
                ],
                redactions: [],
              },
              attempt_count: v2Result.attempt_count ?? 1,
              model: null,
              _internal: {
                warnings: [warningKey],
                failure_kind: parseKind,
              },
            };
          }
          evaluated = convertV2ResponseToEvaluation(v2Result);
        } else {
          evaluated = await evaluateComparison!({
            title: draft.title,
            docAText: draft.docAText,
            docBText: draft.docBText,
            docASpans: [],
            docBSpans: [],
            partyALabel: CONFIDENTIAL_LABEL,
            partyBLabel: SHARED_LABEL,
          }, {
            correlationId: requestId,
            routeName: '/api/document-comparisons/[id]/evaluate',
            entityId: existing.id,
            inputChars: confidentialLength + sharedLength,
            disableConfidentialLeakGuard: true,
          });
        }

        const attemptCompletedAt = new Date();
        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/document-comparisons/[id]/evaluate',
              event: 'evaluation_vertex_call_success',
              requestId,
              comparisonId: existing.id,
              attempt: attemptCount,
              engine,
              latency_ms: attemptCompletedAt.getTime() - attemptStartedAt.getTime(),
              provider: asText(evaluated?.evaluation_provider || evaluated?.provider) || null,
              model: asText(evaluated?.evaluation_model || evaluated?.model) || null,
            }),
          );
        }
        evaluation = withAttemptMetadata({
          evaluation: evaluated,
          requestId,
          attemptNumber: attemptCount,
          startedAt: attemptStartedAt,
          completedAt: attemptCompletedAt,
          inputTrace: evaluationInputTrace,
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

        const proposalId = existing.proposalId;
        if (proposalId) {
          await withDbWriteGuard({
            requestId,
            message: 'Failed to persist proposal evaluation failure history',
            operation: () =>
              persistFailedProposalEvaluationAttempt({
                db,
                proposalId,
                userId: user.id,
                requestId,
                classifiedFailure: classified,
                failedResult,
                completedAt: attemptCompletedAt,
                inputTrace: evaluationInputTrace,
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
          failureMessage: 'AI mediation failed',
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
        diagnostics:
          latestFailedResult && typeof latestFailedResult === 'object'
            ? ((latestFailedResult as any)?.error?.details?.diagnostics as Record<string, unknown> | null)
            : null,
      });
    }

    const defaultConfidentialityWarnings = {
      confidentiality_section_redacted: [] as string[],
      confidentiality_section_regenerated: [] as string[],
      retries_used: {} as Record<string, number>,
    };
    let confidentialityWarnings = defaultConfidentialityWarnings;
    try {
      const healed = await applyCounterpartyConfidentialitySelfHeal({
        evaluation: evaluation as Record<string, any>,
        title: draft.title,
        sharedText: draft.docBText || '',
        requesterConfidentialText: draft.docAText || '',
        counterpartyConfidentialText,
        counterpartyCanaryTokens,
        companyName: companyContext.companyName,
        companyWebsite: companyContext.companyWebsite,
      });
      evaluation = healed.evaluation;
      confidentialityWarnings = healed.warnings;
    } catch (error: any) {
      const report =
        evaluation?.report && typeof evaluation.report === 'object' && !Array.isArray(evaluation.report)
          ? { ...(evaluation.report as Record<string, unknown>) }
          : {};
      const reportSections = Array.isArray(report.sections) ? report.sections : [];
      const redactedSectionKeys = reportSections
        .map((entry, index) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return `section_${index + 1}`;
          }
          return asText((entry as any).key) || `section_${index + 1}`;
        })
        .filter(Boolean);
      const safeLine = "This section can't be shown due to confidentiality.";
      report.sections = reportSections.map((entry, index) => {
        const key = redactedSectionKeys[index] || `section_${index + 1}`;
        const heading =
          entry && typeof entry === 'object' && !Array.isArray(entry)
            ? asText((entry as any).heading) || key
            : key;
        return {
          key,
          heading,
          bullets: [safeLine],
        };
      });
      report.executive_summary = 'Some sections were omitted due to confidentiality policy.';
      evaluation = {
        ...(evaluation as Record<string, unknown>),
        summary: 'Some sections were omitted due to confidentiality policy.',
        report,
        completion_status: 'completed_with_warnings',
        warnings: {
          confidentiality_section_redacted: redactedSectionKeys,
          confidentiality_section_regenerated: [],
          retries_used: {},
          fallback_reason: 'confidentiality_handler_error',
        },
      };
      confidentialityWarnings = {
        confidentiality_section_redacted: redactedSectionKeys,
        confidentiality_section_regenerated: [],
        retries_used: {},
      };
      console.warn(
        JSON.stringify({
          level: 'warn',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_confidentiality_handler_fallback',
          requestId,
          comparisonId: existing.id,
          message: asText(error?.message) || 'unknown_error',
        }),
      );
    }

    if (confidentialityWarnings.confidentiality_section_regenerated.length > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_confidentiality_section_regenerated',
          requestId,
          comparisonId: existing.id,
          sections: confidentialityWarnings.confidentiality_section_regenerated,
          retries_used: confidentialityWarnings.retries_used,
        }),
      );
    }
    if (confidentialityWarnings.confidentiality_section_redacted.length > 0) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_confidentiality_section_omitted',
          requestId,
          comparisonId: existing.id,
          sections: confidentialityWarnings.confidentiality_section_redacted,
          retries_used: confidentialityWarnings.retries_used,
        }),
      );
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

    // Dev logging: Track successful evaluation persistence
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/document-comparisons/[id]/evaluate',
          event: 'evaluation_persisted_success',
          requestId,
          comparisonId: updated?.id || existing.id,
          status: updated?.status || 'unknown',
          draftStep: updated?.draftStep || 'unknown',
          updatedAt: updated?.updatedAt || null,
          evaluationSummary: {
            hasEvaluationResult: Boolean(evaluation),
            hasPublicReport: Boolean(evaluation?.report),
          },
        }),
      );
    }

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
      const pendingWonReset = buildPendingWonReset(linkedProposal, now) || {};
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
              ...pendingWonReset,
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
                inputSharedHash: asText(evaluationInputTrace.shared_hash) || null,
                inputConfHash: asText(evaluationInputTrace.confidential_hash) || null,
                inputSharedLen: toSafeInteger(evaluationInputTrace.shared_length),
                inputConfLen: toSafeInteger(evaluationInputTrace.confidential_length),
                inputVersion: toSafeInteger(evaluationInputTrace.input_version),
                result: evaluation,
                createdAt: now,
                updatedAt: now,
              })
              .returning({
                id: schema.proposalEvaluations.id,
                inputSharedHash: schema.proposalEvaluations.inputSharedHash,
                inputConfHash: schema.proposalEvaluations.inputConfHash,
                inputSharedLen: schema.proposalEvaluations.inputSharedLen,
                inputConfLen: schema.proposalEvaluations.inputConfLen,
                inputVersion: schema.proposalEvaluations.inputVersion,
              }),
        });
        const savedEvaluation = firstRow(savedEvaluationRows);

        await appendProposalHistory(db, {
          proposal,
          actorUserId: user.id,
          actorRole: 'party_a',
          milestone: 'evaluate',
          eventType: 'proposal.evaluated',
          documentComparison: updated,
          evaluations: savedEvaluation
            ? [
                {
                  id: savedEvaluation.id,
                  proposalId: proposal.id,
                  userId: proposal.userId,
                  source: 'document_comparison_vertex',
                  status: 'completed',
                  score: evaluation.score,
                  summary: evaluation.summary,
                  inputSharedHash: savedEvaluation.inputSharedHash,
                  inputConfHash: savedEvaluation.inputConfHash,
                  inputSharedLen: savedEvaluation.inputSharedLen,
                  inputConfLen: savedEvaluation.inputConfLen,
                  inputVersion: savedEvaluation.inputVersion,
                  result: evaluation,
                  createdAt: now,
                  updatedAt: now,
                },
              ]
            : [],
          createdAt: now,
          requestId: context.requestId,
          eventData: {
            source: 'document_comparison_vertex',
            evaluation_score: evaluation.score,
          },
        });

        try {
          await createNotificationEvent({
            db,
            userId: proposal.userId,
            userEmail: proposal.partyAEmail || user.email,
            eventType: 'evaluation_update',
            emailCategory: 'evaluation_complete',
            dedupeKey: `evaluation_update:${proposal.id}:${existing.id}:${savedEvaluation?.id || 'document_comparison'}`,
            title: 'AI mediation review ready',
            message: `An AI mediation review is ready for "${proposal.title || 'your proposal'}".`,
            actionUrl: `/ProposalDetail?id=${encodeURIComponent(proposal.id)}`,
            emailSubject: 'AI mediation review ready',
            emailText: [
              `Your proposal "${proposal.title || 'Untitled Proposal'}" has a new AI mediation review.`,
              '',
              `Score: ${evaluation.score ?? 'N/A'}`,
              '',
              'Sign in to PreMarket to review the full mediation review.',
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
      evaluation_provider:
        asText(evaluation?.evaluation_provider) || (asLower(evaluation?.provider) === 'vertex' ? 'vertex' : 'fallback'),
      evaluation_model: asText(evaluation?.evaluation_model || evaluation?.model) || null,
      evaluation_provider_reason: asText(evaluation?.evaluation_provider_reason || evaluation?.fallbackReason) || null,
      proposal: proposalSummary,
      evaluation_input_trace: evaluationInputTrace,
      request_id: requestId,
      attempt_count: attemptCount,
    });
  });
}
