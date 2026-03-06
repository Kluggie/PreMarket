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

// ─── Default model routing constants ────────────────────────────────────────
// Override via env vars — no code change required to switch models.
// VERTEX_DOC_COMPARE_GENERATION_MODEL: main report quality model
// VERTEX_DOC_COMPARE_VERIFIER_MODEL:   cheap/fast leak-check model
// VERTEX_DOC_COMPARE_EXTRACT_MODEL:    Pass A fact-sheet extraction model
const DEFAULT_GENERATION_MODEL = 'gemini-2.5-pro';
const DEFAULT_VERIFIER_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_EXTRACT_MODEL = 'gemini-2.5-flash-lite';

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
  /** Hint to real implementation — ignored by mocks. */
  maxOutputTokens?: number;
  /** Preferred model to use; implementation may fall back to candidates if unavailable. */
  preferredModel?: string;
}) => Promise<VertexCallResponse>;

export interface VertexEvaluationV2Request {
  sharedText: string;
  confidentialText: string;
  requestId?: string;
  forbiddenLeakText?: string;
  forbiddenLeakCanaryTokens?: string[];
  enforceLeakGuard?: boolean;
  /** Model for Pass B (final evaluation). Defaults to VERTEX_DOC_COMPARE_GENERATION_MODEL or gemini-2.5-pro. */
  generationModel?: string;
  /** Model for the LLM leak-verifier step. Defaults to VERTEX_DOC_COMPARE_VERIFIER_MODEL or gemini-2.5-flash-lite. */
  verifierModel?: string;
  /** Model for Pass A (fact-sheet extraction). Defaults to VERTEX_DOC_COMPARE_EXTRACT_MODEL or verifierModel. */
  extractModel?: string;
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

// ─── Fact Sheet (Pass A output) ─────────────────────────────────────────────

interface FactSheetRisk {
  risk: string;
  impact: 'low' | 'med' | 'high';
  likelihood: 'low' | 'med' | 'high';
}

interface ProposalFactSheetCoverage {
  has_scope: boolean;
  has_timeline: boolean;
  has_kpis: boolean;
  has_constraints: boolean;
  has_risks: boolean;
}

interface ProposalFactSheet {
  project_goal: string | null;
  scope_deliverables: string[];
  timeline: { start: string | null; duration: string | null; milestones: string[] };
  constraints: string[];
  success_criteria_kpis: string[];
  vendor_preferences: string[];
  assumptions: string[];
  risks: FactSheetRisk[];
  open_questions: string[];
  missing_info: string[];
  source_coverage: ProposalFactSheetCoverage;
}

// ─── Report style (deterministic consultant voice selection) ───────────────

type StyleId = 'analytical' | 'direct' | 'collaborative';
type Ordering = 'risks_first' | 'strengths_first' | 'balanced';
type Verbosity = 'tight' | 'standard' | 'deep';

interface ReportStyle {
  style_id: StyleId;
  ordering: Ordering;
  verbosity: Verbosity;
  seed: number;
}

const STYLE_IDS: StyleId[] = ['analytical', 'direct', 'collaborative'];
const ORDERINGS: Ordering[] = ['risks_first', 'strengths_first', 'balanced'];
const VERBOSITIES: Verbosity[] = ['tight', 'standard', 'deep'];

/**
 * djb2-variant hash → integer 0-9999.
 * Stable: same input always produces the same seed.
 * Prefers proposalId/token when available so the style is proposal-scoped.
 */
export function computeReportStyleSeed(params: {
  proposalTextExcerpt: string;
  proposalId?: string;
  token?: string;
}): number {
  const input = params.proposalId || params.token || params.proposalTextExcerpt;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // djb2: hash * 33 XOR char
    hash = (((hash << 5) + hash) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash % 10_000;
}

/** Pure, deterministic: same seed → same style. */
export function selectReportStyle(seed: number): ReportStyle {
  return {
    style_id: STYLE_IDS[seed % 3],
    ordering: ORDERINGS[Math.floor(seed / 3) % 3],
    verbosity: VERBOSITIES[Math.floor(seed / 9) % 3],
    seed,
  };
}

// ─── Telemetry (safe, internal-only) ────────────────────────────────────────
// NEVER includes raw proposal text, extracted strings, or identifiers.
// Safe to log for observability (coverage distribution, clamp frequency, style).

export interface VertexEvaluationV2Telemetry {
  version: 'eval_v2';
  // Coverage signals (booleans only — no extracted text)
  coverageCount: number;
  coverageFlags: {
    has_scope: boolean;
    has_timeline: boolean;
    has_kpis: boolean;
    has_constraints: boolean;
    has_risks: boolean;
  };
  // Post-processing
  clampsApplied: string[];
  identicalTiers: boolean;
  // Output signals (values/counts only)
  fit_level: string;
  confidence_0_1: number;
  missingCount: number;
  redactionsCount: number;
  // Input size signals (counts only — no text)
  sharedChars: number;
  confidentialChars: number;
  proposalChars: number;
  sharedChunkCount: number;
  confidentialChunkCount: number;
  // Style
  reportStyle: {
    style_id: StyleId;
    ordering: Ordering;
    verbosity: Verbosity;
    seed: number;
  };
  // Optional timestamp for time-series drift detection
  timestampMs?: number;
}

// Internal debug metadata — attached to VertexEvaluationV2Result for
// server-side logging; never serialised to the client response.
export interface VertexEvaluationV2Internal {
  fact_sheet: ProposalFactSheet;
  coverage_count: number;
  caps_applied: string[];
  pass_a_parse_error: boolean;
  pass_b_attempt_count: number;
  report_style: ReportStyle;
  telemetry?: VertexEvaluationV2Telemetry;
  /** Non-empty when a safe fallback was used instead of a hard failure. */
  warnings?: string[];
  /** Set when fallback was used due to a model failure. */
  failure_kind?: string;
  /** Actual models used for each step (server-side only). */
  models_used?: {
    generation: string;
    extract: string;
    verifier: string;
    verifier_escalated: boolean;
    verifier_used: boolean;
    /** True when verifier threw / timed out / could not reach a verdict after escalation. */
    verifier_unavailable: boolean;
  };
}

export interface VertexEvaluationV2Result {
  ok: true;
  data: VertexEvaluationV2Response;
  attempt_count: number;
  model: string;
  /** Configured generation model (may differ from model when fallback candidates are used). */
  generation_model?: string;
  /** Server-side only. Do not forward to clients. */
  _internal?: VertexEvaluationV2Internal;
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

// ─── Pass A: Fact Sheet extraction ──────────────────────────────────────────

const FACT_SHEET_SCHEMA_EXAMPLE = {
  project_goal: 'string or null',
  scope_deliverables: ['string'],
  timeline: { start: 'string or null', duration: 'string or null', milestones: ['string'] },
  constraints: ['string'],
  success_criteria_kpis: ['string'],
  vendor_preferences: ['string'],
  assumptions: ['string'],
  risks: [{ risk: 'string', impact: 'low|med|high', likelihood: 'low|med|high' }],
  open_questions: ['string'],
  missing_info: ['string'],
  source_coverage: {
    has_scope: true,
    has_timeline: true,
    has_kpis: true,
    has_constraints: true,
    has_risks: true,
  },
};

function buildFactSheetPrompt(proposalTextExcerpt: string, strict = false): string {
  const strictNote = strict
    ? 'STRICT MODE: Output ONLY valid JSON. No text before or after the JSON object. No markdown.'
    : '';
  return [
    'SYSTEM: You are a structured information extractor for business proposals.',
    'Extract verifiable facts from the proposal text provided. Do not invent, assume, or infer.',
    'Treat the full proposal text as one document (it has a SHARED section and a CONFIDENTIAL section).',
    'DO NOT compare the two sections for consistency. Use both as unified context.',
    '',
    'CONFIDENTIALITY RULES:',
    '- Paraphrase only. Never copy verbatim text from the CONFIDENTIAL section.',
    '- Never include raw numbers, IDs, emails, pricing, or identifiers from the CONFIDENTIAL section.',
    '',
    'INSTRUCTIONS:',
    '- For each field, extract what the text explicitly supports. If a field is not supported, leave it null or empty [].',
    '- For missing_info: list any critical fields that are absent or too vague to extract.',
    '- For source_coverage: set each boolean to true ONLY if the proposal contains concrete, specific information',
    '  (not vague/placeholder language) for that dimension.',
    '  - has_scope: concrete deliverables or scope items are present.',
    '  - has_timeline: a start date, duration, or specific milestones are present.',
    '  - has_kpis: success criteria or KPIs are explicitly defined.',
    '  - has_constraints: constraints, limitations, or boundaries are stated.',
    '  - has_risks: identified risks with some description are present.',
    '',
    strictNote,
    'Output MUST be valid JSON only. No markdown, no backticks, no preamble.',
    'Required JSON schema:',
    JSON.stringify(FACT_SHEET_SCHEMA_EXAMPLE, null, 2),
    'PROPOSAL TEXT:',
    proposalTextExcerpt.slice(0, MAX_SHARED_CHARS + MAX_CONFIDENTIAL_CHARS),
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeCoverageBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 'true') return true;
  if (value === 0 || value === 'false' || value === null) return false;
  return false;
}

function validateFactSheet(raw: unknown): { ok: true; sheet: ProposalFactSheet } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'root_not_object' };
  }
  const r = raw as Record<string, unknown>;

