import { createSign } from 'node:crypto';
import { ApiError } from './errors.js';
import { getVertexConfig, getVertexNotConfiguredError } from './integrations.js';

type Span = { start: number; end: number; level: string };
type EvidenceAnchor = { doc: 'A' | 'B'; start: number; end: number };

type ProposalResponseInput = {
  questionId: string;
  label: string;
  party: 'a' | 'b';
  required: boolean;
  value: unknown;
  valueType: string;
  rangeMin: string | null;
  rangeMax: string | null;
  visibility: 'full' | 'partial' | 'hidden';
  updatedBy: 'proposer' | 'recipient' | 'system';
  verifiedStatus: 'self_declared' | 'evidence_attached' | 'tier1_verified' | 'disputed' | 'unknown';
  moduleKey: string | null;
  sectionId: string | null;
};

type ProposalInput = {
  templateId: string;
  templateName: string;
  partyALabel: string;
  partyBLabel: string;
  responses: ProposalResponseInput[];
  rubric: unknown;
  computedSignals: unknown;
  /** Optional supplementary context from user-uploaded documents. Injected at end of prompt. */
  supplementaryContext?: string | null;
};

type ComparisonInput = {
  title: string;
  partyALabel: string;
  partyBLabel: string;
  docAText: string;
  docBText: string;
  docASpans: Span[];
  docBSpans: Span[];
};

type DocumentEvidenceChunk = {
  evidence_id: string;
  source: 'shared' | 'confidential';
  label: string;
  text: string;
  visibility: 'full' | 'partial' | 'hidden';
};

type ContractEvaluationReport = {
  template_id: string;
  template_name: string;
  generated_at_iso: string;
  parties: { a_label: string; b_label: string };
  quality: {
    completeness_a: number;
    completeness_b: number;
    confidence_overall: number;
    confidence_reasoning: string[];
    missing_high_impact_question_ids: string[];
    missing_high_impact_evidence_ids?: string[];
    disputed_question_ids: string[];
  };
  summary: {
    overall_score_0_100: number | null;
    fit_level: 'high' | 'medium' | 'low' | 'unknown';
    top_fit_reasons: Array<{
      text: string;
      evidence_ids?: string[];
      evidence_question_ids: string[];
      evidence_anchors?: EvidenceAnchor[];
    }>;
    top_blockers: Array<{
      text: string;
      evidence_ids?: string[];
      evidence_question_ids: string[];
      evidence_anchors?: EvidenceAnchor[];
    }>;
    next_actions: string[];
  };
  category_breakdown: Array<{
    category_key: string;
    name: string;
    weight: number;
    score_0_100: number | null;
    confidence_0_1: number;
    notes: string[];
    evidence_ids?: string[];
    evidence_question_ids: string[];
    evidence_anchors?: EvidenceAnchor[];
  }>;
  gates: Array<{
    gate_key: string;
    outcome: 'pass' | 'fail' | 'unknown';
    message: string;
    evidence_question_ids: string[];
    evidence_anchors?: EvidenceAnchor[];
  }>;
  overlaps_and_constraints: Array<{
    key: string;
    outcome: 'pass' | 'fail' | 'unknown';
    short_explanation: string;
    evidence_question_ids: string[];
    evidence_anchors?: EvidenceAnchor[];
  }>;
  contradictions: Array<{
    key: string;
    severity: 'low' | 'med' | 'high';
    description: string;
    evidence_ids?: string[];
    evidence_question_ids: string[];
    evidence_anchors?: EvidenceAnchor[];
  }>;
  flags: Array<{
    severity: 'low' | 'med' | 'high';
    type: 'security' | 'privacy' | 'ops' | 'commercial' | 'integrity' | 'other';
    title: string;
    detail: string;
    detail_level: 'full' | 'partial' | 'redacted';
    evidence_ids?: string[];
    evidence_question_ids: string[];
    evidence_anchors?: EvidenceAnchor[];
  }>;
  verification: {
    summary: {
      self_declared_count: number;
      evidence_attached_count: number;
      tier1_verified_count: number;
      disputed_count: number;
    };
    evidence_requested: Array<{
      item: string;
      reason: string;
      related_question_ids: string[];
      evidence_anchors?: EvidenceAnchor[];
    }>;
  };
  followup_questions: Array<{
    priority: 'high' | 'med' | 'low';
    to_party: 'a' | 'b' | 'both';
    question_text: string;
    why_this_matters: string;
    targets: {
      category_key: string;
      evidence_ids?: string[];
      question_ids: string[];
      evidence_anchors?: EvidenceAnchor[];
    };
  }>;
  appendix: {
    field_digest: Array<{
      question_id: string;
      label: string;
      party: 'a' | 'b';
      value_summary: string;
      visibility: 'full' | 'partial' | 'hidden';
      verified_status: 'self_declared' | 'evidence_attached' | 'tier1_verified' | 'disputed' | 'unknown';
      last_updated_by: 'proposer' | 'recipient' | 'system';
    }>;
    evidence_digest?: Array<{
      evidence_id: string;
      source: 'shared' | 'confidential';
      label: string;
      value_summary: string;
      visibility: 'full' | 'partial' | 'hidden';
    }>;
  };
  // Compatibility layer for existing UI consumers.
  generated_at?: string;
  recommendation?: 'High' | 'Medium' | 'Low';
  confidence_score?: number;
  similarity_score?: number;
  delta_characters?: number;
  confidentiality_spans?: number;
  executive_summary?: string;
  sections?: Array<{ key: string; heading: string; bullets: string[] }>;
  provider?: 'vertex' | 'mock';
  model?: string;
};

type ContractEvaluationResult = {
  provider: 'vertex' | 'mock';
  model: string;
  fallbackReason?: string | null;
  evaluation_provider?: 'vertex' | 'fallback';
  evaluation_model?: string;
  evaluation_provider_reason?: string | null;
  attempt_history?: Array<{
    attempt: number;
    provider: 'vertex' | 'mock';
    model: string | null;
    status: 'success' | 'failed';
    error_code?: string | null;
    reason_code?: string | null;
    retry_scheduled?: boolean;
  }>;
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
  summary: string;
  report: ContractEvaluationReport;
  debug?: {
    raw_model_text?: string;
    raw_model_text_length: number;
  };
};

type ProposalHeuristics = {
  completenessA: number;
  completenessB: number;
  confidenceCap: number;
  insufficient: boolean;
  missingHighImpactQuestionIds: string[];
  disputedQuestionIds: string[];
  confidenceReasons: string[];
};

type ComparisonHeuristics = {
  completenessA: number;
  completenessB: number;
  confidenceCap: number;
  insufficient: boolean;
  confidenceReasons: string[];
  similarityScore: number;
  deltaCharacters: number;
  confidentialitySpans: number;
};

type NormalizeOptions = {
  mode: 'proposal' | 'document_comparison';
  anchorContext?: {
    docAText: string;
    docBText: string;
    docASpans: Span[];
    docBSpans: Span[];
  };
};

type EvaluationTelemetry = {
  correlationId?: string;
  routeName?: string;
  entityId?: string;
  inputChars?: number;
  disableConfidentialLeakGuard?: boolean;
};

type CallVertexOptions = EvaluationTelemetry & {
  promptLabel: 'proposal' | 'document_comparison';
};

type ParseErrorKind =
  | 'json_parse_error'
  | 'schema_validation_error'
  | 'empty_output'
  | 'truncated_output'
  | 'confidential_leak_detected';

type JsonExtractionDiagnostics = {
  rawTextLength: number;
  hadJsonFence: boolean;
  extractionMode: 'raw' | 'json_fence' | 'first_last_brace' | 'none';
  parseErrorKind: ParseErrorKind | null;
  parseErrorMessage: string | null;
};

const MIN_DOCUMENT_COMPARISON_TEXT_LENGTH = 40;
const RAW_MODEL_OUTPUT_DEBUG_FLAG = 'EVAL_SAVE_RAW_MODEL_OUTPUT';
const MAX_DOCUMENT_COMPARISON_PROMPT_CHARS = 20000;
const MAX_DOCUMENT_EVIDENCE_CHUNKS = 50;
const MAX_EVIDENCE_CHUNK_TEXT_CHARS = 600;
const MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT = 5;
const MAX_DOCUMENT_COMPARISON_FLAGS = 8;
const MAX_DOCUMENT_COMPARISON_FOLLOWUPS = 10;
const VERTEX_FETCH_TIMEOUT_MS = 90000;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_FORMAT_OUTPUT_RETRIES = 1;
const MAX_SCHEMA_REPAIR_RETRIES = 1;

const CONTRACT_SYSTEM_PROMPT = `SYSTEM / DEVELOPER PROMPT — VertexGemini3Evaluator (GenerateContent)
You generate a structured evaluation report for a pre-qualification proposal.
You MUST use only the provided template, responses, and optional computedSignals.
You MUST NOT invent facts. If data is missing/ambiguous, say "unknown".

NON-NEGOTIABLE RULES
1) Evidence-only: Every finding/flag/recommendation/follow-up question MUST cite relevant question_id(s) or approved evidence anchors.
2) No hallucinations: Do not claim certifications, controls, revenue, pricing, or documents unless present in responses or computedSignals.
3) Visibility compliance:
   - If visibility="hidden": do NOT reveal the value; set detail_level="redacted" and use a generic description.
   - If visibility="partial": summarize without specific numbers/URLs; detail_level="partial".
   - If visibility="full": you may summarize normally; detail_level="full".
4) Use computedSignals when provided for overlaps/gates/contradictions. Do not recompute complex logic if not provided.
5) Output MUST be valid JSON only. No prose outside JSON.
6) Missing/ambiguous facts must be marked as unknown, never guessed.`;

const PROPOSAL_SCHEMA_DESCRIPTION = {
  template_id: 'string',
  template_name: 'string',
  generated_at_iso: 'string',
  parties: { a_label: 'string', b_label: 'string' },
  quality: {
    completeness_a: 0.0,
    completeness_b: 0.0,
    confidence_overall: 0.0,
    confidence_reasoning: ['string'],
    missing_high_impact_question_ids: ['string'],
    disputed_question_ids: ['string'],
  },
  summary: {
    overall_score_0_100: null,
    fit_level: 'high|medium|low|unknown',
    top_fit_reasons: [{ text: 'string', evidence_question_ids: ['string'] }],
    top_blockers: [{ text: 'string', evidence_question_ids: ['string'] }],
    next_actions: ['string'],
  },
  category_breakdown: [
    {
      category_key: 'string',
      name: 'string',
      weight: 0.0,
      score_0_100: null,
      confidence_0_1: 0.0,
      notes: ['string'],
      evidence_question_ids: ['string'],
    },
  ],
  gates: [{ gate_key: 'string', outcome: 'pass|fail|unknown', message: 'string', evidence_question_ids: ['string'] }],
  overlaps_and_constraints: [
    {
      key: 'string',
      outcome: 'pass|fail|unknown',
      short_explanation: 'string',
      evidence_question_ids: ['string'],
    },
  ],
  contradictions: [
    {
      key: 'string',
      severity: 'low|med|high',
      description: 'string',
      evidence_question_ids: ['string'],
    },
  ],
  flags: [
    {
      severity: 'low|med|high',
      type: 'security|privacy|ops|commercial|integrity|other',
      title: 'string',
      detail: 'string',
      detail_level: 'full|partial|redacted',
      evidence_question_ids: ['string'],
    },
  ],
  verification: {
    summary: {
      self_declared_count: 0,
      evidence_attached_count: 0,
      tier1_verified_count: 0,
      disputed_count: 0,
    },
    evidence_requested: [{ item: 'string', reason: 'string', related_question_ids: ['string'] }],
  },
  followup_questions: [
    {
      priority: 'high|med|low',
      to_party: 'a|b|both',
      question_text: 'string',
      why_this_matters: 'string',
      targets: { category_key: 'string', question_ids: ['string'] },
    },
  ],
  appendix: {
    field_digest: [
      {
        question_id: 'string',
        label: 'string',
        party: 'a|b',
        value_summary: 'string',
        visibility: 'full|partial|hidden',
        verified_status: 'self_declared|evidence_attached|tier1_verified|disputed|unknown',
        last_updated_by: 'proposer|recipient|system',
      },
    ],
  },
};

const DOC_COMPARISON_SCHEMA_EXTENSION = {
  note: 'Document comparison mode MAY include evidence_anchors arrays on evidence-carrying nodes.',
  evidence_anchor_shape: { doc: 'A|B', start: 0, end: 10 },
  constraints: [
    'evidence_anchors must point only to visible spans (never hidden spans).',
    'never quote hidden span text verbatim.',
  ],
};

const DOCUMENT_COMPARISON_SYSTEM_PROMPT = `SYSTEM / DEVELOPER PROMPT — VertexGemini3Evaluator (GenerateContent)
You generate a strict, structured evaluation report for document comparisons.
You MUST use only the provided shared_chunks, confidential_chunks, and computedSignals.
You MUST NOT invent facts. If data is missing/ambiguous, return unknown.

NON-NEGOTIABLE RULES
1) Evidence-only:
   - Every finding, blocker, contradiction, flag, and follow-up MUST cite evidence_ids.
   - Use only evidence_ids provided in the evidence map (for example: "shared:line_003", "conf:line_012").
2) No hallucinations:
   - Do not claim facts, numbers, obligations, or constraints not present in provided chunks/signals.
3) Confidentiality middleman model:
   - Confidential chunks are reasoning-only.
   - Shared/public report MUST NEVER quote or reproduce confidential text verbatim.
   - Shared/public report MUST NEVER disclose confidential numbers, identifiers, or emails.
   - If a conclusion depends on confidential context, describe it generically and use detail_level="redacted".
4) Visibility/allowlist compliance:
   - shared evidence may be summarized/quoted.
   - confidential evidence may only appear as evidence_id references with generic redacted wording.
5) Output MUST be valid JSON only. No prose outside JSON.
6) Always return every top-level key in the schema; arrays must exist (possibly empty).`;

const DOCUMENT_COMPARISON_REPORT_SCHEMA_DESCRIPTION = {
  template_id: 'document_comparison_v1',
  template_name: 'Document Comparison Evaluation',
  generated_at_iso: 'string',
  quality: {
    confidence_overall: 0.0,
    confidence_reasoning: ['string'],
    missing_high_impact_evidence_ids: ['string'],
  },
  summary: {
    fit_level: 'high|medium|low|unknown',
    top_fit_reasons: [{ text: 'string', evidence_ids: ['shared:line_001'] }],
    top_blockers: [{ text: 'string', evidence_ids: ['shared:line_001'] }],
    next_actions: ['string'],
  },
  category_breakdown: [
    {
      category_key: 'string',
      name: 'string',
      score_0_100: null,
      confidence_0_1: 0.0,
      notes: ['string'],
      evidence_ids: ['shared:line_001'],
    },
  ],
  contradictions: [
    { key: 'string', severity: 'low|med|high', description: 'string', evidence_ids: ['shared:line_001'] },
  ],
  flags: [
    {
      severity: 'low|med|high',
      type: 'security|privacy|ops|commercial|integrity|other',
      title: 'string',
      detail: 'string',
      detail_level: 'full|partial|redacted',
      evidence_ids: ['shared:line_001'],
    },
  ],
  followup_questions: [
    {
      priority: 'high|med|low',
      to_party: 'a|b|both',
      question_text: 'string',
      why_this_matters: 'string',
      targets: { category_key: 'string', evidence_ids: ['shared:line_001'] },
    },
  ],
  appendix: {
    evidence_digest: [
      {
        evidence_id: 'string',
        source: 'shared|confidential',
        label: 'string',
        value_summary: 'string',
        visibility: 'full|partial|hidden',
      },
    ],
  },
};

const DOCUMENT_COMPARISON_REQUIRED_TOP_LEVEL_KEYS = [
  'template_id',
  'template_name',
  'generated_at_iso',
  'quality',
  'summary',
  'category_breakdown',
  'contradictions',
  'flags',
  'followup_questions',
  'appendix',
] as const;

const DOCUMENT_COMPARISON_REQUIRED_QUALITY_KEYS = [
  'confidence_overall',
  'confidence_reasoning',
  'missing_high_impact_evidence_ids',
] as const;

const DOCUMENT_COMPARISON_REQUIRED_SUMMARY_KEYS = [
  'fit_level',
  'top_fit_reasons',
  'top_blockers',
  'next_actions',
] as const;

const DOCUMENT_COMPARISON_REQUIRED_APPENDIX_KEYS = ['evidence_digest'] as const;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function clamp0100(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function shouldPersistRawModelOutput() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return asText(process.env[RAW_MODEL_OUTPUT_DEBUG_FLAG]) === '1';
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

function invalidModelOutput(message: string, extra: Record<string, unknown> = {}) {
  return new ApiError(502, 'invalid_model_output', message, extra);
}

function isInvalidModelOutputError(error: unknown) {
  return asLower((error as any)?.code) === 'invalid_model_output';
}

function requireObject(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidModelOutput(`${path} must be an object`);
  }
  return value as Record<string, any>;
}

