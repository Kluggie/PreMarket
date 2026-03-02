import { createSign } from 'node:crypto';
import { ApiError } from './errors.js';
import { getVertexConfig, getVertexNotConfiguredError, type VertexServiceAccountCredentials } from './integrations.js';

const VERTEX_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
const RETRY_BASE_MS = 450;
const MAX_SHARED_CHARS = 12_000;
const MAX_CONFIDENTIAL_CHARS = 12_000;
const MAX_CHUNKS_PER_SOURCE = 30;
const MAX_CHUNK_TEXT_CHARS = 420;
const MIN_LEAK_PHRASE_LEN = 20;
const MIN_LEAK_TOKEN_LEN = 4;

type ParseErrorKind =
  | 'json_parse_error'
  | 'schema_validation_error'
  | 'truncated_output'
  | 'empty_output'
  | 'vertex_timeout'
  | 'vertex_http_error'
  | 'confidential_leak_detected';

type FitLevel = 'high' | 'medium' | 'low' | 'unknown';

type VertexCallResponse = {
  model: string;
  text: string;
  finishReason: string | null;
  httpStatus: number;
};

type SchemaValidationResult =
  | { ok: true; normalized: VertexEvaluationV2Response }
  | { ok: false; missingKeys: string[]; invalidFields: string[] };

type ExtractJsonResult = {
  parsed: unknown | null;
  hadJsonFence: boolean;
  extractionMode: 'raw' | 'json_fence' | 'balanced_brace' | 'first_last_brace' | 'none';
};

type EvaluationChunks = {
  sharedChunks: Array<{ evidence_id: string; text: string }>;
  confidentialChunks: Array<{ evidence_id: string; text: string }>;
};

type VertexCallOverride = (params: {
  prompt: string;
  requestId?: string;
  inputChars: number;
}) => Promise<VertexCallResponse>;

export interface VertexEvaluationV2Request {
  sharedText: string;
  confidentialText: string;
  requestId?: string;
}

export interface VertexEvaluationV2Response {
  fit_level: FitLevel;
  confidence_0_1: number;
  why: string[];
  missing: string[];
  redactions: string[];
}