  const timeline = (r.timeline && typeof r.timeline === 'object' && !Array.isArray(r.timeline))
    ? (r.timeline as Record<string, unknown>)
    : {};

  const coverage = (r.source_coverage && typeof r.source_coverage === 'object' && !Array.isArray(r.source_coverage))
    ? (r.source_coverage as Record<string, unknown>)
    : {};

  const risks: FactSheetRisk[] = [];
  if (Array.isArray(r.risks)) {
    for (const entry of r.risks) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        const impact = asLower(e.impact);
        const likelihood = asLower(e.likelihood);
        risks.push({
          risk: asText(e.risk) || 'Unknown risk',
          impact: (impact === 'low' || impact === 'med' || impact === 'high') ? impact : 'low',
          likelihood: (likelihood === 'low' || likelihood === 'med' || likelihood === 'high') ? likelihood : 'low',
        });
      }
    }
  }

  const sheet: ProposalFactSheet = {
    project_goal: r.project_goal == null ? null : asText(r.project_goal) || null,
    scope_deliverables: toStringArray(r.scope_deliverables),
    timeline: {
      start: timeline.start == null ? null : asText(timeline.start) || null,
      duration: timeline.duration == null ? null : asText(timeline.duration) || null,
      milestones: toStringArray(timeline.milestones),
    },
    constraints: toStringArray(r.constraints),
    success_criteria_kpis: toStringArray(r.success_criteria_kpis),
    vendor_preferences: toStringArray(r.vendor_preferences),
    assumptions: toStringArray(r.assumptions),
    risks,
    open_questions: toStringArray(r.open_questions),
    missing_info: toStringArray(r.missing_info),
    source_coverage: {
      has_scope: normalizeCoverageBoolean(coverage.has_scope),
      has_timeline: normalizeCoverageBoolean(coverage.has_timeline),
      has_kpis: normalizeCoverageBoolean(coverage.has_kpis),
      has_constraints: normalizeCoverageBoolean(coverage.has_constraints),
      has_risks: normalizeCoverageBoolean(coverage.has_risks),
    },
  };

  return { ok: true, sheet };
}

function fallbackFactSheet(missingInfoItems: string[] = []): ProposalFactSheet {
  return {
    project_goal: null,
    scope_deliverables: [],
    timeline: { start: null, duration: null, milestones: [] },
    constraints: [],
    success_criteria_kpis: [],
    vendor_preferences: [],
    assumptions: [],
    risks: [],
    open_questions: [],
    missing_info: missingInfoItems.length
      ? missingInfoItems
      : ['Fact extraction failed — proposal content could not be parsed.'],
    source_coverage: {
      has_scope: false,
      has_timeline: false,
      has_kpis: false,
      has_constraints: false,
      has_risks: false,
    },
  };
}

function computeCoverageCount(coverage: ProposalFactSheetCoverage): number {
  return [
    coverage.has_scope,
    coverage.has_timeline,
    coverage.has_kpis,
    coverage.has_constraints,
    coverage.has_risks,
  ].filter(Boolean).length;
}

async function extractProposalFactsV2(params: {
  proposalTextExcerpt: string;
  requestId?: string;
  callVertex: VertexCallOverride;
  /** Preferred model for Pass A fact-sheet extraction. */
  preferredModel?: string;
}): Promise<{ sheet: ProposalFactSheet; parseError: boolean }> {
  const inputChars = params.proposalTextExcerpt.length;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const strict = attempt === 2;
    const prompt = buildFactSheetPrompt(params.proposalTextExcerpt, strict);

    let vertexResp: VertexCallResponse;
    try {
      vertexResp = await params.callVertex({
        prompt,
        requestId: params.requestId,
        inputChars,
        preferredModel: params.preferredModel,
      });
    } catch {
      // Vertex call failed — return fallback immediately
      return { sheet: fallbackFactSheet(['Fact extraction call failed.']), parseError: true };
    }

    const rawText = String(vertexResp.text || '');
    if (!rawText.trim()) continue;
    if (isLikelyTruncatedOutput(rawText, vertexResp.finishReason)) continue;

    const extracted = parseJsonObject(rawText);
    if (!extracted.parsed) continue;

    const validation = validateFactSheet(extracted.parsed);
    if (validation.ok) {
      return { sheet: validation.sheet, parseError: false };
    }
    // Validation failed — try again (strict mode on attempt 2)
  }

  return { sheet: fallbackFactSheet(), parseError: true };
}

// ─── Pass B: Final evaluation prompt ─────────────────────────────────────────

/** Returns true if any entry in arr contains any of the given keywords (case-insensitive). */
function containsAny(arr: string[], keywords: string[]): boolean {
  const lower = arr.map((s) => s.toLowerCase());
  return keywords.some((kw) => lower.some((s) => s.includes(kw)));
}

const WHY_MAX_CHARS_STANDARD = 2400;
const WHY_MAX_CHARS_TIGHT = 1400;
const MISSING_MAX_ITEMS = 10;
const REDACTIONS_MAX_ITEMS = 8;

/**
 * Safely truncates the why[] array so total chars stay under maxChars.
 * Each element is kept whole if it fits; truncated with "…" otherwise.
 */