function requireArray(value: unknown, path: string): any[] {
  if (!Array.isArray(value)) {
    throw invalidModelOutput(`${path} must be an array`);
  }
  return value;
}

function requireString(value: unknown, path: string) {
  const text = asText(value);
  if (!text) {
    throw invalidModelOutput(`${path} must be a non-empty string`);
  }
  return text;
}

function optionalString(value: unknown) {
  return asText(value);
}

function requireEnum<T extends string>(value: unknown, allowed: T[], path: string): T {
  const normalized = asLower(value) as T;
  if (!allowed.includes(normalized)) {
    throw invalidModelOutput(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

function requireNumber(value: unknown, path: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw invalidModelOutput(`${path} must be a finite number`);
  }
  return numeric;
}

function optionalNumberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const normalized = asText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function normalizeChunkText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitIntoEvidenceSegments(text: string) {
  const normalized = String(text || '').replace(/\r/g, '\n').trim();
  if (!normalized) return [] as string[];

  const lineSegments = normalized
    .split(/\n+/g)
    .map((entry) => normalizeChunkText(entry))
    .filter(Boolean);
  if (lineSegments.length > 1) {
    return lineSegments;
  }

  const sentenceSegments = normalized
    .split(/(?<=[.!?])\s+/g)
    .map((entry) => normalizeChunkText(entry))
    .filter(Boolean);
  if (sentenceSegments.length > 0) {
    return sentenceSegments;
  }

  return [normalizeChunkText(normalized)];
}

function buildEvidenceChunks(text: string, source: 'shared' | 'confidential') {
  const segments = splitIntoEvidenceSegments(text);
  const chunks: DocumentEvidenceChunk[] = [];

  segments.forEach((segment) => {
    if (chunks.length >= MAX_DOCUMENT_EVIDENCE_CHUNKS) {
      return;
    }
    const index = String(chunks.length + 1).padStart(3, '0');
    const prefix = source === 'shared' ? 'shared' : 'conf';
    const chunkText = segment.length > MAX_EVIDENCE_CHUNK_TEXT_CHARS
      ? `${segment.slice(0, MAX_EVIDENCE_CHUNK_TEXT_CHARS)} [TRUNCATED]`
      : segment;
    chunks.push({
      evidence_id: `${prefix}:line_${index}`,
      source,
      label: `${source === 'shared' ? 'Shared' : 'Confidential'} line ${index}`,
      text: chunkText,
      visibility: source === 'shared' ? 'full' : 'hidden',
    });
  });

  if (!chunks.length && normalizeChunkText(text)) {
    chunks.push({
      evidence_id: source === 'shared' ? 'shared:line_001' : 'conf:line_001',
      source,
      label: source === 'shared' ? 'Shared line 001' : 'Confidential line 001',
      text: normalizeChunkText(text).slice(0, MAX_EVIDENCE_CHUNK_TEXT_CHARS),
      visibility: source === 'shared' ? 'full' : 'hidden',
    });
  }

  return chunks;
}

function fitEvidenceChunksToPrompt(chunks: DocumentEvidenceChunk[], maxChars: number) {
  const output: DocumentEvidenceChunk[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const chunk of chunks) {
    if (output.length >= MAX_DOCUMENT_EVIDENCE_CHUNKS) {
      truncated = true;
      break;
    }

    const remaining = maxChars - usedChars;
    if (remaining <= 40) {
      truncated = true;
      break;
    }

    let text = normalizeChunkText(chunk.text);
    if (!text) {
      continue;
    }
    if (text.length > remaining) {
      text = `${text.slice(0, Math.max(30, remaining - 14)).trim()} [TRUNCATED]`;
      truncated = true;
    }
    usedChars += text.length;
    output.push({
      ...chunk,
      text,
    });
  }

  return {
    chunks: output,
    truncated,
    promptChars: usedChars,
    originalCount: chunks.length,
  };
}

function buildDocumentComparisonEvidenceMap(input: ComparisonInput) {
  const maskedShared = maskTextBySpans(input.docBText, input.docBSpans || []);
  const maskedConfidential = maskTextBySpans(input.docAText, input.docASpans || []);
  const sharedBase = buildEvidenceChunks(maskedShared, 'shared');
  const confidentialBase = buildEvidenceChunks(maskedConfidential, 'confidential');
  const sharedPrompt = fitEvidenceChunksToPrompt(sharedBase, MAX_DOCUMENT_COMPARISON_PROMPT_CHARS);
  const confidentialPrompt = fitEvidenceChunksToPrompt(confidentialBase, MAX_DOCUMENT_COMPARISON_PROMPT_CHARS);

  return {
    shared_chunks: sharedPrompt.chunks,
    confidential_chunks: confidentialPrompt.chunks,
    metadata: {
      shared_original_count: sharedPrompt.originalCount,
      shared_prompt_count: sharedPrompt.chunks.length,
      shared_prompt_chars: sharedPrompt.promptChars,
      shared_truncated: sharedPrompt.truncated,
      confidential_original_count: confidentialPrompt.originalCount,
      confidential_prompt_count: confidentialPrompt.chunks.length,
      confidential_prompt_chars: confidentialPrompt.promptChars,
      confidential_truncated: confidentialPrompt.truncated,
    },
  };
}

function hasJsonFence(text: string) {
  return /```(?:json)?\s*[\s\S]*?```/i.test(String(text || ''));
}

function extractJsonCandidate(text: string) {
  const raw = String(text || '').trim();
  const hadJsonFence = hasJsonFence(raw);
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const inner = String(fencedMatch[1] || '').trim();
    if (inner) {
      return {
        candidate: inner,
        hadJsonFence,
        extractionMode: 'json_fence' as const,
      };
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = raw.slice(firstBrace, lastBrace + 1).trim();
    if (slice) {
      return {
        candidate: slice,
        hadJsonFence,
        extractionMode: (firstBrace === 0 && lastBrace === raw.length - 1 ? 'raw' : 'first_last_brace') as
          | 'raw'
          | 'first_last_brace',
      };
    }
  }

  return {
    candidate: raw,
    hadJsonFence,
    extractionMode: (raw ? 'raw' : 'none') as 'raw' | 'none',
  };
}

function parseModelJsonWithDiagnostics(text: string): { parsed: unknown | null; diagnostics: JsonExtractionDiagnostics } {
  const raw = String(text || '');
  const { candidate, hadJsonFence, extractionMode } = extractJsonCandidate(raw);
  const rawTextLength = raw.length;
  if (!candidate) {
    return {
      parsed: null,
      diagnostics: {
        rawTextLength,
        hadJsonFence,
        extractionMode,
        parseErrorKind: 'empty_output',
        parseErrorMessage: 'Model output was empty after extraction.',
      },
    };
  }

  try {
    return {
      parsed: JSON.parse(candidate),
      diagnostics: {
        rawTextLength,
        hadJsonFence,
        extractionMode,
        parseErrorKind: null,
        parseErrorMessage: null,
      },
    };
  } catch (error: any) {
    const parseErrorKind: ParseErrorKind = isLikelyTruncatedModelOutput(candidate) ? 'truncated_output' : 'json_parse_error';
    return {
      parsed: null,
      diagnostics: {
        rawTextLength,
        hadJsonFence,
        extractionMode,
        parseErrorKind,
        parseErrorMessage: asText(error?.message) || 'JSON.parse failed',
      },
    };
  }
}

function parseModelJson(text: string) {
  return parseModelJsonWithDiagnostics(text).parsed;
}

function isLikelyTruncatedModelOutput(text: string) {
  const raw = String(text || '').trim();
  if (!raw) {
    return false;
  }
  const openCurly = (raw.match(/\{/g) || []).length;
  const closeCurly = (raw.match(/\}/g) || []).length;
  const openSquare = (raw.match(/\[/g) || []).length;
  const closeSquare = (raw.match(/\]/g) || []).length;
  return openCurly > closeCurly || openSquare > closeSquare;
}

function normalizeForComparison(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectStringValues(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 10) {
    return output;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length > 0) {
      output.push(text);
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.slice(0, 250).forEach((entry) => collectStringValues(entry, output, depth + 1));
    return output;
  }

  if (!value || typeof value !== 'object') {
    return output;
  }

  Object.values(value as Record<string, unknown>)
    .slice(0, 250)
    .forEach((entry) => collectStringValues(entry, output, depth + 1));
  return output;
}

function buildSharedPhraseCandidates(sharedText: string) {
  const normalized = String(sharedText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [] as string[];
  }

  const candidates = new Set<string>();
  normalized
    .split(/[\n\r.;:!?]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 18)
    .slice(0, 16)
    .forEach((entry) => {
      candidates.add(entry.length > 110 ? entry.slice(0, 110).trim() : entry);
    });

  const words = normalized.split(/\s+/g).filter(Boolean);
  for (let index = 0; index + 4 < words.length && candidates.size < 32; index += 2) {
    const phrase = words.slice(index, index + 5).join(' ').trim();
    if (phrase.length >= 24) {
      candidates.add(phrase);
    }
  }

  return [...candidates].slice(0, 32);
}

function hasSharedPhraseReference(report: unknown, sharedText: string) {
  const sharedCandidates = buildSharedPhraseCandidates(sharedText)
    .map((entry) => normalizeForComparison(entry))
    .filter(Boolean);
  if (!sharedCandidates.length) {
    return false;
  }

  const reportText = normalizeForComparison(collectStringValues(report).join(' '));
  if (!reportText) {
    return false;
  }

  return sharedCandidates.some((candidate) => reportText.includes(candidate));
}

function hasSharedEvidenceIdReference(report: unknown) {
  const reportText = normalizeForComparison(collectStringValues(report).join(' '));
  if (!reportText) {
    return false;
  }
  return reportText.includes(normalizeForComparison('shared:line_'));
}

function ensureDocumentComparisonSpecificity(report: ContractEvaluationReport, sharedText: string) {
  const sharedLength = String(sharedText || '').trim().length;
  if (sharedLength < 20) {
    return false;
  }
  if (hasSharedPhraseReference(report, sharedText) || hasSharedEvidenceIdReference(report)) {
    return true;
  }
  const sections = Array.isArray(report.sections) ? [...report.sections] : [];
  const hasGroundingWarning = sections.some((section) =>
    String(section?.key || '')
      .trim()
      .toLowerCase()
      .includes('grounding_warning'),
  );
  if (!hasGroundingWarning) {
    sections.push({
      key: 'grounding_warning',
      heading: 'Grounding Warning',
      bullets: ['Model output had limited direct shared-text references; treat as low-confidence guidance.'],
    });
  }
  report.sections = sections;
  return false;
}

function tokenize(input: string) {
  return new Set(
    String(input || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((entry) => entry.length >= 3),
  );
}

function computeSimilarity(docAText: string, docBText: string) {
  const tokensA = tokenize(docAText);
  const tokensB = tokenize(docBText);
  const intersection = new Set([...tokensA].filter((token) => tokensB.has(token)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  return clamp0100(Math.round((intersection.size / union.size) * 100));
}

function toRecommendation(fitLevel: 'high' | 'medium' | 'low' | 'unknown'): 'High' | 'Medium' | 'Low' {
  if (fitLevel === 'high') return 'High';
  if (fitLevel === 'medium') return 'Medium';
  return 'Low';
}

function normalizeHighlightLevel(level: unknown) {
  const normalized = asLower(level);
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

function clampSpanBoundary(raw: unknown, textLength: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(Math.floor(numeric), textLength));
}

function normalizeSpans(spans: unknown, text: string): Span[] {
  if (!Array.isArray(spans)) return [];
  const textLength = String(text || '').length;

  const normalized = spans
    .map((span) => {
      const start = clampSpanBoundary(span?.start, textLength);
      const end = clampSpanBoundary(span?.end, textLength);
      const level = normalizeHighlightLevel(span?.level);
      if (start === null || end === null || end <= start || !level) return null;
      return { start, end, level };
    })
    .filter((span): span is Span => Boolean(span))
    .sort((left, right) => left.start - right.start);

  const merged: Span[] = [];
  normalized.forEach((span) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      return;
    }

    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      return;
    }

    merged.push({ ...span });
  });

  return merged;
}

function spanOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function overlapsHiddenSpans(start: number, end: number, spans: Span[]) {
  return spans.some((span) => spanOverlap(start, end, span.start, span.end));
}

function stripHiddenSpans(text: string, spans: Span[]) {
  if (!text) return '';
  const normalized = normalizeSpans(spans, text);
  if (!normalized.length) return text;

  let cursor = 0;
  const parts: string[] = [];
  normalized.forEach((span) => {
    if (span.start > cursor) {
      parts.push(text.slice(cursor, span.start));
    }
    parts.push(' ');
    cursor = span.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function maskTextBySpans(text: string, spans: Span[]) {
  if (!text) return '';
  const normalizedSpans = normalizeSpans(spans || [], text);
  if (!normalizedSpans.length) return text;

  let cursor = 0;
  let hiddenIndex = 1;
  const parts: string[] = [];

  normalizedSpans.forEach((span) => {
    if (span.start > cursor) {
      parts.push(text.slice(cursor, span.start));
    }
    parts.push(`[HIDDEN_${hiddenIndex}]`);
    hiddenIndex += 1;
    cursor = span.end;
  });

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.join('');
}

function extractStringValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectHiddenResponseSnippets(responses: ProposalResponseInput[]) {
  return dedupeStrings(
    responses
      .filter((row) => row.visibility === 'hidden')
      .map((row) => extractStringValue(row.value).trim())
      .filter((value) => value.length >= 4)
      .slice(0, 60),
  );
}

function collectHiddenSpanSnippets(text: string, spans: Span[]) {
  const normalized = normalizeSpans(spans || [], text);
  return dedupeStrings(
    normalized
      .map((span) => text.slice(span.start, span.end).trim())
      .filter((snippet) => snippet.length >= 4)
      .slice(0, 60),
  );
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactHiddenSnippets(text: string, snippets: string[]) {
  let output = String(text || '');
  snippets.forEach((snippet) => {
    const escaped = escapeRegex(snippet);
    if (!escaped) return;
    output = output.replace(new RegExp(escaped, 'gi'), '[REDACTED]');
  });
  return output;
}

function sanitizeDeep(value: any, snippets: string[]): any {
  if (typeof value === 'string') {
    return redactHiddenSnippets(value, snippets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDeep(entry, snippets));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeDeep(entry, snippets)]),
    );
  }

  return value;
}

function containsHiddenSnippet(value: any, snippets: string[]) {
  if (!snippets.length) return false;
  const serialized = JSON.stringify(value || {}).toLowerCase();
  return snippets.some((snippet) => serialized.includes(snippet.toLowerCase()));
}

function normalizeVisibility(value: unknown): 'full' | 'partial' | 'hidden' {
  const normalized = asLower(value);
  if (normalized === 'hidden') return 'hidden';
  if (normalized === 'partial') return 'partial';
  return 'full';
}

function normalizeVerifiedStatus(
  value: unknown,
): 'self_declared' | 'evidence_attached' | 'tier1_verified' | 'disputed' | 'unknown' {
  const normalized = asLower(value);
  if (
    normalized === 'self_declared' ||
    normalized === 'evidence_attached' ||
    normalized === 'tier1_verified' ||
    normalized === 'disputed' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  return 'unknown';
}

function normalizeUpdatedBy(value: unknown): 'proposer' | 'recipient' | 'system' {
  const normalized = asLower(value);
  if (normalized === 'recipient') return 'recipient';
  if (normalized === 'system') return 'system';
  return 'proposer';
}

function isAnsweredResponse(row: ProposalResponseInput) {
  if (row.valueType === 'range') {
    return Boolean(asText(row.rangeMin) || asText(row.rangeMax));
  }

  const value = row.value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

function responseValueSummary(row: ProposalResponseInput) {
  if (row.visibility === 'hidden') {
    return '[REDACTED]';
  }

  if (row.valueType === 'range') {
    const min = asText(row.rangeMin);
    const max = asText(row.rangeMax);
    if (min || max) {
      return `${min || 'min?'} to ${max || 'max?'}`;
    }
    return 'unknown';
  }

  const value = extractStringValue(row.value).replace(/\s+/g, ' ').trim();
  if (!value) return 'unknown';
  if (row.visibility === 'partial') {
    return value.slice(0, 60);
  }
  return value.slice(0, 120);
}

function buildProposalHeuristics(input: ProposalInput): ProposalHeuristics {
  const responsesA = input.responses.filter((row) => row.party === 'a');
  const responsesB = input.responses.filter((row) => row.party === 'b');

  const requiredA = responsesA.filter((row) => row.required);
  const requiredB = responsesB.filter((row) => row.required);

  const denominatorA = requiredA.length > 0 ? requiredA : responsesA;
  const denominatorB = requiredB.length > 0 ? requiredB : responsesB;

  const answeredA = denominatorA.filter(isAnsweredResponse).length;
  const answeredB = denominatorB.filter(isAnsweredResponse).length;

  const completenessA = denominatorA.length > 0 ? answeredA / denominatorA.length : 0;
  const completenessB = denominatorB.length > 0 ? answeredB / denominatorB.length : 0;

  const missingHighImpactQuestionIds = dedupeStrings(
    [...requiredA, ...requiredB]
      .filter((row) => !isAnsweredResponse(row))
      .map((row) => row.questionId)
      .slice(0, 20),
  );

  const disputedQuestionIds = dedupeStrings(
    input.responses
      .filter((row) => row.verifiedStatus === 'disputed')
      .map((row) => row.questionId)
      .slice(0, 20),
  );

  const visibleCharCount = input.responses
    .filter((row) => row.visibility !== 'hidden' && isAnsweredResponse(row))
    .map((row) => responseValueSummary(row))
    .join(' ')
    .length;

  const answeredTotal = input.responses.filter(isAnsweredResponse).length;
  const requiredTotal = requiredA.length + requiredB.length;
  const missingRequiredRatio = requiredTotal > 0 ? missingHighImpactQuestionIds.length / requiredTotal : 0;
  const disputedRatio = input.responses.length > 0 ? disputedQuestionIds.length / input.responses.length : 0;

  const insufficient = answeredTotal < 2 || visibleCharCount < 120;
  const rawConfidenceCap = 0.92 - missingRequiredRatio * 0.55 - disputedRatio * 0.25;
  const confidenceCap = clamp01(insufficient ? Math.min(rawConfidenceCap, 0.3) : rawConfidenceCap);

  const confidenceReasons: string[] = [];
  if (insufficient) {
    confidenceReasons.push('Input coverage is sparse; confidence is capped low.');
  }
  if (missingHighImpactQuestionIds.length > 0) {
    confidenceReasons.push('Required high-impact questions are unanswered.');
  }
  if (disputedQuestionIds.length > 0) {
    confidenceReasons.push('Disputed responses reduce confidence.');
  }

  return {
    completenessA: clamp01(completenessA),
    completenessB: clamp01(completenessB),
    confidenceCap: clamp01(confidenceCap),
    insufficient,
    missingHighImpactQuestionIds,
    disputedQuestionIds,
    confidenceReasons: confidenceReasons.length > 0 ? confidenceReasons : ['Confidence derived from response coverage.'],
  };
}

function countWords(text: string) {
  return String(text || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
}

function buildComparisonHeuristics(input: ComparisonInput): ComparisonHeuristics {
  const visibleA = stripHiddenSpans(input.docAText, input.docASpans);
  const visibleB = stripHiddenSpans(input.docBText, input.docBSpans);

  const wordsA = countWords(visibleA);
  const wordsB = countWords(visibleB);

  const completenessA = clamp01(wordsA / 120);
  const completenessB = clamp01(wordsB / 120);

  const similarity = computeSimilarity(visibleA, visibleB);
  const deltaCharacters = Math.abs(String(input.docAText || '').length - String(input.docBText || '').length);
  const confidentialitySpans = normalizeSpans(input.docASpans || [], input.docAText).length +
    normalizeSpans(input.docBSpans || [], input.docBText).length;

  const insufficient = wordsA < 20 || wordsB < 20 || wordsA + wordsB < 80;
  const rawConfidenceCap = 0.88 - (insufficient ? 0.5 : 0) - (confidentialitySpans > 0 ? 0.08 : 0);

  const confidenceReasons: string[] = [];
  if (insufficient) {
    confidenceReasons.push('Documents are too short for high-confidence evaluation.');
  }
  if (confidentialitySpans > 0) {
    confidenceReasons.push('Confidential spans reduce available evidence.');
  }

  return {
    completenessA,
    completenessB,
    confidenceCap: clamp01(rawConfidenceCap),
    insufficient,
    confidenceReasons: confidenceReasons.length > 0 ? confidenceReasons : ['Confidence derived from visible document coverage.'],
    similarityScore: similarity,
    deltaCharacters,
    confidentialitySpans,
  };
}

function normalizeEvidenceQuestionIds(value: unknown, path: string) {
  const list = requireArray(value, path);
  return dedupeStrings(list.map((entry) => requireString(entry, `${path}[]`)).slice(0, 25));
}

function normalizeEvidenceAnchors(value: unknown, options: NormalizeOptions, path: string): EvidenceAnchor[] {
  if (value === undefined || value === null) {
    return [];
  }

  const anchors = requireArray(value, path)
    .map((raw, index): EvidenceAnchor | null => {
      const row = requireObject(raw, `${path}[${index}]`);
      const doc: EvidenceAnchor['doc'] =
        requireEnum(row.doc, ['a', 'b'], `${path}[${index}].doc`) === 'a' ? 'A' : 'B';
      const start = Math.floor(requireNumber(row.start, `${path}[${index}].start`));
      const end = Math.floor(requireNumber(row.end, `${path}[${index}].end`));

      if (end <= start) {
        return null;
      }

      if (options.mode !== 'document_comparison' || !options.anchorContext) {
        return { doc, start, end };
      }

      const text = doc === 'A' ? options.anchorContext.docAText : options.anchorContext.docBText;
      const spans = doc === 'A' ? options.anchorContext.docASpans : options.anchorContext.docBSpans;
      const boundedStart = Math.max(0, Math.min(start, text.length));
      const boundedEnd = Math.max(0, Math.min(end, text.length));
      if (boundedEnd <= boundedStart) {
        return null;
      }

      if (overlapsHiddenSpans(boundedStart, boundedEnd, spans)) {
        return null;
      }

      return {
        doc,
        start: boundedStart,
        end: boundedEnd,
      };
    })
    .filter((anchor): anchor is EvidenceAnchor => Boolean(anchor))
    .slice(0, 40);

  return anchors;
}

function normalizeEvidenceEntry(
  value: unknown,
  options: NormalizeOptions,
  path: string,
  requireEvidence = true,
) {
  const row = requireObject(value, path);
  const text = requireString(row.text, `${path}.text`);
  const evidenceQuestionIds = normalizeEvidenceQuestionIds(
    row.evidence_question_ids ?? [],
    `${path}.evidence_question_ids`,
  );
  const evidenceAnchors = normalizeEvidenceAnchors(row.evidence_anchors, options, `${path}.evidence_anchors`);

  if (requireEvidence && evidenceQuestionIds.length === 0 && evidenceAnchors.length === 0) {
    throw invalidModelOutput(`${path} must include evidence_question_ids and/or evidence_anchors`);
  }

  const normalized: any = {
    text,
    evidence_question_ids: evidenceQuestionIds,
  };
  if (evidenceAnchors.length > 0) {
    normalized.evidence_anchors = evidenceAnchors;
  }

  return normalized;
}

function normalizeContractReport(raw: unknown, options: NormalizeOptions): ContractEvaluationReport {
  const root = requireObject(raw, 'report');

  const qualityRaw = requireObject(root.quality, 'quality');
  const summaryRaw = requireObject(root.summary, 'summary');
  const verificationRaw = requireObject(root.verification, 'verification');
  const verificationSummaryRaw = requireObject(verificationRaw.summary, 'verification.summary');
  const appendixRaw = requireObject(root.appendix, 'appendix');

  const report: ContractEvaluationReport = {
    template_id: requireString(root.template_id, 'template_id'),
    template_name: requireString(root.template_name, 'template_name'),
    generated_at_iso: requireString(root.generated_at_iso, 'generated_at_iso'),
    parties: {
      a_label: requireString(requireObject(root.parties, 'parties').a_label, 'parties.a_label'),
      b_label: requireString(requireObject(root.parties, 'parties').b_label, 'parties.b_label'),
    },
    quality: {
      completeness_a: clamp01(requireNumber(qualityRaw.completeness_a, 'quality.completeness_a')),
      completeness_b: clamp01(requireNumber(qualityRaw.completeness_b, 'quality.completeness_b')),
      confidence_overall: clamp01(requireNumber(qualityRaw.confidence_overall, 'quality.confidence_overall')),
      confidence_reasoning: dedupeStrings(
        requireArray(qualityRaw.confidence_reasoning, 'quality.confidence_reasoning')
          .map((entry) => requireString(entry, 'quality.confidence_reasoning[]'))
          .slice(0, 30),
      ),
      missing_high_impact_question_ids: dedupeStrings(
        requireArray(qualityRaw.missing_high_impact_question_ids, 'quality.missing_high_impact_question_ids')
          .map((entry) => requireString(entry, 'quality.missing_high_impact_question_ids[]'))
          .slice(0, 40),
      ),
      disputed_question_ids: dedupeStrings(
        requireArray(qualityRaw.disputed_question_ids, 'quality.disputed_question_ids')
          .map((entry) => requireString(entry, 'quality.disputed_question_ids[]'))
          .slice(0, 40),
      ),
    },
    summary: {
      overall_score_0_100: (() => {
        const value = optionalNumberOrNull(summaryRaw.overall_score_0_100);
        if (value === null) return null;
        return clamp0100(value);
      })(),
      fit_level: requireEnum(summaryRaw.fit_level, ['high', 'medium', 'low', 'unknown'], 'summary.fit_level'),
      top_fit_reasons: requireArray(summaryRaw.top_fit_reasons, 'summary.top_fit_reasons')
        .map((entry, index) =>
          normalizeEvidenceEntry(entry, options, `summary.top_fit_reasons[${index}]`),
        )
        .slice(0, 12),
      top_blockers: requireArray(summaryRaw.top_blockers, 'summary.top_blockers')
        .map((entry, index) =>
          normalizeEvidenceEntry(entry, options, `summary.top_blockers[${index}]`),
        )
        .slice(0, 12),
      next_actions: dedupeStrings(
        requireArray(summaryRaw.next_actions, 'summary.next_actions')
          .map((entry) => requireString(entry, 'summary.next_actions[]'))
          .slice(0, 20),
      ),
    },
    category_breakdown: requireArray(root.category_breakdown, 'category_breakdown')
      .map((entry, index) => {
        const row = requireObject(entry, `category_breakdown[${index}]`);
        const normalized: any = {
          category_key: requireString(row.category_key, `category_breakdown[${index}].category_key`),
          name: requireString(row.name, `category_breakdown[${index}].name`),
          weight: clamp01(requireNumber(row.weight, `category_breakdown[${index}].weight`)),
          score_0_100: (() => {
            const value = optionalNumberOrNull(row.score_0_100);
            if (value === null) return null;
            return clamp0100(value);
          })(),
          confidence_0_1: clamp01(requireNumber(row.confidence_0_1, `category_breakdown[${index}].confidence_0_1`)),
          notes: dedupeStrings(
            requireArray(row.notes, `category_breakdown[${index}].notes`)
              .map((note) => requireString(note, `category_breakdown[${index}].notes[]`))
              .slice(0, 12),
          ),
          evidence_question_ids: normalizeEvidenceQuestionIds(
            row.evidence_question_ids,
            `category_breakdown[${index}].evidence_question_ids`,
          ),
        };
        const anchors = normalizeEvidenceAnchors(
          row.evidence_anchors,
          options,
          `category_breakdown[${index}].evidence_anchors`,
        );
        if (anchors.length > 0) {
          normalized.evidence_anchors = anchors;
        }
        return normalized;
      })
      .slice(0, 30),
    gates: requireArray(root.gates, 'gates')
      .map((entry, index) => {
        const row = requireObject(entry, `gates[${index}]`);
        const normalized: any = {
          gate_key: requireString(row.gate_key, `gates[${index}].gate_key`),
          outcome: requireEnum(row.outcome, ['pass', 'fail', 'unknown'], `gates[${index}].outcome`),
          message: requireString(row.message, `gates[${index}].message`),
          evidence_question_ids: normalizeEvidenceQuestionIds(
            row.evidence_question_ids,
            `gates[${index}].evidence_question_ids`,
          ),
        };
        const anchors = normalizeEvidenceAnchors(row.evidence_anchors, options, `gates[${index}].evidence_anchors`);
        if (anchors.length > 0) {
          normalized.evidence_anchors = anchors;
        }
        return normalized;
      })
      .slice(0, 20),
    overlaps_and_constraints: requireArray(root.overlaps_and_constraints, 'overlaps_and_constraints')
      .map((entry, index) => {
        const row = requireObject(entry, `overlaps_and_constraints[${index}]`);
        const normalized: any = {
          key: requireString(row.key, `overlaps_and_constraints[${index}].key`),
          outcome: requireEnum(
            row.outcome,
            ['pass', 'fail', 'unknown'],
            `overlaps_and_constraints[${index}].outcome`,
          ),
          short_explanation: requireString(
            row.short_explanation,
            `overlaps_and_constraints[${index}].short_explanation`,
          ),
          evidence_question_ids: normalizeEvidenceQuestionIds(
            row.evidence_question_ids,
            `overlaps_and_constraints[${index}].evidence_question_ids`,
          ),
        };
        const anchors = normalizeEvidenceAnchors(
          row.evidence_anchors,
          options,
          `overlaps_and_constraints[${index}].evidence_anchors`,
        );
        if (anchors.length > 0) {
          normalized.evidence_anchors = anchors;
        }
        return normalized;
      })
      .slice(0, 20),
    contradictions: requireArray(root.contradictions, 'contradictions')
      .map((entry, index) => {
        const row = requireObject(entry, `contradictions[${index}]`);
        const normalized: any = {
          key: requireString(row.key, `contradictions[${index}].key`),
          severity: requireEnum(row.severity, ['low', 'med', 'high'], `contradictions[${index}].severity`),
          description: requireString(row.description, `contradictions[${index}].description`),
          evidence_question_ids: normalizeEvidenceQuestionIds(
            row.evidence_question_ids,
            `contradictions[${index}].evidence_question_ids`,
          ),
        };
        const anchors = normalizeEvidenceAnchors(
          row.evidence_anchors,
          options,
          `contradictions[${index}].evidence_anchors`,
        );
        if (anchors.length > 0) {
          normalized.evidence_anchors = anchors;
        }
        return normalized;
      })
      .slice(0, 25),
    flags: requireArray(root.flags, 'flags')
      .map((entry, index) => {
        const row = requireObject(entry, `flags[${index}]`);
        const normalized: any = {
          severity: requireEnum(row.severity, ['low', 'med', 'high'], `flags[${index}].severity`),
          type: requireEnum(
            row.type,
            ['security', 'privacy', 'ops', 'commercial', 'integrity', 'other'],
            `flags[${index}].type`,
          ),
          title: requireString(row.title, `flags[${index}].title`),
          detail: requireString(row.detail, `flags[${index}].detail`),
          detail_level: requireEnum(
            row.detail_level,
            ['full', 'partial', 'redacted'],
            `flags[${index}].detail_level`,
          ),
          evidence_question_ids: normalizeEvidenceQuestionIds(
            row.evidence_question_ids,
            `flags[${index}].evidence_question_ids`,
          ),
        };
        const anchors = normalizeEvidenceAnchors(row.evidence_anchors, options, `flags[${index}].evidence_anchors`);
        if (anchors.length > 0) {
          normalized.evidence_anchors = anchors;
        }
        return normalized;
      })
      .slice(0, 12),
    verification: {
      summary: {
        self_declared_count: Math.max(
          0,
          Math.floor(requireNumber(verificationSummaryRaw.self_declared_count, 'verification.summary.self_declared_count')),
        ),
        evidence_attached_count: Math.max(
          0,
          Math.floor(
            requireNumber(
              verificationSummaryRaw.evidence_attached_count,
              'verification.summary.evidence_attached_count',
            ),
          ),
        ),
        tier1_verified_count: Math.max(
          0,
          Math.floor(
            requireNumber(verificationSummaryRaw.tier1_verified_count, 'verification.summary.tier1_verified_count'),
          ),
        ),
        disputed_count: Math.max(
          0,
          Math.floor(requireNumber(verificationSummaryRaw.disputed_count, 'verification.summary.disputed_count')),
        ),
      },
      evidence_requested: requireArray(verificationRaw.evidence_requested, 'verification.evidence_requested')
        .map((entry, index) => {
          const row = requireObject(entry, `verification.evidence_requested[${index}]`);
          const normalized: any = {
            item: requireString(row.item, `verification.evidence_requested[${index}].item`),
            reason: requireString(row.reason, `verification.evidence_requested[${index}].reason`),
            related_question_ids: normalizeEvidenceQuestionIds(
              row.related_question_ids,
              `verification.evidence_requested[${index}].related_question_ids`,
            ),
          };
          const anchors = normalizeEvidenceAnchors(
            row.evidence_anchors,
            options,
            `verification.evidence_requested[${index}].evidence_anchors`,
          );
          if (anchors.length > 0) {
            normalized.evidence_anchors = anchors;
          }
          return normalized;
        })
        .slice(0, 20),
    },
    followup_questions: requireArray(root.followup_questions, 'followup_questions')
      .map((entry, index) => {
        const row = requireObject(entry, `followup_questions[${index}]`);
        const targets = requireObject(row.targets, `followup_questions[${index}].targets`);
        const normalizedTargets: any = {
          category_key: requireString(targets.category_key, `followup_questions[${index}].targets.category_key`),
          question_ids: normalizeEvidenceQuestionIds(
            targets.question_ids,
            `followup_questions[${index}].targets.question_ids`,
          ),
        };
        const targetAnchors = normalizeEvidenceAnchors(
          targets.evidence_anchors,
          options,
          `followup_questions[${index}].targets.evidence_anchors`,
        );
        if (targetAnchors.length > 0) {
          normalizedTargets.evidence_anchors = targetAnchors;
        }
        return {
          priority: requireEnum(row.priority, ['high', 'med', 'low'], `followup_questions[${index}].priority`),
          to_party: requireEnum(row.to_party, ['a', 'b', 'both'], `followup_questions[${index}].to_party`),
          question_text: requireString(row.question_text, `followup_questions[${index}].question_text`),
          why_this_matters: requireString(
            row.why_this_matters,
            `followup_questions[${index}].why_this_matters`,
          ),
          targets: normalizedTargets,
        };
      })
      .slice(0, 20),
    appendix: {
      field_digest: requireArray(appendixRaw.field_digest, 'appendix.field_digest')
        .map((entry, index) => {
          const row = requireObject(entry, `appendix.field_digest[${index}]`);
          return {
            question_id: requireString(row.question_id, `appendix.field_digest[${index}].question_id`),
            label: requireString(row.label, `appendix.field_digest[${index}].label`),
            party: requireEnum(row.party, ['a', 'b'], `appendix.field_digest[${index}].party`),
            value_summary: requireString(row.value_summary, `appendix.field_digest[${index}].value_summary`),
            visibility: requireEnum(
              row.visibility,
              ['full', 'partial', 'hidden'],
              `appendix.field_digest[${index}].visibility`,
            ),
            verified_status: requireEnum(
              row.verified_status,
              ['self_declared', 'evidence_attached', 'tier1_verified', 'disputed', 'unknown'],
              `appendix.field_digest[${index}].verified_status`,
            ),
            last_updated_by: requireEnum(
              row.last_updated_by,
              ['proposer', 'recipient', 'system'],
              `appendix.field_digest[${index}].last_updated_by`,
            ),
          };
        })
        .slice(0, 300),
    },
  };

  return report;
}

function normalizeDocumentEvidenceIdList(
  value: unknown,
  path: string,
  allowedEvidenceIds: Set<string>,
  options: { allowEmpty?: boolean; max?: number } = {},
) {
  const allowEmpty = options.allowEmpty !== false;
  const max = Number.isFinite(Number(options.max)) ? Math.max(1, Math.floor(Number(options.max))) : 30;
  const rows = requireArray(value, path);
  const ids = dedupeStrings(rows.map((entry) => requireString(entry, `${path}[]`)).slice(0, max));
  if (!allowEmpty && ids.length === 0) {
    throw invalidModelOutput(`${path} must include at least one evidence_id`);
  }
  const unknown = ids.find((id) => !allowedEvidenceIds.has(id));
  if (unknown) {
    throw invalidModelOutput(`${path} contains unknown evidence_id`, {
      reasonCode: 'unknown_evidence_id',
      unknownEvidenceId: unknown,
      path,
    });
  }
  return ids;
}

function sanitizeConfidentialDigestSummary(value: string) {
  const normalized = normalizeChunkText(value)
    .replace(/["'`“”‘’]/g, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]')
    .replace(/\b\d[\d,./:-]*\b/g, '[REDACTED]');
  if (!normalized) {
    return 'Confidential evidence withheld for shared report.';
  }
  const clipped = normalized.slice(0, 160).trim();
  return clipped || 'Confidential evidence withheld for shared report.';
}

function normalizeDocumentComparisonReport(raw: unknown, params: {
  partyALabel: string;
  partyBLabel: string;
  evidenceChunks: {
    shared_chunks: DocumentEvidenceChunk[];
    confidential_chunks: DocumentEvidenceChunk[];
  };
}): ContractEvaluationReport {
  const root = requireObject(raw, 'report');
  const qualityRaw = requireObject(root.quality, 'quality');
  const summaryRaw = requireObject(root.summary, 'summary');
  const appendixRaw = requireObject(root.appendix, 'appendix');
  const templateId = requireString(root.template_id, 'template_id');
  if (templateId !== 'document_comparison_v1') {
    throw invalidModelOutput('template_id must be document_comparison_v1', {
      reasonCode: 'invalid_template_id',
      templateId,
    });
  }
  const templateName = requireString(root.template_name, 'template_name');
  const allowedEvidenceIds = new Set(
    [
      ...params.evidenceChunks.shared_chunks.map((chunk) => chunk.evidence_id),
      ...params.evidenceChunks.confidential_chunks.map((chunk) => chunk.evidence_id),
    ].filter(Boolean),
  );
  const chunkById = new Map<string, DocumentEvidenceChunk>();
  [...params.evidenceChunks.shared_chunks, ...params.evidenceChunks.confidential_chunks].forEach((chunk) => {
    chunkById.set(chunk.evidence_id, chunk);
  });

  const topFitReasons = requireArray(summaryRaw.top_fit_reasons, 'summary.top_fit_reasons')
    .map((entry, index) => {
      const row = requireObject(entry, `summary.top_fit_reasons[${index}]`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        row.evidence_ids,
        `summary.top_fit_reasons[${index}].evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 20 },
      );
      return {
        text: requireString(row.text, `summary.top_fit_reasons[${index}].text`),
        evidence_ids: evidenceIds,
        evidence_question_ids: evidenceIds,
      };
    })
    .slice(0, 12);

  const topBlockers = requireArray(summaryRaw.top_blockers, 'summary.top_blockers')
    .map((entry, index) => {
      const row = requireObject(entry, `summary.top_blockers[${index}]`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        row.evidence_ids,
        `summary.top_blockers[${index}].evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 20 },
      );
      return {
        text: requireString(row.text, `summary.top_blockers[${index}].text`),
        evidence_ids: evidenceIds,
        evidence_question_ids: evidenceIds,
      };
    })
    .slice(0, 12);

  const categoryBreakdown = requireArray(root.category_breakdown, 'category_breakdown')
    .map((entry, index) => {
      const row = requireObject(entry, `category_breakdown[${index}]`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        row.evidence_ids,
        `category_breakdown[${index}].evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 30 },
      );
      return {
        category_key: requireString(row.category_key, `category_breakdown[${index}].category_key`),
        name: requireString(row.name, `category_breakdown[${index}].name`),
        weight: 1,
        score_0_100: (() => {
          const value = optionalNumberOrNull(row.score_0_100);
          return value === null ? null : clamp0100(value);
        })(),
        confidence_0_1: clamp01(requireNumber(row.confidence_0_1, `category_breakdown[${index}].confidence_0_1`)),
        notes: dedupeStrings(
          requireArray(row.notes, `category_breakdown[${index}].notes`)
            .map((note) => requireString(note, `category_breakdown[${index}].notes[]`))
            .slice(0, 12),
        ),
        evidence_ids: evidenceIds,
        evidence_question_ids: evidenceIds,
      };
    })
    .slice(0, 30);
  if (categoryBreakdown.length < MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT) {
    throw invalidModelOutput(
      `category_breakdown must include at least ${MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT} categories`,
      {
        reasonCode: 'insufficient_categories',
        categoryCount: categoryBreakdown.length,
      },
    );
  }

  const contradictions = requireArray(root.contradictions, 'contradictions')
    .map((entry, index) => {
      const row = requireObject(entry, `contradictions[${index}]`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        row.evidence_ids,
        `contradictions[${index}].evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 20 },
      );
      return {
        key: requireString(row.key, `contradictions[${index}].key`),
        severity: requireEnum(row.severity, ['low', 'med', 'high'], `contradictions[${index}].severity`),
        description: requireString(row.description, `contradictions[${index}].description`),
        evidence_ids: evidenceIds,
        evidence_question_ids: evidenceIds,
      };
    })
    .slice(0, 25);

  const flags = requireArray(root.flags, 'flags')
    .map((entry, index) => {
      const row = requireObject(entry, `flags[${index}]`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        row.evidence_ids,
        `flags[${index}].evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 20 },
      );
      return {
        severity: requireEnum(row.severity, ['low', 'med', 'high'], `flags[${index}].severity`),
        type: requireEnum(
          row.type,
          ['security', 'privacy', 'ops', 'commercial', 'integrity', 'other'],
          `flags[${index}].type`,
        ),
        title: requireString(row.title, `flags[${index}].title`),
        detail: requireString(row.detail, `flags[${index}].detail`),
        detail_level: requireEnum(row.detail_level, ['full', 'partial', 'redacted'], `flags[${index}].detail_level`),
        evidence_ids: evidenceIds,
        evidence_question_ids: evidenceIds,
      };
    })
    .slice(0, MAX_DOCUMENT_COMPARISON_FLAGS);

  const followupQuestions = requireArray(root.followup_questions, 'followup_questions')
    .map((entry, index) => {
      const row = requireObject(entry, `followup_questions[${index}]`);
      const targets = requireObject(row.targets, `followup_questions[${index}].targets`);
      const evidenceIds = normalizeDocumentEvidenceIdList(
        targets.evidence_ids,
        `followup_questions[${index}].targets.evidence_ids`,
        allowedEvidenceIds,
        { allowEmpty: false, max: 20 },
      );
      return {
        priority: requireEnum(row.priority, ['high', 'med', 'low'], `followup_questions[${index}].priority`),
        to_party: requireEnum(row.to_party, ['a', 'b', 'both'], `followup_questions[${index}].to_party`),
        question_text: requireString(row.question_text, `followup_questions[${index}].question_text`),
        why_this_matters: requireString(row.why_this_matters, `followup_questions[${index}].why_this_matters`),
        targets: {
          category_key: requireString(targets.category_key, `followup_questions[${index}].targets.category_key`),
          evidence_ids: evidenceIds,
          question_ids: evidenceIds,
        },
      };
    })
    .slice(0, MAX_DOCUMENT_COMPARISON_FOLLOWUPS);

  const evidenceDigest = requireArray(appendixRaw.evidence_digest, 'appendix.evidence_digest')
    .map((entry, index) => {
      const row = requireObject(entry, `appendix.evidence_digest[${index}]`);
      const evidenceId = requireString(row.evidence_id, `appendix.evidence_digest[${index}].evidence_id`);
      if (!allowedEvidenceIds.has(evidenceId)) {
        throw invalidModelOutput('appendix.evidence_digest contains unknown evidence_id', {
          reasonCode: 'unknown_evidence_id',
          unknownEvidenceId: evidenceId,
          path: `appendix.evidence_digest[${index}]`,
        });
      }
      const expectedChunk = chunkById.get(evidenceId);
      const source = requireEnum(row.source, ['shared', 'confidential'], `appendix.evidence_digest[${index}].source`);
      if (expectedChunk && expectedChunk.source !== source) {
        throw invalidModelOutput('appendix.evidence_digest source did not match evidence map', {
          reasonCode: 'invalid_evidence_source',
          evidenceId,
          expectedSource: expectedChunk.source,
          providedSource: source,
        });
      }
      const rawVisibility = requireEnum(
        row.visibility,
        ['full', 'partial', 'hidden'],
        `appendix.evidence_digest[${index}].visibility`,
      );
      const rawSummary = requireString(row.value_summary, `appendix.evidence_digest[${index}].value_summary`);
      const visibility = source === 'confidential' && rawVisibility === 'full' ? 'hidden' : rawVisibility;
      const valueSummary = source === 'confidential'
        ? sanitizeConfidentialDigestSummary(rawSummary)
        : normalizeChunkText(rawSummary).slice(0, 220);
      return {
        evidence_id: evidenceId,
        source,
        label: requireString(row.label, `appendix.evidence_digest[${index}].label`),
        value_summary: valueSummary || (source === 'confidential'
          ? 'Confidential evidence withheld for shared report.'
          : 'No summary provided.'),
        visibility,
      };
    })
    .slice(0, 300);

  const confidenceReasoning = dedupeStrings(
    requireArray(qualityRaw.confidence_reasoning, 'quality.confidence_reasoning')
      .map((entry) => requireString(entry, 'quality.confidence_reasoning[]'))
      .slice(0, 30),
  );
  const missingEvidenceIds = normalizeDocumentEvidenceIdList(
    qualityRaw.missing_high_impact_evidence_ids ?? [],
    'quality.missing_high_impact_evidence_ids',
    allowedEvidenceIds,
    { allowEmpty: true, max: 40 },
  );
  const nextActions = dedupeStrings(
    requireArray(summaryRaw.next_actions, 'summary.next_actions')
      .map((entry) => requireString(entry, 'summary.next_actions[]'))
      .slice(0, 20),
  );

  return {
    template_id: templateId,
    template_name: templateName,
    generated_at_iso: requireString(root.generated_at_iso, 'generated_at_iso'),
    parties: {
      a_label: params.partyALabel,
      b_label: params.partyBLabel,
    },
    quality: {
      completeness_a: 1,
      completeness_b: 1,
      confidence_overall: clamp01(requireNumber(qualityRaw.confidence_overall, 'quality.confidence_overall')),
      confidence_reasoning: confidenceReasoning,
      missing_high_impact_question_ids: missingEvidenceIds,
      missing_high_impact_evidence_ids: missingEvidenceIds,
      disputed_question_ids: [],
    },
    summary: {
      overall_score_0_100: (() => {
        const value = optionalNumberOrNull(summaryRaw.overall_score_0_100);
        return value === null ? null : clamp0100(value);
      })(),
      fit_level: requireEnum(summaryRaw.fit_level, ['high', 'medium', 'low', 'unknown'], 'summary.fit_level'),
      top_fit_reasons: topFitReasons,
      top_blockers: topBlockers,
      next_actions: nextActions,
    },
    category_breakdown: categoryBreakdown.map((entry) => ({ ...entry, weight: 1 / Math.max(1, categoryBreakdown.length) })),
    gates: [],
    overlaps_and_constraints: [],
    contradictions,
    flags,
    verification: {
      summary: {
        self_declared_count: 0,
        evidence_attached_count: 0,
        tier1_verified_count: 0,
        disputed_count: 0,
      },
      evidence_requested: [],
    },
    followup_questions: followupQuestions,
    appendix: {
      field_digest: evidenceDigest.map((entry) => ({
        question_id: entry.evidence_id,
        label: entry.label,
        party: entry.source === 'confidential' ? 'a' : 'b',
        value_summary: entry.value_summary,
        visibility: entry.visibility,
        verified_status: 'unknown',
        last_updated_by: 'system',
      })),
      evidence_digest: evidenceDigest,
    },
  };
}

function buildLegacySections(report: ContractEvaluationReport) {
  const sections: Array<{ key: string; heading: string; bullets: string[] }> = [];

  if (report.category_breakdown.length > 0) {
    sections.push({
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: report.category_breakdown
        .slice(0, 6)
        .map((entry) => {
          const scorePart = entry.score_0_100 === null ? 'score n/a' : `score ${Math.round(entry.score_0_100)}`;
          return `${entry.name}: ${scorePart}, confidence ${Math.round(entry.confidence_0_1 * 100)}%`;
        }),
    });
  }

  if (report.flags.length > 0) {
    sections.push({
      key: 'flags',
      heading: 'Risk Flags',
      bullets: report.flags.slice(0, 6).map((flag) => `${flag.severity.toUpperCase()}: ${flag.title}`),
    });
  }

  if (report.summary.top_blockers.length > 0) {
    sections.push({
      key: 'blockers',
      heading: 'Top Blockers',
      bullets: report.summary.top_blockers.slice(0, 6).map((entry) => entry.text),
    });
  }

  if (sections.length === 0) {
    sections.push({
      key: 'summary',
      heading: 'Evaluation Summary',
      bullets: [
        `Fit level: ${report.summary.fit_level}`,
        ...report.summary.next_actions.slice(0, 3),
      ],
    });
  }

  return sections;
}

function buildExecutiveSummary(report: ContractEvaluationReport) {
  const topBlocker = report.summary.top_blockers[0]?.text;
  const topFit = report.summary.top_fit_reasons[0]?.text;
  const reasons = [topFit, topBlocker].filter(Boolean).slice(0, 2);
  if (reasons.length > 0) {
    return reasons.join(' ');
  }
  return report.summary.next_actions[0] || 'Evaluation generated from available evidence.';
}

function applyProposalHeuristics(
  report: ContractEvaluationReport,
  heuristics: ProposalHeuristics,
): ContractEvaluationReport {
  const next = {
    ...report,
    quality: {
      ...report.quality,
      completeness_a: Math.min(report.quality.completeness_a, heuristics.completenessA),
      completeness_b: Math.min(report.quality.completeness_b, heuristics.completenessB),
      confidence_overall: Math.min(report.quality.confidence_overall, heuristics.confidenceCap),
      confidence_reasoning: dedupeStrings([
        ...report.quality.confidence_reasoning,
        ...heuristics.confidenceReasons,
      ]).slice(0, 30),
      missing_high_impact_question_ids: heuristics.missingHighImpactQuestionIds,
      disputed_question_ids: heuristics.disputedQuestionIds,
    },
    summary: {
      ...report.summary,
      fit_level: (() => {
        if (heuristics.insufficient && report.summary.fit_level === 'high') {
          return 'low';
        }
        if (heuristics.insufficient && report.summary.fit_level === 'medium') {
          return 'low';
        }
        return report.summary.fit_level;
      })(),
      overall_score_0_100: (() => {
        if (report.summary.overall_score_0_100 === null) return null;
        if (heuristics.insufficient) {
          return Math.min(report.summary.overall_score_0_100, 45);
        }
        return report.summary.overall_score_0_100;
      })(),
    },
  };

  return next;
}

function applyComparisonHeuristics(
  report: ContractEvaluationReport,
  heuristics: ComparisonHeuristics,
): ContractEvaluationReport {
  const normalizedCategoryBreakdown = Array.isArray(report.category_breakdown)
    ? report.category_breakdown.map((entry) => ({ ...entry }))
    : [];
  const hasNumericCategoryScore = normalizedCategoryBreakdown.some(
    (entry) => typeof entry?.score_0_100 === 'number' && Number.isFinite(entry.score_0_100),
  );
  const seededCategoryBreakdown = normalizedCategoryBreakdown.map((entry, index) => {
    if (typeof entry?.score_0_100 === 'number' && Number.isFinite(entry.score_0_100)) {
      return entry;
    }

    const key = asLower(entry?.category_key);
    const name = asLower(entry?.name);
    const isSimilarityCategory =
      key.includes('similarity') ||
      name.includes('similarity') ||
      key.includes('alignment') ||
      name.includes('alignment');
    const shouldSeedFirstCategory = !hasNumericCategoryScore && index === 0;

    if (isSimilarityCategory || shouldSeedFirstCategory) {
      return {
        ...entry,
        score_0_100: clamp0100(heuristics.similarityScore),
      };
    }
    return entry;
  });

  const categoryScores = seededCategoryBreakdown
    .map((entry) => (typeof entry.score_0_100 === 'number' ? entry.score_0_100 : null))
    .filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
  const categoryAverageScore =
    categoryScores.length > 0
      ? clamp0100(categoryScores.reduce((sum, value) => sum + value, 0) / categoryScores.length)
      : clamp0100(heuristics.similarityScore);

  const next = {
    ...report,
    category_breakdown: seededCategoryBreakdown,
    quality: {
      ...report.quality,
      completeness_a: Math.min(report.quality.completeness_a, heuristics.completenessA),
      completeness_b: Math.min(report.quality.completeness_b, heuristics.completenessB),
      confidence_overall: Math.min(report.quality.confidence_overall, heuristics.confidenceCap),
      confidence_reasoning: dedupeStrings([
        ...report.quality.confidence_reasoning,
        ...heuristics.confidenceReasons,
      ]).slice(0, 30),
    },
    summary: {
      ...report.summary,
      fit_level: (() => {
        if (heuristics.insufficient) {
          return 'low';
        }
        return report.summary.fit_level;
      })(),
      overall_score_0_100: (() => {
        if (report.summary.overall_score_0_100 === null) {
          if (heuristics.insufficient) {
            return Math.min(categoryAverageScore, 45);
          }
          return categoryAverageScore;
        }
        if (heuristics.insufficient) {
          return Math.min(report.summary.overall_score_0_100, 45);
        }
        return report.summary.overall_score_0_100;
      })(),
    },
  };

  return next;
}

function attachCompatibility(
  report: ContractEvaluationReport,
  params: {
    provider: 'vertex' | 'mock';
    model: string;
    similarityScore?: number;
    deltaCharacters?: number;
    confidentialitySpans?: number;
  },
) {
  const recommendation = toRecommendation(report.summary.fit_level);
  const confidenceScore = Math.round(clamp01(report.quality.confidence_overall) * 100);
  const fallbackScore = Math.round(
    ((report.quality.completeness_a + report.quality.completeness_b) / 2) * 70 + confidenceScore * 0.3,
  );
  const derivedScore = clamp0100(
    report.summary.overall_score_0_100 === null ? fallbackScore : report.summary.overall_score_0_100,
  );

  const enriched: ContractEvaluationReport = {
    ...report,
    generated_at: report.generated_at_iso,
    recommendation,
    confidence_score: confidenceScore,
    similarity_score: clamp0100(params.similarityScore ?? derivedScore),
    delta_characters: Math.max(0, Math.floor(toNumber(params.deltaCharacters, 0))),
    confidentiality_spans: Math.max(0, Math.floor(toNumber(params.confidentialitySpans, 0))),
    executive_summary: buildExecutiveSummary(report),
    sections: buildLegacySections(report),
    provider: params.provider,
    model: params.model,
  };

  return {
    report: enriched,
    score: Math.round(derivedScore),
    confidence: confidenceScore,
    recommendation,
    summary: enriched.executive_summary || 'Evaluation generated from provided inputs.',
  };
}

function buildProposalPrompt(input: ProposalInput, heuristics: ProposalHeuristics) {
  const payload = {
    template: {
      id: input.templateId,
      name: input.templateName,
      party_a_label: input.partyALabel,
      party_b_label: input.partyBLabel,
    },
    responses: input.responses.map((row) => ({
      question_id: row.questionId,
      label: row.label,
      module_key: row.moduleKey,
      section_id: row.sectionId,
      party: row.party,
      required: row.required,
      value: row.value,
      value_type: row.valueType,
      range_min: row.rangeMin,
      range_max: row.rangeMax,
      visibility: row.visibility,
      updated_by: row.updatedBy,
      verified_status: row.verifiedStatus,
    })),
    rubric: input.rubric || null,
    computedSignals: input.computedSignals || null,
    preflight: {
      completeness_a_cap: heuristics.completenessA,
      completeness_b_cap: heuristics.completenessB,
      confidence_cap: heuristics.confidenceCap,
      missing_high_impact_question_ids: heuristics.missingHighImpactQuestionIds,
      disputed_question_ids: heuristics.disputedQuestionIds,
    },
  };

  return [
    CONTRACT_SYSTEM_PROMPT,
    'OUTPUT JSON SCHEMA (MUST MATCH):',
    JSON.stringify(PROPOSAL_SCHEMA_DESCRIPTION, null, 2),
    'HOW TO FILL THE REPORT:',
    '- Completeness: answered_required / total_required per party',
    '- Confidence: low if many required fields missing, disputes, or missing evidence',
    '- Category breakdown: use rubric categories when available, otherwise group by module_key',
    '- Keep score_0_100 null if scoring cannot be justified by evidence',
    '- Max flags: 8. Max follow-up questions: 10.',
    'INPUTS (JSON):',
    JSON.stringify(payload, null, 2),
    ...(input.supplementaryContext
      ? [
          'SUPPLEMENTARY CONTEXT (user-provided documents – treat as background reference only):',
          'IMPORTANT: Missing documents must NOT be treated as negatives.',
          'Prioritise proposal content and objective evidence over this context.',
          input.supplementaryContext,
        ]
      : []),
    'Return valid JSON only. No markdown.',
  ].join('\n');
}

function buildDocumentComparisonPrompt(
  input: ComparisonInput,
  heuristics: ComparisonHeuristics,
  evidenceMap: ReturnType<typeof buildDocumentComparisonEvidenceMap>,
) {
  const normalizedDocASpans = normalizeSpans(input.docASpans, input.docAText);
  const normalizedDocBSpans = normalizeSpans(input.docBSpans, input.docBText);
  const sharedEvidenceIds = evidenceMap.shared_chunks.map((chunk) => chunk.evidence_id);
  const confidentialEvidenceIds = evidenceMap.confidential_chunks.map((chunk) => chunk.evidence_id);
  const allowedEvidenceIds = [...sharedEvidenceIds, ...confidentialEvidenceIds];

  const payload = {
    template: {
      id: 'document_comparison_v1',
      name: 'Document Comparison Evaluation',
      comparison_title: input.title || 'Document Comparison',
      party_a_label: input.partyALabel,
      party_b_label: input.partyBLabel,
    },
    evidence_map: {
      shared_chunks: evidenceMap.shared_chunks.map((chunk) => ({
        evidence_id: chunk.evidence_id,
        label: chunk.label,
        source: chunk.source,
        visibility: chunk.visibility,
        text: chunk.text,
      })),
      confidential_chunks: evidenceMap.confidential_chunks.map((chunk) => ({
        evidence_id: chunk.evidence_id,
        label: chunk.label,
        source: chunk.source,
        visibility: chunk.visibility,
        text: chunk.text,
      })),
      allowed_evidence_ids: allowedEvidenceIds,
      chunk_limits: {
        max_chunks_per_source: MAX_DOCUMENT_EVIDENCE_CHUNKS,
        max_chars_per_chunk: MAX_EVIDENCE_CHUNK_TEXT_CHARS,
      },
    },
    computedSignals: {
      hidden_spans: {
        doc_a: normalizedDocASpans,
        doc_b: normalizedDocBSpans,
      },
      preflight: {
        completeness_a_cap: heuristics.completenessA,
        completeness_b_cap: heuristics.completenessB,
        confidence_cap: heuristics.confidenceCap,
        similarity_score: heuristics.similarityScore,
        delta_characters: heuristics.deltaCharacters,
      },
    },
    generation_constraints: {
      require_all_top_level_keys: true,
      category_breakdown_min_items: MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT,
      max_flags: MAX_DOCUMENT_COMPARISON_FLAGS,
      max_followup_questions: MAX_DOCUMENT_COMPARISON_FOLLOWUPS,
      score_0_100_policy: 'leave null unless justified by explicit evidence',
      confidence_overall_range: [0, 1],
    },
  };

  return [
    DOCUMENT_COMPARISON_SYSTEM_PROMPT,
    'MODE: document_comparison',
    'OUTPUT JSON SCHEMA (MUST MATCH):',
    JSON.stringify(DOCUMENT_COMPARISON_REPORT_SCHEMA_DESCRIPTION, null, 2),
    'DOCUMENT COMPARISON EXTENSION:',
    JSON.stringify(DOC_COMPARISON_SCHEMA_EXTENSION, null, 2),
    'RESPONSE CONSTRAINTS:',
    `- category_breakdown MUST include at least ${MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT} categories unless evidence is truly insufficient.`,
    `- flags MUST include at most ${MAX_DOCUMENT_COMPARISON_FLAGS} entries.`,
    `- followup_questions MUST include at most ${MAX_DOCUMENT_COMPARISON_FOLLOWUPS} entries.`,
    '- confidence_overall MUST be between 0 and 1 and justified by confidence_reasoning.',
    '- Arrays must exist even when empty.',
    '- Use only allowed evidence_ids from evidence_map.allowed_evidence_ids.',
    '- Never output confidential chunk text verbatim. For confidential-derived content use redacted generic wording.',
    '- In appendix.evidence_digest: source="confidential" entries must have visibility hidden or partial and generic summaries.',
    'INPUTS (JSON):',
    JSON.stringify(payload, null, 2),
    'Return valid JSON only. No markdown.',
  ].join('\n');
}

function collectDocumentComparisonSchemaDiagnostics(raw: unknown) {
  const schemaMissingKeys: string[] = [];
  let categoryCount: number | null = null;
  const root =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  DOCUMENT_COMPARISON_REQUIRED_TOP_LEVEL_KEYS.forEach((key) => {
    if (!root || root[key] === undefined || root[key] === null) {
      schemaMissingKeys.push(String(key));
    }
  });

  const quality =
    root?.quality && typeof root.quality === 'object' && !Array.isArray(root.quality)
      ? (root.quality as Record<string, unknown>)
      : null;
  DOCUMENT_COMPARISON_REQUIRED_QUALITY_KEYS.forEach((key) => {
    if (!quality || quality[key] === undefined || quality[key] === null) {
      schemaMissingKeys.push(`quality.${String(key)}`);
    }
  });

  const summary =
    root?.summary && typeof root.summary === 'object' && !Array.isArray(root.summary)
      ? (root.summary as Record<string, unknown>)
      : null;
  DOCUMENT_COMPARISON_REQUIRED_SUMMARY_KEYS.forEach((key) => {
    if (!summary || summary[key] === undefined || summary[key] === null) {
      schemaMissingKeys.push(`summary.${String(key)}`);
    }
  });

  const appendix =
    root?.appendix && typeof root.appendix === 'object' && !Array.isArray(root.appendix)
      ? (root.appendix as Record<string, unknown>)
      : null;
  DOCUMENT_COMPARISON_REQUIRED_APPENDIX_KEYS.forEach((key) => {
    if (!appendix || appendix[key] === undefined || appendix[key] === null) {
      schemaMissingKeys.push(`appendix.${String(key)}`);
    }
  });

  if (Array.isArray(root?.category_breakdown)) {
    categoryCount = root!.category_breakdown.length;
  }

  return {
    schemaMissingKeys: dedupeStrings(schemaMissingKeys).slice(0, 40),
    categoryCount,
  };
}

function buildParseDiagnosticsMessage(params: {
  parseErrorKind: ParseErrorKind | null;
  rawTextLength: number;
  hadJsonFence: boolean;
  finishReason: string | null;
  schemaMissingKeys?: string[];
  categoryCount?: number | null;
}) {
  return JSON.stringify({
    parse_error_kind: params.parseErrorKind || null,
    raw_text_length: Number.isFinite(params.rawTextLength) ? params.rawTextLength : 0,
    had_json_fence: Boolean(params.hadJsonFence),
    finish_reason: asText(params.finishReason) || null,
    schema_missing_keys: Array.isArray(params.schemaMissingKeys) ? params.schemaMissingKeys.slice(0, 40) : [],
    category_count: Number.isFinite(Number(params.categoryCount)) ? Number(params.categoryCount) : null,
  });
}

function buildProposalRepairPrompt(
  basePrompt: string,
  diagnostics: {
    parseErrorKind: ParseErrorKind | null;
    schemaMissingKeys: string[];
  },
) {
  const missing = diagnostics.schemaMissingKeys.length
    ? diagnostics.schemaMissingKeys.join(', ')
    : 'unknown';

  return [
    basePrompt,
    '',
    'REPAIR INSTRUCTION (highest priority):',
    '- Your previous output failed schema validation.',
    `- parse_error_kind: ${diagnostics.parseErrorKind || 'schema_validation_error'}`,
    `- schema_missing_keys: ${missing}`,
    '- Return ONLY valid JSON that matches the full schema with all required keys present.',
    '- Ensure all top-level keys are present (quality, summary, category_breakdown, gates, etc.)',
    '- Arrays must exist even when empty.',
    '- Do not include markdown or extra prose.',
  ].join('\n');
}

function buildDocumentComparisonRepairPrompt(
  basePrompt: string,
  diagnostics: {
    parseErrorKind: ParseErrorKind | null;
    schemaMissingKeys: string[];
    categoryCount: number | null;
  },
) {
  const missing = diagnostics.schemaMissingKeys.length
    ? diagnostics.schemaMissingKeys.join(', ')
    : 'unknown';
  const categoryCountText = Number.isFinite(Number(diagnostics.categoryCount))
    ? String(diagnostics.categoryCount)
    : 'unknown';

  return [
    basePrompt,
    '',
    'REPAIR INSTRUCTION (highest priority):',
    '- Your previous output failed schema validation.',
    `- parse_error_kind: ${diagnostics.parseErrorKind || 'schema_validation_error'}`,
    `- schema_missing_keys: ${missing}`,
    `- category_count: ${categoryCountText}`,
    '- Return ONLY valid JSON that matches the full schema with all required keys present.',
    `- Ensure category_breakdown has at least ${MIN_DOCUMENT_COMPARISON_CATEGORY_COUNT} entries.`,
    '- Do not include markdown or extra prose.',
  ].join('\n');
}

function pickVisibleAnchor(
  text: string,
  spans: Span[],
  doc: 'A' | 'B',
): EvidenceAnchor[] {
  const safeText = String(text || '');
  if (!safeText) return [];

  const anchors: EvidenceAnchor[] = [];
  const regex = /\b[\w-]{4,}\b/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(safeText)) !== null && anchors.length < 3) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsHiddenSpans(start, end, spans)) {
      continue;
    }
    anchors.push({ doc, start, end });
  }

  return anchors;
}

function buildMockProposalReport(input: ProposalInput, heuristics: ProposalHeuristics): ContractEvaluationReport {
  const generatedAt = new Date().toISOString();
  const allQuestionIds = input.responses.map((row) => row.questionId);
  const fitLevel: 'high' | 'medium' | 'low' | 'unknown' = (() => {
    const avgCompleteness = (heuristics.completenessA + heuristics.completenessB) / 2;
    if (heuristics.insufficient) return 'low';
    if (avgCompleteness >= 0.75 && heuristics.confidenceCap >= 0.7) return 'high';
    if (avgCompleteness >= 0.45 && heuristics.confidenceCap >= 0.45) return 'medium';
    if (avgCompleteness < 0.2) return 'unknown';
    return 'low';
  })();

  const report: ContractEvaluationReport = {
    template_id: input.templateId,
    template_name: input.templateName,
    generated_at_iso: generatedAt,
    parties: {
      a_label: input.partyALabel,
      b_label: input.partyBLabel,
    },
    quality: {
      completeness_a: heuristics.completenessA,
      completeness_b: heuristics.completenessB,
      confidence_overall: heuristics.confidenceCap,
      confidence_reasoning: heuristics.confidenceReasons,
      missing_high_impact_question_ids: heuristics.missingHighImpactQuestionIds,
      disputed_question_ids: heuristics.disputedQuestionIds,
    },
    summary: {
      overall_score_0_100: null,
      fit_level: fitLevel,
      top_fit_reasons: [
        {
          text: 'Only evidence-backed answered fields were considered.',
          evidence_question_ids: dedupeStrings(allQuestionIds.slice(0, 4)),
        },
      ],
      top_blockers: heuristics.missingHighImpactQuestionIds.length > 0
        ? [
            {
              text: 'Missing required high-impact inputs block confident fit assessment.',
              evidence_question_ids: heuristics.missingHighImpactQuestionIds.slice(0, 6),
            },
          ]
        : [],
      next_actions: heuristics.missingHighImpactQuestionIds.length > 0
        ? ['Complete required unanswered fields before final decision.']
        : ['Request supporting evidence for self-declared claims.'],
    },
    category_breakdown: [
      {
        category_key: 'overall',
        name: 'Overall Completeness',
        weight: 1,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: [
          `Party A completeness ${(heuristics.completenessA * 100).toFixed(0)}%`,
          `Party B completeness ${(heuristics.completenessB * 100).toFixed(0)}%`,
        ],
        evidence_question_ids: dedupeStrings(allQuestionIds.slice(0, 10)),
      },
    ],
    gates: [],
    overlaps_and_constraints: [],
    contradictions: heuristics.disputedQuestionIds.length > 0
      ? [
          {
            key: 'disputed_answers',
            severity: 'med',
            description: 'Some fields are marked disputed and need reconciliation.',
            evidence_question_ids: heuristics.disputedQuestionIds.slice(0, 8),
          },
        ]
      : [],
    flags: heuristics.missingHighImpactQuestionIds.length > 0
      ? [
          {
            severity: 'high',
            type: 'integrity',
            title: 'Missing high-impact responses',
            detail: 'High-impact required fields are missing; decision quality is limited.',
            detail_level: 'full',
            evidence_question_ids: heuristics.missingHighImpactQuestionIds.slice(0, 8),
          },
        ]
      : [],
    verification: {
      summary: {
        self_declared_count: input.responses.filter((row) => row.verifiedStatus === 'self_declared').length,
        evidence_attached_count: input.responses.filter((row) => row.verifiedStatus === 'evidence_attached').length,
        tier1_verified_count: input.responses.filter((row) => row.verifiedStatus === 'tier1_verified').length,
        disputed_count: input.responses.filter((row) => row.verifiedStatus === 'disputed').length,
      },
      evidence_requested: heuristics.missingHighImpactQuestionIds.slice(0, 6).map((questionId) => ({
        item: `Evidence for ${questionId}`,
        reason: 'Required field is missing or incomplete.',
        related_question_ids: [questionId],
      })),
    },
    followup_questions: heuristics.missingHighImpactQuestionIds.slice(0, 10).map((questionId) => ({
      priority: 'high',
      to_party: 'a',
      question_text: `Please provide a complete answer for ${questionId}.`,
      why_this_matters: 'The field is required for fit and risk assessment.',
      targets: {
        category_key: 'overall',
        question_ids: [questionId],
      },
    })),
    appendix: {
      field_digest: input.responses.slice(0, 300).map((row) => ({
        question_id: row.questionId,
        label: row.label,
        party: row.party,
        value_summary: responseValueSummary(row),
        visibility: row.visibility,
        verified_status: row.verifiedStatus,
        last_updated_by: row.updatedBy,
      })),
    },
  };

  return report;
}

function buildMockComparisonReport(
  input: ComparisonInput,
  heuristics: ComparisonHeuristics,
): ContractEvaluationReport {
  const generatedAt = new Date().toISOString();
  const normalizedDocASpans = normalizeSpans(input.docASpans || [], input.docAText);
  const normalizedDocBSpans = normalizeSpans(input.docBSpans || [], input.docBText);

  const anchorsA = pickVisibleAnchor(input.docAText, normalizedDocASpans, 'A');
  const anchorsB = pickVisibleAnchor(input.docBText, normalizedDocBSpans, 'B');
  const fitLevel: 'high' | 'medium' | 'low' | 'unknown' = (() => {
    if (heuristics.insufficient) return 'low';
    if (heuristics.similarityScore >= 80) return 'high';
    if (heuristics.similarityScore >= 50) return 'medium';
    return 'low';
  })();

  return {
    template_id: 'document_comparison_template',
    template_name: input.title || 'Document Comparison',
    generated_at_iso: generatedAt,
    parties: {
      a_label: input.partyALabel,
      b_label: input.partyBLabel,
    },
    quality: {
      completeness_a: heuristics.completenessA,
      completeness_b: heuristics.completenessB,
      confidence_overall: heuristics.confidenceCap,
      confidence_reasoning: heuristics.confidenceReasons,
      missing_high_impact_question_ids: [],
      missing_high_impact_evidence_ids: [],
      disputed_question_ids: [],
    },
    summary: {
      overall_score_0_100: null,
      fit_level: fitLevel,
      top_fit_reasons: [
        {
          text: 'Visible clauses overlap on core commercial obligations.',
          evidence_ids: ['shared:line_001'],
          evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
          evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
        },
      ],
      top_blockers: heuristics.insufficient
        ? [
            {
              text: 'Visible text is too short for high-confidence evaluation.',
              evidence_ids: ['shared:line_001'],
              evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
              evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
            },
          ]
        : [],
      next_actions: heuristics.insufficient
        ? ['Provide fuller visible text for both documents before relying on this report.']
        : ['Review highlighted deltas and confirm obligations with counterparties.'],
    },
    category_breakdown: [
      {
        category_key: 'visible_text_similarity',
        name: 'Visible Text Similarity',
        weight: 0.2,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: [`Similarity signal ${heuristics.similarityScore}%`, `Delta characters ${heuristics.deltaCharacters}`],
        evidence_ids: ['shared:line_001'],
        evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
        evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
      },
      {
        category_key: 'obligation_alignment',
        name: 'Obligation Alignment',
        weight: 0.2,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: ['Obligation language overlaps on deliverables and support commitments.'],
        evidence_ids: ['shared:line_001'],
        evidence_question_ids: ['doc_b_visible'],
      },
      {
        category_key: 'risk_exposure',
        name: 'Risk Exposure',
        weight: 0.2,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: ['Risk language is partially aligned; confidential caveats remain redacted.'],
        evidence_ids: ['conf:line_001'],
        evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
      },
      {
        category_key: 'commercial_fit',
        name: 'Commercial Fit',
        weight: 0.2,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: ['Commercial fit appears moderate pending negotiation clarifications.'],
        evidence_ids: ['shared:line_001'],
        evidence_question_ids: ['doc_b_visible'],
      },
      {
        category_key: 'operational_readiness',
        name: 'Operational Readiness',
        weight: 0.2,
        score_0_100: null,
        confidence_0_1: heuristics.confidenceCap,
        notes: ['Operational details exist but require follow-up for execution certainty.'],
        evidence_ids: ['shared:line_001'],
        evidence_question_ids: ['doc_b_visible'],
      },
    ],
    gates: [],
    overlaps_and_constraints: [
      {
        key: 'confidentiality_constraints',
        outcome: heuristics.confidentialitySpans > 0 ? 'unknown' : 'pass',
        short_explanation: 'Hidden spans were redacted from report evidence and wording.',
        evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
        evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
      },
    ],
    contradictions: [],
    flags: heuristics.insufficient
      ? [
          {
            severity: 'high',
            type: 'integrity',
            title: 'Insufficient visible input coverage',
            detail: 'Input text is too sparse to support high-confidence conclusions.',
            detail_level: 'full',
            evidence_ids: ['shared:line_001'],
            evidence_question_ids: ['doc_a_visible', 'doc_b_visible'],
            evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
          },
        ]
      : [],
    verification: {
      summary: {
        self_declared_count: 2,
        evidence_attached_count: 0,
        tier1_verified_count: 0,
        disputed_count: 0,
      },
      evidence_requested: [
        {
          item: 'Supporting documentation for obligations and SLAs',
          reason: 'Visible text alone may be insufficient for compliance-level assurance.',
          related_question_ids: ['doc_a_visible', 'doc_b_visible'],
          evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
        },
      ],
    },
    followup_questions: [
      {
        priority: heuristics.insufficient ? 'high' : 'med',
        to_party: 'both',
        question_text: 'Can each party provide full non-redacted context for the highlighted clauses?',
        why_this_matters: 'Insufficient visible evidence lowers confidence and can mask legal risk.',
        targets: {
          category_key: 'similarity',
          evidence_ids: ['shared:line_001'],
          question_ids: ['doc_a_visible', 'doc_b_visible'],
          evidence_anchors: [...anchorsA.slice(0, 1), ...anchorsB.slice(0, 1)],
        },
      },
    ],
    appendix: {
      field_digest: [
        {
          question_id: 'doc_a_visible',
          label: input.partyALabel,
          party: 'a',
          // Never echo confidential raw text in shared report payloads.
          value_summary: 'Confidential content evaluated internally.',
          visibility: normalizedDocASpans.length > 0 ? 'partial' : 'full',
          verified_status: 'self_declared',
          last_updated_by: 'proposer',
        },
        {
          question_id: 'doc_b_visible',
          label: input.partyBLabel,
          party: 'b',
          value_summary: stripHiddenSpans(input.docBText, normalizedDocBSpans).slice(0, 120) || 'unknown',
          visibility: normalizedDocBSpans.length > 0 ? 'partial' : 'full',
          verified_status: 'self_declared',
          last_updated_by: 'recipient',
        },
      ],
      evidence_digest: [
        {
          evidence_id: 'conf:line_001',
          source: 'confidential',
          label: input.partyALabel,
          value_summary: 'Confidential evidence withheld for shared report.',
          visibility: 'hidden',
        },
        {
          evidence_id: 'shared:line_001',
          source: 'shared',
          label: input.partyBLabel,
          value_summary: stripHiddenSpans(input.docBText, normalizedDocBSpans).slice(0, 120) || 'unknown',
          visibility: normalizedDocBSpans.length > 0 ? 'partial' : 'full',
        },
      ],
    },
  };
}

async function fetchGoogleAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const jwtPayload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      exp: now + 60 * 60,
      iat: now,
    }),
  );
  const unsignedToken = `${jwtHeader}.${jwtPayload}`;
  const signedToken = `${unsignedToken}.${signJwt(unsignedToken, credentials.private_key)}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedToken,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }

  const payload = (await response.json().catch(() => ({}))) as { access_token?: string };
  const accessToken = asText(payload?.access_token);
  if (!accessToken) {
    throw new ApiError(502, 'vertex_auth_failed', 'Vertex AI access token was not returned');
  }

  return accessToken;
}

function extractModelText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = Array.isArray(candidates?.[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((text: string) => text.length > 0)
    .join('\n')
    .trim();
}

function extractFinishReason(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return asLower(candidates?.[0]?.finishReason);
}

function summarizeVertexPayload(payload: any) {
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const firstCandidate =
    candidates[0] && typeof candidates[0] === 'object' && !Array.isArray(candidates[0])
      ? (candidates[0] as Record<string, unknown>)
      : {};
  const firstParts = Array.isArray((firstCandidate as any)?.content?.parts)
    ? ((firstCandidate as any).content.parts as unknown[])
    : [];
  const firstPart =
    firstParts[0] && typeof firstParts[0] === 'object' && !Array.isArray(firstParts[0])
      ? (firstParts[0] as Record<string, unknown>)
      : {};

  return {
    responseKeys: Object.keys(root).slice(0, 20),
    candidateCount: candidates.length,
    firstCandidateKeys: Object.keys(firstCandidate).slice(0, 20),
    firstPartKeys: Object.keys(firstPart).slice(0, 20),
  };
}

const VERTEX_GENERATION_CONFIG = {
  maxOutputTokens: 6144,
  temperature: 0,
  topP: 1,
  responseMimeType: 'application/json',
} as const;

// Empty array means we intentionally rely on Vertex platform defaults.
const VERTEX_SAFETY_SETTINGS: Array<Record<string, unknown>> = [];

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = VERTEX_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const mergedInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };
    return await fetch(input, mergedInit);
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

async function callVertex(prompt: string, options: CallVertexOptions) {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    const config = getVertexNotConfiguredError();
    throw new ApiError(501, 'not_configured', config.message, config.details);
  }

  const accessToken = await fetchGoogleAccessToken(vertex.credentials);
  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location;
  const preferredModel = asText(process.env.VERTEX_MODEL) || vertex.model;
  const modelCandidates = [
    preferredModel,
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
  ]
    .map((model) => asText(model))
    .filter(Boolean)
    .filter((model, index, values) => values.indexOf(model) === index);

  let lastStatus = 0;
  let lastMessage = '';
  const promptLength = String(prompt || '').length;
  const logBase = {
    level: 'info',
    event: 'vertex_generate_content',
    correlationId: asText(options?.correlationId) || null,
    routeName: asText(options?.routeName) || null,
    entityId: asText(options?.entityId) || null,
    mode: options.promptLabel,
    projectId,
    location,
    promptLength,
    inputChars: Number.isFinite(Number(options?.inputChars)) ? Number(options.inputChars) : null,
    generationConfig: VERTEX_GENERATION_CONFIG,
    safetySettings: VERTEX_SAFETY_SETTINGS.length > 0 ? VERTEX_SAFETY_SETTINGS : 'platform_default',
    modelCandidates,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.info(JSON.stringify({ ...logBase, stage: 'start' }));
  }

  for (const model of modelCandidates) {
    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const startedAtMs = Date.now();
    const baseRequestBody: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: VERTEX_GENERATION_CONFIG,
    };
    if (VERTEX_SAFETY_SETTINGS.length > 0) {
      baseRequestBody.safetySettings = VERTEX_SAFETY_SETTINGS;
    }

    const sendGenerateContent = async (requestBody: Record<string, unknown>) =>
      fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
        VERTEX_FETCH_TIMEOUT_MS,
      );

    let response = await sendGenerateContent(baseRequestBody);
    let preloadedErrorBody = '';
    if (!response.ok && response.status === 400) {
      const badRequestBody = await response.text().catch(() => '');
      const unsupportedMimeType =
        badRequestBody.toLowerCase().includes('responsemimetype') ||
        badRequestBody.toLowerCase().includes('response mime type');
      if (unsupportedMimeType) {
        const generationConfigWithoutMime = { ...VERTEX_GENERATION_CONFIG } as Record<string, unknown>;
        delete generationConfigWithoutMime.responseMimeType;
        const fallbackRequestBody: Record<string, unknown> = {
          ...baseRequestBody,
          generationConfig: generationConfigWithoutMime,
        };
        response = await sendGenerateContent(fallbackRequestBody);
      } else {
        preloadedErrorBody = badRequestBody;
      }
    }
    const latencyMs = Date.now() - startedAtMs;

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const payloadSummary = summarizeVertexPayload(payload);
      const text = extractModelText(payload);
      const finishReason = extractFinishReason(payload);
      if (!text) {
        throw invalidModelOutput('Vertex response did not contain text content', {
          model,
          upstreamStatus: response.status,
          promptLength,
          reasonCode: 'empty_output',
          parseErrorKind: 'empty_output',
          parseErrorName: 'empty_output',
          parseErrorMessage: buildParseDiagnosticsMessage({
            parseErrorKind: 'empty_output',
            rawTextLength: 0,
            hadJsonFence: false,
            finishReason: finishReason || null,
          }),
          finishReason: finishReason || null,
          ...payloadSummary,
          textLength: 0,
          rawTextLength: 0,
          hadJsonFence: false,
        });
      }
      if (finishReason && finishReason !== 'stop') {
        const hadJsonFence = hasJsonFence(text);
        throw invalidModelOutput('Vertex response was truncated before JSON completion', {
          model,
          upstreamStatus: response.status,
          reasonCode: 'truncated_output',
          parseErrorKind: 'truncated_output',
          parseErrorName: 'truncated_output',
          parseErrorMessage: buildParseDiagnosticsMessage({
            parseErrorKind: 'truncated_output',
            rawTextLength: text.length,
            hadJsonFence,
            finishReason: finishReason || null,
          }),
          finishReason,
          promptLength,
          ...payloadSummary,
          textLength: text.length,
          rawTextLength: text.length,
          hadJsonFence,
        });
      }
      if (process.env.NODE_ENV !== 'production') {
        console.info(
          JSON.stringify({
            ...logBase,
            stage: 'success',
            model,
            upstreamStatus: response.status,
            latencyMs,
            finishReason: finishReason || null,
            textLength: text.length,
            ...payloadSummary,
          }),
        );
      }
      return {
        model,
        text,
        finishReason: finishReason || null,
        ...payloadSummary,
      };
    }

    const details = preloadedErrorBody || (await response.text().catch(() => ''));
    lastStatus = response.status;
    lastMessage = details ? details.slice(0, 400) : '';
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        JSON.stringify({
          ...logBase,
          level: 'warn',
          stage: 'upstream_error',
          model,
          upstreamStatus: response.status,
          latencyMs,
          upstreamMessage: lastMessage || null,
        }),
      );
    }
    const modelMissing = response.status === 404 && /publisher model/i.test(details);
    if (modelMissing) {
      continue;
    }

    throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
      model,
      upstreamStatus: response.status,
      upstreamMessage: lastMessage || null,
      triedModels: modelCandidates,
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error(
      JSON.stringify({
        ...logBase,
        level: 'error',
        stage: 'exhausted_models',
        upstreamStatus: lastStatus || 404,
        upstreamMessage: lastMessage || 'No accessible Vertex model found for this project',
      }),
    );
  }
  throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
    model: modelCandidates[modelCandidates.length - 1] || null,
    upstreamStatus: lastStatus || 404,
    upstreamMessage: lastMessage || 'No accessible Vertex model found for this project',
    triedModels: modelCandidates,
  });
}

