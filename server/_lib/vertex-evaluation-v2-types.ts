import type { MediationMovementDirection, MediationRoundContext } from './mediation-progress.js';

export type ParseErrorKind =
  | 'json_parse_error'
  | 'schema_validation_error'
  | 'truncated_output'
  | 'empty_output'
  | 'vertex_timeout'
  | 'vertex_http_error'
  | 'openai_timeout'
  | 'openai_request_failed'
  | 'openai_quota_exceeded'
  | 'confidential_leak_detected';

export type FitLevel = 'high' | 'medium' | 'low' | 'unknown';
export type DealbreakerBasis = 'stated' | 'strongly_implied' | 'not_clearly_established';
export type CompatibilityAssessment =
  | 'broadly_compatible'
  | 'compatible_with_adjustments'
  | 'uncertain_due_to_missing_information'
  | 'fundamentally_incompatible';

export interface NegotiationDealbreaker {
  text: string;
  basis: DealbreakerBasis;
}

export interface NegotiationPartyAnalysis {
  demands: string[];
  priorities: string[];
  dealbreakers: NegotiationDealbreaker[];
  flexibility: string[];
}

export interface NegotiationAnalysis {
  proposing_party: NegotiationPartyAnalysis;
  counterparty: NegotiationPartyAnalysis;
  compatibility_assessment: CompatibilityAssessment | null;
  compatibility_rationale: string;
  bridgeability_notes: string[];
  critical_incompatibilities: string[];
}

export type NarrativeOutputMode =
  | 'executive_memo'
  | 'founder_friendly'
  | 'negotiation_coach'
  | 'skeptical_review'
  | 'balanced_assessment';

export type NarrativeToneProfile =
  | 'decisive'
  | 'constructive'
  | 'cautious'
  | 'skeptical'
  | 'balanced';

export type MediationDecisionStatus =
  | 'not_viable'
  | 'explore_further'
  | 'proceed_with_conditions'
  | 'ready_to_finalize';

export interface StructuredDealAnalysis {
  recommendation: string;
  confidence: number;
  decision_status: MediationDecisionStatus;
  core_thesis: string;
  commercial_rationale: string[];
  strongest_arguments_for: string[];
  strongest_arguments_against: string[];
  key_risks: string[];
  hidden_assumptions: string[];
  unresolved_questions: string[];
  negotiation_leverage: string[];
  suggested_next_actions: string[];
  evidence_used: string[];
  evidence_gaps: string[];
  unsupported_claims: string[];
  grounding_summary: string;
  retrieval_warnings: string[];
  missing_information: string[];
  tone_profile: NarrativeToneProfile;
  output_mode: NarrativeOutputMode;
}

export type MediationEvidenceSourceType =
  | 'shared_contribution'
  | 'confidential_contribution'
  | 'prior_mediation'
  | 'primary_shared_context'
  | 'primary_confidential_context';

export type MediationEvidenceVisibility = 'shared' | 'confidential' | 'internal_derived';

export interface MediationEvidenceCandidate {
  id: string;
  source_type: MediationEvidenceSourceType;
  source_label: string;
  source_role: string;
  visibility: MediationEvidenceVisibility;
  text: string;
  title_or_summary?: string;
  party_or_side?: string;
  round_number?: number | null;
  version_info?: string;
  created_at?: string | null;
  updated_at?: string | null;
  file_names?: string[];
  limitations?: string[];
}

export interface RetrievedMediationEvidenceItem {
  id: string;
  source_type: MediationEvidenceSourceType;
  source_label: string;
  source_role: string;
  visibility: MediationEvidenceVisibility;
  relevance_score: number;
  title_or_summary: string;
  excerpt: string;
  extracted_terms: string[];
  dates_or_version_info?: string;
  party_or_side?: string;
  confidence: number;
  include_reason: string;
  limitations: string[];
}

export interface RetrievedMediationEvidencePacket {
  retrieval_strategy: 'heuristic_commercial_terms_v1' | 'primary_context_fallback_v1';
  evidence_count: number;
  omitted_evidence_count: number;
  token_budget_used: number;
  character_budget_used: number;
  retrieval_warnings: string[];
  generated_at: string;
  items: RetrievedMediationEvidenceItem[];
}

export interface NarrativeMemoSection {
  heading: string;
  paragraphs: string[];
}

export interface NarrativeMemo {
  title: string;
  sections: NarrativeMemoSection[];
  closing: string;
}