function truncateWhyOutput(why: string[], maxChars: number): string[] {
  if (!Array.isArray(why)) return [];
  const result: string[] = [];
  let total = 0;
  for (const entry of why) {
    const text = String(entry || '');
    if (total + text.length + 1 > maxChars) {
      const remaining = maxChars - total - 1;
      if (remaining > 40) {
        result.push(text.slice(0, remaining) + '…');
      }
      break;
    }
    result.push(text);
    total += text.length + 1;
  }
  return result;
}

/**
 * Generic actionable questions used when the fact sheet has no extracted missing_info.
 * Covers the five core decision-blocking dimensions.
 */
const GENERIC_FALLBACK_MISSING: string[] = [
  'What are the specific deliverables and acceptance criteria for this project?',
  'What is the confirmed timeline — start date, key milestones, and go-live deadline?',
  'What are the measurable success criteria (KPIs) that define project success?',
  'What budget, resource, or technical constraints apply to delivery?',
  'What are the key project risks and their proposed mitigations?',
];

/**
 * Produces a safe, clamped fallback VertexEvaluationV2Response when all Vertex
 * attempts have failed. Never returns raw confidential text.
 */
function safeFallbackEvaluationFromFactSheet(
  factSheet: ProposalFactSheet,
  params: {
    failureKind: string;
    requestId?: string;
    finishReason?: string | null;
    sharedChars: number;
    confidentialChars: number;
  },
): { data: VertexEvaluationV2Response; warnings: string[] } {
  const warningKey =
    params.failureKind === 'truncated_output'
      ? 'vertex_truncated_output_fallback_used'
      : params.failureKind.startsWith('vertex_http') || params.failureKind === 'vertex_timeout'
      ? 'vertex_request_failed_fallback_used'
      : params.failureKind === 'not_configured'
      ? 'vertex_not_configured_fallback_used'
      : 'vertex_invalid_response_fallback_used';

  // Build missing[] from fact sheet's missing_info, falling back to generic questions.
  const extractedMissing = factSheet.missing_info
    .filter(Boolean)
    .map((item) => {
      const text = String(item).trim();
      // Convert statement-style items to question format if not already a question.
      return text.endsWith('?') ? text : `${text} — please clarify.`;
    })
    .slice(0, MISSING_MAX_ITEMS);

  const missing =
    extractedMissing.length >= 3
      ? extractedMissing
      : [...extractedMissing, ...GENERIC_FALLBACK_MISSING].slice(0, Math.max(3, extractedMissing.length));

  const why = [
    'Executive Summary: AI report could not be fully generated due to a model output issue. Key missing inputs are listed below to help guide next steps.',
    'Key Risks: Unable to fully assess — model did not return a complete report. Review missing items for critical gaps.',
    'Key Strengths: Unable to fully assess — insufficient model output received.',
    'Decision Readiness: Evaluation incomplete. Please address the missing items below and re-run evaluation for a fuller report.',
    'Recommendations: Ensure all required fields (scope, timeline, KPIs, constraints, risks) are populated before re-running.',
  ];

  return {
    data: {
      fit_level: 'unknown',
      confidence_0_1: 0.2,
      why,
      missing: missing.length > 0 ? missing : GENERIC_FALLBACK_MISSING.slice(0, 3),
      redactions: [],
    },
    warnings: [warningKey],
  };
}