function finalizeEvaluationResult(
  report: ContractEvaluationReport,
  params: {
    provider: 'vertex' | 'mock';
    model: string;
    attemptHistory?: ContractEvaluationResult['attempt_history'];
    fallbackReason?: string | null;
    debug?: {
      raw_model_text?: string;
      raw_model_text_length: number;
    };
    similarityScore?: number;
    deltaCharacters?: number;
    confidentialitySpans?: number;
  },
): ContractEvaluationResult {
  const compatibility = attachCompatibility(report, params);
  const evaluationProvider = params.provider === 'vertex' ? 'vertex' : 'fallback';
  const normalizedFallbackReason =
    evaluationProvider === 'fallback'
      ? asText(params.fallbackReason) || (params.provider === 'mock' ? 'vertex_mock_enabled' : 'non_vertex_provider')
      : null;

  return {
    provider: params.provider,
    model: params.model,
    fallbackReason: normalizedFallbackReason,
    evaluation_provider: evaluationProvider,
    evaluation_model: params.model,
    evaluation_provider_reason: normalizedFallbackReason,
    attempt_history: Array.isArray(params.attemptHistory) ? params.attemptHistory : undefined,
    generatedAt: report.generated_at_iso,
    score: compatibility.score,
    confidence: compatibility.confidence,
    recommendation: compatibility.recommendation,
    summary: compatibility.summary,
    report: compatibility.report,
    debug: params.debug,
  };
}

