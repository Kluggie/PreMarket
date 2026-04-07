import { createSign } from 'node:crypto';
import { ApiError } from './errors.js';
import { getVertexConfig, getVertexNotConfiguredError, type VertexServiceAccountCredentials } from './integrations.js';
import { sanitizeUserInput } from './vertex-input-sanitizer.js';
import {
  STAGE1_PRELIMINARY_SUMMARY_NOTE,
  truncateTextAtNaturalBoundary,
} from '../../src/lib/aiReportUtils.js';
import { preflightPromptCheck, type PreflightResult } from './evaluation-context-budget.js';
import { normalizeOpportunityReviewStage } from '../../src/lib/opportunityReviewStage.js';
import {
  WHY_MAX_CHARS_STANDARD,
  WHY_MAX_CHARS_TIGHT,
  MISSING_MIN_ITEMS,
  MISSING_MAX_ITEMS,
  REDACTIONS_MAX_ITEMS,
  buildEvalPromptFromFactSheet,
  buildFactSheetPrompt,
  buildPreSendPromptFromFactSheet,
  buildStage1SharedIntakePromptFromFactSheet,
  classifyProposalDomain,
  computeCoverageCount,
  computeReportStyleSeed,
  containsAny,
  selectReportStyle,
} from './vertex-evaluation-v2-prompts.js';
import {
  coerceToSmallSchema,
  normalizeCanaryTokens,
  toStringArray,
  validateResponseSchema,
} from './vertex-evaluation-v2-schema.js';
import {
  MEDIATION_STAGE,
  PRE_SEND_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
  type EvaluationChunks,
  type FallbackMode,
  type FactSheetRisk,
  type FitLevel,
  type MediationReviewStage,
  type NegotiationAnalysis,
  type ParseErrorKind,
  type PostProcessMode,
  type PreSendReadinessStatus,
  type PreSendReviewStage,
  type ProposalDomain,
  type ProposalDomainId,
  type ProposalFactSheet,
  type ProposalFactSheetCoverage,
  type ReportStyle,
  type ReviewStage,
  type Stage1SharedIntakeStage,
  type VertexEvaluationV2Failure,
  type VertexEvaluationV2Internal,
  type VertexEvaluationV2MediationResponse,
  type VertexEvaluationV2Outcome,
  type VertexEvaluationV2PreSendResponse,
  type VertexEvaluationV2Stage1SharedIntakeResponse,
  type VertexEvaluationV2Request,
  type VertexEvaluationV2Response,
  type VertexEvaluationV2ResponseForStage,
  type VertexEvaluationV2Result,
  type VertexEvaluationV2Telemetry,
} from './vertex-evaluation-v2-types.js';

export { MEDIATION_STAGE, PRE_SEND_STAGE, STAGE1_SHARED_INTAKE_STAGE } from './vertex-evaluation-v2-types.js';
export { computeReportStyleSeed, selectReportStyle } from './vertex-evaluation-v2-prompts.js';
export type {
  EvaluationChunks,
  FallbackMode,
  FactSheetRisk,
  FitLevel,
  MediationReviewStage,
  NegotiationAnalysis,
  ParseErrorKind,
  PostProcessMode,
  PreSendReadinessStatus,
  PreSendReviewStage,
  ProposalDomain,
  ProposalDomainId,
  ProposalFactSheet,
  ProposalFactSheetCoverage,
  ReportStyle,
  ReviewStage,
  Stage1SharedIntakeStage,
  VertexEvaluationV2Failure,
  VertexEvaluationV2Internal,
  VertexEvaluationV2MediationResponse,
  VertexEvaluationV2Outcome,
  VertexEvaluationV2PreSendResponse,
  VertexEvaluationV2Stage1SharedIntakeResponse,
  VertexEvaluationV2Request,
  VertexEvaluationV2Response,
  VertexEvaluationV2ResponseForStage,
  VertexEvaluationV2Result,
  VertexEvaluationV2Telemetry,
} from './vertex-evaluation-v2-types.js';

const VERTEX_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
const RETRY_BASE_MS = 450;
const MAX_SHARED_CHARS = 16_000;
const MAX_CONFIDENTIAL_CHARS = 16_000;
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

type VertexCallResponse = {
  model: string;
  text: string;
  finishReason: string | null;
  httpStatus: number;
};

type ExtractJsonResult = {
  parsed: unknown | null;
  hadJsonFence: boolean;
  extractionMode: 'raw' | 'json_fence' | 'balanced_brace' | 'first_last_brace' | 'none';
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

declare global {
  // Test-only hook for overriding the main Vertex evaluation call.
  var __PREMARKET_TEST_VERTEX_EVAL_V2_CALL__: VertexCallOverride | undefined;
  // Test-only hook for overriding the leak-verifier Vertex call.
  var __PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__: VertexCallOverride | undefined;
}

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

function assertNever(value: never, message: string): never {
  throw new TypeError(`${message}: ${String(value)}`);
}

function requireAnalysisStage(value: unknown): ReviewStage {
  const normalized = normalizeOpportunityReviewStage(value);
  if (
    normalized === STAGE1_SHARED_INTAKE_STAGE ||
    normalized === PRE_SEND_STAGE ||
    normalized === MEDIATION_STAGE
  ) {
    return normalized;
  }
  throw new TypeError(
    'evaluateWithVertexV2 requires an explicit analysisStage of "stage1_shared_intake", "pre_send_review", or "mediation_review".',
  );
}

export function isStage1SharedIntakeResponse(
  response: VertexEvaluationV2Response,
): response is VertexEvaluationV2Stage1SharedIntakeResponse {
  return response.analysis_stage === STAGE1_SHARED_INTAKE_STAGE;
}

export function isPreSendReviewResponse(
  response: VertexEvaluationV2Response,
): response is VertexEvaluationV2PreSendResponse {
  return response.analysis_stage === PRE_SEND_STAGE;
}

export function isMediationReviewResponse(
  response: VertexEvaluationV2Response,
): response is VertexEvaluationV2MediationResponse {
  return response.analysis_stage === MEDIATION_STAGE;
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

const GENERIC_MISSING_WHY = 'it materially affects scope, delivery risk, or commercial terms';

type MissingRule = {
  id: string;
  priority: number;
  severity: 'material' | 'severe';
  patterns: string[];
  label: string;
  question: string;
  why: string;
  condition: string;
  confidenceUp: string;
  confidenceDown: string;
};

const MISSING_RULES: MissingRule[] = [
  {
    id: 'scope',
    priority: 110,
    severity: 'severe',
    patterns: ['scope', 'deliverable', 'deliverables', 'mvp', 'requirements', 'use case', 'workflow', 'out of scope'],
    label: 'the initial scope still needs a tighter commitment boundary',
    question: 'What is included in the initial committed scope or current phase, and what is explicitly out of scope?',
    why: 'scope boundaries determine pricing, delivery sequencing, and change exposure',
    condition: 'define the current commitment boundary and explicit exclusions',
    confidenceUp: 'a narrower initial scope or phase definition with explicit in-scope and out-of-scope items',
    confidenceDown: 'scope stays open-ended while the proposal still implies a firm commitment',
  },
  {
    id: 'data_cleanup',
    priority: 108,
    severity: 'severe',
    patterns: ['data quality', 'data cleanup', 'cleanup', 'cleansing', 'remediation', 'source data', 'migration', 'historical data'],
    label: 'unquantified data cleanup or remediation risk remains with no clear owner',
    question: 'What data cleanup, remediation, or migration work is assumed before the initial commitment, and who owns it?',
    why: 'data-condition assumptions can materially change effort, budget, and change-order exposure',
    condition: 'quantify the data remediation scope and assign ownership before locking pricing or timeline',
    confidenceUp: 'a scoped audit that quantifies data cleanup effort, assumptions, and ownership',
    confidenceDown: 'the proposal continues to assume usable source data without evidence or ownership',
  },
  {
    id: 'acceptance',
    priority: 106,
    severity: 'material',
    patterns: ['acceptance criteria', 'definition of done', 'sign-off', 'sign off', 'uat', 'success criteria', 'kpi', 'baseline'],
    label: 'acceptance criteria are not concrete enough for sign-off',
    question: 'What measurable acceptance criteria will define completion for the key deliverables or current phase?',
    why: 'sign-off, payment exposure, and scope control depend on objective acceptance criteria',
    condition: 'agree measurable acceptance criteria for the key deliverables',
    confidenceUp: 'measurable success and acceptance criteria tied to the core deliverables',
    confidenceDown: 'completion stays subjective or depends on informal approval',
  },
  {
    id: 'dependency',
    priority: 104,
    severity: 'severe',
    patterns: ['dependency', 'dependencies', 'owner', 'ownership', 'approval', 'approvals', 'third party', 'third-party', 'client side', 'customer side', 'access', 'out of vendor control'],
    label: 'ownership of major dependencies or approvals is still unclear',
    question: 'Which party owns the major dependencies, approvals, and third-party inputs, and what happens if they slip?',
    why: 'unclear ownership distorts timeline risk, resourcing assumptions, and dispute exposure',
    condition: 'name dependency owners and define the fallback if they slip',
    confidenceUp: 'named owners, dates, and contingencies for the major dependencies and approvals',
    confidenceDown: 'critical dependencies remain external, unowned, or out of the vendor’s control',
  },
  {
    id: 'change_order',
    priority: 102,
    severity: 'material',
    patterns: ['change order', 'change-order', 'variation', 'scope creep', 'fixed price', 'fixed-price', 'out of scope'],
    label: 'change-order triggers are not defined for known uncertainty',
    question: 'What change-order triggers apply if assumptions, inputs, or scope expand during delivery?',
    why: 'known uncertainty must be priced and allocated rather than silently pushed onto one side',
    condition: 'define contractual change-order triggers tied to the known uncertainty',
    confidenceUp: 'change-control terms that map directly to the unresolved assumptions',
    confidenceDown: 'price or timeline is treated as fixed while uncertainty remains unbounded',
  },
  {
    id: 'technical',
    priority: 100,
    severity: 'severe',
    patterns: ['architecture', 'integration', 'api', 'schema', 'security', 'performance', 'scalability', 'infrastructure'],
    label: 'critical technical assumptions remain unvalidated',
    question: 'Which technical assumptions around architecture, integrations, data handling, or performance still need validation?',
    why: 'technical unknowns can materially alter implementation effort, architecture, and budget',
    condition: 'run discovery or a technical spike to validate the unresolved technical assumptions',
    confidenceUp: 'technical discovery outputs that validate the integration, architecture, or data assumptions',
    confidenceDown: 'the proposal keeps a firm delivery position while key technical assumptions stay untested',
  },
  {
    id: 'phase_boundary',
    priority: 98,
    severity: 'material',
    patterns: ['phase 2', 'phase two', 'phase 1', 'phase one', 'later phase', 'future phase', 'next phase', 'rollout'],
    label: 'phase boundaries and deferrable work are not yet explicit',
    question: 'What belongs in the current phase, and what is intentionally deferred to later phases?',
    why: 'phase boundaries determine what must be priced, accepted, and protected now versus deferred without dispute',
    condition: 'separate the current phase scope from later-phase options with measurable exit gates',
    confidenceUp: 'explicit phase boundaries and measurable outputs for later-phase work',
    confidenceDown: 'later-phase aspirations stay mixed into current commitments',
  },
  {
    id: 'timeline',
    priority: 96,
    severity: 'material',
    patterns: ['timeline', 'deadline', 'milestone', 'duration', 'go live', 'go-live', 'schedule'],
    label: 'timeline assumptions are not reliable enough yet',
    question: 'What is the confirmed timeline, including milestones, dependencies, and any non-negotiable deadline?',
    why: 'timeline assumptions drive staffing, sequencing, and feasibility',
    condition: 'confirm the delivery timeline and dependency-linked milestones',
    confidenceUp: 'a timeline tied to explicit milestones, dependencies, and contingency assumptions',
    confidenceDown: 'delivery timing remains aspirational or detached from dependency reality',
  },
  {
    id: 'commercial',
    priority: 94,
    severity: 'material',
    patterns: ['budget', 'price', 'pricing', 'cost', 'commercial', 'contract', 'payment', 'billing', 'estimate'],
    label: 'commercial assumptions are not fully tied to defined scope and risk',
    question: 'What commercial model applies, and which assumptions underpin the current pricing or budget expectation?',
    why: 'commercial terms are unreliable if scope, dependencies, or risk allocation stay open',
    condition: 'tie pricing and contract posture to explicit scope and risk assumptions',
    confidenceUp: 'pricing tied to explicit assumptions, exclusions, and risk ownership',
    confidenceDown: 'commercial terms remain optimistic while key assumptions are still open',
  },
  {
    id: 'risk',
    priority: 92,
    severity: 'material',
    patterns: ['risk', 'risks', 'mitigation', 'risk register', 'risk owner'],
    label: 'risk allocation is still too vague',
    question: 'Which material delivery risks are known now, and how will each be mitigated or allocated between the parties?',
    why: 'unallocated risk weakens the recommendation and increases dispute exposure',
    condition: 'document the material risks, mitigations, and risk owners',
    confidenceUp: 'a risk register with mitigations, owners, and commercial treatment',
    confidenceDown: 'material risks stay implicit or are carried without agreement',
  },
  {
    id: 'governance',
    priority: 101,
    severity: 'severe',
    patterns: ['board', 'governance', 'control', 'control rights', 'reserved matters', 'observer rights', 'protective provisions'],
    label: 'governance and control rights still need clearer treatment',
    question: 'What governance rights, approval thresholds, or control provisions would apply if the deal proceeds?',
    why: 'governance terms can matter as much as headline economics because they define control, veto rights, and escalation power',
    condition: 'define the governance and control package with explicit approval mechanics',
    confidenceUp: 'clear governance rights, board treatment, and approval thresholds',
    confidenceDown: 'economics move ahead while control rights remain open or contested',
  },
  {
    id: 'valuation',
    priority: 99,
    severity: 'material',
    patterns: ['valuation', 'dilution', 'pre money', 'post money', 'cap table', 'equity', 'safe', 'priced round'],
    label: 'valuation and dilution assumptions still need to be tied to the wider deal structure',
    question: 'What valuation and dilution assumptions underpin the current economics, and what competing structures remain under consideration?',
    why: 'valuation and dilution shape the real economics and can re-open alignment even if the headline amount appears settled',
    condition: 'align the valuation and dilution assumptions with the governance and milestone structure',
    confidenceUp: 'a valuation position that is matched to dilution, governance, and milestone expectations',
    confidenceDown: 'headline economics stay open or internally inconsistent',
  },
  {
    id: 'tranche',
    priority: 97,
    severity: 'material',
    patterns: ['tranche', 'milestone financing', 'milestone based funding', 'use of funds', 'runway', 'diligence'],
    label: 'funding cadence and milestone conditions still need definition',
    question: 'Would the commitment close in one step or through tranches tied to diligence items, milestones, or use-of-funds checkpoints?',
    why: 'funding cadence changes closing certainty, dilution timing, and execution risk allocation',
    condition: 'define whether the commitment is fully funded at close or staged against explicit milestones',
    confidenceUp: 'a funding structure that clearly links close mechanics, diligence, and milestone release',
    confidenceDown: 'capital timing remains open while operating assumptions depend on it',
  },
  {
    id: 'specification',
    priority: 103,
    severity: 'severe',
    patterns: ['technical specification', 'specification', 'tolerance', 'defect', 'quality control', 'quality standard', 'acceptance sample'],
    label: 'technical specifications and defect treatment still need tighter definition',
    question: 'What technical specifications, quality tolerances, and defect definitions govern acceptance and replacement obligations?',
    why: 'specification ambiguity creates quality disputes, warranty exposure, and rejection risk',
    condition: 'lock the technical specification, defect definition, and acceptance treatment',
    confidenceUp: 'agreed specifications, tolerances, and defect-response mechanics',
    confidenceDown: 'acceptance is expected before the specification and defect treatment are settled',
  },
  {
    id: 'volume_commitment',
    priority: 95,
    severity: 'material',
    patterns: ['minimum order', 'moq', 'volume commitment', 'forecast', 'volume tier', 'exclusivity', 'territory', 'regional exclusivity'],
    label: 'volume, exclusivity, or forecast assumptions remain underdefined',
    question: 'What minimum order, forecast, or exclusivity commitments are required to support the current pricing and supply posture?',
    why: 'volume and exclusivity terms often drive pricing, capacity reservation, and strategic flexibility',
    condition: 'align the pricing structure with explicit volume and exclusivity thresholds',
    confidenceUp: 'clear MOQ, forecast, or exclusivity thresholds tied to pricing and performance',
    confidenceDown: 'price or exclusivity is discussed without the volume commitments that support it',
  },
  {
    id: 'logistics',
    priority: 93,
    severity: 'material',
    patterns: ['lead time', 'shipment', 'logistics', 'inventory', 'fulfillment', 'delivery terms', 'incoterms', 'warehouse'],
    label: 'lead times and logistics ownership still need clearer allocation',
    question: 'Which party owns lead-time commitments, inventory buffers, shipment logistics, and delay remedies?',
    why: 'logistics ownership can materially change reliability, working capital exposure, and service-level risk',
    condition: 'define lead times, logistics ownership, and the remedy structure for delays',
    confidenceUp: 'clear lead-time assumptions, logistics owners, and delay remedies',
    confidenceDown: 'operational delivery depends on logistics that remain unallocated',
  },
  {
    id: 'staffing',
    priority: 91,
    severity: 'material',
    patterns: ['staffing', 'resource plan', 'consultant', 'project manager', 'key personnel', 'onsite support', 'service team'],
    label: 'staffing and delivery-resourcing assumptions are still too open',
    question: 'What staffing mix, key roles, and continuity commitments are assumed for delivery?',
    why: 'staffing assumptions drive delivery capacity, knowledge retention, and timeline credibility',
    condition: 'lock the staffing model, key roles, and continuity expectations',
    confidenceUp: 'named delivery roles, resourcing assumptions, and continuity commitments',
    confidenceDown: 'delivery timing depends on staffing that remains implied or flexible',
  },
  {
    id: 'billing_trigger',
    priority: 90,
    severity: 'material',
    patterns: ['billing trigger', 'invoice', 'retainer', 'time and materials', 'fixed fee', 'milestone billing', 'payment trigger'],
    label: 'billing triggers and sign-off mechanics still need alignment',
    question: 'What billing triggers, sign-off points, or payment releases apply as work is completed?',
    why: 'billing mechanics become contentious when payment timing and sign-off rules are not aligned',
    condition: 'align billing triggers with named deliverables, sign-off points, and change treatment',
    confidenceUp: 'payment mechanics tied cleanly to deliverables and acceptance',
    confidenceDown: 'billing is expected to move ahead of a clear sign-off structure',
  },
];

const CONDITIONAL_CONFIDENCE_PATTERNS = [
  'must be defined',
  'must be quantified',
  'depends on',
  'dependent on',
  'unquantified',
  'undefined',
  'unclear',
  'not defined',
  'not yet defined',
  'needs discovery',
  'requires discovery',
  'out of vendor control',
  'out of the vendor s control',
  'critical risk',
  'pending clarification',
  'to be confirmed',
  'tbd',
  'open question',
  'pause pending clarification',
  'proceed with conditions',
  'conditionally ready',
];

const BODY_VIABLE_PATH_PATTERNS = [
  'workable starting point',
  'credible path to agreement',
  'plausible path to agreement',
  'commercially workable',
  'usable structure',
  'conditionally viable',
  'workable if',
  'bridge to agreement',
  'strong foundation',
];

const BODY_WEAK_PATH_PATTERNS = [
  'no credible path',
  'not commercially viable',
  'not feasible',
  'structurally weak',
  'fundamentally misaligned',
  'no realistic path to agreement',
  'no viable path',
];

const NEUTRAL_TONE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bImprove your position\b/gi, replacement: 'Build a more balanced path to agreement' },
  { pattern: /\b[Yy]ou should strengthen\b/g, replacement: 'The parties would need clearer bilateral treatment of' },
  { pattern: /\b[Yy]ou should rewrite\b/g, replacement: 'The parties would need to restate' },
  { pattern: /\b[Yy]ou should\b/g, replacement: 'The parties would need to' },
  { pattern: /\b[Yy]ou need to\b/g, replacement: 'The parties need to' },
  { pattern: /\b[Yy]our proposal would be better if\b/g, replacement: 'The current proposal becomes easier for both sides to accept if' },
  { pattern: /\b[Yy]our proposal would be stronger if\b/g, replacement: 'The current proposal becomes easier for both sides to rely on if' },
  { pattern: /\b[Yy]our proposal\b/g, replacement: 'the current proposal' },
  { pattern: /\b[Yy]our submission\b/g, replacement: 'the current proposal' },
  { pattern: /\b[Yy]our wording\b/g, replacement: 'the current wording' },
  { pattern: /\bif you\b/gi, replacement: 'if the parties' },
  { pattern: /\b[Bb]efore sending\b/g, replacement: 'Before either side treats this as ready to proceed' },
  { pattern: /\badd stronger wording around\b/gi, replacement: 'define more concrete bilateral treatment of' },
  { pattern: /\bstrengthen the remediation language\b/gi, replacement: 'define the bilateral treatment of remediation more explicitly' },
  { pattern: /\b[Tt]his makes your proposal look weak\b/g, replacement: 'This creates bilateral credibility and scope risk' },
  { pattern: /\b[Tt]o improve credibility\b/g, replacement: 'To reduce credibility risk for both sides' },
  { pattern: /\b[Tt]o increase your chances\b/g, replacement: 'To improve the path to agreement' },
  { pattern: /\bOptions:\b/g, replacement: 'Paths to agreement:' },
  { pattern: /\bFirst 2 weeks plan:\b/g, replacement: 'Immediate negotiation agenda:' },
  { pattern: /\bNext call: what I'?d ask for:\b/g, replacement: 'Next negotiation agenda:' },
  { pattern: /\bLikely pushback & response:\b/g, replacement: 'Likely sticking points & bridges:' },
];

const STOCK_PHRASE_POLISH_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bcore scope is not bounded tightly enough\b/gi, replacement: 'the initial scope still needs a tighter commitment boundary' },
  { pattern: /\bacceptance criteria are not concrete enough for sign-off\b/gi, replacement: 'acceptance criteria still need to be defined more concretely for reliable sign-off' },
  { pattern: /\bownership of major dependencies or approvals is still unclear\b/gi, replacement: 'major dependencies and approvals still need named owners and fallback treatment' },
  { pattern: /\bchange-order triggers are not defined for known uncertainty\b/gi, replacement: 'change-order treatment is still loose around known uncertainty' },
  { pattern: /\bcritical technical assumptions remain unvalidated\b/gi, replacement: 'key technical assumptions still need validation' },
  { pattern: /\bphase boundaries and deferrable work are not yet explicit\b/gi, replacement: 'the line between the current phase and later work still needs to be defined more clearly' },
  { pattern: /\btimeline assumptions are not reliable enough yet\b/gi, replacement: 'timeline assumptions still need firmer confirmation' },
  { pattern: /\bcommercial assumptions are not fully tied to defined scope and risk\b/gi, replacement: 'commercial terms are not yet tied cleanly to the current assumptions and risk allocation' },
  { pattern: /\brisk allocation is still too vague\b/gi, replacement: 'risk ownership and mitigation treatment are still too vague' },
];