function buildEvalPromptFromFactSheet(params: {
  factSheet: ProposalFactSheet;
  chunks: EvaluationChunks;
  reportStyle: ReportStyle;
  /** When true, uses tighter output limits to avoid truncation. */
  tightMode?: boolean;
}) {
  const { factSheet, chunks, reportStyle } = params;
  const tightMode = Boolean(params.tightMode);
  const sc = factSheet.source_coverage;
  const coverageCount = computeCoverageCount(sc);

  // ── Conditional module detection (deterministic from fact sheet) ─────────
  const hasTimeline = sc.has_timeline;
  const hasVendorPrefs = factSheet.vendor_preferences.length > 0;
  const hasCommercialSignals = containsAny(factSheet.constraints, [
    'budget', 'cost', 'price', 'pricing', 'commercial', 'contract', 'payment', 'billing', '$',
  ]);
  const hasDataSecurity = containsAny(factSheet.scope_deliverables, [
    'data', 'api', 'system', 'database', 'integration', 'security', 'cloud', 'storage', 'pipeline',
  ]);
  // Fixed-price contract signal (from vendor preferences or explicit constraint)
  const hasFixedPriceContract = containsAny(factSheet.vendor_preferences, [
    'fixed', 'fixed-price', 'fixed price', 'lump sum', 'firm fixed', 'firm price',
  ]) || containsAny(factSheet.constraints, [
    'fixed price', 'fixed-price', 'fixed contract',
  ]);
  // Urgency / aggressive-timeline signal (from constraints)
  const hasAggressiveTimeline = containsAny(factSheet.constraints, [
    'aggressive', 'tight timeline', 'hard deadline', 'asap', 'urgent',
  ]);

  // ── Required headings (always) ───────────────────────────────────────────
  const firstStrengthOrRisk =
    reportStyle.ordering === 'risks_first' ? 'Key Risks' : 'Key Strengths';
  const secondStrengthOrRisk =
    reportStyle.ordering === 'risks_first' ? 'Key Strengths' : 'Key Risks';
  const requiredHeadings = [
    // Use 'Snapshot' not 'Executive Summary' — the page header already reads 'Executive Summary';
    // using a distinct first-heading avoids a duplicated label in the rendered report.
    'Snapshot',
    firstStrengthOrRisk,
    secondStrengthOrRisk,
    'Decision Readiness',
    'Recommendations',
  ];

  // ── Optional headings (conditional on fact sheet content) ───────────────
  const optionalHeadings: string[] = [];
  if (hasTimeline) optionalHeadings.push('Implementation Notes');
  if (hasCommercialSignals) optionalHeadings.push('Commercial Notes');
  if (hasDataSecurity) optionalHeadings.push('Data & Security Notes');
  if (hasVendorPrefs) optionalHeadings.push('Vendor Fit Notes');

  // ── Voice + depth guidance ───────────────────────────────────────────────
  const voiceGuide =
    reportStyle.style_id === 'analytical'
      ? 'Voice: formal and structured. Use precise language; cite specific fact_sheet fields.'
      : reportStyle.style_id === 'direct'
      ? 'Voice: blunt and direct. Short sentences. Minimal hedging. State conclusions plainly.'
      : 'Voice: constructive and collaborative. Forward-looking language. Frame gaps as opportunities.';

  // If coverage is weak OR tight retry, force tight depth.
  const effectiveVerbosity: Verbosity = coverageCount < 3 || tightMode ? 'tight' : reportStyle.verbosity;
  const depthGuide =
    effectiveVerbosity === 'tight'
      ? 'Depth: concise. Each section: 1-2 compact paragraphs (5-8 sentences total). Prose only — do NOT convert to bullets to compress.'
      : effectiveVerbosity === 'deep'
      ? 'Depth: detailed. Each section: 3-4 paragraphs. Reference specific fact_sheet fields by name.'
      : 'Depth: standard. Each section: 2-3 paragraphs.';

  const orderingGuide =
    reportStyle.ordering === 'risks_first'
      ? 'Ordering: lead with risks, then follow with strengths.'
      : reportStyle.ordering === 'strengths_first'
      ? 'Ordering: lead with strengths, then follow with risks.'
      : 'Ordering: balance strengths and risks throughout.';

  const whyMaxChars = tightMode ? WHY_MAX_CHARS_TIGHT : WHY_MAX_CHARS_STANDARD;

  // IMPORTANT: chunk arrays are NOT sent to the model. Only counts are included.
  // The raw chunks are used code-side only for leak-guard checks after generation.
  const payload = {
    shared_chunk_count: chunks.sharedChunks.length,
    confidential_chunk_count: chunks.confidentialChunks.length,
    // Primary input: structured Fact Sheet extracted in Pass A.
    fact_sheet: factSheet,
    constraints: {
      evaluate_proposal_quality_not_alignment: true,
      confidentiality_middleman_rule: true,
      no_confidential_verbatim: true,
      no_confidential_numbers_or_identifiers: true,
      allow_safe_derived_conclusions: true,
      // Conditional advisor signals derived from the fact sheet.
      has_fixed_price_contract: hasFixedPriceContract,
      has_aggressive_timeline: hasAggressiveTimeline,
      // Output size limits — strictly enforced to avoid truncation.
      why_max_chars: whyMaxChars,
      missing_max_items: MISSING_MAX_ITEMS,
      redactions_max_items: REDACTIONS_MAX_ITEMS,
      report_style: {
        style_id: reportStyle.style_id,
        ordering: reportStyle.ordering,
        verbosity: effectiveVerbosity,
        seed: reportStyle.seed,
      },
    },
  };

  // ── Paragraph depth requirement line (matches depthGuide for test assertions) ──
  const paragraphReq =
    effectiveVerbosity === 'tight'
      ? '1-2 compact paragraphs per section'
      : effectiveVerbosity === 'deep'
      ? '3-4 paragraphs per section'
      : '2-3 paragraphs per section';

  return [
    tightMode
      ? 'STRICT COMPACT MODE: Return JSON only. No markdown. No code fences. No commentary. Output must be short.'
      : '',
    'SYSTEM: You are an expert business consultant and neutral mediator evaluating a business proposal.',
    'Your task is: evaluate the overall business proposal quality and decision-readiness.',
    '',
    'IMPORTANT — input structure:',
    '- The fact_sheet is a structured extraction of the full proposal (shared + confidential tiers combined).',
    '- Evaluate based on the fact_sheet content. The two privacy tiers are the SAME proposal.',
    '- DO NOT compare the tiers for consistency. DO NOT treat their similarity as a quality signal.',
    '',
    'CONFIDENTIALITY RULES (strictly enforced):',
    '- Never quote confidential text verbatim in your output.',
    '- Never disclose confidential numbers, IDs, dates, emails, pricing, or exact identifiers.',
    '- Use only generic, safely-derived conclusions when drawing on confidential context.',
    '- Output must be safe to share publicly.',
    '',
    'EVALUATION RUBRIC — evaluate all dimensions from the fact_sheet:',
    '1. Clarity & specificity: scope_deliverables, project_goal — concrete and specific?',
    '   Flag vague language: "ASAP", "scalable", "world-class", "top N" without definitions, "TBD".',
    '2. Feasibility / realism: timeline and assumptions — realistic and grounded?',
    '3. Completeness: KPIs, timeline, constraints, risks, deliverables all present and non-empty?',
    '   Use source_coverage flags to guide your assessment.',
    '4. Risks & assumptions: risks array — key risks identified with impact/likelihood?',
    '5. Decision-readiness: sufficient information for a confident go / no-go decision?',
    '',
    'REPORT STYLE:',
    voiceGuide,
    depthGuide,
    orderingGuide,
    '',
    'WRITING REQUIREMENTS — follow these strictly:',
    `- Write ${paragraphReq}. Separate paragraphs within one why[] entry using \\n\\n.`,
    '- Max 1 bullet list in the ENTIRE why array. Bullets allowed only in Recommendations (max 4 short items).',
    '- Prose-first: do NOT convert paragraphs to bullets to save space.',
    '- Write as a human consultant/mediator — NOT as auto-filled template fields.',
    '- Natural language, varied sentence length, show nuanced tradeoffs.',
    '- Include at least 2 explicit if/then tradeoff statements distributed across sections.',
    '  Example: "If the timeline is compressed, then scope must be reduced or budget increased."',
    '',
    'MANDATORY ADVISOR ELEMENTS (every report must include ALL of these):',
    '1. Assumptions / Dependencies — inside "Key Risks" OR "Decision Readiness", include a paragraph',
    '   starting with "Assumptions / Dependencies:" listing the key assumptions the project relies on.',
    '   If source_coverage is thin (multiple false fields), make assumptions explicit and conservative.',
    '2. Options — inside "Decision Readiness" OR "Recommendations", include a paragraph starting with "Options:"',
    '   presenting 2-3 concrete paths (e.g., fast MVP, discovery-first, narrow scope) grounded in the fact sheet.',
    '   Do not invent specific numbers — reference the fact_sheet where available.',
    '3. First 2 weeks plan — inside "Recommendations", include a paragraph starting with "First 2 weeks plan:"',
    '   covering: who to interview, discovery/audit tasks (data profiling, source audit, technical spike),',
    '   and measurable success criteria for exiting the discovery phase.',
    '   Keep it specific to the proposal domain (reference systems, integrations, or workstreams named in fact_sheet).',
    '',
    hasFixedPriceContract
      ? 'CONDITIONAL — fixed-price signals detected: inside "Key Risks" or "Recommendations", include a paragraph starting with "Commercial posture:" covering acceptance criteria, change-order triggers, and risk allocation between parties.'
      : '',
    hasAggressiveTimeline
      ? 'CONDITIONAL — urgency signals detected: inside "Decision Readiness" or "Recommendations", include a paragraph starting with "Negotiation lever:" covering scope-time-budget tradeoffs and phased delivery options.'
      : '',
    hasDataSecurity
      ? 'CONDITIONAL — data/integration systems detected: inside "Key Risks" or the data security heading, include a paragraph starting with "Risk containment:" covering access controls, data handling assumptions, and relevant compliance (SOC2, GDPR, etc.).'
      : '',
    '',
    'WHY FIELD — FORMAT INSTRUCTIONS:',
    `- Total combined length of all why[] entries MUST NOT exceed ${whyMaxChars} characters.`,
    '- The "why" array must contain one element per heading below, in the order listed.',
    '- Each element must start with its heading name followed by ": "',
    '  (e.g., "Snapshot: The proposal defines three concrete deliverables...").',
    '- Separate paragraphs within a single heading entry with \\n\\n.',
    `- Required headings (always include, in this order): ${requiredHeadings.join(', ')}.`,
    optionalHeadings.length > 0
      ? `- Conditional headings (relevant to this proposal — include after required ones): ${optionalHeadings.join(', ')}.`
      : '- No conditional headings apply to this proposal.',
    '',
    'MISSING FIELD — QUALITY RULES:',
    `- Maximum ${MISSING_MAX_ITEMS} items. Include ONLY items that materially change feasibility, cost, timeline, or risk.`,
    '- Each item must be an actionable question AND include a "why it matters" clause after an em-dash (—).',
    '  Example: "What is the event schema and retention policy for the source data? — determines ingestion approach and governance risk."',
    '- Order by criticality: contract/deal-blockers first, then technical unknowns, then operational gaps.',
    '- Avoid generic questions. Reference the specific proposal context (systems, vendors, integrations named in fact_sheet).',
    '- Paraphrase all items from fact_sheet.missing_info and fact_sheet.open_questions as actionable questions with why-matters clauses.',
    coverageCount < 3
      ? '- Coverage is thin (multiple false source_coverage fields): missing[] MUST contain at least 6 decision-blocking items with em-dash why clauses.'
      : '',
    '',
    'OUTPUT FIELD SEMANTICS:',
    '- fit_level: Overall proposal quality / readiness.',
    '  high = decision-ready; medium = promising but gaps exist; low = major gaps; unknown = insufficient info.',
    '- confidence_0_1: Your confidence in the assessment (0 = no basis, 1 = very confident).',
    '- why: Consultant memo narrative per heading (multi-paragraph prose). Total chars <= why_max_chars.',
    '- missing: Actionable questions with em-dash why-it-matters, ranked by criticality. Max missing_max_items items.',
    '- redactions: Array of strings — topics that must remain confidential. Max redactions_max_items items.',
    '',
    'HARD GUARDRAILS — follow these without exception:',
    '- "high" fit_level is RARE. Only when specific, quantified, coherent, risks addressed, decision-ready.',
    '  When in doubt, use "medium".',
    '- If source_coverage shows has_kpis, has_timeline, has_constraints, or has_risks is false:',
    '  fit_level CANNOT be "high" AND confidence_0_1 MUST be <= 0.75.',
    '- If multiple source_coverage fields are false: confidence_0_1 MUST be lower still (<= 0.55).',
    '- Each item in fact_sheet.missing_info MUST appear in missing[] and MUST lower confidence.',
    '- Identical or heavily overlapping tiers: NOT a quality signal — do NOT reward this.',
    '',
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
    '- Keep ALL statements safe for public sharing.',
    '- Use generic derived wording for confidential-driven conclusions.',
    'INPUT JSON:',
    JSON.stringify(payload, null, 2),
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Post-processing coverage clamps ─────────────────────────────────────────

type ClampResult = {
  data: VertexEvaluationV2Response;
  capsApplied: string[];
};

function applyCoverageClamps(params: {
  data: VertexEvaluationV2Response;
  factSheet: ProposalFactSheet;
  sharedText: string;
  confidentialText: string;
}): ClampResult {
  const { factSheet, sharedText, confidentialText } = params;
  let { fit_level, confidence_0_1, why, missing, redactions } = params.data;
  const capsApplied: string[] = [];
  const sc = factSheet.source_coverage;

  const coverageCount = computeCoverageCount(sc);

  // Clamp 2 first — low overall coverage (<3 of 5) is the stricter constraint (0.65).
  // Apply before the 0.75 clamp so downgrade_high_low_coverage fires when coverage is low.
  if (coverageCount < 3) {
    if (confidence_0_1 > 0.65) {
      confidence_0_1 = 0.65;
      capsApplied.push('cap_0.65_low_coverage');
    }
    if (fit_level === 'high') {
      fit_level = 'medium';
      capsApplied.push('downgrade_high_low_coverage');
    }
  }

  // Clamp 1 — missing any of the four critical fields → cap at 0.75, block high.
  // Only fires if fit_level is still 'high' or confidence still above 0.75 after Clamp 2.
  const missingCritical = !sc.has_kpis || !sc.has_timeline || !sc.has_constraints || !sc.has_risks;
  if (missingCritical) {
    if (confidence_0_1 > 0.75) {
      confidence_0_1 = 0.75;
      capsApplied.push('cap_0.75_missing_critical');
    }
    if (fit_level === 'high') {
      fit_level = 'medium';
      capsApplied.push('downgrade_high_missing_critical');
    }
  }

  // Clamp 3 — identical shared+confidential text → append warning (no upward effect on fit)
  const sharedNorm = sharedText.trim();
  const confNorm = confidentialText.trim();
  if (sharedNorm && confNorm && sharedNorm === confNorm) {
    const warning = 'Shared and confidential appear identical; confidentiality separation may not be meaningful.';
    if (!missing.includes(warning)) {
      missing = [...missing, warning];
      capsApplied.push('warn_identical_tiers');
    }
  }

  return {
    data: { fit_level, confidence_0_1: clamp01(confidence_0_1), why, missing, redactions },
    capsApplied,
  };
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

function normalizeCanaryTokens(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const unique = new Set<string>();
  value.forEach((entry) => {
    const token = asLower(entry);
    if (!token) {
      return;
    }
    unique.add(token);
  });
  return [...unique].slice(0, 100);
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
  forbiddenText: string;
  sharedText: string;
  forbiddenChunks: Array<{ evidence_id: string; text: string }>;
  canaryTokens: string[];
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

  const leakedCanary = params.canaryTokens.find((token) => outputLower.includes(token));
  if (leakedCanary) {
    return {
      leakType: 'canary_token',
      leakSample: leakedCanary.slice(0, 120),
    };
  }

  const phraseCandidates = buildConfidentialPhraseCandidates(params.forbiddenChunks, params.sharedText);
  const leakedPhrase = phraseCandidates.find((phrase) => outputNormalized.includes(phrase));
  if (leakedPhrase) {
    return {
      leakType: 'confidential_substring',
      leakSample: leakedPhrase.slice(0, 120),
    };
  }

  const sensitiveTokens = collectSensitiveTokens(params.forbiddenText, params.sharedText);
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
  maxOutputTokens?: number;
  preferredModel?: string;
}): Promise<VertexCallResponse> {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    const notConfigured = getVertexNotConfiguredError();
    throw new ApiError(501, 'not_configured', notConfigured.message, notConfigured.details);
  }

  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location || 'us-central1';
  // Priority: explicit caller override > env var > vertex config default
  const preferredModel =
    asText(params.preferredModel) ||
    asText(process.env.VERTEX_MODEL) ||
    vertex.model ||
    DEFAULT_GENERATION_MODEL;
  const modelCandidates = [
    preferredModel,
    DEFAULT_GENERATION_MODEL,
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
  ]
    .map((model) => asText(model))
    .filter(Boolean)
    .filter((model, index, values) => values.indexOf(model) === index);
  const accessToken = await fetchGoogleAccessToken(vertex.credentials);

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    topP: 1,
    maxOutputTokens: params.maxOutputTokens ?? 4096,
    responseMimeType: 'application/json',
  };

  const buildBody = (config: Record<string, unknown>) => ({
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: config,
  });
  let lastStatus = 0;
  let lastMessage = '';
  let lastModel = modelCandidates[modelCandidates.length - 1] || preferredModel;
  const triedModels: string[] = [];

  for (const model of modelCandidates) {
    triedModels.push(model);
    lastModel = model;
    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

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

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      return {
        model,
        text: extractModelText(payload),
        finishReason: extractFinishReason(payload),
        httpStatus: response.status,
      };
    }

    const body = preloadedBody || (await response.text().catch(() => ''));
    const truncatedMessage = body.slice(0, 400);
    lastStatus = response.status;
    lastMessage = truncatedMessage;

    const modelMissing = response.status === 404 && /publisher model/i.test(body);
    const transientUpstream = response.status === 429 || (response.status >= 500 && response.status <= 599);
    const hasNextModel = triedModels.length < modelCandidates.length;
    if ((modelMissing || transientUpstream) && hasNextModel) {
      continue;
    }

    throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
      model,
      triedModels,
      upstreamStatus: response.status,
      upstreamMessage: truncatedMessage || null,
      requestId: asText(params.requestId) || null,
      inputChars: params.inputChars,
    });
  }

  throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
    model: lastModel,
    triedModels,
    upstreamStatus: lastStatus || 502,
    upstreamMessage: lastMessage || null,
    requestId: asText(params.requestId) || null,
    inputChars: params.inputChars,
  });
}