function normalizeProposalInput(input: ProposalInput): ProposalInput {
  const normalizedResponses: ProposalResponseInput[] = Array.isArray(input.responses)
    ? input.responses
        .map((row): ProposalResponseInput | null => {
          const questionId = asText(row?.questionId);
          if (!questionId) return null;

          const party: 'a' | 'b' = asLower(row?.party) === 'b' ? 'b' : 'a';

          return {
            questionId,
            label: asText(row?.label) || questionId,
            party,
            required: Boolean(row?.required),
            value: row?.value ?? null,
            valueType: asText(row?.valueType) || 'text',
            rangeMin: asText(row?.rangeMin) || null,
            rangeMax: asText(row?.rangeMax) || null,
            visibility: normalizeVisibility(row?.visibility),
            updatedBy: normalizeUpdatedBy(row?.updatedBy),
            verifiedStatus: normalizeVerifiedStatus(row?.verifiedStatus),
            moduleKey: asText(row?.moduleKey) || null,
            sectionId: asText(row?.sectionId) || null,
          };
        })
        .filter((row): row is ProposalResponseInput => Boolean(row))
    : [];

  return {
    templateId: asText(input.templateId) || 'template_unknown',
    templateName: asText(input.templateName) || 'Proposal Template',
    partyALabel: asText(input.partyALabel) || 'Party A',
    partyBLabel: asText(input.partyBLabel) || 'Party B',
    responses: normalizedResponses,
    rubric: input.rubric || null,
    computedSignals: input.computedSignals || null,
    supplementaryContext: input.supplementaryContext || null,
  };
}

