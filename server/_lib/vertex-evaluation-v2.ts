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
  forbiddenLeakText?: string;
  forbiddenLeakCanaryTokens?: string[];
  enforceLeakGuard?: boolean;
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

// Internal debug metadata — attached to VertexEvaluationV2Result for
// server-side logging; never serialised to the client response.
export interface VertexEvaluationV2Internal {
  fact_sheet: ProposalFactSheet;
  coverage_count: number;
  caps_applied: string[];
  pass_a_parse_error: boolean;
  pass_b_attempt_count: number;
  report_style: ReportStyle;
}

export interface VertexEvaluationV2Result {
  ok: true;
  data: VertexEvaluationV2Response;
  attempt_count: number;
  model: string;
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
}): Promise<{ sheet: ProposalFactSheet; parseError: boolean }> {
  const inputChars = params.proposalTextExcerpt.length;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const strict = attempt === 2;
    const prompt = buildFactSheetPrompt(params.proposalTextExcerpt, strict);

    let vertexResp: VertexCallResponse;
    try {
      vertexResp = await params.callVertex({ prompt, requestId: params.requestId, inputChars });
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

function buildEvalPromptFromFactSheet(params: {
  factSheet: ProposalFactSheet;
  chunks: EvaluationChunks;
  reportStyle: ReportStyle;
}) {
  const { factSheet, chunks, reportStyle } = params;
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

  // ── Required headings (always) ───────────────────────────────────────────
  const firstStrengthOrRisk =
    reportStyle.ordering === 'risks_first' ? 'Key Risks' : 'Key Strengths';
  const secondStrengthOrRisk =
    reportStyle.ordering === 'risks_first' ? 'Key Strengths' : 'Key Risks';
  const requiredHeadings = [
    'Executive Summary',
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

  // If coverage is weak, force tight regardless of selected verbosity.
  const effectiveVerbosity: Verbosity = coverageCount < 3 ? 'tight' : reportStyle.verbosity;
  const depthGuide =
    effectiveVerbosity === 'tight'
      ? 'Depth: concise. 1-2 sentences per section. Push detail to missing[].'
      : effectiveVerbosity === 'deep'
      ? 'Depth: detailed. 3-5 sentences per section. Reference specific fact_sheet fields by name.'
      : 'Depth: standard. 2-3 sentences per section.';

  const orderingGuide =
    reportStyle.ordering === 'risks_first'
      ? 'Ordering: lead with risks, then follow with strengths.'
      : reportStyle.ordering === 'strengths_first'
      ? 'Ordering: lead with strengths, then follow with risks.'
      : 'Ordering: balance strengths and risks throughout.';

  const payload = {
    // Chunk lists kept intact — leak-guard depends on them.
    shared_chunks: chunks.sharedChunks,
    confidential_chunks: chunks.confidentialChunks,
    // Primary input: structured Fact Sheet extracted in Pass A.
    fact_sheet: factSheet,
    constraints: {
      evaluate_proposal_quality_not_alignment: true,
      confidentiality_middleman_rule: true,
      no_confidential_verbatim: true,
      no_confidential_numbers_or_identifiers: true,
      allow_safe_derived_conclusions: true,
      report_style: {
        style_id: reportStyle.style_id,
        ordering: reportStyle.ordering,
        verbosity: effectiveVerbosity,
        seed: reportStyle.seed,
      },
    },
  };

  return [
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
    'WHY FIELD — FORMAT INSTRUCTIONS:',
    '- The "why" array must contain one element per heading below, in the order listed.',
    '- Each element must start with its heading name followed by a colon and a space',
    '  (e.g., "Key Strengths: The proposal defines three concrete deliverables...").',
    `- Required headings (always include, in this order): ${requiredHeadings.join(', ')}.`,
    optionalHeadings.length > 0
      ? `- Conditional headings (relevant to this proposal — include after required ones): ${optionalHeadings.join(', ')}.`
      : '- No conditional headings apply to this proposal.',
    '',
    'MISSING FIELD — QUALITY RULES:',
    '- Include ONLY items that materially change feasibility, cost, timeline, or risk assessment.',
    '- Phrase each item as an actionable question (e.g., "What is the confirmed go-live deadline?").',
    '- Rank most-critical items first.',
    '- Do not include trivial or cosmetic gaps.',
    '- Incorporate all items from fact_sheet.missing_info and fact_sheet.open_questions (paraphrase as questions).',
    coverageCount < 3
      ? '- Coverage is weak: missing[] must contain substantive, decision-blocking questions (minimum 3).'
      : '',
    '',
    'OUTPUT FIELD SEMANTICS:',
    '- fit_level: Overall proposal quality / readiness.',
    '  high = decision-ready; medium = promising but gaps exist; low = major gaps; unknown = insufficient info.',
    '- confidence_0_1: Your confidence in the assessment (0 = no basis, 1 = very confident).',
    '- why: Consultant-style narrative per heading, as described in WHY FIELD instructions above.',
    '- missing: Actionable questions ranked by criticality, per quality rules above.',
    '- redactions: Array of strings — topics that must remain confidential.',
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
}): Promise<VertexCallResponse> {
  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    const notConfigured = getVertexNotConfiguredError();
    throw new ApiError(501, 'not_configured', notConfigured.message, notConfigured.details);
  }

  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location || 'us-central1';
  const preferredModel = asText(process.env.VERTEX_MODEL) || vertex.model || 'gemini-2.0-flash-001';
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
  const accessToken = await fetchGoogleAccessToken(vertex.credentials);

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
  const forbiddenLeakText =
    input.forbiddenLeakText === undefined
      ? confidentialText
      : String(input.forbiddenLeakText || '').trim();
  const forbiddenLeakCanaryTokens = normalizeCanaryTokens(input.forbiddenLeakCanaryTokens);
  const enforceLeakGuard = input.enforceLeakGuard !== false;
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
  const forbiddenChunks = buildSourceChunks(forbiddenLeakText.slice(0, MAX_CONFIDENTIAL_CHARS), 'conf');
  const callVertex = getVertexCallImplementation();

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
  });

  // ── Pass B: final evaluation using Fact Sheet ────────────────────────────
  const prompt = buildEvalPromptFromFactSheet({ factSheet, chunks, reportStyle });

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
          model: asText(error?.extra?.model) || null,
          upstream_status: Number(error?.extra?.upstreamStatus || 0) || null,
          tried_models: Array.isArray(error?.extra?.triedModels)
            ? error.extra.triedModels.map((entry: unknown) => asText(entry)).filter(Boolean).slice(0, 8)
            : [],
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

    if (enforceLeakGuard) {
      const leak = detectConfidentialLeak({
        response: schemaValidation.normalized,
        forbiddenText: forbiddenLeakText,
        sharedText,
        forbiddenChunks,
        canaryTokens: forbiddenLeakCanaryTokens,
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
    }

    // ── Apply deterministic coverage clamps (post-processing) ───────────
    const clamped = applyCoverageClamps({
      data: schemaValidation.normalized,
      factSheet,
      sharedText,
      confidentialText,
    });

    return {
      ok: true,
      data: clamped.data,
      attempt_count: attempt,
      model: vertex.model,
      _internal: {
        fact_sheet: factSheet,
        coverage_count: computeCoverageCount(factSheet.source_coverage),
        caps_applied: clamped.capsApplied,
        pass_a_parse_error: passAParseError,
        pass_b_attempt_count: attempt,
        report_style: reportStyle,
      },
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