export interface VertexEvaluationV2Error {
  parse_error_kind: ParseErrorKind;
  finish_reason: string | null;
  raw_text_length: number;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface VertexEvaluationV2Result {
  ok: true;
  data: VertexEvaluationV2Response;
  attempt_count: number;
  model: string;
}

export interface VertexEvaluationV2Failure {
  ok: false;
  error: VertexEvaluationV2Error;
  attempt_count: number;
}

export type VertexEvaluationV2Outcome = VertexEvaluationV2Result | VertexEvaluationV2Failure;

function asText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeSpaces(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenizeForLeakScan(value: string) {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoChunks(text: string) {
  const normalized = String(text || '').replace(/\r/g, '\n').trim();
  if (!normalized) return [] as string[];

  const byLine = normalized
    .split(/\n+/g)
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);
  if (byLine.length > 1) {
    return byLine;
  }

  const bySentence = normalized
    .split(/(?<=[.!?])\s+/g)
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);
  if (bySentence.length) {
    return bySentence;
  }

  return [normalizeSpaces(normalized)];
}

function buildSourceChunks(text: string, source: 'shared' | 'conf') {
  const segments = splitIntoChunks(text);
  const chunks: Array<{ evidence_id: string; text: string }> = [];

  for (const segment of segments) {
    if (chunks.length >= MAX_CHUNKS_PER_SOURCE) break;
    const index = String(chunks.length + 1).padStart(3, '0');
    const evidence_id = `${source}:line_${index}`;
    const chunkText =
      segment.length > MAX_CHUNK_TEXT_CHARS
        ? `${segment.slice(0, MAX_CHUNK_TEXT_CHARS)} [TRUNCATED]`
        : segment;
    chunks.push({
      evidence_id,
      text: chunkText,
    });
  }

  return chunks;
}

function buildChunks(sharedText: string, confidentialText: string): EvaluationChunks {
  return {
    sharedChunks: buildSourceChunks(sharedText.slice(0, MAX_SHARED_CHARS), 'shared'),
    confidentialChunks: buildSourceChunks(confidentialText.slice(0, MAX_CONFIDENTIAL_CHARS), 'conf'),
  };
}

function buildPrompt(params: {
  sharedText: string;
  confidentialText: string;
  chunks: EvaluationChunks;
}) {
  const payload = {
    shared_chunks: params.chunks.sharedChunks,
    confidential_chunks: params.chunks.confidentialChunks,
    constraints: {
      confidentiality_middleman_rule: true,
      no_confidential_verbatim: true,
      no_confidential_numbers_or_identifiers: true,
      allow_safe_derived_conclusions: true,
    },
    inputs: {
      shared_text_excerpt: params.sharedText.slice(0, MAX_SHARED_CHARS),
      confidential_text_excerpt: params.confidentialText.slice(0, MAX_CONFIDENTIAL_CHARS),
    },
  };

  return [
    'SYSTEM: You are an evaluation middleman for contract/proposal alignment.',
    'You may reason over confidential input internally, but output must be safe to share.',
    'Never quote confidential text. Never disclose confidential numbers, IDs, dates, emails, or exact identifiers.',
    'Output MUST be valid JSON only. No markdown, no backticks, no preamble.',
    'Required JSON schema (all keys required):',
    JSON.stringify(
      {
        fit_level: 'high|medium|low|unknown',
        confidence_0_1: 0,
        why: ['string'],
        missing: ['string'],
        redactions: ['string'],
      },
      null,
      2,
    ),
    'Rules:',
    '- fit_level must be one of high|medium|low|unknown.',
    '- confidence_0_1 must be between 0 and 1.',
    '- why/missing/redactions must be arrays (can be empty).',
    '- Keep all statements safe for shared/public report.',
    '- Use generic derived wording for confidential-driven conclusions.',
    'INPUT JSON:',
    JSON.stringify(payload, null, 2),
    'Return JSON only.',
  ].join('\n');
}

function hasJsonFence(text: string) {
  return /```(?:json)?\s*[\s\S]*?```/i.test(String(text || ''));
}

function extractFirstBalancedJsonObject(text: string) {
  const raw = String(text || '');
  let start = raw.indexOf('{');
  let startsChecked = 0;

  while (start >= 0 && startsChecked < 48) {
    startsChecked += 1;
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char !== '}') {
        continue;
      }

      depth -= 1;
      if (depth < 0) break;
      if (depth !== 0) continue;

      const candidate = raw.slice(start, index + 1).trim();
      if (candidate) {
        return { candidate, start, end: index };
      }
      break;
    }

    start = raw.indexOf('{', start + 1);
  }

  return null;
}

function extractJsonCandidate(text: string): { candidate: string; hadJsonFence: boolean; extractionMode: ExtractJsonResult['extractionMode'] } {
  const raw = String(text || '').trim();
  const hadJsonFence = hasJsonFence(raw);
  if (!raw) {
    return { candidate: '', hadJsonFence, extractionMode: 'none' };
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner) {
      return { candidate: inner, hadJsonFence, extractionMode: 'json_fence' };
    }
  }

  const balanced = extractFirstBalancedJsonObject(raw);
  if (balanced?.candidate) {
    const extractionMode: ExtractJsonResult['extractionMode'] =
      balanced.start === 0 && balanced.end === raw.length - 1 ? 'raw' : 'balanced_brace';
    return { candidate: balanced.candidate, hadJsonFence, extractionMode };
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return {
      candidate: raw.slice(firstBrace, lastBrace + 1).trim(),
      hadJsonFence,
      extractionMode: firstBrace === 0 && lastBrace === raw.length - 1 ? 'raw' : 'first_last_brace',
    };
  }

  return { candidate: raw, hadJsonFence, extractionMode: 'raw' };
}

function parseJsonObject(text: string): ExtractJsonResult {
  const extracted = extractJsonCandidate(text);
  if (!extracted.candidate) {
    return {
      parsed: null,
      hadJsonFence: extracted.hadJsonFence,
      extractionMode: extracted.extractionMode,
    };
  }

  try {
    const parsed = JSON.parse(extracted.candidate);
    if (typeof parsed === 'string') {
      const maybeJson = parsed.trim();
      if (maybeJson.startsWith('{') && maybeJson.endsWith('}')) {
        return {
          parsed: JSON.parse(maybeJson),
          hadJsonFence: extracted.hadJsonFence,
          extractionMode: extracted.extractionMode,
        };
      }
    }
    return {
      parsed,
      hadJsonFence: extracted.hadJsonFence,
      extractionMode: extracted.extractionMode,
    };
  } catch {
    return {
      parsed: null,
      hadJsonFence: extracted.hadJsonFence,
      extractionMode: extracted.extractionMode,
    };
  }
}