const COACHING_GUARD_PATTERNS = [
  /\bimprove your position\b/i,
  /\byou should\b/i,
  /\byou need to\b/i,
  /\byour proposal\b/i,
  /\byour submission\b/i,
  /\bif you\b/i,
  /\bbefore sending\b/i,
  /\badd stronger wording\b/i,
  /\bstrengthen the remediation language\b/i,
  /\bincrease your chances\b/i,
  /\blook weak\b/i,
];

function trimParagraphAtSentenceBoundary(paragraph: string, maxChars: number) {
  const text = normalizeSpaces(paragraph);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  if (maxChars <= 0 || isRoleLockedParagraph(text)) return '';
  return truncateTextAtNaturalBoundary(text, maxChars);
}

/**
 * Section-aware truncation for why[].
 * Preserves heading labels, prefers dropping lower-priority paragraphs, and only
 * trims at sentence boundaries when a section would otherwise be omitted.
 */
function truncateWhyOutput(why: string[], maxChars: number): string[] {
  if (!Array.isArray(why)) return [];
  const sections = parseWhySections(why);
  const result: string[] = [];
  let total = 0;

  for (const section of sections) {
    const heading = asText(section.heading) || canonicalWhyHeading(section.key);
    const paragraphs = splitParagraphs(section.body);
    if (!heading || paragraphs.length === 0) continue;

    const formatEntry = (paragraphList: string[]) => `${heading}: ${combineParagraphs(paragraphList)}`;
    let keptParagraphs = [...paragraphs];
    let candidate = formatEntry(keptParagraphs);

    while (keptParagraphs.length > 0 && total + candidate.length + 1 > maxChars) {
      if (keptParagraphs.length > 1) {
        keptParagraphs = dropLowestPriorityParagraph(section.key, keptParagraphs);
        candidate = formatEntry(keptParagraphs);
        continue;
      }

      const remaining = maxChars - total - heading.length - 3 - 1;
      const trimmedParagraph = trimParagraphAtSentenceBoundary(keptParagraphs[0], remaining);
      if (trimmedParagraph) {
        keptParagraphs = [trimmedParagraph];
        candidate = formatEntry(keptParagraphs);
      } else {
        keptParagraphs = [];
      }
      break;
    }

    if (keptParagraphs.length === 0) {
      continue;
    }

    result.push(candidate);
    total += candidate.length + 1;
    if (total >= maxChars - 20) break;
  }

  return result;
}

function compressWhySectionsForRequiredCoverage(sections: WhySection[], maxChars: number) {
  const ordered = orderedWhySections(sections)
    .filter((section) => ALL_KNOWN_WHY_SECTION_KEYS.includes(section.key))
    .filter((section) => splitParagraphs(section.body).length > 0);
  if (ordered.length === 0) return [] as string[];

  const result: string[] = [];
  let remaining = maxChars;

  ordered.forEach((section, index) => {
    const heading = asText(section.heading) || canonicalWhyHeading(section.key);
    const paragraphs = splitParagraphs(section.body);
    if (!heading || paragraphs.length === 0) return;

    const sectionsLeft = Math.max(1, ordered.length - index);
    const reservedPerSection = Math.max(140, Math.floor(remaining / sectionsLeft));
    const bodyBudget = Math.max(90, reservedPerSection - heading.length - 2);
    const preferredParagraphs = (() => {
      if (section.key === 'decision readiness') {
        const selected = [
          paragraphs.find((paragraph) => /^Decision status:/i.test(paragraph)) || '',
          paragraphs.find((paragraph) => /^What must be agreed now vs later:/i.test(paragraph)) || '',
          paragraphs.find((paragraph) => /^What would change the verdict:/i.test(paragraph)) || '',
        ].filter(Boolean);
        return selected.length > 0 ? selected : [paragraphs[0]];
      }
      // For mediation sections, take first paragraph as priority
      return [paragraphs[0]];
    })();

    const perParagraphBudget = Math.max(70, Math.floor(bodyBudget / preferredParagraphs.length));
    const compressedParagraphs = preferredParagraphs
      .map((paragraph) => {
        let next = trimParagraphAtSentenceBoundary(paragraph, perParagraphBudget);
        if (!next) {
          next = truncateTextAtNaturalBoundary(sanitizeNarrativeParagraph(paragraph), perParagraphBudget);
        }
        return next;
      })
      .filter(Boolean);
    if (compressedParagraphs.length === 0) return;

    const entry = `${heading}: ${combineParagraphs(compressedParagraphs)}`;
    result.push(entry);
    remaining = Math.max(0, remaining - entry.length - 1);
  });

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
  'Who owns the major approvals, dependencies, and third-party inputs that the deal relies on?',
  'What change-order, variation, or repricing mechanism applies if assumptions or scope move during execution?',
];

const DOMAIN_FALLBACK_MISSING: Record<ProposalDomainId, string[]> = {
  software: [
    'Which integrations, APIs, or connected systems are part of the initial rollout, and which are deferred? — determines implementation effort, testing scope, and change-order exposure.',
    'What data migration, cleanup, or remediation work is assumed, and who owns it? — materially changes delivery effort, timeline, and commercial risk.',
    'What measurable adoption, performance, or SLA metrics define success after go-live? — sets the basis for acceptance, support obligations, and value realization.',
    'Which party owns access, environments, security review, and deployment windows? — drives delivery sequencing and schedule reliability.',
    'What support model, incident-response expectation, and post-launch service level apply? — changes staffing, operating coverage, and pricing assumptions.',
    'What change-request process applies if integration, reporting, or workflow requirements expand during rollout? — protects both sides from silent scope drift.',
  ],
  investment: [
    'What valuation and dilution assumptions underpin the current round structure? — changes the real economics even if the headline raise amount is stable.',
    'What governance rights, board treatment, and reserved matters would apply at close? — affects control and investor protection beyond price alone.',
    'Would capital be released in one close or in tranches tied to milestones or diligence items? — changes runway certainty and execution risk allocation.',
    'Which due-diligence workstreams remain open, and what issues could still move the terms? — determines closing certainty and timeline risk.',
    'What use-of-funds plan and milestone plan support the amount being raised? — links capital needs to operating outcomes and milestone credibility.',
    'Which investor protections are required versus negotiable? — shapes whether governance or downside protection is the real point of tension.',
  ],
  supply: [
    'What technical specifications, quality tolerances, and defect definitions govern acceptance? — determines warranty exposure, rejection rights, and operational risk.',
    'What minimum order quantities, forecast commitments, or volume tiers underpin the current pricing? — changes unit economics, capacity planning, and leverage.',
    'What lead times, inventory buffers, and logistics responsibilities apply? — drives service reliability and working-capital exposure.',
    'Is any exclusivity requested, and what performance or volume thresholds would justify it? — affects strategic flexibility and pricing tradeoffs.',
    'What warranty, replacement, or chargeback mechanism applies for defects, shortages, or delays? — allocates quality and delivery risk.',
    'Which regions, SKUs, or rollout phases are included in the initial commitment? — bounds scope and prevents spillover into later commercial disputes.',
  ],
  services: [
    'What specific deliverables, work products, and milestone sign-offs are included in the initial statement of work? — determines billing certainty and acceptance risk.',
    'What staffing mix, key roles, and continuity commitments are assumed for delivery? — affects execution capacity and knowledge retention.',
    'Which client-side inputs, approvals, or SMEs are required, and what happens if they are delayed? — shifts timeline risk and dependency ownership.',
    'What billing triggers, retainer terms, or milestone-payment releases apply? — ties the economics to actual delivery mechanics.',
    'What change-request process governs out-of-scope work or evolving requirements? — protects both sides from unpriced expansion.',
    'What acceptance or sign-off criteria convert the work into completed deliverables? — affects dispute exposure and project closeout.',
  ],
  generic: GENERIC_FALLBACK_MISSING,
};

type WhySection = {
  heading: string;
  key: string;
  body: string;
};

const REQUIRED_WHY_SECTION_KEYS = [
  'mediation summary',
  'decision readiness',
];

/**
 * Adaptive headings the AI may include alongside the two required sections.
 * The orchestration layer preserves any of these that appear in the AI output
 * instead of filtering to a fixed list.
 */
const ADAPTIVE_WHY_SECTION_KEYS = [
  'where agreement exists',
  'what is blocking commitment',
  'the real hesitation',
  'risk and how to reduce it',
  'proposed bridge',
  'what can be agreed now',
  'what must wait',
  'likely landing zone',
  'each side\'s position',
  'missing information that matters',
  'suggested next step',
  'recommended path',
];

const ALL_KNOWN_WHY_SECTION_KEYS = [...REQUIRED_WHY_SECTION_KEYS, ...ADAPTIVE_WHY_SECTION_KEYS];

type CalibrationSignals = {
  domain: ProposalDomain;
  rules: MissingRule[];
  ruleIds: Set<string>;
  blockerLabels: string[];
  conditions: string[];
  confidenceUp: string[];
  confidenceDown: string[];
  hasConditionalLanguage: boolean;
  highEligible: boolean;
  shouldBeConditional: boolean;
  shouldBeLow: boolean;
  conditionallyViable: boolean;
  fixedPriceSignal: boolean;
  coverageCount: number;
  alignmentPoints: string[];
  hasCrediblePath: boolean;
  structuralViabilityScore: number;
  bodySuggestsViablePath: boolean;
};

function normalizeKeywordText(value: string) {
  return asLower(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function keywordMatch(text: string, pattern: string) {
  const haystack = normalizeKeywordText(text);
  const needle = normalizeKeywordText(pattern);
  return Boolean(haystack && needle && haystack.includes(needle));
}

function domainDiligenceLabel(domain: ProposalDomain) {
  if (domain.id === 'software') return 'pilot or discovery tranche';
  if (domain.id === 'investment') return 'diligence or staged-close structure';
  if (domain.id === 'supply') return 'qualification order or pilot supply tranche';
  if (domain.id === 'services') return 'diagnostic or mobilization phase';
  return 'diligence step';
}

function findMatchingMissingRules(text: string) {
  const normalized = asText(text);
  if (!normalized) {
    return [] as MissingRule[];
  }
  return MISSING_RULES.filter((rule) => rule.patterns.some((pattern) => keywordMatch(normalized, pattern)));
}

function getMissingRuleById(id: string) {
  return MISSING_RULES.find((rule) => rule.id === id) || null;
}

function lowerFirst(value: string) {
  if (!value) return '';
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function stripTrailingPunctuation(value: string) {
  return String(value || '').replace(/[.?!]+$/g, '').trim();
}

function joinNatural(items: string[]) {
  const clean = items.map((item) => asText(item)).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

function neutralizeShareableText(value: string) {
  let next = String(value || '');
  NEUTRAL_TONE_REPLACEMENTS.forEach(({ pattern, replacement }) => {
    next = next.replace(pattern, replacement);
  });
  STOCK_PHRASE_POLISH_REPLACEMENTS.forEach(({ pattern, replacement }) => {
    next = next.replace(pattern, replacement);
  });
  return next.trim();
}

function hasCoachingLanguage(value: string) {
  return COACHING_GUARD_PATTERNS.some((pattern) => pattern.test(String(value || '')));
}

function normalizeWhyHeadingKey(value: string) {
  const normalized = normalizeKeywordText(value);
  if (!normalized) return '';
  // --- New mediation headings ---
  if (['mediation summary', 'mediation overview', 'summary'].includes(normalized)) return 'mediation summary';
  if (['where agreement exists', 'agreement', 'areas of agreement'].includes(normalized)) return 'where agreement exists';
  if (['what is blocking commitment', 'blocking commitment', 'blockers'].includes(normalized)) return 'what is blocking commitment';
  if (['the real hesitation', 'real hesitation', 'hesitation'].includes(normalized)) return 'the real hesitation';
  if (['risk and how to reduce it', 'risk reduction'].includes(normalized)) return 'risk and how to reduce it';
  if (['proposed bridge', 'bridge', 'bridging proposal'].includes(normalized)) return 'proposed bridge';
  if (['what can be agreed now', 'agree now'].includes(normalized)) return 'what can be agreed now';
  if (['what must wait', 'deferred', 'must wait'].includes(normalized)) return 'what must wait';
  if (['likely landing zone', 'landing zone'].includes(normalized)) return 'likely landing zone';
  if (['each side s position', 'each sides position', 'positions'].includes(normalized)) return 'each side\'s position';
  if (['missing information that matters', 'missing information', 'information gaps'].includes(normalized)) return 'missing information that matters';
  if (['suggested next step', 'next step'].includes(normalized)) return 'suggested next step';
  // --- Legacy headings (map to closest mediation equivalent) ---
  if (['executive summary', 'decision snapshot', 'snapshot'].includes(normalized)) return 'mediation summary';
  if (['decision assessment', 'assessment'].includes(normalized)) return 'mediation summary';
  if (['negotiation insights', 'negotiation insight'].includes(normalized)) return 'where agreement exists';
  if (['leverage signals', 'leverage', 'leverage signal'].includes(normalized)) return 'the real hesitation';
  if (['potential deal structures', 'deal structures', 'deal structure', 'options'].includes(normalized)) return 'proposed bridge';
  if (['recommendation', 'recommendations', 'recommended next step', 'next steps', 'path forward'].includes(normalized)) {
    return 'recommended path';
  }
  return normalized;
}

function canonicalWhyHeading(key: string) {
  const normalized = normalizeWhyHeadingKey(key);
  // New mediation headings
  if (normalized === 'mediation summary') return 'Mediation Summary';
  if (normalized === 'where agreement exists') return 'Where Agreement Exists';
  if (normalized === 'what is blocking commitment') return 'What Is Blocking Commitment';
  if (normalized === 'the real hesitation') return 'The Real Hesitation';
  if (normalized === 'risk and how to reduce it') return 'Risk and How to Reduce It';
  if (normalized === 'proposed bridge') return 'Proposed Bridge';
  if (normalized === 'what can be agreed now') return 'What Can Be Agreed Now';
  if (normalized === 'what must wait') return 'What Must Wait';
  if (normalized === 'likely landing zone') return 'Likely Landing Zone';
  if (normalized === 'each side\'s position') return 'Each Side\u2019s Position';
  if (normalized === 'missing information that matters') return 'Missing Information That Matters';
  if (normalized === 'suggested next step') return 'Suggested Next Step';
  if (normalized === 'recommended path') return 'Recommended Path';
  if (normalized === 'decision readiness') return 'Decision Readiness';
  // Legacy aliases (kept for backward compatibility with stored reports)
  if (normalized === 'risk summary') return 'Risk Summary';
  if (normalized === 'key risks') return 'Key Risks';
  if (normalized === 'key strengths') return 'Key Strengths';
  if (normalized === 'implementation notes') return 'Implementation Notes';
  if (normalized === 'commercial notes') return 'Commercial Notes';
  if (normalized === 'data security notes') return 'Data & Security Notes';
  if (normalized === 'vendor fit notes') return 'Vendor Fit Notes';
  return key || 'Section';
}

function coalesceLegacyWhySections(sections: WhySection[]) {
  if (!Array.isArray(sections) || sections.length === 0) return [] as WhySection[];

  const next = sections.map((section) => ({
    ...section,
    key: normalizeWhyHeadingKey(section.key || section.heading),
    heading: asText(section.heading) || canonicalWhyHeading(section.key),
    body: asText(section.body),
  }));

  next.forEach((section) => {
    if (section.key === 'snapshot') {
      section.key = 'mediation summary';
      section.heading = 'Mediation Summary';
    } else if (section.key === 'recommendations') {
      section.key = 'recommended path';
      section.heading = 'Recommended Path';
    }
  });

  const mediationSummaryParagraphs: string[] = [];
  const retained = next.filter((section) => {
    if (section.key === 'key risks' || section.key === 'risk summary') {
      const body = combineParagraphs(splitParagraphs(section.body));
      if (body) mediationSummaryParagraphs.push(`Risk Summary: ${body}`);
      return false;
    }
    if (section.key === 'key strengths') {
      const body = combineParagraphs(splitParagraphs(section.body));
      if (body) mediationSummaryParagraphs.push(`Key Strengths: ${body}`);
      return false;
    }
    return true;
  });

  if (mediationSummaryParagraphs.length > 0) {
    const existing = retained.find((section) => section.key === 'mediation summary');
    const mergedBody = combineParagraphs([
      ...(existing ? splitParagraphs(existing.body) : []),
      ...mediationSummaryParagraphs,
    ]);
    if (existing) {
      existing.heading = 'Mediation Summary';
      existing.body = mergedBody;
    } else {
      retained.push({
        heading: 'Mediation Summary',
        key: 'mediation summary',
        body: mergedBody,
      });
    }
  }

  return retained;
}

function splitParagraphs(value: string) {
  return String(value || '')
    .split(/\n{2,}/g)
    .map((paragraph) => normalizeSpaces(paragraph))
    .filter(Boolean);
}

const DEDUPE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'than', 'then',
  'both', 'side', 'sides', 'party', 'parties', 'their', 'there', 'what', 'when',
  'where', 'which', 'will', 'would', 'could', 'should', 'must', 'have', 'has',
  'had', 'not', 'yet', 'still', 'more', 'less', 'only', 'very', 'much', 'because',
  'while', 'under', 'over', 'they', 'them', 'also', 'does', 'doesn', 'being',
  'ready', 'proceed', 'proposal', 'current', 'agreement', 'against', 'between',
  'around', 'about', 'before', 'after', 'until', 'through', 'needs', 'need',
]);

function paragraphKeywords(value: string) {
  return normalizeKeywordText(value)
    .split(/\s+/g)
    .filter((token) => token.length > 2 && !DEDUPE_STOPWORDS.has(token));
}

function paragraphsAreNearDuplicates(a: string, b: string) {
  const left = normalizeSpaces(a).toLowerCase();
  const right = normalizeSpaces(b).toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.slice(0, 140) === right.slice(0, 140)) return true;

  const leftTokens = paragraphKeywords(left);
  const rightTokens = paragraphKeywords(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlap = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) overlap += 1;
  });
  const denominator = Math.max(1, Math.min(leftSet.size, rightSet.size));
  return overlap / denominator >= 0.72;
}

function paragraphDropPriority(sectionKey: string, paragraph: string, index: number) {
  const text = normalizeSpaces(paragraph);
  // Legacy section keys (kept for backward compatibility)
  if (sectionKey === 'decision assessment') {
    if (/^Risk Summary:/i.test(text)) return 1;
    if (/^Key Strengths:/i.test(text)) return 2;
    return 3 + index / 10;
  }
  // Current mediation section keys
  if (sectionKey === 'recommended path' || sectionKey === 'suggested next step') {
    if (/^Recommended path:/i.test(text)) return 1;
    if (/^Immediate next step:/i.test(text)) return 2;
    return 3 + index / 10;
  }
  if (sectionKey === 'decision readiness') {
    if (/^Decision status:/i.test(text)) return 1;
    if (/^What would change the verdict:/i.test(text)) return 4;
    if (/^What must be agreed now vs later:/i.test(text)) return 2;
    return 3 + index / 10;
  }
  return 1 + index / 10;
}

function dropLowestPriorityParagraph(sectionKey: string, paragraphs: string[]) {
  if (paragraphs.length <= 1) return [];
  let removeIndex = paragraphs.length - 1;
  let highestPriority = -1;
  paragraphs.forEach((paragraph, index) => {
    const priority = paragraphDropPriority(sectionKey, paragraph, index);
    if (priority >= highestPriority) {
      highestPriority = priority;
      removeIndex = index;
    }
  });
  return paragraphs.filter((_, index) => index !== removeIndex);
}

function maxParagraphsForSection(sectionKey: string) {
  if (sectionKey === 'mediation summary') return 4;
  if (sectionKey === 'decision readiness') return 3;
  if (sectionKey === 'recommended path') return 2;
  if (sectionKey === 'suggested next step') return 2;
  // Adaptive sections get a reasonable default
  if (ALL_KNOWN_WHY_SECTION_KEYS.includes(sectionKey)) return 3;
  return 2;
}

function isRoleLockedParagraph(value: string) {
  return /^(Risk Summary|Key Strengths|Decision status|What must be agreed now vs later|What would change the verdict|Recommended path|Immediate next step):/i.test(
    normalizeSpaces(value),
  );
}

function isLowSignalParagraph(value: string) {
  const text = normalizeSpaces(value);
  if (!text) return false;
  return [
    /looks polished/i,
    /broadly workable/i,
    /presented clearly/i,
    /mentioned but not fully resolved/i,
    /tighten details during delivery/i,
    /^proceed and /i,
    /^ready to proceed/i,
    /risk[- ]dominant/i,
    /^this section should stay/i,
    /^hesitation and blockers should/i,
    /^readiness depends on what the parties/i,
    /^the recommended path should turn/i,
  ].some((pattern) => pattern.test(text));
}

function parseWhySections(why: string[]) {
  return coalesceLegacyWhySections((Array.isArray(why) ? why : [])
    .map((entry, index) => {
      const raw = asText(entry);
      if (!raw) return null;
      const separator = raw.indexOf(': ');
      if (separator > 0) {
        const heading = raw.slice(0, separator).trim();
        return {
          heading,
          key: normalizeWhyHeadingKey(heading),
          body: raw.slice(separator + 2).trim(),
        } as WhySection;
      }
      const fallbackHeading = index === 0 ? 'Snapshot' : `Section ${index + 1}`;
      return {
        heading: fallbackHeading,
        key: normalizeWhyHeadingKey(fallbackHeading),
        body: raw,
      } as WhySection;
    })
    .filter(Boolean) as WhySection[]);
}