function normalizeComparisonInput(input: ComparisonInput): ComparisonInput {
  return {
    title: asText(input.title) || 'Untitled Comparison',
    partyALabel: asText(input.partyALabel) || 'Confidential Information',
    partyBLabel: asText(input.partyBLabel) || 'Shared Information',
    docAText: String(input.docAText || ''),
    docBText: String(input.docBText || ''),
    docASpans: normalizeSpans(input.docASpans || [], String(input.docAText || '')),
    docBSpans: normalizeSpans(input.docBSpans || [], String(input.docBText || '')),
  };
}

function assertComparisonInputForEvaluation(input: ComparisonInput) {
  const confidentialText = String(input.docAText || '').trim();
  const sharedText = String(input.docBText || '').trim();
  const confidentialLength = confidentialText.length;
  const sharedLength = sharedText.length;
  const confidentialWords = countWords(confidentialText);
  const sharedWords = countWords(sharedText);

  if (!confidentialLength || !sharedLength) {
    throw new ApiError(400, 'empty_inputs', 'Both confidential and shared documents are required for evaluation', {
      inputConfidentialLength: confidentialLength,
      inputSharedLength: sharedLength,
      inputConfidentialWords: confidentialWords,
      inputSharedWords: sharedWords,
    });
  }

  if (
    confidentialLength < MIN_DOCUMENT_COMPARISON_TEXT_LENGTH ||
    sharedLength < MIN_DOCUMENT_COMPARISON_TEXT_LENGTH
  ) {
    throw new ApiError(
      400,
      'invalid_input',
      `Both documents must include at least ${MIN_DOCUMENT_COMPARISON_TEXT_LENGTH} characters.`,
      {
        inputConfidentialLength: confidentialLength,
        inputSharedLength: sharedLength,
        inputConfidentialWords: confidentialWords,
        inputSharedWords: sharedWords,
      },
    );
  }
}