export type EvaluationChunks = {
  sharedChunks: Array<{ evidence_id: string; text: string }>;
  confidentialChunks: Array<{ evidence_id: string; text: string }>;
};

export type FallbackMode = 'salvaged_memo' | 'incomplete';
export type PostProcessMode = 'normal' | 'salvaged_fallback' | 'incomplete_fallback';
export type Stage1SharedIntakeStage = 'stage1_shared_intake';
export type PreSendReviewStage = 'pre_send_review';
export type MediationReviewStage = 'mediation_review';
export type OneSidedReviewStage = Stage1SharedIntakeStage | PreSendReviewStage;
export type ReviewStage = OneSidedReviewStage | MediationReviewStage;

export const STAGE1_SHARED_INTAKE_STAGE: Stage1SharedIntakeStage = 'stage1_shared_intake';
export const PRE_SEND_STAGE: PreSendReviewStage = 'pre_send_review';
export const MEDIATION_STAGE: MediationReviewStage = 'mediation_review';

export type VertexEvaluationV2ResponseForStage<Stage extends ReviewStage> =
  Stage extends Stage1SharedIntakeStage
    ? VertexEvaluationV2Stage1SharedIntakeResponse
    : Stage extends PreSendReviewStage
    ? VertexEvaluationV2PreSendResponse
    : VertexEvaluationV2MediationResponse;

export type SchemaValidationResult<Stage extends ReviewStage = ReviewStage> =
  | { ok: true; normalized: VertexEvaluationV2ResponseForStage<Stage> }
  | { ok: false; missingKeys: string[]; invalidFields: string[] };

export type CoercedSchemaCandidate<Stage extends ReviewStage = ReviewStage> = {
  candidate: unknown | VertexEvaluationV2ResponseForStage<Stage>;
  coerced: boolean;
};

export type PreSendReadinessStatus =
  | 'not_ready_to_send'
  | 'ready_with_clarifications'
  | 'ready_to_send';

export type SharedIntakeStatus = 'awaiting_other_side_input';

export interface VertexEvaluationV2MediationResponse {
  analysis_stage: MediationReviewStage;
  fit_level: FitLevel;
  confidence_0_1: number;
  why: string[];
  missing: string[];
  redactions: string[];
  internal_analysis?: StructuredDealAnalysis;
  narrative?: NarrativeMemo;
  negotiation_analysis?: NegotiationAnalysis;
  delta_summary?: string;
  resolved_since_last_round?: string[];
  remaining_deltas?: string[];
  new_open_issues?: string[];
  movement_direction?: MediationMovementDirection;
}

export interface VertexEvaluationV2Stage1SharedIntakeResponse {
  analysis_stage: Stage1SharedIntakeStage;
  submission_summary: string;
  scope_snapshot: string[];
  unanswered_questions: string[];
  other_side_needed: string[];
  discussion_starting_points: string[];
  intake_status: SharedIntakeStatus;
  basis_note: string;
}

export interface VertexEvaluationV2PreSendResponse {
  analysis_stage: PreSendReviewStage;
  readiness_status: PreSendReadinessStatus;
  send_readiness_summary: string;
  missing_information: string[];
  ambiguous_terms: string[];
  likely_recipient_questions: string[];
  likely_pushback_areas: string[];
  commercial_risks: string[];
  implementation_risks: string[];
  suggested_clarifications: string[];
}

export type VertexEvaluationV2Response =
  | VertexEvaluationV2MediationResponse
  | VertexEvaluationV2Stage1SharedIntakeResponse
  | VertexEvaluationV2PreSendResponse;