function isLikelyTruncatedOutput(text: string, finishReason: string | null) {
  const reason = asLower(finishReason);
  if (reason && reason !== 'stop') {
    return true;
  }
  const raw = String(text || '').trim();
  if (!raw) return false;
  const openCurly = (raw.match(/\{/g) || []).length;
  const closeCurly = (raw.match(/\}/g) || []).length;
  const openSquare = (raw.match(/\[/g) || []).length;
  const closeSquare = (raw.match(/\]/g) || []).length;
  return openCurly > closeCurly || openSquare > closeSquare;
}

function validateResponseSchema(value: unknown): SchemaValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      missingKeys: ['fit_level', 'confidence_0_1', 'why', 'missing', 'redactions'],
      invalidFields: ['root_not_object'],
    };
  }

  const raw = value as Record<string, unknown>;
  const requiredKeys = ['fit_level', 'confidence_0_1', 'why', 'missing', 'redactions'] as const;
  const missingKeys = requiredKeys.filter((key) => raw[key] === undefined);
  const invalidFields: string[] = [];

  const fit = asLower(raw.fit_level);
  if (!['high', 'medium', 'low', 'unknown'].includes(fit)) {
    invalidFields.push('fit_level');
  }

  const confidence = Number(raw.confidence_0_1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    invalidFields.push('confidence_0_1');
  }

  const ensureStringArray = (entry: unknown, field: string) => {
    if (!Array.isArray(entry)) {
      invalidFields.push(field);
      return [] as string[];
    }
    const normalized = entry
      .map((item) => asText(item))
      .filter((item) => item.length > 0);
    if (normalized.length !== entry.length) {
      invalidFields.push(`${field}_contains_non_string`);
    }
    return normalized;
  };

  const why = ensureStringArray(raw.why, 'why');
  const missing = ensureStringArray(raw.missing, 'missing');
  const redactions = ensureStringArray(raw.redactions, 'redactions');

  if (missingKeys.length || invalidFields.length) {
    return {
      ok: false,
      missingKeys,
      invalidFields,
    };
  }

  return {
    ok: true,
    normalized: {
      fit_level: fit as FitLevel,
      confidence_0_1: clamp01(confidence),
      why,
      missing,
      redactions,
    },
  };
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return asText(entry);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return asText((entry as any).text || (entry as any).title || (entry as any).description);
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeFitLevel(value: unknown): FitLevel {
  const normalized = asLower(value);
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low' || normalized === 'unknown') {
    return normalized;
  }
  if (normalized === 'yes') return 'high';
  if (normalized === 'no') return 'low';
  return 'unknown';
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric > 1 && numeric <= 100) {
    return clamp01(numeric / 100);
  }
  return clamp01(numeric);
}

function coerceToSmallSchema(value: unknown): { candidate: unknown; coerced: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { candidate: value, coerced: false };
  }
  const raw = value as Record<string, unknown>;
  const hasSmallShape =
    raw.fit_level !== undefined &&
    raw.confidence_0_1 !== undefined &&
    raw.why !== undefined &&
    raw.missing !== undefined &&
    raw.redactions !== undefined;
  if (hasSmallShape) {
    return { candidate: value, coerced: false };
  }

  const summary = raw.summary && typeof raw.summary === 'object' && !Array.isArray(raw.summary)
    ? (raw.summary as Record<string, unknown>)
    : {};
  const quality = raw.quality && typeof raw.quality === 'object' && !Array.isArray(raw.quality)
    ? (raw.quality as Record<string, unknown>)
    : {};
  const flags = Array.isArray(raw.flags) ? raw.flags : [];
  const redactedFlags = flags
    .filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      return asLower((entry as any).detail_level) === 'redacted';
    })
    .map((entry) => asText((entry as any).title || (entry as any).type || (entry as any).detail))
    .filter(Boolean);

  const whyFromSummary = toStringArray(summary.top_fit_reasons);
  const missingFromSummary = toStringArray(summary.top_blockers);
  const why = toStringArray(raw.why).length
    ? toStringArray(raw.why)
    : whyFromSummary.length
      ? whyFromSummary
      : toStringArray(raw.summary_points);
  const missing = toStringArray(raw.missing).length
    ? toStringArray(raw.missing)
    : missingFromSummary.length
      ? missingFromSummary
      : toStringArray(raw.gaps);
  const redactions = toStringArray(raw.redactions).length
    ? toStringArray(raw.redactions)
    : toStringArray(raw.topics_for_redaction).length
      ? toStringArray(raw.topics_for_redaction)
      : redactedFlags;

  const coerced: VertexEvaluationV2Response = {
    fit_level: normalizeFitLevel(raw.fit_level ?? summary.fit_level ?? raw.answer),
    confidence_0_1: normalizeConfidence(raw.confidence_0_1 ?? quality.confidence_overall ?? raw.confidence),
    why,
    missing,
    redactions,
  };
  return { candidate: coerced, coerced: true };
}