function sanitizeAndValidateHiddenCompliance(report: ContractEvaluationReport, hiddenSnippets: string[]) {
  if (hiddenSnippets.length === 0) {
    return report;
  }

  const sanitized = sanitizeDeep(report, hiddenSnippets);
  if (containsHiddenSnippet(sanitized, hiddenSnippets)) {
    throw invalidModelOutput('Hidden content leaked into evaluation output');
  }

  return sanitized;
}

function buildConfidentialPhraseCandidates(
  confidentialChunks: DocumentEvidenceChunk[],
  sharedChunks: DocumentEvidenceChunk[],
) {
  const sharedNormalized = normalizeForComparison(sharedChunks.map((chunk) => chunk.text).join(' '));
  const uniquePhrases = new Set<string>();

  confidentialChunks.forEach((chunk) => {
    const normalizedChunk = normalizeChunkText(chunk.text);
    if (!normalizedChunk) return;
    const words = normalizedChunk.split(/\s+/g).filter(Boolean);
    for (let index = 0; index + 5 < words.length && uniquePhrases.size < 240; index += 2) {
      const phrase = words.slice(index, index + 6).join(' ').trim();
      const normalized = normalizeForComparison(phrase);
      if (!normalized || normalized.length < 28) continue;
      if (sharedNormalized.includes(normalized)) continue;
      uniquePhrases.add(normalized);
    }
  });

  return [...uniquePhrases].slice(0, 240);
}