export interface VertexEvaluationV2Error {
  parse_error_kind: ParseErrorKind;
  finish_reason: string | null;
  raw_text_length: number;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface FactSheetRisk {
  risk: string;
  impact: 'low' | 'med' | 'high';
  likelihood: 'low' | 'med' | 'high';
}

export interface ProposalFactSheetCoverage {
  has_scope: boolean;
  has_timeline: boolean;
  has_kpis: boolean;
  has_constraints: boolean;
  has_risks: boolean;
}

export interface ProposalFactSheet {
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

export type ProposalDomainId = 'software' | 'investment' | 'supply' | 'services' | 'generic';

export type ProposalDomain = {
  id: ProposalDomainId;
  label: string;
};

export type StyleId = 'analytical' | 'direct' | 'collaborative';
export type Ordering = 'risks_first' | 'strengths_first' | 'balanced';
export type Verbosity = 'tight' | 'standard' | 'deep';

export interface ReportStyle {
  style_id: StyleId;
  ordering: Ordering;
  verbosity: Verbosity;
  seed: number;
}

export interface VertexEvaluationV2Telemetry {
  version: 'eval_v2';
  coverageCount: number;
  coverageFlags: {
    has_scope: boolean;
    has_timeline: boolean;
    has_kpis: boolean;
    has_constraints: boolean;
    has_risks: boolean;
  };
  clampsApplied: string[];
  identicalTiers: boolean;
  fit_level: string;
  confidence_0_1: number;
  missingCount: number;
  redactionsCount: number;
  sharedChars: number;
  confidentialChars: number;
  proposalChars: number;
  sharedChunkCount: number;
  confidentialChunkCount: number;
  reportStyle: {
    style_id: StyleId;
    ordering: Ordering;
    verbosity: Verbosity;
    seed: number;
  };
  timestampMs?: number;
}

export interface VertexEvaluationV2Internal {
  fact_sheet: ProposalFactSheet;
  coverage_count: number;
  caps_applied: string[];
  pass_a_parse_error: boolean;
  pass_b_attempt_count: number;
  report_style: ReportStyle;
  telemetry?: VertexEvaluationV2Telemetry;
  warnings?: string[];
  failure_kind?: string;
  fallback_mode?: FallbackMode;
  failure_details?: {
    provider_status?: number | null;
    provider_code?: string | null;
  };
  preflight?: {
    promptChars: number;
    estimatedPromptTokens: number;
    overCeiling: boolean;
    ceiling: number;
    trimTriggered: boolean;
  };
  models_used?: {
    provider?: 'vertex' | 'openai';
    generation: string;
    extract: string;
    verifier: string;
    verifier_escalated: boolean;
    verifier_used: boolean;
    verifier_unavailable: boolean;
  };
  refinement?: {
    attempted: boolean;
    applied: boolean;
    skip_reason?: string;
  };
  regeneration?: {
    triggered: boolean;
    reasons: string[];
    applied: boolean;
  };
  raw_quality_score?: number;
  quality_warnings?: string[];
  narrative_validation?: {
    valid: boolean;
    renderer_path: 'narrative' | 'fallback';
    warnings: string[];
    word_count?: number;
    paragraph_count?: number;
    section_count?: number;
  };
  runtime?: {
    total_elapsed_ms: number;
    model_elapsed_ms: number;
    model_call_count: number;
    quality_repair_call_count: number;
    budget_ms: number | null;
    budget_remaining_ms: number | null;
    budget_exhausted: boolean;
    phase_elapsed_ms: {
      fact_extraction: number;
      generation: number;
      verification: number;
      quality_repair: number;
    };
  };
  retrieval?: {
    retrieval_strategy: RetrievedMediationEvidencePacket['retrieval_strategy'];
    evidence_count: number;
    omitted_evidence_count: number;
    token_budget_used: number;
    character_budget_used: number;
    retrieval_warnings: string[];
  };
}

export interface VertexEvaluationV2Request<Stage extends ReviewStage = ReviewStage> {
  sharedText: string;
  confidentialText: string;
  analysisStage: Stage;
  requestId?: string;
  forbiddenLeakText?: string;
  forbiddenLeakCanaryTokens?: string[];
  enforceLeakGuard?: boolean;
  generationModel?: string;
  verifierModel?: string;
  extractModel?: string;
  convergenceDigestText?: string;
  mediationRoundContext?: MediationRoundContext;
  evidenceCandidates?: MediationEvidenceCandidate[];
  executionDeadlineMs?: number;
  maxQualityRepairCalls?: number;
}

export interface VertexEvaluationV2Result<Stage extends ReviewStage = ReviewStage> {
  ok: true;
  data: VertexEvaluationV2ResponseForStage<Stage>;
  attempt_count: number;
  model: string;
  generation_model?: string;
  _internal?: VertexEvaluationV2Internal;
  error?: undefined;
}

export interface VertexEvaluationV2Failure {
  ok: false;
  error: VertexEvaluationV2Error;
  attempt_count: number;
}

export type VertexEvaluationV2Outcome<Stage extends ReviewStage = ReviewStage> =
  | VertexEvaluationV2Result<Stage>
  | VertexEvaluationV2Failure;