function combineParagraphs(paragraphs: string[]) {
  const result: string[] = [];
  paragraphs.forEach((paragraph) => {
    const trimmed = String(paragraph || '').trim();
    if (!trimmed) return;
    if (result.some((existing) => paragraphsAreNearDuplicates(existing, trimmed))) return;
    result.push(trimmed);
  });
  return result.join('\n\n');
}

function upsertWhySection(sections: WhySection[], key: string, body: string) {
  const normalizedKey = normalizeWhyHeadingKey(key);
  const existing = sections.find((section) => section.key === normalizedKey);
  if (existing) {
    existing.body = body;
    if (!existing.heading) {
      existing.heading = canonicalWhyHeading(normalizedKey);
    }
    return;
  }
  sections.push({
    heading: canonicalWhyHeading(normalizedKey),
    key: normalizedKey,
    body,
  });
}

function serializeWhySections(sections: WhySection[]) {
  return sections
    .map((section) => {
      const heading = asText(section.heading) || canonicalWhyHeading(section.key);
      const body = asText(section.body);
      return body ? `${heading}: ${body}` : '';
    })
    .filter(Boolean);
}

function lastSentenceBoundaryIndex(value: string) {
  const text = String(value || '');
  let lastIndex = -1;
  const matches = text.matchAll(/[.!?](?=\s|$)/g);
  for (const match of matches) {
    lastIndex = match.index ?? lastIndex;
  }
  return lastIndex >= 0 ? lastIndex + 1 : -1;
}

const TRAILING_FRAGMENT_PATTERN =
  /\b(and|or|but|because|if|then|with|for|to|of|in|on|by|versus|vs|than|around|about|under|over|through|including|depending|based)\b$/i;

function sanitizeNarrativeParagraph(value: string) {
  let next = normalizeSpaces(value);
  if (!next) return '';

  const ellipsisIndex = next.search(/(?:\.\.\.|…)/);
  if (ellipsisIndex >= 0) {
    const beforeEllipsis = next.slice(0, ellipsisIndex).trim();
    // Ellipsis means the model truncated mid-thought. If the remaining text
    // already ends with sentence punctuation, keep it as-is. Otherwise force
    // truncation back to the last natural sentence/clause boundary to avoid
    // mid-word fragments like "Conditions to proc."
    const budget = /[.!?]$/.test(beforeEllipsis)
      ? beforeEllipsis.length
      : Math.max(0, beforeEllipsis.length - 1);
    const shortened = truncateTextAtNaturalBoundary(beforeEllipsis, budget);
    if (shortened) {
      next = shortened;
    } else {
      return '';
    }
  }

  if (/[,:;–—-]$/.test(next) || TRAILING_FRAGMENT_PATTERN.test(next)) {
    const shortened = truncateTextAtNaturalBoundary(next, next.length);
    if (shortened) {
      next = shortened;
    } else {
      return '';
    }
  }

  if (!/[.!?]$/.test(next)) {
    const shortened = truncateTextAtNaturalBoundary(next, next.length);
    if (shortened && shortened !== next) {
      next = shortened;
    } else if (next.length >= 20 && !TRAILING_FRAGMENT_PATTERN.test(next)) {
      next = `${stripTrailingPunctuation(next)}.`;
    } else {
      return '';
    }
  }

  return normalizeSpaces(next);
}

function sanitizeWhyEntries(why: string[]) {
  const sections = parseWhySections(why);
  return orderedWhySections(sections)
    .map((section) => {
      const heading = asText(section.heading) || canonicalWhyHeading(section.key);
      const paragraphs = splitParagraphs(section.body)
        .map((paragraph) => sanitizeNarrativeParagraph(paragraph))
        .filter(Boolean);
      const body = combineParagraphs(paragraphs);
      return body ? `${heading}: ${body}` : '';
    })
    .filter(Boolean);
}

function splitMissingEntry(value: string) {
  const text = normalizeSpaces(value);
  const emDashIndex = text.indexOf('—');
  const hyphenDashIndex = emDashIndex >= 0 ? -1 : text.indexOf(' - ');
  const splitIndex = emDashIndex >= 0 ? emDashIndex : hyphenDashIndex;
  if (splitIndex < 0) {
    return { question: text, why: '' };
  }
  return {
    question: text.slice(0, splitIndex).trim(),
    why: text.slice(splitIndex + (emDashIndex >= 0 ? 1 : 3)).trim(),
  };
}

function isFixedPriceSignal(factSheet: ProposalFactSheet) {
  return containsAny(factSheet.vendor_preferences, [
    'fixed', 'fixed-price', 'fixed price', 'lump sum', 'firm fixed', 'firm price',
  ]) || containsAny(factSheet.constraints, [
    'fixed price', 'fixed-price', 'fixed contract',
  ]);
}

function toActionableMissingQuestion(raw: string, forcedRule?: MissingRule | null) {
  const text = normalizeSpaces(String(raw || '').replace(/^[\d\s.)-]+/, ''));
  const rule = forcedRule || findMatchingMissingRules(text)[0] || null;
  const normalized = asLower(text);

  if (
    normalized.includes('shared and confidential appear identical') ||
    normalized.includes('confidentiality separation may not be meaningful')
  ) {
    return 'Are the shared and confidential inputs materially different? — identical tiers reduce confidence because confidentiality separation may not be meaningful.';
  }

  if (!text) {
    if (!rule) return '';
    return `${rule.question} — ${rule.why}.`;
  }

  const emDashIndex = text.indexOf('—');
  const hyphenDashIndex = emDashIndex >= 0 ? -1 : text.indexOf(' - ');
  const splitIndex = emDashIndex >= 0 ? emDashIndex : hyphenDashIndex;
  const left = splitIndex >= 0 ? text.slice(0, splitIndex).trim() : text;
  const right = splitIndex >= 0 ? text.slice(splitIndex + (emDashIndex >= 0 ? 1 : 3)).trim() : '';

  let question = left;
  if (question.endsWith('?')) {
    question = question;
  } else if (/^(what|who|which|when|where|why|how)\b/i.test(question)) {
    question = `${stripTrailingPunctuation(question)}?`;
  } else if (rule) {
    question = rule.question;
  } else {
    const stem = stripTrailingPunctuation(question)
      .replace(/^(no|missing|undefined|unclear|clarify|confirm|define)\s+/i, '')
      .trim();
    question = `What is the agreed position on ${lowerFirst(stem || 'this unresolved issue')}?`;
  }

  const why = stripTrailingPunctuation(right || rule?.why || GENERIC_MISSING_WHY);
  return `${question} — ${why}.`;
}

function buildDerivedRuleIds(factSheet: ProposalFactSheet) {
  const ids: string[] = [];
  const sc = factSheet.source_coverage;
  if (!sc.has_scope) ids.push('scope');
  if (!sc.has_timeline) ids.push('timeline');
  if (!sc.has_kpis) ids.push('acceptance');
  if (!sc.has_constraints) ids.push('commercial');
  if (!sc.has_risks) ids.push('risk');
  if (isFixedPriceSignal(factSheet)) ids.push('change_order');
  return ids;
}

function collectCalibrationRules(params: {
  factSheet: ProposalFactSheet;
  texts: string[];
}) {
  const rules: MissingRule[] = [];
  const seen = new Set<string>();

  const addRule = (rule: MissingRule | null) => {
    if (!rule || seen.has(rule.id)) return;
    seen.add(rule.id);
    rules.push(rule);
  };

  params.texts.forEach((text) => {
    findMatchingMissingRules(text).forEach((rule) => addRule(rule));
  });

  buildDerivedRuleIds(params.factSheet).forEach((id) => {
    addRule(getMissingRuleById(id));
  });

  return rules.sort((a, b) => b.priority - a.priority);
}