function extractSensitiveConfidentialTokens(
  confidentialChunks: DocumentEvidenceChunk[],
  sharedChunks: DocumentEvidenceChunk[],
) {
  const confidential = confidentialChunks.map((chunk) => String(chunk.text || '')).join('\n');
  const sharedLower = sharedChunks.map((chunk) => String(chunk.text || '')).join('\n').toLowerCase();
  const tokenSet = new Set<string>();

  const emailMatches = confidential.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const idMatches = confidential.match(/\b[A-Za-z][A-Za-z0-9_-]{6,}\d[A-Za-z0-9_-]*\b/g) || [];
  const longNumberMatches = confidential.match(/\b\d{4,}\b/g) || [];

  [...emailMatches, ...idMatches, ...longNumberMatches]
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length >= 4)
    .forEach((entry) => {
      const normalized = entry.toLowerCase();
      if (!normalized) return;
      if (sharedLower.includes(normalized)) return;
      tokenSet.add(normalized);
    });

  return [...tokenSet].slice(0, 240);
}

function assertMiddlemanConfidentiality(report: ContractEvaluationReport, params: {
  confidentialChunks: DocumentEvidenceChunk[];
  sharedChunks: DocumentEvidenceChunk[];
  rawTextLength?: number;
}) {
  const reportStrings = collectStringValues(report);
  const reportNormalized = normalizeForComparison(reportStrings.join(' '));
  const reportLower = reportStrings.join(' ').toLowerCase();
  if (!reportNormalized && !reportLower) {
    return;
  }

  // Only check for confidential leaks if there's meaningful shared content to compare against
  // If shared is empty/minimal, the confidentiality check creates false positives
  const sharedText = params.sharedChunks.map((chunk) => chunk.text).join(' ');
  const sharedLength = normalizeForComparison(sharedText).length;
  if (sharedLength < 100) {
    return; // Not enough shared content to meaningfully detect leaks
  }

  const phraseCandidates = buildConfidentialPhraseCandidates(params.confidentialChunks, params.sharedChunks);
  const leakedPhrase = phraseCandidates.find((candidate) => reportNormalized.includes(candidate));
  if (leakedPhrase) {
    throw invalidModelOutput('Confidential content leaked into shared report output', {
      reasonCode: 'confidential_leak_detected',
      leakType: 'confidential_substring',
      leakSample: leakedPhrase.slice(0, 120),
      rawTextLength: params.rawTextLength ?? 0,
    });
  }

  const sensitiveTokens = extractSensitiveConfidentialTokens(params.confidentialChunks, params.sharedChunks);
  const leakedToken = sensitiveTokens.find((token) => reportLower.includes(token));
  if (leakedToken) {
    throw invalidModelOutput('Confidential identifiers leaked into shared report output', {
      reasonCode: 'confidential_leak_detected',
      leakType: 'confidential_token',
      leakSample: leakedToken.slice(0, 120),
      rawTextLength: params.rawTextLength ?? 0,
    });
  }
}

async function waitForRetryBackoff(attemptNumber: number, baseMs = 350) {
  const exponent = Math.max(0, attemptNumber - 1);
  const jitter = Math.floor(Math.random() * 160);
  const delayMs = Math.min(1500, baseMs * Math.pow(2, exponent) + jitter);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isTransientVertexFailure(error: unknown) {
  const code = asLower((error as any)?.code);
  const status = Number((error as any)?.statusCode || (error as any)?.status || 0);
  const upstreamStatus = Number((error as any)?.extra?.upstreamStatus || 0);
  if (code === 'vertex_timeout') {
    return true;
  }
  if (code === 'vertex_request_failed') {
    if ([429, 500, 502, 503, 504].includes(upstreamStatus)) {
      return true;
    }
    if ([429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }
  if (status >= 500 && status <= 599) {
    return true;
  }
  return false;
}

function isMalformedModelFailure(error: unknown) {
  return asLower((error as any)?.code) === 'invalid_model_output';
}

function withAttemptHistory(error: unknown, attempts: ContractEvaluationResult['attempt_history']) {
  const history = Array.isArray(attempts) ? attempts : [];
  if (error instanceof ApiError) {
    const existingExtra =
      error.extra && typeof error.extra === 'object' && !Array.isArray(error.extra) ? error.extra : {};
    return new ApiError(error.statusCode, error.code, error.message, {
      ...existingExtra,
      attemptHistory: history,
      attemptCount: history.length,
      reasonCode:
        asText((existingExtra as any).reasonCode) ||
        asText((existingExtra as any).parseErrorName) ||
        null,
    });
  }
  const message = error instanceof Error ? error.message : 'Vertex evaluation failed';
  return new ApiError(502, 'vertex_request_failed', message, {
    attemptHistory: history,
    attemptCount: history.length,
  });
}

export async function evaluateProposalWithVertex(
  input: ProposalInput,
  telemetry: EvaluationTelemetry = {},
): Promise<ContractEvaluationResult> {
  const normalizedInput = normalizeProposalInput(input);
  const heuristics = buildProposalHeuristics(normalizedInput);

  let report: ContractEvaluationReport;
  let provider: 'vertex' | 'mock' = 'vertex';
  let model = asText(process.env.VERTEX_MODEL) || 'gemini-2.0-flash-001';
  let fallbackReason: string | null = null;
  const attemptHistory: ContractEvaluationResult['attempt_history'] = [];
  let debug:
    | {
        raw_model_text?: string;
        raw_model_text_length: number;
      }
    | undefined;

  if (String(process.env.VERTEX_MOCK || '').trim() === '1') {
    provider = 'mock';
    model = 'vertex-mock';
    fallbackReason = 'vertex_mock_enabled';
    report = buildMockProposalReport(normalizedInput, heuristics);
    attemptHistory.push({
      attempt: 1,
      provider: 'mock',
      model,
      status: 'success',
      retry_scheduled: false,
    });
  } else {
    const basePrompt = buildProposalPrompt(normalizedInput, heuristics);
    let prompt = basePrompt;
    let transientRetryCount = 0;
    let formatRetryCount = 0;
    let schemaRepairRetryCount = 0;
    let attempt = 0;
    
    while (true) {
      attempt += 1;
      try {
        const vertex = await callVertex(prompt, {
          ...telemetry,
          promptLabel: 'proposal',
          inputChars: JSON.stringify({
            templateId: normalizedInput.templateId,
            templateName: normalizedInput.templateName,
            responses: normalizedInput.responses,
            rubric: normalizedInput.rubric || null,
            computedSignals: normalizedInput.computedSignals || null,
          }).length,
        });
        model = vertex.model;
        
        if (shouldPersistRawModelOutput()) {
          debug = {
            raw_model_text_length: String(vertex.text || '').length,
            raw_model_text: String(vertex.text || '').slice(0, 12000),
          };
        }

        // Check for empty output
        const rawText = String(vertex.text || '').trim();
        if (!rawText) {
          throw invalidModelOutput('Model returned empty output', {
            model: vertex.model,
            reasonCode: 'empty_output',
            parseErrorKind: 'empty_output',
            textLength: 0,
            rawTextLength: 0,
            hadJsonFence: false,
            finishReason: asText((vertex as any)?.finishReason) || null,
            parseErrorName: 'empty_output',
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind: 'empty_output',
              rawTextLength: 0,
              hadJsonFence: false,
              finishReason: asText((vertex as any)?.finishReason) || null,
            }),
          });
        }

        // Check for truncated output
        if (isLikelyTruncatedModelOutput(rawText)) {
          throw invalidModelOutput('Model output appears truncated', {
            model: vertex.model,
            reasonCode: 'truncated_output',
            parseErrorKind: 'truncated_output',
            textLength: rawText.length,
            rawTextLength: rawText.length,
            hadJsonFence: hasJsonFence(rawText),
            finishReason: asText((vertex as any)?.finishReason) || null,
            parseErrorName: 'truncated_output',
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind: 'truncated_output',
              rawTextLength: rawText.length,
              hadJsonFence: hasJsonFence(rawText),
              finishReason: asText((vertex as any)?.finishReason) || null,
            }),
          });
        }

        // Parse JSON with comprehensive diagnostics
        const parsedResult = parseModelJsonWithDiagnostics(rawText);
        const parsed = parsedResult.parsed;
        
        if (!parsed) {
          const parseErrorKind = parsedResult.diagnostics.parseErrorKind || 'json_parse_error';
          throw invalidModelOutput('Model output was not valid JSON', {
            model: vertex.model,
            reasonCode: parseErrorKind,
            parseErrorKind,
            textLength: parsedResult.diagnostics.rawTextLength,
            rawTextLength: parsedResult.diagnostics.rawTextLength,
            hadJsonFence: parsedResult.diagnostics.hadJsonFence,
            finishReason: asText((vertex as any)?.finishReason) || null,
            parseErrorName: parseErrorKind,
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind,
              rawTextLength: parsedResult.diagnostics.rawTextLength,
              hadJsonFence: parsedResult.diagnostics.hadJsonFence,
              finishReason: asText((vertex as any)?.finishReason) || null,
            }),
          });
        }

        // Validate schema
        try {
          report = normalizeContractReport(parsed, { mode: 'proposal' });
        } catch (error: any) {
          if (!isInvalidModelOutputError(error)) {
            throw error;
          }
          // Extract schema diagnostics
          const schemaError = error as any;
          const schemaMissingKeys = Array.isArray(schemaError?.extra?.schemaMissingKeys)
            ? (schemaError.extra.schemaMissingKeys as unknown[]).map((entry) => asText(entry)).filter(Boolean)
            : [];
          
          throw invalidModelOutput('Model output did not match required evaluation schema', {
            model: vertex.model,
            reasonCode: 'schema_validation_error',
            parseErrorKind: 'schema_validation_error',
            textLength: parsedResult.diagnostics.rawTextLength,
            rawTextLength: parsedResult.diagnostics.rawTextLength,
            hadJsonFence: parsedResult.diagnostics.hadJsonFence,
            finishReason: asText((vertex as any)?.finishReason) || null,
            schemaMissingKeys,
            parseErrorName: 'schema_validation_error',
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind: 'schema_validation_error',
              rawTextLength: parsedResult.diagnostics.rawTextLength,
              hadJsonFence: parsedResult.diagnostics.hadJsonFence,
              finishReason: asText((vertex as any)?.finishReason) || null,
              schemaMissingKeys,
            }),
          });
        }

        attemptHistory.push({
          attempt,
          provider: 'vertex',
          model: vertex.model,
          status: 'success',
          retry_scheduled: false,
        });
        break;
      } catch (error: any) {
        const errorCode = asLower(error?.code);
        const parseErrorKind = asLower(error?.extra?.parseErrorKind || error?.extra?.reasonCode) || null;
        const reasonCode = parseErrorKind || asText(error?.extra?.reasonCode) || null;
        const transient = isTransientVertexFailure(error);
        const malformed = isMalformedModelFailure(error);
        
        // Determine retry strategy
        const shouldRetryTransient = transient && !malformed && transientRetryCount < MAX_TRANSIENT_RETRIES;
        const shouldRetryFormat =
          malformed &&
          (parseErrorKind === 'truncated_output' || parseErrorKind === 'empty_output') &&
          formatRetryCount < MAX_FORMAT_OUTPUT_RETRIES;
        const shouldRetrySchemaRepair =
          malformed &&
          parseErrorKind === 'schema_validation_error' &&
          schemaRepairRetryCount < MAX_SCHEMA_REPAIR_RETRIES;
        const shouldRetryMalformed =
          malformed &&
          parseErrorKind !== 'confidential_leak_detected' &&
          (shouldRetryFormat || shouldRetrySchemaRepair);
        const shouldRetry = shouldRetryTransient || shouldRetryMalformed;

        if (process.env.NODE_ENV !== 'production' && malformed) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'vertex_parse_failure',
              correlationId: asText(telemetry?.correlationId) || null,
              routeName: asText(telemetry?.routeName) || null,
              entityId: asText(telemetry?.entityId) || null,
              attempt,
              parse_error_kind: parseErrorKind || null,
              raw_text_length: toNumber(error?.extra?.rawTextLength ?? error?.extra?.textLength, 0),
              had_json_fence: Boolean(error?.extra?.hadJsonFence),
              finish_reason: asText(error?.extra?.finishReason) || null,
              schema_missing_keys: Array.isArray(error?.extra?.schemaMissingKeys)
                ? (error.extra.schemaMissingKeys as unknown[]).map((entry) => asText(entry)).filter(Boolean).slice(0, 40)
                : [],
              retry_scheduled: shouldRetry,
            }),
          );
        }

        attemptHistory.push({
          attempt,
          provider: 'vertex',
          model: asText(error?.extra?.model) || model || null,
          status: 'failed',
          error_code: errorCode || 'unknown_error',
          reason_code: reasonCode,
          retry_scheduled: shouldRetry,
        });

        if (!shouldRetry) {
          throw withAttemptHistory(error, attemptHistory);
        }

        if (shouldRetryTransient) {
          transientRetryCount += 1;
        } else if (shouldRetrySchemaRepair) {
          schemaRepairRetryCount += 1;
          const missingKeys = Array.isArray(error?.extra?.schemaMissingKeys)
            ? (error.extra.schemaMissingKeys as unknown[]).map((entry) => asText(entry)).filter(Boolean)
            : [];
          prompt = buildProposalRepairPrompt(basePrompt, {
            parseErrorKind: 'schema_validation_error',
            schemaMissingKeys: missingKeys,
          });
        } else if (shouldRetryFormat) {
          formatRetryCount += 1;
          prompt = basePrompt;
        }
        
        await waitForRetryBackoff(attempt);
      }
    }
  }

  report = applyProposalHeuristics(report, heuristics);
  report = sanitizeAndValidateHiddenCompliance(report, collectHiddenResponseSnippets(normalizedInput.responses));

  return finalizeEvaluationResult(report, {
    provider,
    model,
    attemptHistory,
    fallbackReason,
    debug,
  });
}