function getVertexCallImplementation(): VertexCallOverride {
  const override = (globalThis as any).__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  if (typeof override === 'function') {
    return override as VertexCallOverride;
  }
  return callVertexV2;
}

/**
 * Separate test hook for the LLM leak-verifier step so tests can control it
 * independently of the main generation call.
 * Global: __PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__
 */
function getVertexVerifierCallImplementation(): VertexCallOverride {
  const override = (globalThis as any).__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__;
  if (typeof override === 'function') {
    return override as VertexCallOverride;
  }
  return callVertexV2;
}

// ─── LLM leak verifier ────────────────────────────────────────────────────────

type LlmVerifierVerdict = 'clean' | 'leak' | 'unsure' | 'unavailable';

/**
 * Returns a safe, narrative-free placeholder response for cases where the
 * evaluator must suppress the real output (leak detected or verifier down).
 * Callers add a 'warnings' entry to _internal to explain which case occurred.
 */
function buildSuppressedOutput(warningReason: 'leak_detected' | 'verifier_unavailable'): VertexEvaluationV2Response {
  const placeholder =
    warningReason === 'leak_detected'
      ? 'Output suppressed: evaluation output contained confidential information and could not be shared.'
      : 'Output suppressed: evaluation verifier was unavailable and output safety could not be confirmed.';
  return {
    fit_level: 'unknown',
    confidence_0_1: 0,
    why: [placeholder],
    missing: [],
    redactions: [],
  };
}