function collectSensitiveTokens(confidentialText: string, sharedText: string) {
  const confidentialLower = String(confidentialText || '').toLowerCase();
  const sharedLower = String(sharedText || '').toLowerCase();
  const tokenSet = new Set<string>();

  const emails = confidentialLower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  const ids = confidentialLower.match(/\b[a-z][a-z0-9_-]{6,}\d[a-z0-9_-]*\b/g) || [];
  const numbers = confidentialLower.match(/\b\d{4,}\b/g) || [];

  [...emails, ...ids, ...numbers]
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_LEAK_TOKEN_LEN)
    .forEach((token) => {
      if (sharedLower.includes(token)) return;
      tokenSet.add(token);
    });

  return [...tokenSet].slice(0, 300);
}

function buildConfidentialPhraseCandidates(confidentialChunks: Array<{ evidence_id: string; text: string }>, sharedText: string) {
  const sharedNormalized = tokenizeForLeakScan(sharedText);
  const candidateSet = new Set<string>();

  confidentialChunks.forEach((chunk) => {
    const words = tokenizeForLeakScan(chunk.text)
      .split(/\s+/g)
      .filter(Boolean);
    for (let index = 0; index + 4 < words.length && candidateSet.size < 400; index += 2) {
      const phrase = words.slice(index, index + 5).join(' ').trim();
      if (!phrase || phrase.length < MIN_LEAK_PHRASE_LEN) continue;
      if (sharedNormalized.includes(phrase)) continue;
      candidateSet.add(phrase);
    }
  });

  return [...candidateSet].slice(0, 300);
}

function detectConfidentialLeak(params: {
  response: VertexEvaluationV2Response;
  confidentialText: string;
  sharedText: string;
  confidentialChunks: Array<{ evidence_id: string; text: string }>;
}) {
  const outputText = [
    ...params.response.why,
    ...params.response.missing,
    ...params.response.redactions,
  ].join(' ');
  const outputLower = outputText.toLowerCase();
  const outputNormalized = tokenizeForLeakScan(outputText);
  if (!outputLower.trim()) {
    return null;
  }

  const phraseCandidates = buildConfidentialPhraseCandidates(params.confidentialChunks, params.sharedText);
  const leakedPhrase = phraseCandidates.find((phrase) => outputNormalized.includes(phrase));
  if (leakedPhrase) {
    return {
      leakType: 'confidential_substring',
      leakSample: leakedPhrase.slice(0, 120),
    };
  }

  const sensitiveTokens = collectSensitiveTokens(params.confidentialText, params.sharedText);
  const leakedToken = sensitiveTokens.find((token) => outputLower.includes(token));
  if (leakedToken) {
    return {
      leakType: 'confidential_token',
      leakSample: leakedToken.slice(0, 120),
    };
  }

  return null;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signJwt(unsignedToken: string, privateKey: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  return signer.sign(privateKey, 'base64url');
}

async function fetchGoogleAccessToken(credentials: VertexServiceAccountCredentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = signJwt(unsignedToken, credentials.private_key);
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }

  const payloadBody = (await response.json().catch(() => ({}))) as { access_token?: string };
  const token = asText(payloadBody.access_token);
  if (!token) {
    throw new ApiError(502, 'vertex_auth_failed', 'Vertex AI access token was not returned');
  }
  return token;
}