export async function evaluateDocumentComparisonWithVertex(
  input: ComparisonInput,
  telemetry: EvaluationTelemetry = {},
): Promise<ContractEvaluationResult> {
  const normalizedInput = normalizeComparisonInput(input);
  assertComparisonInputForEvaluation(normalizedInput);
  const heuristics = buildComparisonHeuristics(normalizedInput);
  const evidenceMap = buildDocumentComparisonEvidenceMap(normalizedInput);

  let report: ContractEvaluationReport;
  let provider: 'vertex' | 'mock' = 'vertex';
  let model = asText(process.env.VERTEX_MODEL) || 'gemini-2.0-flash-001';
  let fallbackReason: string | null = null;
  const attemptHistory: ContractEvaluationResult['attempt_history'] = [];
  let debug:
    | {
        raw_model_text?: string;
        raw_model_text_length: number;
      }
    | undefined;
  let lastSuccessfulVertexTextLength = 0;

  if (String(process.env.VERTEX_MOCK || '').trim() === '1') {
    provider = 'mock';
    model = 'vertex-mock';
    fallbackReason = 'vertex_mock_enabled';
    report = buildMockComparisonReport(normalizedInput, heuristics);
    attemptHistory.push({
      attempt: 1,
      provider: 'mock',
      model,
      status: 'success',
      retry_scheduled: false,
    });
  } else {
    const basePrompt = buildDocumentComparisonPrompt(normalizedInput, heuristics, evidenceMap);
    let prompt = basePrompt;
    let transientRetryCount = 0;
    let formatRetryCount = 0;
    let schemaRepairRetryCount = 0;
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const vertex = await callVertex(prompt, {
          ...telemetry,
          promptLabel: 'document_comparison',
          inputChars: normalizedInput.docAText.length + normalizedInput.docBText.length,
        });
        model = vertex.model;
        if (shouldPersistRawModelOutput()) {
          debug = {
            raw_model_text_length: String(vertex.text || '').length,
            raw_model_text: String(vertex.text || '').slice(0, 12000),
          };
        }

        if (isLikelyTruncatedModelOutput(vertex.text)) {
          const rawText = String(vertex.text || '');
          const hadJsonFence = hasJsonFence(rawText);
          throw invalidModelOutput('Model output appears truncated', {
            model: vertex.model,
            reasonCode: 'truncated_output',
            parseErrorKind: 'truncated_output',
            textLength: rawText.length,
            rawTextLength: rawText.length,
            hadJsonFence,
            finishReason: asText((vertex as any)?.finishReason) || null,
            responseKeys: Array.isArray((vertex as any).responseKeys) ? (vertex as any).responseKeys : [],
            candidateCount: Number((vertex as any).candidateCount || 0),
            firstCandidateKeys: Array.isArray((vertex as any).firstCandidateKeys)
              ? (vertex as any).firstCandidateKeys
              : [],
            firstPartKeys: Array.isArray((vertex as any).firstPartKeys) ? (vertex as any).firstPartKeys : [],
            parseErrorName: 'truncated_output',
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind: 'truncated_output',
              rawTextLength: rawText.length,
              hadJsonFence,
              finishReason: asText((vertex as any)?.finishReason) || null,
            }),
            rawModelText: shouldPersistRawModelOutput() ? String(vertex.text || '').slice(0, 12000) : undefined,
          });
        }

        const parsedResult = parseModelJsonWithDiagnostics(vertex.text);
        const parsed = parsedResult.parsed;
        if (!parsed) {
          const parseErrorKind = parsedResult.diagnostics.parseErrorKind || 'json_parse_error';
          throw invalidModelOutput('Model output was not valid JSON', {
            model: vertex.model,
            reasonCode: parseErrorKind,
            parseErrorKind,
            textLength: parsedResult.diagnostics.rawTextLength,
            rawTextLength: parsedResult.diagnostics.rawTextLength,
            hadJsonFence: parsedResult.diagnostics.hadJsonFence,
            finishReason: asText((vertex as any)?.finishReason) || null,
            responseKeys: Array.isArray((vertex as any).responseKeys) ? (vertex as any).responseKeys : [],
            candidateCount: Number((vertex as any).candidateCount || 0),
            firstCandidateKeys: Array.isArray((vertex as any).firstCandidateKeys)
              ? (vertex as any).firstCandidateKeys
              : [],
            firstPartKeys: Array.isArray((vertex as any).firstPartKeys) ? (vertex as any).firstPartKeys : [],
            parseErrorName: parseErrorKind,
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind,
              rawTextLength: parsedResult.diagnostics.rawTextLength,
              hadJsonFence: parsedResult.diagnostics.hadJsonFence,
              finishReason: asText((vertex as any)?.finishReason) || null,
            }),
            rawModelText: shouldPersistRawModelOutput() ? String(vertex.text || '').slice(0, 12000) : undefined,
          });
        }
        const schemaDiagnostics = collectDocumentComparisonSchemaDiagnostics(parsed);
        try {
          report = normalizeDocumentComparisonReport(parsed, {
            partyALabel: normalizedInput.partyALabel,
            partyBLabel: normalizedInput.partyBLabel,
            evidenceChunks: {
              shared_chunks: evidenceMap.shared_chunks,
              confidential_chunks: evidenceMap.confidential_chunks,
            },
          });
          lastSuccessfulVertexTextLength = String(vertex.text || '').length;
        } catch (error: any) {
          if (!isInvalidModelOutputError(error)) {
            throw error;
          }
          const schemaMissingKeys = schemaDiagnostics.schemaMissingKeys;
          const categoryCount = schemaDiagnostics.categoryCount;
          throw invalidModelOutput('Model output did not match required evaluation schema', {
            model: vertex.model,
            reasonCode: 'schema_validation_error',
            parseErrorKind: 'schema_validation_error',
            textLength: parsedResult.diagnostics.rawTextLength,
            rawTextLength: parsedResult.diagnostics.rawTextLength,
            hadJsonFence: parsedResult.diagnostics.hadJsonFence,
            finishReason: asText((vertex as any)?.finishReason) || null,
            schemaMissingKeys,
            categoryCount,
            responseKeys: Array.isArray((vertex as any).responseKeys) ? (vertex as any).responseKeys : [],
            candidateCount: Number((vertex as any).candidateCount || 0),
            firstCandidateKeys: Array.isArray((vertex as any).firstCandidateKeys)
              ? (vertex as any).firstCandidateKeys
              : [],
            firstPartKeys: Array.isArray((vertex as any).firstPartKeys) ? (vertex as any).firstPartKeys : [],
            parseErrorName: 'schema_validation_error',
            parseErrorMessage: buildParseDiagnosticsMessage({
              parseErrorKind: 'schema_validation_error',
              rawTextLength: parsedResult.diagnostics.rawTextLength,
              hadJsonFence: parsedResult.diagnostics.hadJsonFence,
              finishReason: asText((vertex as any)?.finishReason) || null,
              schemaMissingKeys,
              categoryCount,
            }),
            rawModelText: shouldPersistRawModelOutput() ? String(vertex.text || '').slice(0, 12000) : undefined,
          });
        }

        attemptHistory.push({
          attempt,
          provider: 'vertex',
          model: vertex.model,
          status: 'success',
          retry_scheduled: false,
        });
        break;
      } catch (error: any) {
        const errorCode = asLower(error?.code);
        const parseErrorKind = asLower(error?.extra?.parseErrorKind || error?.extra?.reasonCode) || null;
        const reasonCode = parseErrorKind || asText(error?.extra?.reasonCode) || null;
        const transient = isTransientVertexFailure(error);
        const malformed = isMalformedModelFailure(error);
        // Malformed model output has strict retry controls based on parse error kind.
        const shouldRetryTransient = transient && !malformed && transientRetryCount < MAX_TRANSIENT_RETRIES;
        const shouldRetryFormat =
          malformed &&
          (parseErrorKind === 'truncated_output' || parseErrorKind === 'empty_output') &&
          formatRetryCount < MAX_FORMAT_OUTPUT_RETRIES;
        const shouldRetrySchemaRepair =
          malformed &&
          parseErrorKind === 'schema_validation_error' &&
          schemaRepairRetryCount < MAX_SCHEMA_REPAIR_RETRIES;
        const shouldRetryMalformed =
          malformed &&
          parseErrorKind !== 'confidential_leak_detected' &&
          (shouldRetryFormat || shouldRetrySchemaRepair);
        const shouldRetry = shouldRetryTransient || shouldRetryMalformed;

        if (process.env.NODE_ENV !== 'production' && malformed) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'vertex_parse_failure',
              correlationId: asText(telemetry?.correlationId) || null,
              routeName: asText(telemetry?.routeName) || null,
              entityId: asText(telemetry?.entityId) || null,
              attempt,
              parse_error_kind: parseErrorKind || null,
              raw_text_length: toNumber(error?.extra?.rawTextLength ?? error?.extra?.textLength, 0),
              had_json_fence: Boolean(error?.extra?.hadJsonFence),
              finish_reason: asText(error?.extra?.finishReason) || null,
              schema_missing_keys: Array.isArray(error?.extra?.schemaMissingKeys)
                ? (error.extra.schemaMissingKeys as unknown[]).map((entry) => asText(entry)).filter(Boolean).slice(0, 40)
                : [],
              category_count: Number.isFinite(Number(error?.extra?.categoryCount))
                ? Number(error.extra.categoryCount)
                : null,
              retry_scheduled: shouldRetry,
            }),
          );
        }

        attemptHistory.push({
          attempt,
          provider: 'vertex',
          model: asText(error?.extra?.model) || model || null,
          status: 'failed',
          error_code: errorCode || 'unknown_error',
          reason_code: reasonCode,
          retry_scheduled: shouldRetry,
        });

        if (!shouldRetry) {
          throw withAttemptHistory(error, attemptHistory);
        }

        if (shouldRetryTransient) {
          transientRetryCount += 1;
        } else if (shouldRetrySchemaRepair) {
          schemaRepairRetryCount += 1;
          const missingKeys = Array.isArray(error?.extra?.schemaMissingKeys)
            ? (error.extra.schemaMissingKeys as unknown[]).map((entry) => asText(entry)).filter(Boolean)
            : [];
          const categoryCount = Number.isFinite(Number(error?.extra?.categoryCount))
            ? Number(error.extra.categoryCount)
            : null;
          prompt = buildDocumentComparisonRepairPrompt(basePrompt, {
            parseErrorKind: 'schema_validation_error',
            schemaMissingKeys: missingKeys,
            categoryCount,
          });
        } else if (shouldRetryFormat) {
          formatRetryCount += 1;
          prompt = basePrompt;
        }
        await waitForRetryBackoff(attempt);
      }
    }
  }

  report = applyComparisonHeuristics(report, heuristics);
  report = sanitizeAndValidateHiddenCompliance(report, [
    ...collectHiddenSpanSnippets(normalizedInput.docAText, normalizedInput.docASpans),
    ...collectHiddenSpanSnippets(normalizedInput.docBText, normalizedInput.docBSpans),
  ]);
  if (!telemetry.disableConfidentialLeakGuard) {
    assertMiddlemanConfidentiality(report, {
      confidentialChunks: evidenceMap.confidential_chunks,
      sharedChunks: evidenceMap.shared_chunks,
      rawTextLength: String(process.env.VERTEX_MOCK || '').trim() === '1' ? 0 : lastSuccessfulVertexTextLength,
    });
  }
  const hasSpecificGrounding = ensureDocumentComparisonSpecificity(report, normalizedInput.docBText);
  if (!hasSpecificGrounding) {
    throw new ApiError(502, 'insufficient_detail', 'Model output lacked references to shared input', {
      reasonCode: 'missing_shared_reference',
    });
  }

  return finalizeEvaluationResult(report, {
    provider,
    model,
    attemptHistory,
    fallbackReason,
    debug,
    similarityScore: heuristics.similarityScore,
    deltaCharacters: heuristics.deltaCharacters,
    confidentialitySpans: heuristics.confidentialitySpans,
  });
}