function buildLeakVerifierPrompt(params: {
  forbiddenText: string;
  outputText: string;
}): string {
  const forbidden = params.forbiddenText.slice(0, 2000);
  const output = params.outputText.slice(0, 3000);
  return [
    'You are a strict security auditor. Your only job is to check whether the OUTPUT TEXT below',
    'contains any information from the CONFIDENTIAL MATERIAL that should not be disclosed.',
    '',
    'CONFIDENTIAL MATERIAL (must NOT appear verbatim or paraphrased in output):',
    '---',
    forbidden || '(none)',
    '---',
    '',
    'OUTPUT TEXT TO AUDIT:',
    '---',
    output || '(empty)',
    '---',
    '',
    'Rules:',
    '- "leak": true  → output reproduces or paraphrases confidential details.',
    '- "leak": false → output is safe; no confidential content disclosed.',
    '- Be conservative: when in doubt, prefer "leak": true.',
    '- "reason": one concise sentence.',
    '',
    'Respond in strict JSON ONLY (no markdown, no preamble):',
    '{ "leak": boolean, "reason": string }',
  ].join('\n');
}

/**
 * Runs the LLM leak-verifier step.
 * 1. Calls verifierModel with the audit prompt.
 * 2. If the response is invalid/unsure, escalates once to escalationModel.
 * 3. Never throws — unknown errors return 'unsure' for the caller to handle.
 *
 * Returns { verdict, escalated, reason }.
 */