function normalizeMissingQuestions(params: {
  factSheet: ProposalFactSheet;
  missing: string[];
}) {
  const domain = classifyProposalDomain(params.factSheet);
  const domainFallback = DOMAIN_FALLBACK_MISSING[domain.id] || GENERIC_FALLBACK_MISSING;
  const sourceItems = [
    ...params.missing,
    ...params.factSheet.open_questions,
    ...params.factSheet.missing_info,
  ].map((item) => asText(neutralizeShareableText(asText(item)))).filter(Boolean);
  const rules = collectCalibrationRules({
    factSheet: params.factSheet,
    texts: sourceItems,
  });

  if (sourceItems.length === 0 && rules.length === 0) {
    return [] as string[];
  }

  const entries: Array<{ text: string; priority: number; key: string }> = [];
  const seen = new Set<string>();

  const addEntry = (text: string, rule?: MissingRule | null, dedupeMode: 'text' | 'rule' = 'text') => {
    const cleaned = asText(text);
    if (!cleaned) return;
    const dedupeKey =
      dedupeMode === 'rule' && rule
        ? `rule:${rule.id}`
        : `text:${normalizeKeywordText(cleaned).slice(0, 120)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    entries.push({
      text: cleaned,
      priority: rule?.priority ?? 40,
      key: dedupeKey,
    });
  };

  sourceItems.forEach((item) => {
    const matchedRule = findMatchingMissingRules(item)[0] || null;
    addEntry(toActionableMissingQuestion(item, matchedRule), matchedRule, 'text');
  });

  rules.forEach((rule) => {
    addEntry(toActionableMissingQuestion('', rule), rule, 'rule');
  });

  if (entries.length === 0) {
    domainFallback.forEach((item) => addEntry(toActionableMissingQuestion(item), null));
  } else if (entries.length < MISSING_MIN_ITEMS) {
    domainFallback.forEach((item) => addEntry(toActionableMissingQuestion(item), null));
  }

  if (entries.length < MISSING_MIN_ITEMS) {
    GENERIC_FALLBACK_MISSING.forEach((item) => addEntry(toActionableMissingQuestion(item), null));
  }

  return dedupeMissingEntries(
    entries
      .sort((a, b) => b.priority - a.priority)
      .map((entry) => ({
        ...entry,
        text: sanitizeMissingEntry(entry.text),
      }))
      .filter((entry) => entry.text),
  )
    .slice(0, MISSING_MAX_ITEMS)
    .map((entry) => entry.text);
}

type VisibilityIndex = {
  visibleText: string;
  entityPhrases: string[];
};

const PROTECTED_REDACTION_PATTERNS = [
  'internal',
  'confidential',
  'private',
  'non-public',
  'sensitive',
  'proprietary',
  'margin',
  'cost basis',
  'pricing floor',
];

const DETAIL_HINT_PATTERNS = [
  'acceptance',
  'criteria',
  'threshold',
  'thresholds',
  'measurable',
  'metric',
  'metrics',
  'kpi',
  'logic',
  'rule',
  'rules',
  'reconciliation',
  'variance',
  'schema',
  'format',
  'mapping',
  'owner',
  'ownership',
  'responsibility',
  'trigger',
  'assumption',
  'assumptions',
  'quality',
  'scale',
  'detailed',
  'detail',
  'exact',
  'contingency',
  'exclusion',
  'exclusions',
  'out of scope',
  'out-of-scope',
  'sign off',
  'sign-off',
  'pricing assumptions',
  'payment terms',
  'milestones',
  'deadline',
  'renewal',
  'termination',
  'liability',
  'indemnity',
  'warranty',
  'service level',
  'sla',
];

const VISIBILITY_CATEGORY_RULES: Array<{
  patterns: string[];
  isVisible: (params: { factSheet: ProposalFactSheet; visibility: VisibilityIndex }) => boolean;
}> = [
  {
    patterns: ['scope', 'deliverable', 'deliverables', 'mvp', 'phase'],
    isVisible: ({ factSheet }) => Boolean(factSheet.project_goal) || factSheet.source_coverage.has_scope,
  },
  {
    patterns: ['timeline', 'schedule', 'milestone', 'milestones', 'deadline', 'duration', 'dates'],
    isVisible: ({ factSheet }) => factSheet.source_coverage.has_timeline,
  },
  {
    patterns: ['metric', 'metrics', 'kpi', 'kpis', 'success criteria', 'target', 'targets'],
    isVisible: ({ factSheet }) => factSheet.source_coverage.has_kpis,
  },
  {
    patterns: ['budget', 'price', 'pricing', 'commercial model', 'commercial', 'payment', 'contract'],
    isVisible: ({ factSheet, visibility }) =>
      factSheet.source_coverage.has_constraints
      || ['budget', 'pricing', 'commercial', 'payment', 'contract'].some((pattern) => keywordMatch(visibility.visibleText, pattern)),
  },
  {
    patterns: ['risk', 'risks', 'mitigation'],
    isVisible: ({ factSheet }) => factSheet.source_coverage.has_risks,
  },
  {
    patterns: ['system', 'systems', 'tool', 'tools', 'platform', 'platforms', 'application', 'applications', 'site', 'sites', 'stakeholder', 'stakeholders', 'names', 'name'],
    isVisible: ({ visibility }) => visibility.entityPhrases.length > 0,
  },
  {
    patterns: ['architecture', 'technical architecture', 'integration', 'integrations', 'api', 'schema', 'governance'],
    isVisible: ({ visibility }) =>
      ['architecture', 'integration', 'api', 'schema', 'governance'].some((pattern) => keywordMatch(visibility.visibleText, pattern)),
  },
];

function addVisiblePhrase(target: Set<string>, value: string) {
  const normalized = normalizeKeywordText(value);
  if (!normalized || normalized.length < 3) return;
  target.add(normalized);
}

function extractEntityPhrases(text: string) {
  const matches = String(text || '').match(/\b(?:[A-Z][A-Za-z0-9&+._/-]*\s+){0,2}[A-Z][A-Za-z0-9&+._/-]*\b/g) || [];
  const stopwords = new Set([
    'Executive', 'Summary', 'Decision', 'Assessment', 'Negotiation', 'Insights',
    'Leverage', 'Signals', 'Potential', 'Deal', 'Structures', 'Key', 'Risks',
    'Risk', 'Strengths', 'Readiness', 'Recommended', 'Path',
  ]);
  const phrases = new Set<string>();
  matches.forEach((match) => {
    const cleaned = normalizeSpaces(match);
    if (!cleaned) return;
    const parts = cleaned.split(' ');
    if (parts.every((part) => stopwords.has(part))) return;
    addVisiblePhrase(phrases, cleaned);
  });
  return [...phrases];
}

function buildVisibilityIndex(params: {
  factSheet: ProposalFactSheet;
  sharedText: string;
  why: string[];
}) {
  const phraseSet = new Set<string>();
  const addList = (items: string[]) => {
    items.forEach((item) => addVisiblePhrase(phraseSet, item));
  };

  if (params.factSheet.source_coverage.has_scope) {
    addList(params.factSheet.scope_deliverables);
  }
  if (params.factSheet.source_coverage.has_timeline) {
    addList([
      params.factSheet.timeline.start || '',
      params.factSheet.timeline.duration || '',
      ...params.factSheet.timeline.milestones,
    ]);
  }
  if (params.factSheet.source_coverage.has_constraints) {
    addList([...params.factSheet.constraints, ...params.factSheet.vendor_preferences]);
  }
  if (params.factSheet.source_coverage.has_kpis) {
    addList(params.factSheet.success_criteria_kpis);
  }
  if (params.factSheet.source_coverage.has_risks) {
    addList(params.factSheet.risks.map((item) => item.risk));
  }
  addList([
    params.factSheet.project_goal || '',
    ...params.factSheet.assumptions,
    ...params.factSheet.open_questions,
  ]);
  extractEntityPhrases(params.sharedText).forEach((item) => addVisiblePhrase(phraseSet, item));
  params.why.forEach((entry) => extractEntityPhrases(entry).forEach((item) => addVisiblePhrase(phraseSet, item)));

  return {
    visibleText: normalizeSpaces([
      params.sharedText,
      params.factSheet.project_goal || '',
      ...(params.factSheet.source_coverage.has_scope ? params.factSheet.scope_deliverables : []),
      ...(params.factSheet.source_coverage.has_timeline
        ? [params.factSheet.timeline.start || '', params.factSheet.timeline.duration || '', ...params.factSheet.timeline.milestones]
        : []),
      ...(params.factSheet.source_coverage.has_constraints ? [...params.factSheet.constraints, ...params.factSheet.vendor_preferences] : []),
      ...(params.factSheet.source_coverage.has_kpis ? params.factSheet.success_criteria_kpis : []),
      ...params.factSheet.assumptions,
      ...params.factSheet.open_questions,
      ...(params.factSheet.source_coverage.has_risks ? params.factSheet.risks.map((item) => item.risk) : []),
      ...params.why,
    ].join(' ')),
    entityPhrases: [...phraseSet],
  } as VisibilityIndex;
}

function hasDetailHint(text: string) {
  return DETAIL_HINT_PATTERNS.some((pattern) => keywordMatch(text, pattern));
}

function countDetailHints(text: string) {
  return DETAIL_HINT_PATTERNS.filter((pattern) => keywordMatch(text, pattern)).length;
}

function sanitizeMissingEntry(value: string) {
  const text = normalizeSpaces(value);
  if (!text) return '';
  const { question, why } = splitMissingEntry(text);
  let nextQuestion = sanitizeNarrativeParagraph(stripTrailingPunctuation(question));
  if (!nextQuestion) return '';
  nextQuestion = stripTrailingPunctuation(nextQuestion);
  if (!nextQuestion.endsWith('?')) {
    if (/^(what|which|who|where|when|why|how)\b/i.test(nextQuestion)) {
      nextQuestion = `${nextQuestion}?`;
    } else {
      nextQuestion = `What is the agreed position on ${lowerFirst(nextQuestion)}?`;
    }
  }

  let nextWhy = sanitizeNarrativeParagraph(stripTrailingPunctuation(why));
  if (!nextWhy) {
    nextWhy = GENERIC_MISSING_WHY;
  }
  nextWhy = stripTrailingPunctuation(nextWhy);
  if (!nextWhy) return '';

  return `${nextQuestion} — ${nextWhy}.`;
}

function keywordOverlapRatio(left: string, right: string) {
  const stopwords = new Set([
    'what',
    'which',
    'who',
    'where',
    'when',
    'why',
    'how',
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'than',
    'then',
    'will',
    'would',
    'should',
    'must',
  ]);
  const tokenize = (value: string) =>
    new Set(
      normalizeKeywordText(value)
        .split(' ')
        .filter((token) => token.length >= 4 && !stopwords.has(token)),
    );

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  });

  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function missingEntriesOverlap(left: string, right: string) {
  const leftParts = splitMissingEntry(left);
  const rightParts = splitMissingEntry(right);
  const questionOverlap =
    paragraphsAreNearDuplicates(leftParts.question, rightParts.question)
    || keywordOverlapRatio(leftParts.question, rightParts.question) >= 0.8;
  const whyOverlap =
    Boolean(leftParts.why && rightParts.why)
    && (
      paragraphsAreNearDuplicates(leftParts.why, rightParts.why)
      || keywordOverlapRatio(leftParts.why, rightParts.why) >= 0.72
    );
  const subjectOverlap =
    keywordOverlapRatio(extractMissingSubject(left), extractMissingSubject(right)) >= 0.8;
  return (
    questionOverlap
    || whyOverlap
    || (
      subjectOverlap
      && Boolean(leftParts.why && rightParts.why)
      && keywordOverlapRatio(leftParts.why, rightParts.why) >= 0.55
    )
  );
}

function isMoreSpecificMissingEntry(left: string, right: string) {
  const leftHints = countDetailHints(left);
  const rightHints = countDetailHints(right);
  if (leftHints !== rightHints) return leftHints > rightHints;
  return left.length > right.length;
}

function dedupeMissingEntries(entries: Array<{ text: string; priority: number; key: string }>) {
  const deduped: Array<{ text: string; priority: number; key: string }> = [];

  entries.forEach((entry) => {
    const duplicateIndex = deduped.findIndex((existing) => missingEntriesOverlap(existing.text, entry.text));
    if (duplicateIndex < 0) {
      deduped.push(entry);
      return;
    }

    const existing = deduped[duplicateIndex];
    if (
      entry.priority > existing.priority
      || (entry.priority === existing.priority && isMoreSpecificMissingEntry(entry.text, existing.text))
    ) {
      deduped[duplicateIndex] = entry;
    }
  });

  return deduped;
}

function sanitizeRedactionEntry(value: string) {
  let next = normalizeSpaces(asText(value));
  if (!next) return '';
  if (/(?:\.\.\.|…)/.test(next)) return '';
  next = next.replace(/[,:;–—-]+$/g, '').trim();
  return next;
}

function extractMissingSubject(text: string) {
  const left = asText(text).split('—')[0] || '';
  return stripTrailingPunctuation(left)
    .replace(/^(what|which|who|where|when|how)\b/i, '')
    .replace(/^(is|are|the|a|an)\b/i, '')
    .trim();
}

function isAlreadyVisibleCategory(params: {
  subject: string;
  factSheet: ProposalFactSheet;
  visibility: VisibilityIndex;
}) {
  return VISIBILITY_CATEGORY_RULES.some((rule) =>
    rule.patterns.some((pattern) => keywordMatch(params.subject, pattern)) && rule.isVisible(params),
  );
}

function isVisiblePhrase(params: {
  subject: string;
  visibility: VisibilityIndex;
}) {
  const normalizedSubject = normalizeKeywordText(params.subject);
  if (!normalizedSubject) return false;
  return params.visibility.entityPhrases.some((phrase) =>
    normalizedSubject.includes(phrase) || phrase.includes(normalizedSubject),
  );
}

function filterVisibleMissingItems(params: {
  factSheet: ProposalFactSheet;
  sharedText: string;
  why: string[];
  missing: string[];
}) {
  const visibility = buildVisibilityIndex({
    factSheet: params.factSheet,
    sharedText: params.sharedText,
    why: params.why,
  });
  const kept: string[] = [];
  const seen = new Set<string>();

  params.missing.forEach((item) => {
    const text = asText(item);
    if (!text) return;
    if (/shared and confidential inputs materially different|identical tiers/i.test(text)) {
      kept.push(text);
      return;
    }
    const subject = extractMissingSubject(text);
    const detailSpecific = hasDetailHint(text);
    const alreadyVisible =
      !detailSpecific
      && (
        isVisiblePhrase({ subject, visibility })
        || isAlreadyVisibleCategory({ subject, factSheet: params.factSheet, visibility })
      );
    if (alreadyVisible) return;
    const dedupeKey = normalizeKeywordText(text).slice(0, 120);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    kept.push(text);
  });

  return kept.slice(0, MISSING_MAX_ITEMS);
}

function normalizeRedactions(params: {
  factSheet: ProposalFactSheet;
  sharedText: string;
  why: string[];
  missing: string[];
  redactions: string[];
}) {
  const visibility = buildVisibilityIndex({
    factSheet: params.factSheet,
    sharedText: params.sharedText,
    why: params.why,
  });
  const seen = new Set<string>();

  return params.redactions
    .map((item) => sanitizeRedactionEntry(neutralizeShareableText(item)))
    .filter((item) => {
      if (!item) return false;
      if (params.missing.some((missingItem) => paragraphsAreNearDuplicates(missingItem, item))) return false;
      const subject = extractMissingSubject(item);
      const detailSpecific = hasDetailHint(item);
      const protectedDetail = PROTECTED_REDACTION_PATTERNS.some((pattern) => keywordMatch(item, pattern));
      if (!protectedDetail && isVisiblePhrase({ subject, visibility })) return false;
      if (!detailSpecific && isAlreadyVisibleCategory({ subject, factSheet: params.factSheet, visibility })) return false;
      const dedupeKey = normalizeKeywordText(item).slice(0, 120);
      if (!dedupeKey || seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .slice(0, REDACTIONS_MAX_ITEMS);
}

function buildPositiveEvidenceSummary(factSheet: ProposalFactSheet) {
  const evidence: string[] = [];
  if (factSheet.scope_deliverables.length > 0) {
    evidence.push(
      `${Math.min(factSheet.scope_deliverables.length, 3)} named deliverable${factSheet.scope_deliverables.length === 1 ? '' : 's'}`,
    );
  }
  if (factSheet.timeline.duration || factSheet.timeline.milestones.length > 0) {
    evidence.push('a defined delivery timeline');
  }
  if (factSheet.success_criteria_kpis.length > 0) {
    evidence.push('measurable success criteria');
  }
  if (factSheet.constraints.length > 0) {
    evidence.push('stated delivery constraints');
  }
  if (factSheet.risks.length > 0) {
    evidence.push('an explicit risk list');
  }
  return joinNatural(evidence.slice(0, 3));
}

function hasCommercialSignal(factSheet: ProposalFactSheet) {
  return containsAny([...factSheet.constraints, ...factSheet.vendor_preferences], [
    'budget', 'price', 'pricing', 'commercial', 'payment', 'billing', 'contract', 'fixed', 'fixed-price', 'estimate',
  ]);
}

function buildAlignmentPoints(factSheet: ProposalFactSheet) {
  const points: string[] = [];
  const addPoint = (value: string) => {
    const text = asText(value);
    if (!text || points.includes(text)) return;
    points.push(text);
  };

  if (factSheet.project_goal) {
    addPoint('a shared high-level objective');
  }
  if (factSheet.scope_deliverables.length > 0) {
    const deliverables = factSheet.scope_deliverables
      .slice(0, 2)
      .map((item) => stripTrailingPunctuation(item))
      .filter(Boolean);
    if (deliverables.length > 0) {
      addPoint(
        deliverables.length === 1
          ? `a named core deliverable (${deliverables[0]})`
          : `named deliverables such as ${joinNatural(deliverables)}`,
      );
    }
  }
  if (factSheet.timeline.milestones.length > 1) {
    addPoint('a phased structure with named milestones');
  } else if (factSheet.timeline.duration || factSheet.timeline.start || factSheet.timeline.milestones.length > 0) {
    addPoint('a stated delivery timeline');
  }
  if (factSheet.success_criteria_kpis.length > 0) {
    addPoint('measurable success criteria');
  }
  if (hasCommercialSignal(factSheet)) {
    addPoint('a commercially workable starting posture');
  } else if (factSheet.constraints.length > 0) {
    addPoint('visible delivery constraints');
  }
  if (factSheet.risks.length > 0) {
    addPoint('identified delivery risks');
  }
  return points.slice(0, 4);
}

function buildAssumptionsSummary(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const clauses: string[] = [];
  params.factSheet.assumptions
    .slice(0, 2)
    .map((item) => stripTrailingPunctuation(item))
    .filter(Boolean)
    .forEach((item) => clauses.push(item));

  if (params.signals.ruleIds.has('dependency')) {
    clauses.push('major approvals, access, or third-party inputs still need named owners and fallback treatment');
  }
  if (params.signals.ruleIds.has('data_cleanup')) {
    clauses.push('data quality is being assumed rather than quantified');
  }
  if (params.signals.ruleIds.has('technical')) {
    clauses.push('integration or architecture assumptions remain to be validated');
  }
  if (params.signals.ruleIds.has('phase_boundary')) {
    clauses.push('the proposal still needs a cleaner line between the current phase and later-phase work');
  }

  return joinNatural(clauses.slice(0, 2))
    || 'the remaining scope, dependency, and commercial assumptions still need explicit bilateral treatment';
}

function buildRiskTransferSummary(signals: CalibrationSignals) {
  const clauses: string[] = [];
  const addClause = (value: string) => {
    if (!value || clauses.includes(value)) return;
    clauses.push(value);
  };

  if (signals.ruleIds.has('data_cleanup')) {
    addClause('data remediation risk is not yet assigned cleanly');
  }
  if (signals.ruleIds.has('acceptance')) {
    addClause('sign-off risk remains subjective');
  }
  if (signals.ruleIds.has('dependency')) {
    addClause('timeline risk still sits with whichever party controls access or approvals');
  }
  if (signals.ruleIds.has('change_order')) {
    addClause('price certainty is being asked for before uncertainty is bounded');
  }
  if (signals.ruleIds.has('scope')) {
    addClause('scope interpretation risk remains open between scope, effort, and price');
  }
  if (signals.ruleIds.has('technical')) {
    addClause('architecture and budget assumptions remain untested');
  }
  if (signals.ruleIds.has('commercial')) {
    addClause('commercial exposure is not yet tied tightly enough to defined assumptions');
  }
  if (signals.ruleIds.has('timeline')) {
    addClause('delivery timing is still broader than a clean contractual commitment');
  }
  if (signals.ruleIds.has('phase_boundary')) {
    addClause('later-phase aspirations are still mixed into the current commitment');
  }
  if (signals.ruleIds.has('risk')) {
    addClause('known risks are not yet allocated with owners and mitigations');
  }

  return joinNatural(clauses.slice(0, 2));
}

function describeBlockerForContext(ruleId: string, context: 'snapshot' | 'risk') {
  const snapshotMap: Record<string, string> = {
    scope: 'the initial scope still needs a tighter commitment boundary',
    data_cleanup: 'data remediation remains unquantified and unowned',
    acceptance: 'sign-off criteria are still too loose for reliable acceptance',
    dependency: 'major dependencies still lack clear owners and fallback treatment',
    change_order: 'change-order treatment is still undefined around known uncertainty',
    technical: 'key technical assumptions still need validation',
    phase_boundary: 'the line between the current phase and later work is still too loose',
    timeline: 'timeline assumptions remain unconfirmed',
    commercial: 'commercial terms are not yet tied cleanly to the current assumptions',
    risk: 'risk ownership remains too vague',
  };
  const riskMap: Record<string, string> = {
    scope: 'scope interpretation remains broad enough to create pricing and delivery dispute risk',
    data_cleanup: 'data remediation could shift material effort onto one side without an agreed owner',
    acceptance: 'subjective sign-off still leaves payment and completion exposure open',
    dependency: 'dependency slippage can still spill directly into delivery and budget risk',
    change_order: 'known uncertainty can still trigger disputes because change-control treatment is loose',
    technical: 'untested technical assumptions could still move architecture, effort, or cost',
    phase_boundary: 'later-phase ambitions are still close enough to the current phase to create spillover risk',
    timeline: 'delivery timing can still move if milestones and dependencies stay loosely tied',
    commercial: 'commercial posture can still drift away from the actual risk allocation',
    risk: 'known risks still lack clear mitigation and owner treatment',
  };

  return (context === 'snapshot' ? snapshotMap : riskMap)[ruleId] || '';
}

function buildBlockerSummary(params: {
  signals: CalibrationSignals;
  context: 'snapshot' | 'risk';
}) {
  const clauses = params.signals.rules
    .slice(0, 2)
    .map((rule) => describeBlockerForContext(rule.id, params.context))
    .filter(Boolean);

  if (clauses.length > 0) {
    return joinNatural(clauses);
  }

  return params.context === 'snapshot'
    ? 'the current materials are not yet bounded tightly enough for commitment'
    : 'scope, dependency, or commercial exposure still remains too open';
}

function buildStrengthParagraphs(params: {
  factSheet: ProposalFactSheet;
  data: VertexEvaluationV2MediationResponse;
  signals: CalibrationSignals;
  positiveEvidence: string;
  strengthsPoints: string[];
}) {
  if (params.data.fit_level === 'low') {
    if (params.strengthsPoints.length > 0) {
      const paragraphs = [
        `Some alignment still exists around ${joinNatural(params.strengthsPoints)}, but those positives are not enough to offset the unresolved structural gaps.`,
      ];
      if (params.positiveEvidence) {
        paragraphs.push(
          `The strongest usable positives are ${params.positiveEvidence}, but they still do not create a dependable commitment path on the current record.`,
        );
      }
      return paragraphs;
    }
    return ['The parties have at least identified a common objective, but the current structure still lacks a dependable path to agreement.'];
  }

  const primary = params.strengthsPoints.slice(0, 2);
  const secondary = params.signals.alignmentPoints.slice(2, 4);
  const paragraphs: string[] = [];

  if (primary.length > 0) {
    paragraphs.push(`Areas of alignment include ${joinNatural(primary)}.`);
  } else if (params.positiveEvidence) {
    paragraphs.push(`The current proposal already gives both sides usable structure through ${params.positiveEvidence}.`);
  }

  if (secondary.length > 0) {
    paragraphs.push(
      `The current materials also provide ${joinNatural(secondary)}, which gives the parties a more concrete base for sequencing, governance, or sign-off.`,
    );
  } else if (params.positiveEvidence) {
    paragraphs.push(
      `Those positives matter because the discussion is already anchored in ${params.positiveEvidence} rather than broad intent alone.`,
    );
  }

  if (params.signals.conditionallyViable) {
    paragraphs.push(
      'That structure matters because it creates a plausible path to agreement once the unresolved conditions are tied to scope, sign-off, and commercial treatment.',
    );
  }

  return paragraphs.filter(Boolean);
}

function buildPathsToAgreement(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const paths: string[] = [];
  const addPath = (value: string) => {
    const text = asText(value);
    if (!text || paths.includes(text)) return;
    paths.push(text);
  };

  if (params.signals.ruleIds.has('data_cleanup') || params.signals.ruleIds.has('technical')) {
    addPath(`use a ${domainDiligenceLabel(params.signals.domain)} before any broad commitment is treated as final`);
  }
  if (params.signals.domain.id === 'investment') {
    addPath('trade valuation against governance or investor-protection terms instead of negotiating price in isolation');
  }
  if (params.signals.domain.id === 'supply') {
    addPath('tie pricing, exclusivity, or lead-time commitments to explicit volume thresholds and service remedies');
  }
  if (params.signals.domain.id === 'services') {
    addPath('lock the initial statement of work, staffing model, and billing triggers before expanding the mandate');
  }
  if (params.signals.ruleIds.has('scope') || params.signals.ruleIds.has('acceptance') || params.signals.ruleIds.has('phase_boundary')) {
    addPath('narrow the initial scope and attach measurable acceptance gates before broader expansion');
  }
  if (params.signals.ruleIds.has('change_order') || params.signals.ruleIds.has('commercial') || params.signals.ruleIds.has('dependency') || params.signals.ruleIds.has('timeline')) {
    addPath('tie price, timing, and change-order treatment to named assumptions, owners, and contingency triggers');
  }
  if (paths.length === 0 && params.factSheet.timeline.milestones.length > 1) {
    addPath('phase the commitment so the first milestone is bounded now and later milestones are confirmed after early evidence');
  }
  if (paths.length === 0) {
    addPath('convert the current structure into explicit bilateral conditions to proceed before treating it as sign-ready');
  }

  return paths.slice(0, 3);
}

function buildNowVsLaterSummary(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const nowItems = params.signals.conditions.slice(0, 3);
  const nowText = nowItems.length > 0
    ? `the parties should ${joinNatural(nowItems)} now`
    : 'the parties should settle the remaining scope, acceptance, and dependency conditions now';

  const laterText =
    params.signals.domain.id === 'investment'
      ? 'non-core governance refinements or follow-on milestone mechanics can wait until the initial round structure is agreed'
      : params.signals.domain.id === 'supply'
      ? 'broader regional scope, higher-volume tiers, or exclusivity terms can wait until the initial supply performance is proven'
      : params.signals.domain.id === 'services'
      ? 'secondary workstreams or expansion services can wait until the initial statement of work is accepted'
      : params.factSheet.timeline.milestones.length > 1 || params.signals.ruleIds.has('phase_boundary')
      ? 'broader rollout items can wait until the earlier phase proves out against agreed gates'
      : params.factSheet.scope_deliverables.length > 2
      ? 'secondary deliverables can be deferred until the initial commitment is accepted'
      : 'secondary optimizations or expansion items can wait until the initial commitment is accepted';

  return `What must be agreed now vs later: ${nowText}; ${laterText}.`;
}

function buildNegotiationAgendaItems(signals: CalibrationSignals) {
  const items: string[] = [];
  const addItem = (value: string) => {
    const text = stripTrailingPunctuation(value);
    if (!text || items.includes(text)) return;
    items.push(text);
  };

  signals.rules.forEach((rule) => {
    if (rule.id === 'scope') addItem('define the current commitment boundary and explicit exclusions');
    if (rule.id === 'data_cleanup') addItem('assign remediation ownership and quantify cleanup effort');
    if (rule.id === 'acceptance') addItem('agree measurable acceptance criteria for the key deliverables');
    if (rule.id === 'dependency') addItem('name dependency owners, approvals, and fallback treatment');
    if (rule.id === 'change_order') addItem('set change-order triggers for the known uncertainty');
    if (rule.id === 'technical') addItem('validate the core technical and integration assumptions');
    if (rule.id === 'timeline') addItem('confirm milestones and any non-negotiable deadline assumptions');
    if (rule.id === 'commercial') addItem('tie pricing posture to explicit assumptions and exclusions');
    if (rule.id === 'phase_boundary') addItem('separate current-phase obligations from later-phase options');
    if (rule.id === 'governance') addItem('align governance rights, approval thresholds, and control protections');
    if (rule.id === 'valuation') addItem('tie valuation and dilution assumptions to the wider deal structure');
    if (rule.id === 'tranche') addItem('define whether closing is single-step or milestone-based');
    if (rule.id === 'specification') addItem('lock the technical specification and defect treatment');
    if (rule.id === 'volume_commitment') addItem('tie pricing or exclusivity to explicit volume commitments');
    if (rule.id === 'logistics') addItem('assign logistics ownership, lead times, and delay remedies');
    if (rule.id === 'staffing') addItem('lock the staffing model and continuity expectations');
    if (rule.id === 'billing_trigger') addItem('align billing triggers with milestone sign-off and deliverables');
  });

  if (items.length < 3) addItem('confirm which issues must be fixed now versus deferred to a later phase');
  if (items.length < 3) addItem('align the commercial posture with the actual risk ownership');
  if (items.length < 3) addItem('confirm the narrowest commit-ready version of the current proposal');

  return items.slice(0, 3);
}

function buildStickingPointsParagraph(signals: CalibrationSignals) {
  if (signals.domain.id === 'investment') {
    const scenarios: string[] = [
      'If one side wants the current valuation while governance, control rights, or investor protections remain open, then the bridge is a cleaner valuation-versus-control tradeoff rather than more headline debate.',
      'If capital needs are urgent before diligence or milestone confidence is complete, then the bridge is a staged close or tranche structure tied to explicit milestones.',
    ];
    return scenarios.slice(0, 2).join(' ');
  }

  if (signals.domain.id === 'supply') {
    const scenarios: string[] = [
      'If the buyer wants lower unit pricing before specifications, lead times, or forecast volumes are fixed, then the bridge is a pilot order, MOQ tiering, or conditional exclusivity structure.',
      'If the supplier wants longer commitments before regional scope or defect treatment is settled, then the bridge is a narrower initial volume with explicit service and warranty gates.',
    ];
    return scenarios.slice(0, 2).join(' ');
  }

  if (signals.domain.id === 'services') {
    const scenarios: string[] = [
      'If the client wants firm fees before staffing, dependencies, or sign-off points are fully defined, then the bridge is a mobilization phase, capped allowance, or clearer change-request regime.',
      'If the provider wants faster start dates while client-side approvals or SME access remain open, then the bridge is to name dependency owners and phase the early deliverables.',
    ];
    return scenarios.slice(0, 2).join(' ');
  }

  const scenarios: string[] = [];

  if (signals.ruleIds.has('data_cleanup') || signals.ruleIds.has('change_order') || signals.ruleIds.has('technical')) {
    scenarios.push(
      `If either side wants firm pricing before the data or technical assumptions are validated, then the bridge is a ${domainDiligenceLabel(signals.domain)} or a capped allowance tied to agreed change-order triggers.`,
    );
  }
  if (signals.ruleIds.has('scope') || signals.ruleIds.has('timeline') || signals.ruleIds.has('acceptance') || signals.ruleIds.has('dependency')) {
    scenarios.push(
      'If one side wants a faster timeline while scope, acceptance, or dependency ownership stays broad, then the bridge is a narrower initial phase with named owners and milestone-specific acceptance gates.',
    );
  }
  if (scenarios.length < 2) {
    scenarios.push(
      'If the parties disagree on what must be locked now, then the bridge is to separate current-phase obligations from later-phase options and price only the bounded portion.',
    );
  }

  return scenarios.slice(0, 2).join(' ');
}

function buildLikelyPrioritiesParagraph(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const proposingSide: string[] = [];
  const counterparty: string[] = [];
  const add = (target: string[], value: string) => {
    if (!value || target.includes(value)) return;
    target.push(value);
  };

  if (params.signals.domain.id === 'software') {
    add(proposingSide, 'implementation timing and rollout certainty');
    add(proposingSide, 'a bounded integration and migration scope');
    add(counterparty, 'delivery accountability tied to data readiness and change control');
    add(counterparty, 'support coverage and service levels that hold after go-live');
  } else if (params.signals.domain.id === 'investment') {
    add(proposingSide, 'valuation and funding certainty');
    add(proposingSide, 'enough capital to support the next runway milestone');
    add(counterparty, 'governance rights and downside protection');
    add(counterparty, 'milestone credibility and diligence completion');
  } else if (params.signals.domain.id === 'supply') {
    add(proposingSide, 'volume visibility and pricing discipline');
    add(proposingSide, 'lead-time and capacity commitments that are operationally realistic');
    add(counterparty, 'unit economics, quality assurance, and defect remedies');
    add(counterparty, 'flexibility around exclusivity and forecast commitments');
  } else if (params.signals.domain.id === 'services') {
    add(proposingSide, 'scope control and staffing utilization');
    add(proposingSide, 'billing certainty tied to named milestones or deliverables');
    add(counterparty, 'delivery accountability and milestone sign-off');
    add(counterparty, 'clear ownership of client-side dependencies and approvals');
  }

  if (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal) {
    add(proposingSide, 'commercial certainty and protection against scope drift');
    add(counterparty, 'economics that stay tied to validated assumptions and risk ownership');
  }
  if (params.factSheet.timeline.milestones.length > 0 || params.signals.ruleIds.has('timeline')) {
    add(proposingSide, 'implementation timing and milestone credibility');
    add(counterparty, 'delivery dates that have contingency treatment if dependencies slip');
  }
  if (params.factSheet.success_criteria_kpis.length > 0 || params.signals.ruleIds.has('acceptance')) {
    add(proposingSide, 'objective acceptance and measurable outcomes');
    add(counterparty, 'sign-off mechanics that match the actual commitment boundary');
  }
  if (params.signals.ruleIds.has('dependency')) {
    add(proposingSide, 'named owners for approvals, access, and third-party inputs');
    add(counterparty, 'relief if external dependencies move outside the committed plan');
  }

  if (proposingSide.length === 0) add(proposingSide, 'clarity on scope, timing, and execution accountability');
  if (counterparty.length === 0) add(counterparty, 'confidence that the commitment is bounded and governable');

  return `The proposing side is likely to prioritize ${joinNatural(proposingSide.slice(0, 2))}. The counterparty is likely to prioritize ${joinNatural(counterparty.slice(0, 2))}.`;
}

function buildPossibleConcessionsParagraph(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const concessions: string[] = [];
  const add = (value: string) => {
    if (!value || concessions.includes(value)) return;
    concessions.push(value);
  };

  if (params.signals.domain.id === 'software') {
    add('the vendor may trade some upfront implementation economics for a longer subscription term, phased rollout, or narrower initial integration set');
    add('the customer may accept a pilot, staged go-live, or clearer change-control regime in exchange for better delivery certainty');
  } else if (params.signals.domain.id === 'investment') {
    add('founders may accept a lower headline valuation if governance and control rights stay lighter');
    add('investors may accept less control at close if capital is staged against milestones or diligence deliverables');
  } else if (params.signals.domain.id === 'supply') {
    add('the supplier may offer better unit pricing if the buyer accepts higher volume commitments, firmer forecasts, or narrower regional flexibility');
    add('the buyer may trade exclusivity or longer commitments for stronger lead-time, warranty, or service protections');
  } else if (params.signals.domain.id === 'services') {
    add('the provider may accept a smaller initial fee if the client accepts a tighter statement of work or milestone billing structure');
    add('the client may accept a mobilization phase or capped allowance if staffing continuity and sign-off mechanics become more reliable');
  }

  if (params.signals.ruleIds.has('scope') || params.signals.ruleIds.has('phase_boundary')) {
    add('one side could accept a narrower initial phase if the other side accepts a clearer expansion path once agreed gates are met');
  }
  if (params.signals.ruleIds.has('commercial') || params.signals.ruleIds.has('change_order')) {
    add('commercial certainty could be traded for staged pricing, capped allowances, or a defined variation mechanism');
  }
  if (params.signals.ruleIds.has('timeline') || params.signals.ruleIds.has('dependency')) {
    add('tighter timing commitments could be exchanged for named dependency owners and escalation paths');
  }
  if (concessions.length === 0) {
    add('either side may need to trade some flexibility on scope, timing, or governance to convert the draft into a signable structure');
  }

  return `On possible concessions, ${concessions.slice(0, 2).join('; ')}.`;
}

function buildStructuralTensionsParagraph(params: {
  signals: CalibrationSignals;
  cleanBounded: boolean;
  riskBlockerSummary: string;
  riskTransferSummary: string;
}) {
  if (params.cleanBounded) {
    return 'The remaining tension sits mainly in execution governance, papering discipline, and final approval sequencing rather than in core feasibility.';
  }
  if (params.signals.domain.id === 'investment') {
    return `The main tension is between the headline economics and the control package, because ${params.riskBlockerSummary}.${params.riskTransferSummary ? ` As drafted, ${params.riskTransferSummary}.` : ''} ${buildStickingPointsParagraph(params.signals)}`;
  }
  if (params.signals.domain.id === 'supply') {
    return `The main tension is between price certainty and operating commitments on volume, specification, and service reliability, because ${params.riskBlockerSummary}.${params.riskTransferSummary ? ` As drafted, ${params.riskTransferSummary}.` : ''} ${buildStickingPointsParagraph(params.signals)}`;
  }
  if (params.signals.domain.id === 'services') {
    return `The main tension is between commercial certainty and the still-open delivery mechanics around staffing, dependencies, and sign-off, because ${params.riskBlockerSummary}.${params.riskTransferSummary ? ` As drafted, ${params.riskTransferSummary}.` : ''} ${buildStickingPointsParagraph(params.signals)}`;
  }
  const bridge = buildStickingPointsParagraph(params.signals);
  return `The main tension is that ${params.riskBlockerSummary}.${params.riskTransferSummary ? ` As drafted, ${params.riskTransferSummary}.` : ''} ${bridge}`;
}

function buildLeverageSignalParagraphs(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
}) {
  const items: string[] = [];
  const add = (value: string) => {
    if (!value || items.includes(value)) return;
    items.push(value);
  };

  if (params.signals.domain.id === 'software') {
    add('Implementation continuity appears valuable, so switching costs may be meaningful where integrations, data migration, or workflow reconfiguration are involved.');
    add('Delivery certainty may matter more than a nominal price reduction if rollout timing, support expectations, or SLA posture carries internal visibility.');
    if (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal) {
      add('Internal pricing flexibility may exist around onboarding, implementation effort, or term length even if the headline commercial posture looks firm.');
    }
  } else if (params.signals.domain.id === 'investment') {
    add('Governance and control provisions may matter more than headline valuation, which can shift the real negotiation away from price alone.');
    add('Timeline pressure around financing or runway may make closing certainty more valuable than a final incremental move in economics.');
    add('Alternative capital options may exist but still appear imperfect, which can strengthen whichever side is better positioned to offer certainty on diligence and close mechanics.');
  } else if (params.signals.domain.id === 'supply') {
    add('Switching or supplier-qualification costs may be meaningful, which can make delivery certainty and defect treatment more valuable than a small unit-price concession.');
    add('Capacity utilization or forecast visibility may strengthen willingness to close if one side can offer cleaner volume planning.');
    add('Exclusivity or regional rights may carry more strategic value than the headline price point if they affect channel access or capacity reservation.');
  } else if (params.signals.domain.id === 'services') {
    add('Start-date pressure and limited specialist capacity may favor the side able to offer reliable staffing and dependency readiness.');
    add('Continuity of delivery knowledge may raise switching costs, especially where mobilization, site familiarity, or stakeholder context already matters.');
    add('Billing certainty may be less important than dependency control if client-side approvals or inputs can still move the delivery plan.');
  }

  if (params.signals.ruleIds.has('timeline') || containsAny(params.factSheet.constraints, ['deadline', 'urgent', 'asap', 'hard deadline'])) {
    add('One side appears to face timeline pressure, which can favor the party able to offer a credible phased timetable or dependency relief.');
  }
  if (params.signals.ruleIds.has('dependency')) {
    add('Approvals, access, and third-party inputs appear to be controlled asymmetrically, which gives the controlling party influence over sequencing and contingency language.');
  }
  if (
    containsAny(params.factSheet.scope_deliverables, ['integration', 'api', 'system', 'platform', 'reporting', 'workflow'])
    || containsAny(params.factSheet.constraints, ['existing infrastructure', 'existing system', 'existing process'])
  ) {
    add('Switching costs appear meaningful because the proposal seems to depend on continuity with existing systems, workflows, or operating processes.');
  }
  if (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal) {
    add('Budget discipline or pricing posture appears to be shaping the negotiation, which can favor structures that trade certainty for narrower scope or staged commitment.');
  }
  if (params.factSheet.vendor_preferences.length > 0) {
    add('Stated provider or operating preferences narrow the feasible option set and can shift leverage toward counterparties that already fit those constraints.');
  }

  if (items.length === 0) {
    add('The main leverage appears to sit with whichever party can either narrow the commitment quickly or absorb uncertainty without reopening the commercial structure.');
  }

  return items.slice(0, 4);
}

function buildDealStructureParagraphs(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
  cleanBounded: boolean;
}) {
  const optionBodies: string[] = [];
  const addOption = (value: string) => {
    const text = asText(value);
    if (!text || optionBodies.includes(text)) return;
    optionBodies.push(text);
  };

  if (params.signals.domain.id === 'software') {
    addOption(params.cleanBounded
      ? 'Standard SaaS structure: proceed on the current subscription and implementation scope with named integrations, rollout phases, acceptance metrics, and support/SLA terms preserved into final papering.'
      : 'Standard SaaS structure: proceed only if the initial rollout scope, integration assumptions, migration responsibilities, and support commitments are locked before signature.');
    if (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal) {
      addOption('Term-versus-economics tradeoff: reduce upfront implementation or onboarding burden in exchange for a longer subscription commitment, broader rollout commitment, or cleaner renewal economics.');
    }
    if (params.signals.ruleIds.has('technical') || params.signals.ruleIds.has('data_cleanup') || params.signals.ruleIds.has('dependency')) {
      addOption('Pilot or phased-rollout structure: start with the highest-priority integrations and migration work, then expand after agreed performance, adoption, or sign-off gates are met.');
    }
  } else if (params.signals.domain.id === 'investment') {
    addOption(params.cleanBounded
      ? 'Current round structure: close on the present economics with the agreed governance, diligence, and milestone framing carried through final documentation.'
      : 'Current round structure: proceed only if valuation, dilution, governance rights, and any open diligence items are locked together before signing.');
    addOption('Tranche-based financing: commit the round in stages so capital release or closing mechanics are tied to agreed milestones, diligence outcomes, or use-of-funds checkpoints.');
    addOption('Valuation-versus-control tradeoff: adjust headline valuation, board rights, or investor protections so one side gains economics while the other gains cleaner governance certainty.');
  } else if (params.signals.domain.id === 'supply') {
    addOption(params.cleanBounded
      ? 'Base supply structure: proceed on current pricing with technical specifications, lead times, quality standards, and warranty treatment preserved into the contract.'
      : 'Base supply structure: proceed only if specifications, lead times, defect treatment, and logistics ownership are locked before signature.');
    addOption('Volume-pricing tradeoff: reduce unit pricing in exchange for higher minimum orders, firmer forecasts, or longer volume commitments.');
    addOption('Pilot or non-exclusive structure: start with a smaller initial order, regional scope, or non-exclusive term before moving to broader exclusivity or scaled volumes.');
  } else if (params.signals.domain.id === 'services') {
    addOption(params.cleanBounded
      ? 'Fixed-scope services structure: proceed on the current statement of work with named deliverables, staffing assumptions, milestone sign-off, and change-request treatment preserved.'
      : 'Fixed-scope services structure: proceed only if deliverables, staffing, dependency ownership, and sign-off mechanics are locked before signature.');
    addOption('Diagnostic or mobilization structure: use a short paid kickoff phase to confirm scope, staffing, and client-side dependencies before the broader work order becomes binding.');
    addOption('Capped-fee or milestone-billing structure: lower upfront commitment in exchange for clearer billing triggers, milestone releases, and out-of-scope change treatment.');
  } else {
    addOption(params.cleanBounded
      ? 'Standard structure: proceed on the current scope with the written milestones, acceptance criteria, governance cadence, and risk treatment preserved into final papering.'
      : 'Standard structure: proceed only if the current scope, acceptance criteria, dependency owners, and commercial assumptions are locked before signature.');
    if (params.signals.ruleIds.has('technical') || params.signals.ruleIds.has('data_cleanup')) {
      addOption(`Diligence-led structure: use a ${domainDiligenceLabel(params.signals.domain)} to validate the unresolved technical or remediation assumptions before the broader commitment becomes binding.`);
    } else {
      addOption('Phased structure: commit the initial phase now and defer later scope until agreed exit gates are met.');
    }
    if (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal) {
      addOption('Contingent commercial structure: use milestone-based pricing, capped allowances, or a defined variation mechanism so the economics move only when the unresolved assumptions move.');
    } else {
      addOption('Conditional expansion structure: keep the base commitment narrow and add later scope through pre-agreed expansion triggers once performance or governance conditions are met.');
    }
  }

  if (optionBodies.length < 2) {
    addOption('Phased structure: keep the initial commitment narrow and expand only after agreed acceptance, milestone, or performance gates are met.');
  }
  if (optionBodies.length < 3 && (hasCommercialSignal(params.factSheet) || params.signals.fixedPriceSignal)) {
    addOption('Commercial tradeoff structure: narrow the base commitment or term assumptions now so economics only widen when the unresolved conditions are cleared.');
  }

  const minOptions = params.signals.coverageCount >= 3 ? 3 : 2;
  return optionBodies
    .slice(0, Math.max(2, Math.min(3, minOptions)));
}

function buildRecommendedPathParagraphs(params: {
  factSheet: ProposalFactSheet;
  signals: CalibrationSignals;
  data: VertexEvaluationV2MediationResponse;
  cleanBounded: boolean;
  conditionSummary: string;
  agendaItems: string[];
}) {
  if (params.cleanBounded && params.data.fit_level === 'high') {
    return [
      'Recommended path: move to final papering, final approvals, and signature preparation without reopening the bounded scope, acceptance, dependency, or governance mechanics already visible in the record.',
      'Immediate next step: confirm final approvals, lock the execution governance cadence, and preserve the current commercial assumptions in the final documentation.',
    ];
  }

  if (params.data.fit_level === 'low') {
    return [
      `Recommended path: pause signature and convert the discussion into a restructuring or ${domainDiligenceLabel(params.signals.domain)} focused on what is needed to ${params.conditionSummary}.`,
      `Immediate next step: ${params.agendaItems.join('; ')}.`,
    ];
  }

  const lead =
    params.signals.ruleIds.has('technical') || params.signals.ruleIds.has('data_cleanup')
      ? `Recommended path: run a short ${domainDiligenceLabel(params.signals.domain)} to ${params.conditionSummary}, then reconvene to lock the bounded commitment.`
      : `Recommended path: use the next negotiation round to ${params.conditionSummary} before either side treats the current draft as final.`;

  return [
    lead,
    `Immediate next step: ${params.agendaItems.join('; ')}.`,
  ];
}

function buildSectionRoleDefaults(params: {
  factSheet: ProposalFactSheet;
  data: VertexEvaluationV2MediationResponse;
  signals: CalibrationSignals;
}) {
  const positiveEvidence = buildPositiveEvidenceSummary(params.factSheet);
  const alignmentSummary = joinNatural(params.signals.alignmentPoints.slice(0, 2)) || positiveEvidence;
  const strengthsPoints = params.signals.alignmentPoints.slice(1, 3).length > 0
    ? params.signals.alignmentPoints.slice(1, 3)
    : params.signals.alignmentPoints.slice(0, 2);
  const snapshotBlockerSummary = buildBlockerSummary({
    signals: params.signals,
    context: 'snapshot',
  });
  const riskBlockerSummary = buildBlockerSummary({
    signals: params.signals,
    context: 'risk',
  });
  const conditionSummary =
    params.signals.conditions.length > 0
      ? joinNatural(params.signals.conditions.slice(0, 2))
      : 'define the unresolved scope, acceptance, and dependency terms';
  const confidenceUp =
    params.signals.confidenceUp.length > 0
      ? params.signals.confidenceUp[0]
      : 'explicit scope, acceptance criteria, and dependency ownership';
  const confidenceDown =
    params.signals.confidenceDown.length > 0
      ? params.signals.confidenceDown[0]
      : 'the same assumptions stay open while the commercial posture stays firm';
  const riskTransferSummary = buildRiskTransferSummary(params.signals);
  const pathsToAgreement = buildPathsToAgreement(params);
  const agendaItems = buildNegotiationAgendaItems(params.signals);
  const assumptionsSummary = buildAssumptionsSummary(params);
  const cleanBounded =
    params.signals.highEligible
    && !params.signals.shouldBeConditional
    && !params.signals.shouldBeLow
    && params.signals.ruleIds.size === 0;

  const strengthParagraphs = buildStrengthParagraphs({
    factSheet: params.factSheet,
    data: params.data,
    signals: params.signals,
    positiveEvidence,
    strengthsPoints,
  });

  const decisionStatus =
    cleanBounded && params.data.fit_level === 'high'
      ? {
          label: 'Ready to finalize',
          explanation: 'The current record is bounded enough on scope, timing, acceptance, dependencies, and risk treatment to support final commitment.',
        }
      : params.data.fit_level === 'low'
      ? {
          label: 'Not viable',
          explanation: `The current draft still leaves too much structural uncertainty because ${snapshotBlockerSummary}.`,
        }
      : params.signals.conditionallyViable
      ? {
          label: 'Proceed with conditions',
          explanation: `A credible path exists, but the parties still need to ${conditionSummary} before commitment is defensible.`,
        }
      : {
          label: 'Explore further',
          explanation: `The deal may be workable, but the present record is still too conditional or incomplete because ${snapshotBlockerSummary}.`,
        };

  const mediationSummaryLead =
    params.data.fit_level === 'low'
      ? `${alignmentSummary ? `Some alignment is still visible around ${alignmentSummary}, but ` : ''}the deal is not yet workable on the current record because ${snapshotBlockerSummary}.`
      : cleanBounded && params.data.fit_level === 'high'
      ? `The deal is fundamentally workable and close to executable: alignment exists around ${alignmentSummary}, and the proposal is bounded enough for both sides to treat it as a final commitment structure.`
      : params.signals.conditionallyViable
      ? `The deal appears fundamentally workable, but not yet sign-ready: alignment exists around ${alignmentSummary}, while ${snapshotBlockerSummary}.`
      : `The deal merits further work rather than immediate commitment because ${snapshotBlockerSummary}.`;

  const mediationSummaryTension =
    params.data.fit_level === 'low'
      ? 'The current materials still leave scope, dependency, or commercial exposure too open for either side to rely on the draft.'
      : cleanBounded
      ? 'The remaining tension sits mainly in final approvals, execution governance, and preserving the current assumptions in papering rather than in core feasibility.'
      : params.signals.conditionallyViable
      ? `The tension is between the visible alignment and the fact that ${riskBlockerSummary}.${riskTransferSummary ? ` As drafted, ${riskTransferSummary}.` : ''}`
      : `The tension is that ${riskBlockerSummary}.${riskTransferSummary ? ` As drafted, ${riskTransferSummary}.` : ''}`;

  const mediationSummaryNext =
    cleanBounded && params.data.fit_level === 'high'
      ? 'The remaining work is to preserve the bounded structure through final approvals and clean documentation rather than renegotiate the commercial foundation.'
      : `The parties still need to ${conditionSummary}. One realistic bridge is to ${lowerFirst(pathsToAgreement[0] || 'convert the current draft into explicit bilateral conditions to proceed')}.`;

  const defaults: Record<string, string[]> = {
    'mediation summary': [
      mediationSummaryLead,
      mediationSummaryTension,
      mediationSummaryNext,
    ],
    'where agreement exists': [
      `Key Strengths: ${combineParagraphs(strengthParagraphs)}`,
    ],
    'what is blocking commitment': [
      cleanBounded
        ? 'Remaining risk is concentrated in execution governance, handoff sequencing, and final confirmation of the written assumptions rather than in core feasibility.'
        : `The primary risks sit where ${riskBlockerSummary}.${riskTransferSummary ? ` As drafted, ${riskTransferSummary}.` : ''} Assumptions and dependencies remain around ${assumptionsSummary}.`,
    ],
    'the real hesitation': buildLeverageSignalParagraphs(params),
    'risk and how to reduce it': [
      buildStructuralTensionsParagraph({
        signals: params.signals,
        cleanBounded,
        riskBlockerSummary,
        riskTransferSummary,
      }),
    ],
    'proposed bridge': buildDealStructureParagraphs({
      factSheet: params.factSheet,
      signals: params.signals,
      cleanBounded,
    }),
    'each side\'s position': [
      buildLikelyPrioritiesParagraph(params),
      buildPossibleConcessionsParagraph(params),
    ],
    'likely landing zone': [
      `The most realistic path to agreement likely involves ${joinNatural(pathsToAgreement.slice(0, 2))}.`,
    ],
    'decision readiness': [
      `Decision status: ${decisionStatus.label}. ${decisionStatus.explanation}`,
      buildNowVsLaterSummary(params),
      `What would change the verdict: confidence would increase with ${confidenceUp}; it would fall further if ${confidenceDown}.`,
    ],
    'recommended path': buildRecommendedPathParagraphs({
      factSheet: params.factSheet,
      signals: params.signals,
      data: params.data,
      cleanBounded,
      conditionSummary,
      agendaItems,
    }),
    'suggested next step': [
      `Immediate next step: ${agendaItems.join('; ')}.`,
    ],
  };

  if (params.signals.fixedPriceSignal && (defaults['the real hesitation'] || []).length < 3) {
    defaults['the real hesitation'].push(
      'Any fixed-price or fixed-scope posture appears to depend on tighter acceptance criteria, change-order triggers, and risk ownership than the current draft may yet provide.',
    );
  }

  return defaults;
}

function orderedWhySections(sections: WhySection[]) {
  const order = new Map(ALL_KNOWN_WHY_SECTION_KEYS.map((key, index) => [key, index]));
  return [...sections].sort((left, right) => {
    const leftIndex = order.has(left.key) ? (order.get(left.key) as number) : ALL_KNOWN_WHY_SECTION_KEYS.length + 1;
    const rightIndex = order.has(right.key) ? (order.get(right.key) as number) : ALL_KNOWN_WHY_SECTION_KEYS.length + 1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return 0;
  });
}

function buildWhyEntriesFromRoleDefaults(roleDefaults: Record<string, string[]>) {
  return sanitizeWhyEntries(
    ALL_KNOWN_WHY_SECTION_KEYS
      .map((key) => {
        const body = combineParagraphs(roleDefaults[key] || []);
        if (!body) return '';
        return `${canonicalWhyHeading(key)}: ${body}`;
      })
      .filter(Boolean),
  );
}

function classifyFallbackMode(factSheet: ProposalFactSheet) {
  const coverageCount = computeCoverageCount(factSheet.source_coverage);
  const alignmentPoints = buildAlignmentPoints(factSheet);
  const hasMaterialQuestions = factSheet.missing_info.length > 0 || factSheet.open_questions.length > 0;

  if (coverageCount >= 3 && alignmentPoints.length >= 2) return 'salvaged_memo' as FallbackMode;
  if (coverageCount >= 2 && alignmentPoints.length >= 2 && hasMaterialQuestions) return 'salvaged_memo' as FallbackMode;
  return 'incomplete' as FallbackMode;
}

function buildCalibrationSignals(params: {
  factSheet: ProposalFactSheet;
  data: VertexEvaluationV2MediationResponse;
}) {
  const domain = classifyProposalDomain(params.factSheet);
  const whySections = parseWhySections(params.data.why);
  const whyBodiesAll = whySections.map((section) => section.body);
  const whyBodies = whySections
    .filter((section) => [
      'what is blocking commitment',
      'the real hesitation',
      'risk and how to reduce it',
      'decision readiness',
      'recommended path',
      'suggested next step',
    ].includes(section.key))
    .map((section) => section.body);
  const issueTexts = [
    ...params.factSheet.missing_info,
    ...params.factSheet.open_questions,
    ...params.factSheet.assumptions,
    ...params.data.missing,
    ...whyBodies,
  ].map((text) => asText(text)).filter(Boolean);
  const rules = collectCalibrationRules({
    factSheet: params.factSheet,
    texts: issueTexts,
  });
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const sc = params.factSheet.source_coverage;
  const coverageCount = computeCoverageCount(sc);
  const conditionalCorpus = issueTexts.join(' ');
  const bodyCorpus = whyBodiesAll.join(' ');
  const hasConditionalLanguage = CONDITIONAL_CONFIDENCE_PATTERNS.some((pattern) => keywordMatch(conditionalCorpus, pattern));
  const bodySuggestsViablePath = BODY_VIABLE_PATH_PATTERNS.some((pattern) => keywordMatch(bodyCorpus, pattern));
  const bodySuggestsWeakPath = BODY_WEAK_PATH_PATTERNS.some((pattern) => keywordMatch(bodyCorpus, pattern));
  const fixedPriceSignal = isFixedPriceSignal(params.factSheet);
  const alignmentPoints = buildAlignmentPoints(params.factSheet);
  const structuralViabilityScore = [
    Boolean(params.factSheet.project_goal),
    sc.has_scope,
    sc.has_timeline,
    sc.has_constraints,
    sc.has_kpis,
    sc.has_risks,
  ].filter(Boolean).length;
  const hasCrediblePath =
    structuralViabilityScore >= 3 ||
    (alignmentPoints.length >= 2 && sc.has_scope && (sc.has_timeline || sc.has_constraints)) ||
    (bodySuggestsViablePath && structuralViabilityScore >= 2);

  const highEligible =
    sc.has_scope &&
    sc.has_timeline &&
    sc.has_kpis &&
    sc.has_constraints &&
    sc.has_risks &&
    !ruleIds.has('scope') &&
    !ruleIds.has('data_cleanup') &&
    !ruleIds.has('acceptance') &&
    !ruleIds.has('dependency') &&
    !ruleIds.has('technical') &&
    (!fixedPriceSignal || !ruleIds.has('change_order')) &&
    params.factSheet.missing_info.length === 0 &&
    params.factSheet.open_questions.length === 0;

  const severeUnbounded =
    (!sc.has_scope && !sc.has_timeline && structuralViabilityScore <= 2) ||
    (ruleIds.has('technical') && (ruleIds.has('data_cleanup') || ruleIds.has('dependency')) && !hasCrediblePath) ||
    (coverageCount <= 1 && rules.length >= 3);

  const shouldBeLow =
    bodySuggestsWeakPath ||
    severeUnbounded ||
    (!hasCrediblePath && (rules.length >= 3 || coverageCount <= 2));

  const shouldBeConditional =
    !highEligible &&
    (
      rules.length > 0 ||
      hasConditionalLanguage ||
      params.factSheet.missing_info.length > 0 ||
      params.factSheet.open_questions.length > 0 ||
      !sc.has_kpis ||
      !sc.has_risks ||
      !sc.has_constraints
    );

  const conditionallyViable =
    shouldBeConditional &&
    !shouldBeLow &&
    hasCrediblePath &&
    (
      alignmentPoints.length >= 2 ||
      structuralViabilityScore >= 3 ||
      bodySuggestsViablePath
    );

  return {
    domain,
    rules,
    ruleIds,
    blockerLabels: rules.map((rule) => rule.label),
    conditions: rules.map((rule) => rule.condition),
    confidenceUp: rules.map((rule) => rule.confidenceUp),
    confidenceDown: rules.map((rule) => rule.confidenceDown),
    hasConditionalLanguage,
    highEligible,
    shouldBeConditional,
    shouldBeLow,
    conditionallyViable,
    fixedPriceSignal,
    coverageCount,
    alignmentPoints,
    hasCrediblePath,
    structuralViabilityScore,
    bodySuggestsViablePath,
  } as CalibrationSignals;
}

function rewriteWhyForCalibration(params: {
  factSheet: ProposalFactSheet;
  data: VertexEvaluationV2MediationResponse;
  signals: CalibrationSignals;
  postProcessMode?: PostProcessMode;
}) {
  const sections = parseWhySections(params.data.why);
  if (sections.length === 0) {
    return params.data.why;
  }
  REQUIRED_WHY_SECTION_KEYS.forEach((key) => {
    if (!sections.some((section) => section.key === key)) {
      upsertWhySection(sections, key, '');
    }
  });

  sections.forEach((section) => {
    let nextBody = neutralizeShareableText(section.body);
    if (hasCoachingLanguage(nextBody)) {
      if (section.key === 'mediation summary') {
        nextBody = combineParagraphs([
          'The mediation summary should stay grounded in the current proposal mechanics rather than praise or one-sided drafting advice.',
          nextBody,
        ]);
      } else if (section.key === 'where agreement exists' || section.key === 'each side\'s position') {
        nextBody = combineParagraphs([
          'This section should stay neutral and explain how each side may respond to the current structure.',
          nextBody,
        ]);
      } else if (section.key === 'the real hesitation' || section.key === 'what is blocking commitment') {
        nextBody = combineParagraphs([
          'Hesitation and blockers should be described as dynamics visible to both sides, not as a confidential fact or one-sided tactic.',
          nextBody,
        ]);
      } else if (section.key === 'decision readiness') {
        nextBody = combineParagraphs([
          'Readiness depends on what the parties can bound now versus defer to a later phase.',
          nextBody,
        ]);
      } else if (section.key === 'recommended path' || section.key === 'suggested next step' || section.key === 'proposed bridge') {
        nextBody = combineParagraphs([
          'The recommended path should turn the remaining gaps into a neutral next negotiation step rather than one-sided drafting advice.',
          nextBody,
        ]);
      }
    }
    section.body = nextBody;
  });

  const roleDefaults = buildSectionRoleDefaults(params);
  const needsRichRewrite =
    (params.postProcessMode || 'normal') === 'normal'
    && (
      params.signals.shouldBeConditional
      || params.signals.shouldBeLow
      || params.signals.conditionallyViable
    );

  const globallySeenParagraphs: string[] = [];
  const rewrittenSections = orderedWhySections(sections).map((section) => {
    let existingParagraphs = splitParagraphs(section.body);

    // Prevent contradictory decision statuses: when role defaults provide a
    // calibrated "Decision status:" paragraph, strip any conflicting model-
    // generated status line from the existing paragraphs.
    if (needsRichRewrite && section.key === 'decision readiness') {
      const roleStatusParagraph = (roleDefaults[section.key] || []).find(
        (p) => /^Decision status:/i.test(normalizeSpaces(p)),
      );
      if (roleStatusParagraph) {
        existingParagraphs = existingParagraphs.filter(
          (p) => !/^Decision status:/i.test(normalizeSpaces(p)),
        );
      }
    }

    const candidateParagraphs = [
      ...(needsRichRewrite ? (roleDefaults[section.key] || []) : []),
      ...existingParagraphs,
    ];

    const finalParagraphs: string[] = [];
    candidateParagraphs.forEach((paragraph) => {
      const trimmed = asText(paragraph);
      if (!trimmed) return;
      if (needsRichRewrite && isLowSignalParagraph(trimmed)) return;
      const roleLocked = isRoleLockedParagraph(trimmed);
      if (finalParagraphs.some((existing) => paragraphsAreNearDuplicates(existing, trimmed))) return;
      if (!roleLocked && globallySeenParagraphs.some((existing) => paragraphsAreNearDuplicates(existing, trimmed))) return;
      finalParagraphs.push(trimmed);
      globallySeenParagraphs.push(trimmed);
    });

    let cappedParagraphs = [...finalParagraphs];
    while (cappedParagraphs.length > maxParagraphsForSection(section.key)) {
      cappedParagraphs = dropLowestPriorityParagraph(section.key, cappedParagraphs);
    }

    if (cappedParagraphs.length === 0) {
      const fallbackParagraph = (roleDefaults[section.key] || [])[0] || section.body;
      const trimmedFallback = asText(fallbackParagraph);
      if (trimmedFallback) {
        cappedParagraphs.push(trimmedFallback);
        globallySeenParagraphs.push(trimmedFallback);
      }
    }

    return {
      ...section,
      heading: canonicalWhyHeading(section.key || section.heading),
      body: combineParagraphs(cappedParagraphs),
    };
  });

  const truncated = truncateWhyOutput(serializeWhySections(rewrittenSections), WHY_MAX_CHARS_STANDARD);
  const truncatedKeys = new Set(parseWhySections(truncated).map((section) => section.key));
  const missingRequiredSections = REQUIRED_WHY_SECTION_KEYS.some((key) => !truncatedKeys.has(key));
  if (missingRequiredSections) {
    return sanitizeWhyEntries(
      compressWhySectionsForRequiredCoverage(rewrittenSections, WHY_MAX_CHARS_STANDARD),
    );
  }

  return sanitizeWhyEntries(truncated);
}

function alignFitLevelToSignals(params: {
  fit_level: FitLevel;
  signals: CalibrationSignals;
}) {
  let fit_level = params.fit_level;
  const capsApplied: string[] = [];

  if (params.signals.highEligible) {
    if (fit_level === 'medium' || fit_level === 'low' || fit_level === 'unknown') {
      fit_level = fit_level === 'unknown' ? 'medium' : fit_level;
    }
    return { fit_level, capsApplied };
  }

  if (params.signals.shouldBeLow && !params.signals.hasCrediblePath) {
    if (fit_level === 'high') {
      fit_level = 'low';
      capsApplied.push('downgrade_high_severe_uncertainty');
    } else if (fit_level === 'medium') {
      fit_level = 'low';
      capsApplied.push('downgrade_medium_severe_uncertainty');
    }
    return { fit_level, capsApplied };
  }

  if (params.signals.conditionallyViable && fit_level === 'low') {
    fit_level = 'medium';
    capsApplied.push('upgrade_low_conditional_viable');
  } else if (params.signals.shouldBeConditional && fit_level === 'high') {
    fit_level = 'medium';
    capsApplied.push('downgrade_high_material_uncertainty');
  }

  return { fit_level, capsApplied };
}

function capConfidenceToSignals(params: {
  confidence_0_1: number;
  signals: CalibrationSignals;
}) {
  let confidence_0_1 = params.confidence_0_1;
  let confidenceCap = 1;
  let confidenceCapReason = '';
  const capsApplied: string[] = [];

  const applyCap = (value: number, reason: string) => {
    if (value < confidenceCap) {
      confidenceCap = value;
      confidenceCapReason = reason;
    }
  };

  if (params.signals.shouldBeLow && !params.signals.hasCrediblePath) {
    applyCap(0.45, 'cap_0.45_severe_uncertainty');
  } else if (params.signals.shouldBeConditional) {
    applyCap(0.62, 'cap_0.62_material_uncertainty');
  }

  if (params.signals.hasConditionalLanguage) {
    applyCap(0.68, 'cap_0.68_conditional_language');
  }

  if (confidence_0_1 > 0.85 && (params.signals.shouldBeConditional || params.signals.hasConditionalLanguage)) {
    applyCap(0.58, 'cap_0.58_contradiction_confidence');
  }

  if (confidenceCapReason && confidence_0_1 > confidenceCap) {
    confidence_0_1 = confidenceCap;
    capsApplied.push(confidenceCapReason);
  }

  return { confidence_0_1, capsApplied };
}

function applyConsistencyCalibration(params: {
  data: VertexEvaluationV2MediationResponse;
  factSheet: ProposalFactSheet;
  sharedText: string;
  postProcessMode?: PostProcessMode;
}): ClampResult {
  let {
    fit_level,
    confidence_0_1,
    why,
    missing,
    redactions,
    negotiation_analysis,
    delta_summary,
    resolved_since_last_round,
    remaining_deltas,
    new_open_issues,
    movement_direction,
  } = params.data;
  const capsApplied: string[] = [];
  const signals = buildCalibrationSignals({
    factSheet: params.factSheet,
    data: {
      analysis_stage: MEDIATION_STAGE,
      fit_level,
      confidence_0_1,
      why,
      missing,
      redactions,
      negotiation_analysis,
    },
  });

  const normalizedMissing = normalizeMissingQuestions({
    factSheet: params.factSheet,
    missing,
  });
  if (JSON.stringify(normalizedMissing) !== JSON.stringify(missing)) {
    missing = normalizedMissing;
    capsApplied.push('normalize_missing_questions');
  }

  const alignedFit = alignFitLevelToSignals({ fit_level, signals });
  fit_level = alignedFit.fit_level;
  capsApplied.push(...alignedFit.capsApplied);

  const alignedConfidence = capConfidenceToSignals({ confidence_0_1, signals });
  confidence_0_1 = alignedConfidence.confidence_0_1;
  capsApplied.push(...alignedConfidence.capsApplied);

  const rewrittenWhy = rewriteWhyForCalibration({
    factSheet: params.factSheet,
    data: {
      analysis_stage: MEDIATION_STAGE,
      fit_level,
      confidence_0_1,
      why,
      missing,
      redactions,
      negotiation_analysis,
    },
    signals,
    postProcessMode: params.postProcessMode,
  });
  if (JSON.stringify(rewrittenWhy) !== JSON.stringify(why)) {
    why = rewrittenWhy;
    capsApplied.push('rewrite_conditional_decision_language');
  }

  const visibleMissing = filterVisibleMissingItems({
    factSheet: params.factSheet,
    sharedText: params.sharedText,
    why,
    missing,
  });
  const missingChangedAfterVisibility = JSON.stringify(visibleMissing) !== JSON.stringify(missing);
  if (JSON.stringify(visibleMissing) !== JSON.stringify(missing)) {
    missing = visibleMissing;
    capsApplied.push('filter_visible_missing_items');
  }

  const normalizedRedactions = normalizeRedactions({
    factSheet: params.factSheet,
    sharedText: params.sharedText,
    why,
    missing,
    redactions,
  });
  const redactionsChangedAfterVisibility = JSON.stringify(normalizedRedactions) !== JSON.stringify(redactions);
  if (JSON.stringify(normalizedRedactions) !== JSON.stringify(redactions)) {
    redactions = normalizedRedactions;
    capsApplied.push('filter_visible_redactions');
  }

  const requiresFinalSemanticAlignment =
    (params.postProcessMode || 'normal') === 'normal'
    && (
      signals.shouldBeConditional
      || signals.shouldBeLow
      || signals.conditionallyViable
      || signals.bodySuggestsViablePath
      || fit_level === 'unknown'
      || (
        !signals.highEligible
        && (missingChangedAfterVisibility || redactionsChangedAfterVisibility)
      )
    );

  if (requiresFinalSemanticAlignment) {
    const finalizedSignals = buildCalibrationSignals({
      factSheet: params.factSheet,
      data: {
        analysis_stage: MEDIATION_STAGE,
        fit_level,
        confidence_0_1,
        why,
        missing,
        redactions,
        negotiation_analysis,
      },
    });
    const finalFit = alignFitLevelToSignals({ fit_level, signals: finalizedSignals });
    if (finalFit.fit_level !== fit_level) {
      fit_level = finalFit.fit_level;
      capsApplied.push(...finalFit.capsApplied.map((item) => `${item}_post_normalization`));
    }
    const finalConfidence = capConfidenceToSignals({ confidence_0_1, signals: finalizedSignals });
    if (finalConfidence.confidence_0_1 !== confidence_0_1) {
      confidence_0_1 = finalConfidence.confidence_0_1;
      capsApplied.push(...finalConfidence.capsApplied.map((item) => `${item}_post_normalization`));
    }
  }

  return {
    data: {
      analysis_stage: MEDIATION_STAGE,
      fit_level,
      confidence_0_1: clamp01(confidence_0_1),
      why,
      missing,
      redactions,
      ...(negotiation_analysis ? { negotiation_analysis } : {}),
      ...(delta_summary ? { delta_summary } : {}),
      ...(resolved_since_last_round ? { resolved_since_last_round } : {}),
      ...(remaining_deltas ? { remaining_deltas } : {}),
      ...(new_open_issues ? { new_open_issues } : {}),
      ...(movement_direction ? { movement_direction } : {}),
    },
    capsApplied,
  };
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    const text = asText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    normalized.push(text);
  });
  return normalized;
}

function trimStageItems(values: string[], maxItems = 6, fallback: string[] = []) {
  const normalized = uniqueStrings(values).slice(0, maxItems);
  if (normalized.length > 0) {
    return normalized;
  }
  return uniqueStrings(fallback).slice(0, maxItems);
}

const DEFAULT_STAGE1_BASIS_NOTE = STAGE1_PRELIMINARY_SUMMARY_NOTE;

function toStage1Question(value: string) {
  const text = asText(value);
  if (!text) return '';
  const { question } = splitMissingEntry(text);
  const base = stripTrailingPunctuation(question || text);
  if (!base) return '';
  if (base.endsWith('?')) return base;
  if (/^(what|which|who|where|when|why|how)\b/i.test(base)) {
    return `${base}?`;
  }
  return `What remains unclear about ${lowerFirst(base)}?`;
}

function normalizeStage1Questions(values: string[], fallback: string[] = [], maxItems = 6) {
  return trimStageItems(
    values.map((item) => toStage1Question(item)).filter(Boolean),
    maxItems,
    fallback.map((item) => toStage1Question(item)).filter(Boolean),
  );
}

function toStage1ClarificationTopic(value: string) {
  const text = stripTrailingPunctuation(asText(value).replace(/\?$/g, ''));
  if (!text) return '';
  return text
    .replace(/^(what|which|who|where|when|why|how)\s+/i, '')
    .replace(/^(is|are|do|does|did|can|could|will|would|should)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStage1SubmissionSummary(factSheet: ProposalFactSheet) {
  const sentences: string[] = [];
  if (factSheet.project_goal) {
    sentences.push(
      `The submitted materials describe an opportunity centered on ${stripTrailingPunctuation(factSheet.project_goal)}.`,
    );
  } else if (factSheet.scope_deliverables.length > 0) {
    sentences.push(
      `The submitted materials outline an opportunity with named elements such as ${joinNatural(factSheet.scope_deliverables.slice(0, 3).map((item) => stripTrailingPunctuation(item))).toLowerCase()}.`,
    );
  } else {
    sentences.push('The submitted materials outline an opportunity, but the current record remains high level.');
  }

  const visibleElements: string[] = [];
  if (factSheet.timeline.duration || factSheet.timeline.start || factSheet.timeline.milestones.length > 0) {
    visibleElements.push('timing');
  }
  if (factSheet.constraints.length > 0 || factSheet.vendor_preferences.length > 0) {
    visibleElements.push('commercial or operational constraints');
  }
  if (factSheet.success_criteria_kpis.length > 0) {
    visibleElements.push('stated success measures');
  }

  if (visibleElements.length > 0) {
    sentences.push(`The current record already references ${joinNatural(visibleElements)}.`);
  } else {
    sentences.push('Important scope, timing, and success details are still only partially defined.');
  }

  return sentences.join(' ');
}

function buildStage1ScopeSnapshot(factSheet: ProposalFactSheet) {
  const items: string[] = [];
  if (factSheet.project_goal) {
    items.push(`Stated objective: ${stripTrailingPunctuation(factSheet.project_goal)}.`);
  }
  if (factSheet.scope_deliverables.length > 0) {
    items.push(
      `Named scope elements include ${joinNatural(factSheet.scope_deliverables.slice(0, 3).map((item) => stripTrailingPunctuation(item))).toLowerCase()}.`,
    );
  }
  if (factSheet.timeline.start || factSheet.timeline.duration || factSheet.timeline.milestones.length > 0) {
    const timelineBits = [
      factSheet.timeline.start ? `start timing of ${stripTrailingPunctuation(factSheet.timeline.start)}` : '',
      factSheet.timeline.duration ? `a duration of ${stripTrailingPunctuation(factSheet.timeline.duration)}` : '',
      factSheet.timeline.milestones.length > 0
        ? `milestones such as ${joinNatural(factSheet.timeline.milestones.slice(0, 3).map((item) => stripTrailingPunctuation(item))).toLowerCase()}`
        : '',
    ].filter(Boolean);
    if (timelineBits.length > 0) {
      items.push(`The materials mention ${joinNatural(timelineBits)}.`);
    }
  }
  if (factSheet.constraints.length > 0 || factSheet.vendor_preferences.length > 0) {
    items.push(
      `Current constraints or commercial preferences include ${joinNatural(
        [...factSheet.constraints, ...factSheet.vendor_preferences].slice(0, 3).map((item) => stripTrailingPunctuation(item)),
      ).toLowerCase()}.`,
    );
  }
  if (factSheet.success_criteria_kpis.length > 0) {
    items.push(
      `Success measures already mentioned include ${joinNatural(factSheet.success_criteria_kpis.slice(0, 2).map((item) => stripTrailingPunctuation(item))).toLowerCase()}.`,
    );
  }
  if (factSheet.assumptions.length > 0) {
    items.push(
      `Assumptions or dependencies already visible include ${joinNatural(factSheet.assumptions.slice(0, 2).map((item) => stripTrailingPunctuation(item))).toLowerCase()}.`,
    );
  }
  return trimStageItems(items, 5);
}

function buildStage1OtherSideNeeded(
  factSheet: ProposalFactSheet,
  unansweredQuestions: string[],
) {
  const items: string[] = [];
  const addItem = (value: string) => {
    const text = asText(value);
    if (!text || items.includes(text)) return;
    items.push(text);
  };

  if (unansweredQuestions.length > 0) {
    unansweredQuestions.slice(0, 2).forEach((question) => {
      const topic = toStage1ClarificationTopic(question);
      addItem(topic ? `Clarification on ${lowerFirst(topic)}.` : 'Clarification on the current open questions.');
    });
  }
  if (factSheet.constraints.length > 0 || factSheet.vendor_preferences.length > 0) {
    addItem('Any constraints, preferences, or boundary conditions that may shape the opportunity.');
  }
  addItem('Any corrections, additions, or counter-assumptions that may change the current scope, timing, ownership, or commercial framing.');
  addItem('Further context on priorities or dependencies that would help structure the next exchange.');

  return trimStageItems(items, 4);
}

function buildStage1DiscussionStartingPoints(factSheet: ProposalFactSheet) {
  const items: string[] = [
    'Confirm what has been submitted so far and what each side sees as the scope of the next exchange.',
    'Surface the open questions that would help make the next exchange more concrete.',
    'Clarify which points are factual inputs, commercial preferences, timing constraints, or dependencies.',
  ];
  if (factSheet.timeline.duration || factSheet.timeline.start || factSheet.timeline.milestones.length > 0) {
    items.push('Confirm whether the currently mentioned timeline is a target, a requirement, or still open for discussion.');
  }
  if (factSheet.success_criteria_kpis.length > 0) {
    items.push('Check whether both sides are using the same definition of success, sign-off, or completion.');
  }
  return trimStageItems(items, 4);
}

function safeFallbackStage1SharedIntakeFromFactSheet(
  factSheet: ProposalFactSheet,
  params: { failureKind: string },
): { data: VertexEvaluationV2Stage1SharedIntakeResponse; warnings: string[]; fallbackMode: FallbackMode } {
  const warningKey =
    params.failureKind === 'truncated_output'
      ? 'vertex_truncated_output_fallback_used'
      : params.failureKind.startsWith('vertex_http') || params.failureKind === 'vertex_timeout'
        ? 'vertex_request_failed_fallback_used'
        : params.failureKind === 'not_configured'
          ? 'vertex_not_configured_fallback_used'
          : 'vertex_invalid_response_fallback_used';

  const unansweredQuestions = normalizeStage1Questions(
    [...factSheet.open_questions, ...factSheet.missing_info],
    [
      'What is the confirmed scope and current boundary of the opportunity?',
      'What timing, ownership, or dependency assumptions still need to be clarified?',
      'What success measures or decision criteria are expected at this stage?',
    ],
  );

  return {
    data: {
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary: buildStage1SubmissionSummary(factSheet),
      scope_snapshot: buildStage1ScopeSnapshot(factSheet),
      unanswered_questions: unansweredQuestions,
      other_side_needed: buildStage1OtherSideNeeded(factSheet, unansweredQuestions),
      discussion_starting_points: buildStage1DiscussionStartingPoints(factSheet),
      intake_status: 'awaiting_other_side_input',
      basis_note: DEFAULT_STAGE1_BASIS_NOTE,
    },
    warnings: [warningKey],
    fallbackMode: classifyFallbackMode(factSheet),
  };
}

function getPreSendReadinessSignals(factSheet: ProposalFactSheet) {
  const coverageCount = computeCoverageCount(factSheet.source_coverage);
  const openItems = uniqueStrings([
    ...factSheet.missing_info,
    ...factSheet.open_questions,
  ]);
  const rules = collectCalibrationRules({
    factSheet,
    texts: openItems,
  });
  return {
    coverageCount,
    openItemCount: openItems.length,
    severeRuleCount: rules.filter((rule) => rule.severity === 'severe').length,
    materialRuleCount: rules.filter((rule) => rule.severity === 'material').length,
    hasCoreCommercialStructure:
      factSheet.source_coverage.has_scope &&
      factSheet.source_coverage.has_timeline &&
      factSheet.source_coverage.has_constraints,
  };
}

function derivePreSendReadinessStatus(factSheet: ProposalFactSheet): PreSendReadinessStatus {
  const {
    coverageCount,
    openItemCount,
    severeRuleCount,
    materialRuleCount,
    hasCoreCommercialStructure,
  } = getPreSendReadinessSignals(factSheet);

  if (
    coverageCount <= 1 ||
    (coverageCount <= 2 && openItemCount >= 4) ||
    severeRuleCount >= 3 ||
    (!hasCoreCommercialStructure && coverageCount <= 3 && openItemCount >= 3)
  ) {
    return 'not_ready_to_send';
  }

  const shareReady =
    hasCoreCommercialStructure &&
    coverageCount >= 4 &&
    severeRuleCount === 0 &&
    materialRuleCount <= 1 &&
    openItemCount <= 1;

  if (shareReady) {
    return 'ready_to_send';
  }

  return 'ready_with_clarifications';
}

function safeFallbackPreSendReviewFromFactSheet(
  factSheet: ProposalFactSheet,
  params: { failureKind: string },
): { data: VertexEvaluationV2PreSendResponse; warnings: string[]; fallbackMode: FallbackMode } {
  const warningKey =
    params.failureKind === 'truncated_output'
      ? 'vertex_truncated_output_fallback_used'
      : params.failureKind.startsWith('vertex_http') || params.failureKind === 'vertex_timeout'
        ? 'vertex_request_failed_fallback_used'
        : params.failureKind === 'not_configured'
          ? 'vertex_not_configured_fallback_used'
          : 'vertex_invalid_response_fallback_used';

  const readiness_status = derivePreSendReadinessStatus(factSheet);
  const fallbackMode = classifyFallbackMode(factSheet);
  const useNegativeFallbackDefaults = readiness_status !== 'ready_to_send';
  const fixedPriceSignal = isFixedPriceSignal(factSheet);
  const pilotSignal = containsAny(
    [
      factSheet.project_goal || '',
      ...factSheet.scope_deliverables,
      ...factSheet.constraints,
      ...factSheet.vendor_preferences,
      ...factSheet.open_questions,
      ...factSheet.missing_info,
    ],
    ['pilot'],
  );
  const missing_information = trimStageItems(
    factSheet.missing_info,
    6,
    useNegativeFallbackDefaults
      ? [
          'Core scope details are still too thin to share confidently.',
          'Acceptance criteria are not yet defined clearly enough for a counterparty review.',
          'Timeline, dependencies, or constraints need more explicit framing.',
        ]
      : [],
  );
  const likely_recipient_questions = trimStageItems(
    factSheet.open_questions,
    6,
    useNegativeFallbackDefaults
      ? missing_information.map((item) => item.endsWith('?') ? item : `${item}?`)
      : [],
  );
  const ambiguous_terms = trimStageItems(
    [
      ...factSheet.assumptions,
      ...factSheet.constraints.filter((entry) => /\bflexible|support|alignment|commercial|standard|reasonable|subject to\b/i.test(entry)),
    ],
    5,
    useNegativeFallbackDefaults
      ? ['Several scope, ownership, or timing assumptions are still implicit rather than contractable.']
      : [],
  );
  const commercial_risks = trimStageItems(
    [
      ...factSheet.constraints.filter((entry) => /\bbudget|price|pricing|payment|liability|commercial|margin|change order|change-order\b/i.test(entry)),
      ...factSheet.risks
        .map((entry) => entry.risk)
        .filter((entry) => /\bbudget|payment|liability|commercial|cost|pricing\b/i.test(entry)),
    ],
    5,
    useNegativeFallbackDefaults
      ? ['Commercial boundaries and risk allocation still need clearer wording before sharing.']
      : [],
  );
  const implementation_risks = trimStageItems(
    [
      ...factSheet.risks.map((entry) => entry.risk),
      ...factSheet.constraints.filter((entry) => /\bdata|integration|approval|dependency|timeline|milestone|implementation|security|rollout\b/i.test(entry)),
    ],
    5,
    useNegativeFallbackDefaults
      ? ['Delivery dependencies, sequencing, or acceptance mechanics need more explicit definition.']
      : [],
  );
  const likely_pushback_areas = trimStageItems(
    [...commercial_risks, ...implementation_risks, ...ambiguous_terms],
    6,
    useNegativeFallbackDefaults
      ? ['A reasonable recipient may push back on unclear scope, ownership, or commercial boundaries.']
      : [],
  );
  const suggested_clarifications = trimStageItems(
    [
      ...missing_information.map((entry) => `Clarify: ${entry}`),
      ...ambiguous_terms.map((entry) => `Tighten wording around: ${entry}`),
    ],
    6,
    useNegativeFallbackDefaults
      ? ['Clarify the highest-risk gaps before sharing this draft more broadly.']
      : [],
  );

  const summaryLead =
    readiness_status === 'ready_to_send'
      ? 'This sender draft is a strong early-stage commercial brief and appears ready to share now. The remaining items below read more like minor clarifications than structural blockers.'
      : readiness_status === 'ready_with_clarifications'
        ? fixedPriceSignal
          ? `This sender draft is already a credible brief for vendor discussion. The remaining points below read more like limited clarifications than structural blockers, but tightening them would support ${pilotSignal ? 'reliable fixed-price pilot pricing' : 'reliable fixed-price pricing'}.`
          : 'This sender draft is already a credible brief for vendor discussion. The remaining points below read more like limited clarifications than structural blockers, but tightening them would make the brief easier to price and paper cleanly.'
        : 'This sender draft can still help frame an early scoping conversation, but it is not yet ready to circulate as a dependable commercial brief because several core scope, ownership, or risk-allocation terms remain too open.';

  return {
    data: {
      analysis_stage: PRE_SEND_STAGE,
      readiness_status,
      send_readiness_summary: summaryLead,
      missing_information,
      ambiguous_terms,
      likely_recipient_questions,
      likely_pushback_areas,
      commercial_risks,
      implementation_risks,
      suggested_clarifications,
    },
    warnings: [warningKey],
    fallbackMode,
  };
}

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
): { data: VertexEvaluationV2MediationResponse; warnings: string[]; fallbackMode: FallbackMode } {
  const warningKey =
    params.failureKind === 'truncated_output'
      ? 'vertex_truncated_output_fallback_used'
      : params.failureKind.startsWith('vertex_http') || params.failureKind === 'vertex_timeout'
      ? 'vertex_request_failed_fallback_used'
      : params.failureKind === 'not_configured'
      ? 'vertex_not_configured_fallback_used'
      : 'vertex_invalid_response_fallback_used';
  const missing = normalizeMissingQuestions({
    factSheet,
    missing: factSheet.missing_info,
  });
  const fallbackMode = classifyFallbackMode(factSheet);
  const fallbackMissing =
    missing.length > 0 ? missing : normalizeMissingQuestions({ factSheet, missing: GENERIC_FALLBACK_MISSING });

  if (fallbackMode === 'incomplete') {
    return {
      data: {
        analysis_stage: MEDIATION_STAGE,
        fit_level: 'unknown',
        confidence_0_1: 0.2,
        why: [
          'Executive Summary: Assessment incomplete: generation failed and the extracted material is too thin for a reliable bilateral negotiation brief.',
          'Decision Assessment: Risk Summary: too many deal-critical details remain unverified to allocate scope, dependency, or commercial risk with confidence.\n\nKey Strengths: the current materials provide only a limited basis for bilateral assessment.',
          'Negotiation Insights: Likely priorities remain hard to infer with confidence because the record is too thin.\n\nPossible concessions cannot yet be assessed reliably.\n\nStructural tensions are visible, but not bounded well enough for a substantive neutral memo.',
          'Leverage Signals: Leverage signal: the current information gap itself is the main constraint, because either side could be carrying material unknowns that are not yet visible in the shared record.',
          'Potential Deal Structures: Option A — Re-run the evaluation after more complete materials are available.\n\nOption B — Use a short diligence step to fill the missing items below before resuming negotiation.\n\nOption C — Pause the process until a fuller source record exists.',
          'Decision Readiness: Decision status: Explore further. Do not treat this as decision-ready; a fuller source record or a successful rerun is needed before a substantive neutral memo can be issued.',
          'Recommended Path: Recommended path: collect the missing information below and rerun the mediation before using this report as a negotiation aid.',
        ],
        missing: fallbackMissing,
        redactions: [],
      },
      warnings: [warningKey],
      fallbackMode,
    };
  }

  const provisionalData: VertexEvaluationV2MediationResponse = {
    analysis_stage: MEDIATION_STAGE,
    fit_level: 'medium',
    confidence_0_1: 0.48,
    why: [],
    missing: fallbackMissing,
    redactions: [],
  };
  const fallbackSignals = buildCalibrationSignals({
    factSheet,
    data: provisionalData,
  });
  const fit_level = fallbackSignals.shouldBeLow ? 'low' : 'medium';
  const confidence_0_1 = fit_level === 'medium' ? 0.48 : 0.38;
  const fallbackData: VertexEvaluationV2MediationResponse = {
    analysis_stage: MEDIATION_STAGE,
    fit_level,
    confidence_0_1,
    why: [],
    missing: fallbackMissing,
    redactions: [],
  };
  const roleDefaults = buildSectionRoleDefaults({
    factSheet,
    data: fallbackData,
    signals: buildCalibrationSignals({ factSheet, data: fallbackData }),
  });

  return {
    data: {
      ...fallbackData,
      why: buildWhyEntriesFromRoleDefaults(roleDefaults),
    },
    warnings: [warningKey],
    fallbackMode,
  };
}

// ─── Post-processing coverage clamps ─────────────────────────────────────────

type ClampResult = {
  data: VertexEvaluationV2MediationResponse;
  capsApplied: string[];
};

function applyCoverageClamps(params: {
  data: VertexEvaluationV2MediationResponse;
  factSheet: ProposalFactSheet;
  sharedText: string;
  confidentialText: string;
  postProcessMode?: PostProcessMode;
}): ClampResult {
  const { factSheet, sharedText, confidentialText } = params;
  let { fit_level, confidence_0_1, why, missing, redactions, negotiation_analysis } = params.data;
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
    const warning =
      'Are the shared and confidential inputs materially different? — identical tiers reduce confidence because confidentiality separation may not be meaningful.';
    if (!missing.includes(warning)) {
      missing = [...missing, warning];
      capsApplied.push('warn_identical_tiers');
    }
  }

  const calibrated = applyConsistencyCalibration({
    data: {
      analysis_stage: MEDIATION_STAGE,
      fit_level,
      confidence_0_1,
      why,
      missing,
      redactions,
      negotiation_analysis,
    },
    factSheet,
    sharedText,
    postProcessMode: params.postProcessMode,
  });

  return {
    data: calibrated.data,
    capsApplied: [...capsApplied, ...calibrated.capsApplied],
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

function flattenNegotiationAnalysisText(analysis?: NegotiationAnalysis) {
  if (!analysis) return [] as string[];
  return [
    ...analysis.proposing_party.demands,
    ...analysis.proposing_party.priorities,
    ...analysis.proposing_party.dealbreakers.map((entry) => `${entry.basis}: ${entry.text}`),
    ...analysis.proposing_party.flexibility,
    ...analysis.counterparty.demands,
    ...analysis.counterparty.priorities,
    ...analysis.counterparty.dealbreakers.map((entry) => `${entry.basis}: ${entry.text}`),
    ...analysis.counterparty.flexibility,
    analysis.compatibility_assessment || '',
    analysis.compatibility_rationale,
    ...analysis.bridgeability_notes,
    ...analysis.critical_incompatibilities,
  ].filter(Boolean);
}

function flattenEvaluationResponseText(response: VertexEvaluationV2Response) {
  switch (response.analysis_stage) {
    case STAGE1_SHARED_INTAKE_STAGE:
      return [
        response.submission_summary,
        ...response.scope_snapshot,
        ...response.unanswered_questions,
        ...response.other_side_needed,
        ...response.discussion_starting_points,
        response.intake_status,
        response.basis_note,
      ].filter(Boolean);
    case PRE_SEND_STAGE:
      return [
        response.send_readiness_summary,
        ...response.missing_information,
        ...response.ambiguous_terms,
        ...response.likely_recipient_questions,
        ...response.likely_pushback_areas,
        ...response.commercial_risks,
        ...response.implementation_risks,
        ...response.suggested_clarifications,
      ].filter(Boolean);
    case MEDIATION_STAGE:
      return [
        ...response.why,
        ...response.missing,
        ...response.redactions,
        ...flattenNegotiationAnalysisText(response.negotiation_analysis),
        response.delta_summary || '',
        ...(response.resolved_since_last_round || []),
        ...(response.remaining_deltas || []),
        ...(response.new_open_issues || []),
        response.movement_direction || '',
      ].filter(Boolean);
    default:
      return assertNever(response, 'Unsupported vertex evaluation response stage');
  }
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
  const outputText = flattenEvaluationResponseText(params.response).join(' ');
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
  const override = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_CALL__;
  if (typeof override === 'function') {
    return override;
  }
  return callVertexV2;
}

/**
 * Separate test hook for the LLM leak-verifier step so tests can control it
 * independently of the main generation call.
 * Global: __PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__
 */
function getVertexVerifierCallImplementation(): VertexCallOverride {
  const override = globalThis.__PREMARKET_TEST_VERTEX_EVAL_V2_VERIFIER_CALL__;
  if (typeof override === 'function') {
    return override;
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
function buildSuppressedOutput(
  warningReason: 'leak_detected' | 'verifier_unavailable',
  stage: Stage1SharedIntakeStage,
): VertexEvaluationV2Stage1SharedIntakeResponse;
function buildSuppressedOutput(
  warningReason: 'leak_detected' | 'verifier_unavailable',
  stage: PreSendReviewStage,
): VertexEvaluationV2PreSendResponse;
function buildSuppressedOutput(
  warningReason: 'leak_detected' | 'verifier_unavailable',
  stage: MediationReviewStage,
): VertexEvaluationV2MediationResponse;
function buildSuppressedOutput(
  warningReason: 'leak_detected' | 'verifier_unavailable',
  stage: ReviewStage,
): VertexEvaluationV2Response;
function buildSuppressedOutput(
  warningReason: 'leak_detected' | 'verifier_unavailable',
  stage: ReviewStage,
): VertexEvaluationV2Response {
  const placeholder =
    warningReason === 'leak_detected'
      ? 'Output suppressed: evaluation output contained confidential information and could not be shared.'
      : 'Output suppressed: evaluation verifier was unavailable and output safety could not be confirmed.';
  if (stage === STAGE1_SHARED_INTAKE_STAGE) {
    return {
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary: placeholder,
      scope_snapshot: [],
      unanswered_questions: [],
      other_side_needed: [],
      discussion_starting_points: [],
      intake_status: 'awaiting_other_side_input',
      basis_note: DEFAULT_STAGE1_BASIS_NOTE,
    };
  }
  if (stage === PRE_SEND_STAGE) {
    return {
      analysis_stage: PRE_SEND_STAGE,
      readiness_status: 'not_ready_to_send',
      send_readiness_summary: placeholder,
      missing_information: [],
      ambiguous_terms: [],
      likely_recipient_questions: [],
      likely_pushback_areas: [],
      commercial_risks: [],
      implementation_risks: [],
      suggested_clarifications: [],
    };
  }
  return {
    analysis_stage: MEDIATION_STAGE,
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
  const outputText = flattenEvaluationResponseText(params.response).join('\n');

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
  evalResult: VertexEvaluationV2MediationResponse;
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

// ─── Quality assessment & refinement (multi-pass + regen) ────────────────────

/**
 * Quality gate — heuristic checks on the Pass B output to detect weak,
 * generic, or incomplete sections.
 *
 * Returns an array of trigger reasons. Empty array = pass is clean.
 * This is deterministic (no model calls) and intentionally conservative:
 * it errs on the side of flagging rather than missing genuine quality issues.
 */

const GENERIC_FILLER_PATTERNS = [
  /\bclarity and specificity\b/i,
  /\bdecision-ready\b/i,
  /\bmature approach\b/i,
  /\bthoughtfully separates\b/i,
  /\bbroadly workable\b/i,
  /\blooks polished\b/i,
  /\bpresented clearly\b/i,
  /\boverall this (?:is|looks|appears) (?:a |)(?:solid|strong|good)\b/i,
  /\bwell-structured proposal\b/i,
  /\bcomprehensive coverage\b/i,
];

const MIN_WHY_TOTAL_CHARS = 1200;
const MIN_SECTION_BODY_CHARS = 80;
const MIN_MISSING_ITEMS_QUALITY = 4;
const MAX_GENERIC_FILLER_HITS = 3;

interface QualityAssessment {
  /** Overall score 0-1 (below 0.5 = weak). */
  score: number;
  /** Trigger reasons for regeneration. */
  triggers: string[];
  /** Specific weak section keys (for targeted refinement context). */
  weakSections: string[];
}

function assessReportQuality(data: VertexEvaluationV2MediationResponse): QualityAssessment {
  const triggers: string[] = [];
  const weakSections: string[] = [];
  let penaltyPoints = 0;

  // 1. Check total why[] substance
  const whyText = (data.why || []).join(' ');
  const whyTotalChars = whyText.length;
  if (whyTotalChars < MIN_WHY_TOTAL_CHARS) {
    triggers.push(`why_too_short:${whyTotalChars}chars`);
    penaltyPoints += 2;
  }

  // 2. Check each required section exists and has substance
  const sections = parseWhySections(data.why || []);
  for (const key of REQUIRED_WHY_SECTION_KEYS) {
    const section = sections.find((s) => s.key === key);
    if (!section) {
      triggers.push(`missing_section:${key}`);
      weakSections.push(key);
      penaltyPoints += 2;
    } else if (section.body.length < MIN_SECTION_BODY_CHARS) {
      triggers.push(`thin_section:${key}:${section.body.length}chars`);
      weakSections.push(key);
      penaltyPoints += 1;
    }
  }

  // 3. Check for excessive generic filler
  let fillerHits = 0;
  for (const pattern of GENERIC_FILLER_PATTERNS) {
    if (pattern.test(whyText)) {
      fillerHits += 1;
    }
  }
  if (fillerHits >= MAX_GENERIC_FILLER_HITS) {
    triggers.push(`excessive_filler:${fillerHits}hits`);
    penaltyPoints += 1;
  }

  // 4. Check missing[] quality
  const missingItems = data.missing || [];
  if (missingItems.length < MIN_MISSING_ITEMS_QUALITY) {
    triggers.push(`too_few_missing:${missingItems.length}`);
    penaltyPoints += 1;
  }
  // Check that missing items have em-dash why clauses
  const itemsWithoutWhy = missingItems.filter((item) => !item.includes('—') && !item.includes(' — '));
  if (itemsWithoutWhy.length > missingItems.length * 0.5) {
    triggers.push('missing_items_lack_why_clauses');
    penaltyPoints += 1;
  }

  // 5. Check for malformed or incomplete sections
  for (const section of sections) {
    if (section.body && !/[.!?]$/.test(section.body.trim())) {
      triggers.push(`incomplete_ending:${section.key}`);
      weakSections.push(section.key);
      penaltyPoints += 1;
    }
  }

  // Score: starts at 1.0, deducted by penalties (each ~0.1)
  const score = Math.max(0, Math.min(1, 1 - penaltyPoints * 0.1));

  return { score, triggers, weakSections: [...new Set(weakSections)] };
}

/**
 * Build a refinement prompt that takes the initial Pass B evaluation and
 * improves its presentation quality without changing the substantive judgment.
 *
 * This is Pass C — a controlled polish pass. It preserves:
 * - The same fit_level and confidence_0_1
 * - The same factual basis and evidence
 * - The same confidentiality constraints
 *
 * It improves:
 * - Specificity and concreteness of narrative
 * - Section completeness and structure
 * - Removal of generic filler
 * - Stronger top-line insights
 * - Better tradeoff framing
 */
function buildRefinementPrompt(params: {
  initialResult: VertexEvaluationV2MediationResponse;
  factSheet: ProposalFactSheet;
  reportStyle: ReportStyle;
  quality: QualityAssessment;
  convergenceDigestText?: string;
}) {
  const { initialResult, factSheet, reportStyle, quality } = params;

  const weakSectionsList = quality.weakSections.length > 0
    ? `WEAK SECTIONS (prioritize improving these): ${quality.weakSections.join(', ')}`
    : 'No specific sections flagged — improve overall polish and specificity.';

  const triggersList = quality.triggers.length > 0
    ? `Quality issues detected: ${quality.triggers.join('; ')}`
    : '';

  return [
    'SYSTEM: You are the AI Mediator for PreMarket refining a previously generated evaluation report.',
    'Your task: improve the presentation quality and specificity of the report below WITHOUT changing its substantive conclusions.',
    '',
    'PRESERVATION RULES (non-negotiable):',
    `- fit_level MUST remain: "${initialResult.fit_level}"`,
    `- confidence_0_1 MUST remain: ${initialResult.confidence_0_1}`,
    '- Do NOT change the overall judgment, risk assessment direction, or recommendation direction.',
    '- Preserve negotiation_analysis exactly if it is present. Do NOT add, remove, or reclassify demands, dealbreakers, compatibility verdicts, or bridgeability notes.',
    '- Preserve delta_summary, resolved_since_last_round, remaining_deltas, new_open_issues, and movement_direction exactly if they are present.',
    '- Do NOT introduce new confidential information or leak confidential details.',
    '- Do NOT add new sections or remove required sections.',
    '- Do NOT turn the evaluator into a strategist or coach.',
    '- Output must remain safe to share publicly and bilaterally neutral.',
    '',
    'CONFIDENTIALITY RULES (strictly enforced — same as initial generation):',
    '- Never quote confidential text verbatim.',
    '- Never disclose confidential numbers, IDs, dates, emails, pricing, or exact identifiers.',
    '- Use only generic, safely-derived conclusions when drawing on confidential context.',
    '',
    'IMPROVEMENT TARGETS:',
    `- ${weakSectionsList}`,
    triggersList ? `- ${triggersList}` : '',
    '- Replace generic filler ("clarity and specificity", "broadly workable", "looks polished") with concrete evidence-backed statements.',
    '- Strengthen top-line insights in Executive Summary and Decision Assessment.',
    '- Ensure every section has substantive, specific content grounded in the fact_sheet.',
    '- Ensure each missing[] item has an actionable question with an em-dash why-it-matters clause.',
    '- Improve tradeoff framing — include at least 2 explicit if/then statements.',
    '- Ensure natural prose flow with varied sentence lengths.',
    '- Maintain the same report style:',
    `  Voice: ${reportStyle.style_id}, Ordering: ${reportStyle.ordering}, Verbosity: ${reportStyle.verbosity}`,
    '',
    'FACT SHEET (for evidence grounding — same as used in initial generation):',
    JSON.stringify(factSheet, null, 2),
    '',
    params.convergenceDigestText || '',
    '',
    'INITIAL REPORT TO REFINE:',
    JSON.stringify(initialResult, null, 2),
    '',
    'Output MUST be valid JSON only. No markdown, no backticks, no preamble.',
    'Return the full refined report in this exact schema:',
    JSON.stringify(
      {
        analysis_stage: MEDIATION_STAGE,
        fit_level: 'high|medium|low|unknown',
        confidence_0_1: 0,
        why: ['string'],
        missing: ['string'],
        redactions: ['string'],
        delta_summary: 'string',
        resolved_since_last_round: ['string'],
        remaining_deltas: ['string'],
        new_open_issues: ['string'],
        movement_direction: 'converging|stalled|diverging',
        negotiation_analysis: {
          proposing_party: {
            demands: ['string'],
            priorities: ['string'],
            dealbreakers: [{ text: 'string', basis: 'stated|strongly_implied|not_clearly_established' }],
            flexibility: ['string'],
          },
          counterparty: {
            demands: ['string'],
            priorities: ['string'],
            dealbreakers: [{ text: 'string', basis: 'stated|strongly_implied|not_clearly_established' }],
            flexibility: ['string'],
          },
          compatibility_assessment:
            'broadly_compatible|compatible_with_adjustments|uncertain_due_to_missing_information|fundamentally_incompatible',
          compatibility_rationale: 'string',
          bridgeability_notes: ['string'],
          critical_incompatibilities: ['string'],
        },
      },
      null,
      2,
    ),
    'negotiation_analysis is optional; if it is present in the initial report, preserve it exactly.',
    'Progress fields are optional; if they are present in the initial report, preserve them exactly.',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Attempt a single refinement pass on a completed Pass B result.
 *
 * Returns the refined result if successful and better, or the original
 * result if refinement fails or produces worse output.
 *
 * NEVER retries — exactly one attempt. On any failure, returns original.
 */
async function attemptRefinementPass(params: {
  initialResult: VertexEvaluationV2MediationResponse;
  factSheet: ProposalFactSheet;
  reportStyle: ReportStyle;
  quality: QualityAssessment;
  convergenceDigestText?: string;
  requestId?: string;
  inputChars: number;
  generationModel: string;
  callVertex: VertexCallOverride;
  forbiddenLeakText: string;
  sharedText: string;
  forbiddenChunks: Array<{ evidence_id: string; text: string }>;
  canaryTokens: string[];
  enforceLeakGuard: boolean;
}): Promise<{
  result: VertexEvaluationV2MediationResponse;
  applied: boolean;
  skip_reason?: string;
}> {
  const refinementPrompt = buildRefinementPrompt({
    initialResult: params.initialResult,
    factSheet: params.factSheet,
    reportStyle: params.reportStyle,
    quality: params.quality,
    convergenceDigestText: params.convergenceDigestText,
  });

  let vertex: VertexCallResponse;
  try {
    vertex = await params.callVertex({
      prompt: refinementPrompt,
      requestId: params.requestId ? `${params.requestId}_refine` : undefined,
      inputChars: params.inputChars,
      maxOutputTokens: 6144,
      preferredModel: params.generationModel,
    });
  } catch {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_call_failed' };
  }

  const rawText = String(vertex.text || '');
  if (!rawText.trim()) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_empty_output' };
  }

  if (isLikelyTruncatedOutput(rawText, vertex.finishReason)) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_truncated' };
  }

  const extracted = parseJsonObject(rawText);
  if (!extracted.parsed) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_parse_failed' };
  }

  const coerced = coerceToSmallSchema(extracted.parsed, MEDIATION_STAGE);
  const validation = validateResponseSchema(coerced.candidate, MEDIATION_STAGE);
  if (!validation.ok) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_schema_invalid' };
  }

  // Verify the refinement preserved substantive judgment
  if (validation.normalized.fit_level !== params.initialResult.fit_level) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_changed_fit_level' };
  }
  if (Math.abs(validation.normalized.confidence_0_1 - params.initialResult.confidence_0_1) > 0.05) {
    return { result: params.initialResult, applied: false, skip_reason: 'refinement_changed_confidence' };
  }

  const refinedResult: VertexEvaluationV2MediationResponse = {
    ...validation.normalized,
    negotiation_analysis: params.initialResult.negotiation_analysis,
    ...(params.initialResult.delta_summary ? { delta_summary: params.initialResult.delta_summary } : {}),
    ...(params.initialResult.resolved_since_last_round
      ? { resolved_since_last_round: params.initialResult.resolved_since_last_round }
      : {}),
    ...(params.initialResult.remaining_deltas
      ? { remaining_deltas: params.initialResult.remaining_deltas }
      : {}),
    ...(params.initialResult.new_open_issues
      ? { new_open_issues: params.initialResult.new_open_issues }
      : {}),
    ...(params.initialResult.movement_direction
      ? { movement_direction: params.initialResult.movement_direction }
      : {}),
  };

  // Leak check the refined output
  if (params.enforceLeakGuard) {
    const leak = detectConfidentialLeak({
      response: refinedResult,
      forbiddenText: params.forbiddenLeakText,
      sharedText: params.sharedText,
      forbiddenChunks: params.forbiddenChunks,
      canaryTokens: params.canaryTokens,
    });
    if (leak) {
      return { result: params.initialResult, applied: false, skip_reason: 'refinement_leaked_confidential' };
    }
  }

  // Structural checks passed — return for post-processing quality comparison
  // in the caller (which applies coverage clamps symmetrically).
  return { result: refinedResult, applied: true };
}

export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request<Stage1SharedIntakeStage>,
): Promise<VertexEvaluationV2Outcome<Stage1SharedIntakeStage>>;
export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request<PreSendReviewStage>,
): Promise<VertexEvaluationV2Outcome<PreSendReviewStage>>;
export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request<MediationReviewStage>,
): Promise<VertexEvaluationV2Outcome<MediationReviewStage>>;
export async function evaluateWithVertexV2(
  input: VertexEvaluationV2Request,
): Promise<VertexEvaluationV2Outcome> {
  const sharedText = sanitizeUserInput(String(input.sharedText || '')).trim();
  const confidentialText = sanitizeUserInput(String(input.confidentialText || '')).trim();
  const analysisStage = requireAnalysisStage(input.analysisStage);
  const forbiddenLeakText =
    input.forbiddenLeakText === undefined
      ? confidentialText
      : sanitizeUserInput(String(input.forbiddenLeakText || '')).trim();
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

  const convergenceDigestText = asText(input.convergenceDigestText) || undefined;

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
  const buildPrompt = (options: { tightMode?: boolean; includeDigest?: boolean } = {}) =>
    analysisStage === STAGE1_SHARED_INTAKE_STAGE
      ? buildStage1SharedIntakePromptFromFactSheet({
          factSheet,
          reportStyle,
          tightMode: options.tightMode,
        })
      : analysisStage === PRE_SEND_STAGE
      ? buildPreSendPromptFromFactSheet({
          factSheet,
          reportStyle,
          tightMode: options.tightMode,
        })
      : buildEvalPromptFromFactSheet({
          factSheet,
          chunks,
          reportStyle,
          tightMode: options.tightMode,
          convergenceDigestText: options.includeDigest === false ? undefined : convergenceDigestText,
          mediationRoundContext: input.mediationRoundContext,
        });

  let prompt = buildPrompt();

  // ── Token preflight: check exact final prompt before Vertex call ─────────
  // This runs on the actual assembled prompt string, not just the inputs.
  // If the prompt exceeds the hard ceiling, we proactively switch to tight
  // mode. If still over, we strip the convergence digest (it is the most
  // expendable part of the prompt — the model can still evaluate without it).
  let preflight = preflightPromptCheck(prompt);
  let preflightTrimTriggered = false;
  if (preflight.overCeiling) {
    // First trim: rebuild with tight mode (reduces instruction overhead).
    prompt = buildPrompt({ tightMode: true });
    preflight = preflightPromptCheck(prompt);
    preflightTrimTriggered = true;
    if (preflight.overCeiling && convergenceDigestText && analysisStage !== PRE_SEND_STAGE) {
    // Second trim: drop convergence digest entirely.
      prompt = buildPrompt({ tightMode: true, includeDigest: false });
      preflight = preflightPromptCheck(prompt);
    }
  }

  let attempt = 0;
  let usedTightRetry = false;
  let lastParseFailureKind: string = 'unknown';
  let lastFinishReason: string | null = null;
  let lastRawTextLength = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let vertex: VertexCallResponse;
    let llmVerifyMeta:
      | { verdict: LlmVerifierVerdict; escalated: boolean }
      | undefined;

    try {
      vertex = await callVertex({
        prompt,
        requestId,
        inputChars,
        maxOutputTokens: 6144,
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
        prompt = buildPrompt({ tightMode: true });
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
        prompt = buildPrompt({ tightMode: true });
        continue;
      }
      // Both attempts failed to parse → use fallback.
      lastParseFailureKind = 'json_parse_error';
      break;
    }

    const coerced = coerceToSmallSchema(extracted.parsed, analysisStage);
    const schemaValidation = validateResponseSchema(coerced.candidate, analysisStage);
    if (!schemaValidation.ok) {
      if (!usedTightRetry) {
        usedTightRetry = true;
        lastParseFailureKind = 'schema_validation_error';
        prompt = buildPrompt({ tightMode: true });
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
        const suppressed = buildSuppressedOutput('leak_detected', analysisStage);
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
      const llmVerifyResult = await runLlmLeakVerifier({
        response: schemaValidation.normalized,
        forbiddenText: forbiddenLeakText,
        sharedText,
        requestId,
        verifierModel,
        escalationModel: generationModel,
        callVerifier,
        callGeneration: callVertex,
      });
      if (llmVerifyResult.verdict === 'leak') {
        // LLM verifier detected leak: suppress output, return ok:true with warnings.
        const suppressed = buildSuppressedOutput('leak_detected', analysisStage);
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
              verifier_escalated: llmVerifyResult.escalated,
              verifier_unavailable: false,
            },
          },
        };
      }
      if (llmVerifyResult.verdict === 'unavailable') {
        // Verifier infrastructure failure: cannot confirm output is safe.
        // Policy: suppress narrative output to prevent silent leaks.
        // Never 5xx — persisted as completed_with_warnings.
        const suppressed = buildSuppressedOutput('verifier_unavailable', analysisStage);
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
              verifier_escalated: llmVerifyResult.escalated,
              verifier_unavailable: true,
            },
          },
        };
      }
      // Store verifier metadata for _internal so we can track it.
      llmVerifyMeta = {
        verdict: llmVerifyResult.verdict,
        escalated: llmVerifyResult.escalated,
      };
    }

    if (analysisStage === STAGE1_SHARED_INTAKE_STAGE) {
      if (!isStage1SharedIntakeResponse(schemaValidation.normalized)) {
        throw new TypeError('Stage 1 validation returned a non Stage 1 response.');
      }
      return {
        ok: true,
        data: schemaValidation.normalized,
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
          preflight: {
            promptChars: preflight.promptChars,
            estimatedPromptTokens: preflight.estimatedPromptTokens,
            overCeiling: preflight.overCeiling,
            ceiling: preflight.ceiling,
            trimTriggered: preflightTrimTriggered,
          },
          models_used: {
            generation: generationModel,
            extract: extractModel,
            verifier: verifierModel,
            verifier_used: Boolean(llmVerifyMeta),
            verifier_escalated: Boolean(llmVerifyMeta?.escalated),
            verifier_unavailable: false,
          },
        },
      };
    }

    if (analysisStage === PRE_SEND_STAGE) {
      if (!isPreSendReviewResponse(schemaValidation.normalized)) {
        throw new TypeError('Pre-send validation returned a non pre-send response.');
      }
      const preSendResult = schemaValidation.normalized;
      return {
        ok: true,
        data: preSendResult,
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
          preflight: {
            promptChars: preflight.promptChars,
            estimatedPromptTokens: preflight.estimatedPromptTokens,
            overCeiling: preflight.overCeiling,
            ceiling: preflight.ceiling,
            trimTriggered: preflightTrimTriggered,
          },
          models_used: {
            generation: generationModel,
            extract: extractModel,
            verifier: verifierModel,
            verifier_used: Boolean(llmVerifyMeta),
            verifier_escalated: Boolean(llmVerifyMeta?.escalated),
            verifier_unavailable: false,
          },
        },
      };
    }

    // ── Quality assessment on raw Pass B output (BEFORE post-processing) ──
    // Post-processing (coverage clamps + consistency calibration) backfills
    // missing sections and normalizes missing[], which would mask genuine
    // quality issues. Assess the raw model output so refinement/regen can
    // target the real quality problems.
    if (!isMediationReviewResponse(schemaValidation.normalized)) {
      throw new TypeError('Mediation validation returned a non mediation response.');
    }
    const mediationResult = schemaValidation.normalized;
    const rawQuality = assessReportQuality(mediationResult);
    const QUALITY_THRESHOLD = 0.5;
    const shouldRefine = rawQuality.score < 1.0;
    const shouldRegenerate = rawQuality.score < QUALITY_THRESHOLD;

    let bestRawResult = mediationResult;
    let refinementMeta: { attempted: boolean; applied: boolean; skip_reason?: string } =
      { attempted: false, applied: false };
    let regenMeta: { triggered: boolean; reasons: string[]; applied: boolean } =
      { triggered: false, reasons: [], applied: false };

    // ── Pass C: Multi-pass refinement (when quality < 1.0) ───────────────
    // Refines presentation quality without changing substantive judgment.
    // Single attempt — no retries. Operates on raw output to produce a
    // better raw result that will then go through post-processing.
    if (shouldRefine) {
      const refinement = await attemptRefinementPass({
        initialResult: mediationResult,
        factSheet,
        reportStyle,
        quality: rawQuality,
        convergenceDigestText,
        requestId,
        inputChars,
        generationModel,
        callVertex,
        forbiddenLeakText,
        sharedText,
        forbiddenChunks,
        canaryTokens: forbiddenLeakCanaryTokens,
        enforceLeakGuard,
      });
      refinementMeta = {
        attempted: true,
        applied: false,
        skip_reason: refinement.skip_reason,
      };
      if (refinement.applied) {
        // Compare raw quality symmetrically (both pre-post-processing)
        const refinedRawQuality = assessReportQuality(refinement.result);
        if (refinedRawQuality.score >= rawQuality.score) {
          bestRawResult = refinement.result;
          refinementMeta.applied = true;
          refinementMeta.skip_reason = undefined;
        } else {
          refinementMeta.skip_reason = 'refinement_quality_worse';
        }
      }
    }

    // ── Targeted regeneration (exactly one pass for weak output) ─────────
    // Only triggers when raw quality score is below threshold AND
    // refinement did not solve the issue. At most one regen attempt.
    if (shouldRegenerate && !refinementMeta.applied) {
      regenMeta = { triggered: true, reasons: rawQuality.triggers, applied: false };

      // Regeneration: re-run Pass B once with a strengthened prompt
      try {
        const regenPrompt = buildPrompt();
        const regenVertex = await callVertex({
          prompt: regenPrompt,
          requestId: requestId ? `${requestId}_regen` : undefined,
          inputChars,
          maxOutputTokens: 6144,
          preferredModel: generationModel,
        });

        const regenRaw = String(regenVertex.text || '');
        if (regenRaw.trim() && !isLikelyTruncatedOutput(regenRaw, regenVertex.finishReason)) {
          const regenExtracted = parseJsonObject(regenRaw);
          if (regenExtracted.parsed) {
            const regenCoerced = coerceToSmallSchema(regenExtracted.parsed, analysisStage);
            const regenValidation = validateResponseSchema(regenCoerced.candidate, analysisStage);
            if (regenValidation.ok) {
              if (!isMediationReviewResponse(regenValidation.normalized)) {
                throw new TypeError('Regenerated mediation response failed stage narrowing.');
              }
              const regeneratedResult = regenValidation.normalized;
              // Leak check on regenerated output
              let regenLeakSafe = true;
              if (enforceLeakGuard) {
                const regenLeak = detectConfidentialLeak({
                  response: regeneratedResult,
                  forbiddenText: forbiddenLeakText,
                  sharedText,
                  forbiddenChunks,
                  canaryTokens: forbiddenLeakCanaryTokens,
                });
                if (regenLeak) regenLeakSafe = false;
              }

              if (regenLeakSafe) {
                // Compare raw quality (both pre-post-processing)
                const regenRawQuality = assessReportQuality(regeneratedResult);
                if (regenRawQuality.score > rawQuality.score) {
                  bestRawResult = regeneratedResult;
                  regenMeta.applied = true;
                }
              }
            }
          }
        }
      } catch {
        // Regen failed — keep original. No retry.
      }
    }

    // ── Apply deterministic coverage clamps (post-processing) on winner ──
    const clamped = applyCoverageClamps({
      data: bestRawResult,
      factSheet,
      sharedText,
      confidentialText,
      postProcessMode: 'normal',
    });
    const finalData = clamped.data;

    // ── Build safe telemetry (counts/booleans/enums only) ─────────────────
    const telemetry = buildTelemetry({
      sharedText,
      confidentialText,
      proposalTextExcerpt,
      sharedChunks: chunks.sharedChunks,
      confidentialChunks: chunks.confidentialChunks,
      factSheet,
      evalResult: finalData,
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
      if (refinementMeta.attempted) {
        // eslint-disable-next-line no-console
        console.log('[eval_v2.refinement]', JSON.stringify(refinementMeta));
      }
      if (regenMeta.triggered) {
        // eslint-disable-next-line no-console
        console.log('[eval_v2.regeneration]', JSON.stringify(regenMeta));
      }
    }

    return {
      ok: true,
      data: finalData,
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
        preflight: {
          promptChars: preflight.promptChars,
          estimatedPromptTokens: preflight.estimatedPromptTokens,
          overCeiling: preflight.overCeiling,
          ceiling: preflight.ceiling,
          trimTriggered: preflightTrimTriggered,
        },
        models_used: {
          generation: generationModel,
          extract: extractModel,
          verifier: verifierModel,
          verifier_used: Boolean(llmVerifyMeta),
          verifier_escalated: Boolean(llmVerifyMeta?.escalated),
          verifier_unavailable: false,
        },
        refinement: refinementMeta,
        regeneration: regenMeta,
        raw_quality_score: rawQuality.score,
      },
    };
  }

  // ── All Pass B attempts failed → safe fallback ───────────────────────────
  // Return ok:true with a clamped fallback evaluation so the API never fails.
  if (analysisStage === STAGE1_SHARED_INTAKE_STAGE) {
    const fallback = safeFallbackStage1SharedIntakeFromFactSheet(factSheet, {
      failureKind: lastParseFailureKind,
    });

    return {
      ok: true,
      data: fallback.data,
      attempt_count: attempt,
      model: null,
      generation_model: generationModel,
      _internal: {
        fact_sheet: factSheet,
        coverage_count: computeCoverageCount(factSheet.source_coverage),
        caps_applied: [],
        pass_a_parse_error: passAParseError,
        pass_b_attempt_count: attempt,
        report_style: reportStyle,
        preflight: {
          promptChars: preflight.promptChars,
          estimatedPromptTokens: preflight.estimatedPromptTokens,
          overCeiling: preflight.overCeiling,
          ceiling: preflight.ceiling,
          trimTriggered: preflightTrimTriggered,
        },
        warnings: fallback.warnings,
        failure_kind: lastParseFailureKind,
        fallback_mode: fallback.fallbackMode,
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

  if (analysisStage === PRE_SEND_STAGE) {
    const fallback = safeFallbackPreSendReviewFromFactSheet(factSheet, {
      failureKind: lastParseFailureKind,
    });

    return {
      ok: true,
      data: fallback.data,
      attempt_count: attempt,
      model: null,
      generation_model: generationModel,
      _internal: {
        fact_sheet: factSheet,
        coverage_count: computeCoverageCount(factSheet.source_coverage),
        caps_applied: [],
        pass_a_parse_error: passAParseError,
        pass_b_attempt_count: attempt,
        report_style: reportStyle,
        preflight: {
          promptChars: preflight.promptChars,
          estimatedPromptTokens: preflight.estimatedPromptTokens,
          overCeiling: preflight.overCeiling,
          ceiling: preflight.ceiling,
          trimTriggered: preflightTrimTriggered,
        },
        warnings: fallback.warnings,
        failure_kind: lastParseFailureKind,
        fallback_mode: fallback.fallbackMode,
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
    postProcessMode: fallback.fallbackMode === 'salvaged_memo' ? 'salvaged_fallback' : 'incomplete_fallback',
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
      preflight: {
        promptChars: preflight.promptChars,
        estimatedPromptTokens: preflight.estimatedPromptTokens,
        overCeiling: preflight.overCeiling,
        ceiling: preflight.ceiling,
        trimTriggered: preflightTrimTriggered,
      },
      warnings: fallback.warnings,
      failure_kind: lastParseFailureKind,
      fallback_mode: fallback.fallbackMode,
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

export { validateResponseSchema, assessReportQuality };