function extractModelText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = Array.isArray(candidates?.[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractFinishReason(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return asText(candidates?.[0]?.finishReason) || null;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = VERTEX_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    const isAbort =
      asLower(error?.name) === 'aborterror' ||
      asLower(error?.code) === 'aborted' ||
      asLower(error?.code) === 'abort_error';
    if (isAbort) {
      throw new ApiError(504, 'vertex_timeout', 'Vertex request timed out', {
        status: 504,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callVertexV2(params: {
  prompt: string;
  requestId?: string;
  inputChars: number;
}): Promise<VertexCallResponse> {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    const notConfigured = getVertexNotConfiguredError();
    throw new ApiError(501, 'not_configured', notConfigured.message, notConfigured.details);
  }

  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location || 'us-central1';
  const model = asText(process.env.VERTEX_MODEL) || vertex.model || 'gemini-2.0-flash-001';
  const accessToken = await fetchGoogleAccessToken(vertex.credentials);

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    topP: 1,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  };

  const buildBody = (config: Record<string, unknown>) => ({
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: config,
  });

  const send = async (body: Record<string, unknown>) =>
    fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': asText(params.requestId) || '',
        },
        body: JSON.stringify(body),
      },
      VERTEX_TIMEOUT_MS,
    );

  let response = await send(buildBody(generationConfig));
  let preloadedBody = '';
  if (!response.ok && response.status === 400) {
    const badBody = await response.text().catch(() => '');
    const unsupportedMimeType =
      badBody.toLowerCase().includes('responsemimetype') ||
      badBody.toLowerCase().includes('response mime type');
    if (unsupportedMimeType) {
      const fallbackConfig = { ...generationConfig };
      delete fallbackConfig.responseMimeType;
      response = await send(buildBody(fallbackConfig));
    } else {
      preloadedBody = badBody;
    }
  }

  if (!response.ok) {
    const body = preloadedBody || (await response.text().catch(() => ''));
    throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
      model,
      upstreamStatus: response.status,
      upstreamMessage: body.slice(0, 400),
      requestId: asText(params.requestId) || null,
      inputChars: params.inputChars,
    });
  }

  const payload = await response.json().catch(() => ({}));
  return {
    model,
    text: extractModelText(payload),
    finishReason: extractFinishReason(payload),
    httpStatus: response.status,
  };
}

function getVertexCallImplementation(): VertexCallOverride {
  const override = (globalThis as any).__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  if (typeof override === 'function') {
    return override as VertexCallOverride;
  }
  return callVertexV2;
}

function buildFailure(params: {
  kind: ParseErrorKind;
  requestId?: string;
  finishReason?: string | null;
  rawTextLength?: number;
  retryable: boolean;
  attemptCount: number;
  details?: Record<string, unknown>;
}): VertexEvaluationV2Failure {
  return {
    ok: false,
    error: {
      parse_error_kind: params.kind,
      finish_reason: params.finishReason ?? null,
      raw_text_length: Number.isFinite(Number(params.rawTextLength)) ? Number(params.rawTextLength) : 0,
      retryable: params.retryable,
      requestId: asText(params.requestId) || undefined,
      details: params.details,
    },
    attempt_count: params.attemptCount,
  };
}