async function runLlmLeakVerifier(params: {
  response: VertexEvaluationV2Response;
  forbiddenText: string;
  sharedText: string;
  requestId?: string;
  verifierModel: string;
  escalationModel: string;
  callVerifier: VertexCallOverride;
  callGeneration: VertexCallOverride;
}): Promise<{ verdict: LlmVerifierVerdict; escalated: boolean; reason: string }> {
  const outputText = [
    ...params.response.why,
    ...params.response.missing,
    ...params.response.redactions,
  ].join('\n');

  // Nothing to verify if there's no confidential text or no output.
  if (!params.forbiddenText.trim() || !outputText.trim()) {
    return { verdict: 'clean', escalated: false, reason: 'no_content_to_verify' };
  }

  const prompt = buildLeakVerifierPrompt({
    forbiddenText: params.forbiddenText,
    outputText,
  });
  const inputChars = prompt.length;

  const parseVerifierResponse = (text: string): LlmVerifierVerdict => {
    try {
      const raw = text.trim();
      // Strip optional JSON fence
      const inner = raw.startsWith('```') ? raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim() : raw;
      const parsed = JSON.parse(inner);
      if (typeof parsed?.leak === 'boolean') {
        return parsed.leak ? 'leak' : 'clean';
      }
    } catch {
      // fall through
    }
    return 'unsure';
  };

  const getReason = (text: string): string => {
    try {
      const raw = text.trim();
      const inner = raw.startsWith('```') ? raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim() : raw;
      const parsed = JSON.parse(inner);
      return asText(parsed?.reason) || 'no_reason';
    } catch {
      return 'parse_error';
    }
  };

  // ── First attempt: verifier model ─────────────────────────────────────────
  let verifierText = '';
  let verifierThrew = false;
  try {
    const resp = await params.callVerifier({
      prompt,
      requestId: params.requestId,
      inputChars,
      maxOutputTokens: 256,
      preferredModel: params.verifierModel,
    });
    verifierText = asText(resp.text);
  } catch {
    // Verifier infrastructure failure (not configured, network error, etc.).
    // Policy: cannot treat as clean — must suppress output to avoid silent leaks.
    verifierThrew = true;
  }

  if (verifierThrew) {
    return { verdict: 'unavailable', escalated: false, reason: 'verifier_call_failed' };
  }

  const firstVerdict = parseVerifierResponse(verifierText);
  if (firstVerdict !== 'unsure') {
    return { verdict: firstVerdict, escalated: false, reason: getReason(verifierText) };
  }

  // ── Escalation: retry with escalation model via the same verifier hook ────
  // NOTE: Uses callVerifier (not callGeneration) to keep the main generation
  // hook exclusively for Pass A + Pass B calls — simplifies test isolation.
  let escalationText = '';
  let escalationThrew = false;
  try {
    const resp = await params.callVerifier({
      prompt,
      requestId: params.requestId,
      inputChars,
      maxOutputTokens: 256,
      preferredModel: params.escalationModel,
    });
    escalationText = asText(resp.text);
  } catch {
    escalationThrew = true;
  }

  if (escalationThrew) {
    return { verdict: 'unavailable', escalated: true, reason: 'escalation_call_failed' };
  }

  const escalatedVerdict = parseVerifierResponse(escalationText);
  // If still unsure after escalation: cannot confirm safety — return 'unavailable'.
  // Policy: unresolvable ambiguity is treated the same as unavailability (suppress output).
  if (escalatedVerdict === 'unsure') {
    return { verdict: 'unavailable', escalated: true, reason: 'unsure_after_escalation' };
  }
  return {
    verdict: escalatedVerdict,
    escalated: true,
    reason: getReason(escalationText) || 'escalation_used',
  };
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

// ─── Safe telemetry builder ────────────────────────────────────────────────────────
// Extracts ONLY counts, booleans, and enums — never raw text or identifiers.
// Safe to log, emit to monitoring, or store without PII/confidentiality risk.

function buildTelemetry(params: {
  sharedText: string;
  confidentialText: string;
  proposalTextExcerpt: string;
  sharedChunks: Array<{ evidence_id: string; text: string }>;
  confidentialChunks: Array<{ evidence_id: string; text: string }>;
  factSheet: ProposalFactSheet;
  evalResult: VertexEvaluationV2Response;
  reportStyle: ReportStyle;
  clampsApplied: string[];
}): VertexEvaluationV2Telemetry {
  const sc = params.factSheet.source_coverage;
  const sharedNorm = params.sharedText.trim();
  const confNorm = params.confidentialText.trim();

  return {
    version: 'eval_v2',
    coverageCount: computeCoverageCount(sc),
    coverageFlags: {
      has_scope: sc.has_scope,
      has_timeline: sc.has_timeline,
      has_kpis: sc.has_kpis,
      has_constraints: sc.has_constraints,
      has_risks: sc.has_risks,
    },
    clampsApplied: params.clampsApplied,
    identicalTiers: Boolean(sharedNorm && confNorm && sharedNorm === confNorm),
    fit_level: params.evalResult.fit_level,
    confidence_0_1: params.evalResult.confidence_0_1,
    missingCount: params.evalResult.missing.length,
    redactionsCount: params.evalResult.redactions.length,
    sharedChars: params.sharedText.length,
    confidentialChars: params.confidentialText.length,
    proposalChars: params.proposalTextExcerpt.length,
    sharedChunkCount: params.sharedChunks.length,
    confidentialChunkCount: params.confidentialChunks.length,
    reportStyle: {
      style_id: params.reportStyle.style_id,
      ordering: params.reportStyle.ordering,
      verbosity: params.reportStyle.verbosity,
      seed: params.reportStyle.seed,
    },
    timestampMs: Date.now(),
  };
}

export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request,
): Promise<VertexEvaluationV2Outcome> {
  const sharedText = String(input.sharedText || '').trim();
  const confidentialText = String(input.confidentialText || '').trim();
  const forbiddenLeakText =
    input.forbiddenLeakText === undefined
      ? confidentialText
      : String(input.forbiddenLeakText || '').trim();
  const forbiddenLeakCanaryTokens = normalizeCanaryTokens(input.forbiddenLeakCanaryTokens);
  const enforceLeakGuard = input.enforceLeakGuard === true;
  const requestId = asText(input.requestId) || undefined;
  const inputChars = sharedText.length + confidentialText.length;

  // ── Model resolution (env var overrides > request params > built-in defaults) ─
  const generationModel =
    asText(input.generationModel) ||
    asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) ||
    asText(process.env.VERTEX_MODEL) ||
    DEFAULT_GENERATION_MODEL;
  const verifierModel =
    asText(input.verifierModel) ||
    asText(process.env.VERTEX_DOC_COMPARE_VERIFIER_MODEL) ||
    DEFAULT_VERIFIER_MODEL;
  const extractModel =
    asText(input.extractModel) ||
    asText(process.env.VERTEX_DOC_COMPARE_EXTRACT_MODEL) ||
    verifierModel;

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
  const forbiddenChunks = buildSourceChunks(forbiddenLeakText.slice(0, MAX_CONFIDENTIAL_CHARS), 'conf');
  const callVertex = getVertexCallImplementation();
  const callVerifier = getVertexVerifierCallImplementation();

  // ── Pass A: extract structured Fact Sheet ────────────────────────────────
  const proposalTextExcerpt =
    '[SHARED / PUBLIC PORTION]\n' +
    sharedText.slice(0, MAX_SHARED_CHARS) +
    '\n---\n' +
    '[CONFIDENTIAL PORTION — internal context only, do NOT reproduce verbatim in output]\n' +
    confidentialText.slice(0, MAX_CONFIDENTIAL_CHARS);

  // ── Deterministic report style selection ─────────────────────────────────
  const reportStyleSeed = computeReportStyleSeed({
    proposalTextExcerpt,
    proposalId: requestId,
  });
  const reportStyle = selectReportStyle(reportStyleSeed);

  const { sheet: factSheet, parseError: passAParseError } = await extractProposalFactsV2({
    proposalTextExcerpt,
    requestId,
    callVertex,
    preferredModel: extractModel,
  });

  // ── Pass B: final evaluation using Fact Sheet ────────────────────────────
  let prompt = buildEvalPromptFromFactSheet({ factSheet, chunks, reportStyle });

  let attempt = 0;
  let usedTightRetry = false;
  let lastParseFailureKind: string = 'unknown';
  let lastFinishReason: string | null = null;
  let lastRawTextLength = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let vertex: VertexCallResponse;

    try {
      vertex = await callVertex({
        prompt,
        requestId,
        inputChars,
        maxOutputTokens: 4096,
        preferredModel: generationModel,
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
        // Hard failure — not_configured is not recoverable via fallback.
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

      // Network error exhausted retries — fall through to fallback.
      lastParseFailureKind = kind;
      break;
    }

    const rawText = String(vertex.text || '');
    const rawTextLength = rawText.length;
    const finishReason = vertex.finishReason ? asLower(vertex.finishReason) : null;
    lastFinishReason = finishReason;
    lastRawTextLength = rawTextLength;

    if (!rawText.trim()) {
      if (attempt < MAX_ATTEMPTS) {
        continue;
      }
      // Empty output after all attempts — fall through to fallback.
      lastParseFailureKind = 'empty_output';
      break;
    }

    if (isLikelyTruncatedOutput(rawText, finishReason)) {
      if (!usedTightRetry) {
        // First truncation → retry once with tight mode to reduce output size.
        usedTightRetry = true;
        prompt = buildEvalPromptFromFactSheet({ factSheet, chunks, reportStyle, tightMode: true });
        continue;
      }
      // Tight retry also truncated → use fallback.
      lastParseFailureKind = 'truncated_output';
      break;
    }

    const extracted = parseJsonObject(rawText);
    if (!extracted.parsed) {
      if (!usedTightRetry) {
        // First parse failure → retry once with tight mode.
        usedTightRetry = true;
        lastParseFailureKind = 'json_parse_error';
        prompt = buildEvalPromptFromFactSheet({ factSheet, chunks, reportStyle, tightMode: true });
        continue;
      }
      // Both attempts failed to parse → use fallback.
      lastParseFailureKind = 'json_parse_error';
      break;
    }

    const coerced = coerceToSmallSchema(extracted.parsed);
    const schemaValidation = validateResponseSchema(coerced.candidate);
    if (!schemaValidation.ok) {
      if (!usedTightRetry) {
        usedTightRetry = true;
        lastParseFailureKind = 'schema_validation_error';
        prompt = buildEvalPromptFromFactSheet({ factSheet, chunks, reportStyle, tightMode: true });
        continue;
      }
      // Schema still invalid after tight retry → fallback.
      lastParseFailureKind = 'schema_validation_error';
      break;
    }

    if (enforceLeakGuard) {
      const leak = detectConfidentialLeak({
        response: schemaValidation.normalized,
        forbiddenText: forbiddenLeakText,
        sharedText,
        forbiddenChunks,
        canaryTokens: forbiddenLeakCanaryTokens,
      });
      if (leak) {
        // Deterministic leak detected: suppress output, return ok:true with warnings.
        // Never 5xx — the evaluation is persisted as completed_with_warnings.
        const suppressed = buildSuppressedOutput('leak_detected');
        return {
          ok: true,
          data: suppressed,
          attempt_count: attempt,
          model: vertex.model,
          generation_model: generationModel,
          _internal: {
            fact_sheet: factSheet,
            coverage_count: computeCoverageCount(factSheet.source_coverage),
            caps_applied: [],
            pass_a_parse_error: passAParseError,
            pass_b_attempt_count: attempt,
            report_style: reportStyle,
            warnings: ['confidential_leak_detected_output_suppressed'],
            failure_kind: 'confidential_leak_detected',
            models_used: {
              generation: generationModel,
              extract: extractModel,
              verifier: verifierModel,
              verifier_used: false,
              verifier_escalated: false,
              verifier_unavailable: false,
            },
          },
        };
      }

      // ── LLM verifier (second-layer leak check using cheap/fast model) ────
      // Only runs when deterministic check passes. Escalates to the generation
      // model when the verifier returns invalid JSON or an "unsure" verdict.
      const llmVerify = await runLlmLeakVerifier({
        response: schemaValidation.normalized,
        forbiddenText: forbiddenLeakText,
        sharedText,
        requestId,
        verifierModel,
        escalationModel: generationModel,
        callVerifier,
        callGeneration: callVertex,
      });
      if (llmVerify.verdict === 'leak') {
        // LLM verifier detected leak: suppress output, return ok:true with warnings.
        const suppressed = buildSuppressedOutput('leak_detected');
        return {
          ok: true,
          data: suppressed,
          attempt_count: attempt,
          model: vertex.model,
          generation_model: generationModel,
          _internal: {
            fact_sheet: factSheet,
            coverage_count: computeCoverageCount(factSheet.source_coverage),
            caps_applied: [],
            pass_a_parse_error: passAParseError,
            pass_b_attempt_count: attempt,
            report_style: reportStyle,
            warnings: ['confidential_leak_detected_output_suppressed'],
            failure_kind: 'confidential_leak_detected',
            models_used: {
              generation: generationModel,
              extract: extractModel,
              verifier: verifierModel,
              verifier_used: true,
              verifier_escalated: llmVerify.escalated,
              verifier_unavailable: false,
            },
          },
        };
      }
      if (llmVerify.verdict === 'unavailable') {
        // Verifier infrastructure failure: cannot confirm output is safe.
        // Policy: suppress narrative output to prevent silent leaks.
        // Never 5xx — persisted as completed_with_warnings.
        const suppressed = buildSuppressedOutput('verifier_unavailable');
        return {
          ok: true,
          data: suppressed,
          attempt_count: attempt,
          model: vertex.model,
          generation_model: generationModel,
          _internal: {
            fact_sheet: factSheet,
            coverage_count: computeCoverageCount(factSheet.source_coverage),
            caps_applied: [],
            pass_a_parse_error: passAParseError,
            pass_b_attempt_count: attempt,
            report_style: reportStyle,
            warnings: ['verifier_unavailable_output_suppressed'],
            failure_kind: 'verifier_unavailable',
            models_used: {
              generation: generationModel,
              extract: extractModel,
              verifier: verifierModel,
              verifier_used: true,
              verifier_escalated: llmVerify.escalated,
              verifier_unavailable: true,
            },
          },
        };
      }
      // Store verifier metadata for _internal so we can track it.
      (schemaValidation as any)._llmVerify = llmVerify;
    }

    // ── Apply deterministic coverage clamps (post-processing) ───────────
    const clamped = applyCoverageClamps({
      data: schemaValidation.normalized,
      factSheet,
      sharedText,
      confidentialText,
    });

    // ── Build safe telemetry (counts/booleans/enums only) ─────────────────
    const telemetry = buildTelemetry({
      sharedText,
      confidentialText,
      proposalTextExcerpt,
      sharedChunks: chunks.sharedChunks,
      confidentialChunks: chunks.confidentialChunks,
      factSheet,
      evalResult: clamped.data,
      reportStyle,
      clampsApplied: clamped.capsApplied,
    });

    // ── Gated debug log (never in production) ────────────────────────────
    if (
      process.env['EVAL_V2_TELEMETRY'] === '1' &&
      process.env['NODE_ENV'] !== 'production'
    ) {
      // eslint-disable-next-line no-console
      console.log('[eval_v2.telemetry]', JSON.stringify(telemetry));
    }

    const llmVerify: { verdict: string; escalated: boolean } | undefined =
      (schemaValidation as any)._llmVerify;

    return {
      ok: true,
      data: clamped.data,
      attempt_count: attempt,
      model: vertex.model,
      generation_model: generationModel,
      _internal: {
        fact_sheet: factSheet,
        coverage_count: computeCoverageCount(factSheet.source_coverage),
        caps_applied: clamped.capsApplied,
        pass_a_parse_error: passAParseError,
        pass_b_attempt_count: attempt,
        report_style: reportStyle,
        telemetry,
        models_used: {
          generation: generationModel,
          extract: extractModel,
          verifier: verifierModel,
          verifier_used: Boolean(llmVerify),
          verifier_escalated: Boolean(llmVerify?.escalated),
          verifier_unavailable: false,
        },
      },
    };
  }

  // ── All Pass B attempts failed → safe fallback ───────────────────────────
  // Return ok:true with a clamped fallback evaluation so the API never fails.
  const fallback = safeFallbackEvaluationFromFactSheet(factSheet, {
    failureKind: lastParseFailureKind,
    requestId,
    finishReason: lastFinishReason,
    sharedChars: sharedText.length,
    confidentialChars: confidentialText.length,
  });

  const fallbackClamped = applyCoverageClamps({
    data: fallback.data,
    factSheet,
    sharedText,
    confidentialText,
  });

  const fallbackTelemetry = buildTelemetry({
    sharedText,
    confidentialText,
    proposalTextExcerpt,
    sharedChunks: chunks.sharedChunks,
    confidentialChunks: chunks.confidentialChunks,
    factSheet,
    evalResult: fallbackClamped.data,
    reportStyle,
    clampsApplied: fallbackClamped.capsApplied,
  });

  return {
    ok: true,
    data: fallbackClamped.data,
    attempt_count: attempt,
    model: null,
    generation_model: generationModel,
    _internal: {
      fact_sheet: factSheet,
      coverage_count: computeCoverageCount(factSheet.source_coverage),
      caps_applied: fallbackClamped.capsApplied,
      pass_a_parse_error: passAParseError,
      pass_b_attempt_count: attempt,
      report_style: reportStyle,
      telemetry: fallbackTelemetry,
      warnings: fallback.warnings,
      failure_kind: lastParseFailureKind,
      models_used: {
        generation: generationModel,
        extract: extractModel,
        verifier: verifierModel,
        verifier_used: false,
        verifier_escalated: false,
        verifier_unavailable: false,
      },
    },
  };
}

export { validateResponseSchema };