function toRetryableForKind(kind: ParseErrorKind) {
  return kind === 'empty_output' || kind === 'truncated_output';
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getRetryDelayMs(attemptNumber: number) {
  const base = RETRY_BASE_MS * Math.max(1, Math.pow(2, Math.max(0, attemptNumber - 1)));
  const jitter = Math.floor(Math.random() * 251);
  return Math.min(2200, base + jitter);
}

function isTransientVertexHttpFailure(params: {
  code: string;
  status: number;
  message: string;
}) {
  const { code, status } = params;
  const message = asLower(params.message);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (
    ['econnreset', 'econnrefused', 'enotfound', 'ehostunreach', 'etimedout', 'fetch_failed'].includes(code)
  ) {
    return true;
  }
  if (!status) {
    if (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('temporarily unavailable') ||
      message.includes('upstream')
    ) {
      return true;
    }
  }
  return false;
}

export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request,
): Promise<VertexEvaluationV2Outcome> {
  const sharedText = String(input.sharedText || '').trim();
  const confidentialText = String(input.confidentialText || '').trim();
  const requestId = asText(input.requestId) || undefined;
  const inputChars = sharedText.length + confidentialText.length;

  if (!sharedText || !confidentialText) {
    return buildFailure({
      kind: 'empty_output',
      requestId,
      finishReason: null,
      rawTextLength: 0,
      retryable: true,
      attemptCount: 0,
      details: { reason: 'empty_input' },
    });
  }

  const chunks = buildChunks(sharedText, confidentialText);
  const prompt = buildPrompt({ sharedText, confidentialText, chunks });
  const callVertex = getVertexCallImplementation();

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let vertex: VertexCallResponse;

    try {
      vertex = await callVertex({
        prompt,
        requestId,
        inputChars,
      });
    } catch (error: any) {
      const code = asLower(error?.code);
      const status = Number(
        error?.statusCode || error?.status || error?.extra?.upstreamStatus || error?.extra?.status || 0,
      );
      const message =
        asText(error?.extra?.upstreamMessage) ||
        asText(error?.extra?.message) ||
        asText(error?.message) ||
        'Vertex request failed';
      const isTimeout = code === 'vertex_timeout';
      if (code === 'not_configured') {
        return buildFailure({
          kind: 'vertex_http_error',
          requestId,
          finishReason: null,
          rawTextLength: 0,
          retryable: false,
          attemptCount: attempt,
          details: {
            status: 501,
            code: 'not_configured',
          },
        });
      }

      const retryable = isTimeout
        ? true
        : isTransientVertexHttpFailure({
            code,
            status,
            message,
          });
      const kind: ParseErrorKind = isTimeout ? 'vertex_timeout' : 'vertex_http_error';

      if (retryable && attempt < MAX_ATTEMPTS) {
        await waitMs(getRetryDelayMs(attempt));
        continue;
      }

      return buildFailure({
        kind,
        requestId,
        finishReason: null,
        rawTextLength: 0,
        retryable,
        attemptCount: attempt,
        details: {
          status: status || (isTimeout ? 504 : 502),
          code: code || (isTimeout ? 'vertex_timeout' : 'vertex_http_error'),
          message,
        },
      });
    }

    const rawText = String(vertex.text || '');
    const rawTextLength = rawText.length;
    const finishReason = vertex.finishReason ? asLower(vertex.finishReason) : null;

    if (!rawText.trim()) {
      if (attempt < MAX_ATTEMPTS) {
        continue;
      }
      return buildFailure({
        kind: 'empty_output',
        requestId,
        finishReason,
        rawTextLength,
        retryable: true,
        attemptCount: attempt,
      });
    }

    if (isLikelyTruncatedOutput(rawText, finishReason)) {
      if (attempt < MAX_ATTEMPTS) {
        continue;
      }
      return buildFailure({
        kind: 'truncated_output',
        requestId,
        finishReason,
        rawTextLength,
        retryable: true,
        attemptCount: attempt,
      });
    }

    const extracted = parseJsonObject(rawText);
    if (!extracted.parsed) {
      return buildFailure({
        kind: 'json_parse_error',
        requestId,
        finishReason,
        rawTextLength,
        retryable: false,
        attemptCount: attempt,
        details: {
          had_json_fence: extracted.hadJsonFence,
          extraction_mode: extracted.extractionMode,
        },
      });
    }

    const coerced = coerceToSmallSchema(extracted.parsed);
    const schemaValidation = validateResponseSchema(coerced.candidate);
    if (!schemaValidation.ok) {
      return buildFailure({
        kind: 'schema_validation_error',
        requestId,
        finishReason,
        rawTextLength,
        retryable: false,
        attemptCount: attempt,
        details: {
          schema_missing_keys: schemaValidation.missingKeys,
          invalid_fields: schemaValidation.invalidFields,
          coerced_from_legacy: coerced.coerced,
        },
      });
    }

    const leak = detectConfidentialLeak({
      response: schemaValidation.normalized,
      confidentialText,
      sharedText,
      confidentialChunks: chunks.confidentialChunks,
    });
    if (leak) {
      return buildFailure({
        kind: 'confidential_leak_detected',
        requestId,
        finishReason,
        rawTextLength,
        retryable: false,
        attemptCount: attempt,
        details: leak,
      });
    }

    return {
      ok: true,
      data: schemaValidation.normalized,
      attempt_count: attempt,
      model: vertex.model,
    };
  }

  return buildFailure({
    kind: 'empty_output',
    requestId,
    finishReason: null,
    rawTextLength: 0,
    retryable: toRetryableForKind('empty_output'),
    attemptCount: MAX_ATTEMPTS,
  });
}

export { validateResponseSchema };
