import { normalizeOpportunityReviewStage } from '../../src/lib/opportunityReviewStage.js';
import type { MediationMovementDirection } from './mediation-progress.js';
import {
  MEDIATION_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
  PRE_SEND_STAGE,
  type CoercedSchemaCandidate,
  type CompatibilityAssessment,
  type DealbreakerBasis,
  type FitLevel,
  type MediationReviewStage,
  type NegotiationAnalysis,
  type NegotiationDealbreaker,
  type NegotiationPartyAnalysis,
  type PreSendReadinessStatus,
  type PreSendReviewStage,
  type SharedIntakeStatus,
  type Stage1SharedIntakeStage,
  type ReviewStage,
  type SchemaValidationResult,
  type VertexEvaluationV2MediationResponse,
  type VertexEvaluationV2Stage1SharedIntakeResponse,
  type VertexEvaluationV2PreSendResponse,
} from './vertex-evaluation-v2-types.js';

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

function normalizeKeywordText(value: string) {
  return asLower(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readObjectTextLike(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const text = asText(record[key]);
    if (text) {
      return text;
    }
  }
  return '';
}

function readEntryTextLike(entry: unknown) {
  if (typeof entry === 'string') {
    return asText(entry);
  }
  const record = toObjectRecord(entry);
  if (!record) {
    return '';
  }
  return readObjectTextLike(record, ['text', 'title', 'description']);
}

function ensureStringArrayField(entry: unknown, field: string, invalidFields: string[]) {
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
}

export function normalizeReadinessStatus(value: unknown): PreSendReadinessStatus {
  const normalized = normalizeKeywordText(asText(value));
  if (normalized === 'ready to send' || normalized === 'ready to share') {
    return 'ready_to_send';
  }
  if (
    normalized === 'ready with clarifications' ||
    normalized === 'tighten before sending' ||
    normalized === 'tighten before sharing'
  ) {
    return 'ready_with_clarifications';
  }
  return 'not_ready_to_send';
}

export function normalizeSharedIntakeStatus(value: unknown): SharedIntakeStatus {
  const normalized = normalizeKeywordText(asText(value));
  if (
    normalized === 'awaiting other side input' ||
    normalized === 'awaiting other side' ||
    normalized === 'awaiting counterpart input' ||
    normalized === 'awaiting response'
  ) {
    return 'awaiting_other_side_input';
  }
  return 'awaiting_other_side_input';
}

export function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => readEntryTextLike(entry))
    .filter(Boolean);
}

export function normalizeCanaryTokens(value: unknown) {
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

function normalizeMovementDirection(value: unknown): MediationMovementDirection | undefined {
  const normalized = asLower(value);
  if (normalized === 'converging' || normalized === 'stalled' || normalized === 'diverging') {
    return normalized;
  }
  return undefined;
}

function normalizeProgressStringArray(value: unknown, maxItems = 6) {
  return normalizeNegotiationStringArray(value, maxItems);
}

function normalizeNegotiationStringArray(value: unknown, maxItems = 8) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const normalized: string[] = [];
  value.forEach((entry) => {
    const text = readEntryTextLike(entry);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    normalized.push(text);
  });
  return normalized.slice(0, maxItems);
}

function normalizeDealbreakerBasis(value: unknown): DealbreakerBasis {
  const normalized = normalizeKeywordText(asText(value));
  if (normalized === 'stated') return 'stated';
  if (normalized === 'strongly implied') return 'strongly_implied';
  if (normalized === 'not clearly established') return 'not_clearly_established';
  return 'not_clearly_established';
}

function normalizeNegotiationDealbreakers(value: unknown, maxItems = 6) {
  if (!Array.isArray(value)) return [] as NegotiationDealbreaker[];
  const seen = new Set<string>();
  const normalized: NegotiationDealbreaker[] = [];
  value.forEach((entry) => {
    const text = readEntryTextLike(entry);
    if (!text) return;

    const record = toObjectRecord(entry);
    const basis = record
      ? normalizeDealbreakerBasis(readObjectTextLike(record, ['basis', 'status', 'support']))
      : 'not_clearly_established';
    const key = `${text.toLowerCase()}::${basis}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ text, basis });
  });
  return normalized.slice(0, maxItems);
}

function normalizeNegotiationParty(value: unknown): NegotiationPartyAnalysis {
  const raw = toObjectRecord(value) || {};
  return {
    demands: normalizeNegotiationStringArray(raw.demands || raw.required_outcomes || raw.key_demands),
    priorities: normalizeNegotiationStringArray(raw.priorities),
    dealbreakers: normalizeNegotiationDealbreakers(raw.dealbreakers || raw.non_negotiables),
    flexibility: normalizeNegotiationStringArray(raw.flexibility || raw.possible_movement),
  };
}

function hasSupportedFundamentalConflict(params: {
  proposing_party: NegotiationPartyAnalysis;
  counterparty: NegotiationPartyAnalysis;
  compatibility_rationale: string;
  critical_incompatibilities: string[];
}) {
  const supportedDealbreakers = [
    ...params.proposing_party.dealbreakers,
    ...params.counterparty.dealbreakers,
  ].filter((entry) => entry.basis !== 'not_clearly_established');
  if (params.critical_incompatibilities.length > 0) {
    return true;
  }
  if (supportedDealbreakers.length >= 2) {
    return true;
  }
  const conflictText = [params.compatibility_rationale, ...params.critical_incompatibilities].join(' ');
  return supportedDealbreakers.length >= 1 &&
    /\b(fundamental(?:ly)? incompatible|irreconcilable|mutually exclusive|cannot both|cannot be reconciled|no realistic path|won't accept|will not accept|non-negotiable|dealbreaker|direct conflict|critical point)\b/i
      .test(conflictText);
}

function normalizeCompatibilityAssessment(value: unknown): CompatibilityAssessment | null {
  const normalized = normalizeKeywordText(asText(value));
  if (normalized === 'broadly compatible') return 'broadly_compatible';
  if (normalized === 'compatible with adjustments') return 'compatible_with_adjustments';
  if (
    normalized === 'uncertain due to missing information' ||
    normalized === 'uncertain due to missing info' ||
    normalized === 'uncertain'
  ) {
    return 'uncertain_due_to_missing_information';
  }
  if (normalized === 'fundamentally incompatible') return 'fundamentally_incompatible';
  return null;
}

function normalizeNegotiationAnalysis(value: unknown): NegotiationAnalysis | undefined {
  const raw = toObjectRecord(value) || {};
  const proposing_party = normalizeNegotiationParty(
    raw.proposing_party || raw.party_a || raw.originating_party || raw.requester_side,
  );
  const counterparty = normalizeNegotiationParty(
    raw.counterparty || raw.party_b || raw.other_party || raw.recipient_side,
  );
  let compatibility_assessment = normalizeCompatibilityAssessment(raw.compatibility_assessment || raw.compatibility);
  let compatibility_rationale = asText(raw.compatibility_rationale || raw.compatibility_summary);
  const bridgeability_notes = normalizeNegotiationStringArray(
    raw.bridgeability_notes || raw.bridgeability || raw.bridgeability_actions,
  );
  const critical_incompatibilities = normalizeNegotiationStringArray(
    raw.critical_incompatibilities || raw.blocking_points,
  );

  if (
    compatibility_assessment === 'fundamentally_incompatible' &&
    !hasSupportedFundamentalConflict({
      proposing_party,
      counterparty,
      compatibility_rationale,
      critical_incompatibilities,
    })
  ) {
    compatibility_assessment = 'uncertain_due_to_missing_information';
    if (!/\b(missing|unclear|uncertain|clarif|cannot assess|not yet clear)\b/i.test(compatibility_rationale)) {
      compatibility_rationale =
        'Compatibility is not yet clear from the current materials and likely requires clarification before incompatibility can be assessed confidently.';
    }
  }

  const hasAnyContent =
    compatibility_assessment !== null ||
    Boolean(compatibility_rationale) ||
    bridgeability_notes.length > 0 ||
    critical_incompatibilities.length > 0 ||
    proposing_party.demands.length > 0 ||
    proposing_party.priorities.length > 0 ||
    proposing_party.dealbreakers.length > 0 ||
    proposing_party.flexibility.length > 0 ||
    counterparty.demands.length > 0 ||
    counterparty.priorities.length > 0 ||
    counterparty.dealbreakers.length > 0 ||
    counterparty.flexibility.length > 0;

  if (!hasAnyContent) {
    return undefined;
  }

  return {
    proposing_party,
    counterparty,
    compatibility_assessment,
    compatibility_rationale,
    bridgeability_notes,
    critical_incompatibilities,
  };
}

export function validateMediationResponseSchema(
  value: unknown,
): SchemaValidationResult<MediationReviewStage> {
  const raw = toObjectRecord(value);
  if (!raw) {
    return {
      ok: false,
      missingKeys: ['analysis_stage', 'fit_level', 'confidence_0_1', 'why', 'missing', 'redactions'],
      invalidFields: ['root_not_object', 'analysis_stage'],
    };
  }

  const requiredKeys = ['analysis_stage', 'fit_level', 'confidence_0_1', 'why', 'missing', 'redactions'] as const;
  const missingKeys = requiredKeys.filter((key) => raw[key] === undefined);
  const invalidFields: string[] = [];
  const analysisStage = normalizeOpportunityReviewStage(raw.analysis_stage);
  if (analysisStage !== MEDIATION_STAGE) {
    invalidFields.push('analysis_stage');
  }

  const fit = asLower(raw.fit_level);
  if (!['high', 'medium', 'low', 'unknown'].includes(fit)) {
    invalidFields.push('fit_level');
  }

  const confidence = Number(raw.confidence_0_1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    invalidFields.push('confidence_0_1');
  }

  const why = ensureStringArrayField(raw.why, 'why', invalidFields);
  const missing = ensureStringArrayField(raw.missing, 'missing', invalidFields);
  const redactions = ensureStringArrayField(raw.redactions, 'redactions', invalidFields);
  const negotiationAnalysis = normalizeNegotiationAnalysis(
    raw.negotiation_analysis !== undefined
      ? raw.negotiation_analysis
      : (
          raw.party_a_demands !== undefined ||
          raw.party_a_priorities !== undefined ||
          raw.party_a_dealbreakers !== undefined ||
          raw.party_a_flexibility !== undefined ||
          raw.party_b_demands !== undefined ||
          raw.party_b_priorities !== undefined ||
          raw.party_b_dealbreakers !== undefined ||
          raw.party_b_flexibility !== undefined ||
          raw.compatibility_assessment !== undefined ||
          raw.compatibility_rationale !== undefined ||
          raw.bridgeability_notes !== undefined ||
          raw.critical_incompatibilities !== undefined
        )
        ? {
            proposing_party: {
              demands: raw.party_a_demands,
              priorities: raw.party_a_priorities,
              dealbreakers: raw.party_a_dealbreakers,
              flexibility: raw.party_a_flexibility,
            },
            counterparty: {
              demands: raw.party_b_demands,
              priorities: raw.party_b_priorities,
              dealbreakers: raw.party_b_dealbreakers,
              flexibility: raw.party_b_flexibility,
            },
            compatibility_assessment: raw.compatibility_assessment,
            compatibility_rationale: raw.compatibility_rationale,
            bridgeability_notes: raw.bridgeability_notes,
            critical_incompatibilities: raw.critical_incompatibilities,
          }
        : undefined,
  );
  const movementDirection = normalizeMovementDirection(raw.movement_direction);
  if (raw.movement_direction !== undefined && !movementDirection) {
    invalidFields.push('movement_direction');
  }
  const deltaSummary = asText(raw.delta_summary);
  const resolvedSinceLastRound = normalizeProgressStringArray(raw.resolved_since_last_round, 4);
  const remainingDeltas = normalizeProgressStringArray(raw.remaining_deltas, 6);
  const newOpenIssues = normalizeProgressStringArray(raw.new_open_issues, 4);

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
      analysis_stage: MEDIATION_STAGE,
      fit_level: fit as FitLevel,
      confidence_0_1: clamp01(confidence),
      why,
      missing,
      redactions,
      ...(negotiationAnalysis ? { negotiation_analysis: negotiationAnalysis } : {}),
      ...(deltaSummary ? { delta_summary: deltaSummary } : {}),
      ...(resolvedSinceLastRound.length > 0 ? { resolved_since_last_round: resolvedSinceLastRound } : {}),
      ...(remainingDeltas.length > 0 ? { remaining_deltas: remainingDeltas } : {}),
      ...(newOpenIssues.length > 0 ? { new_open_issues: newOpenIssues } : {}),
      ...(movementDirection ? { movement_direction: movementDirection } : {}),
    },
  };
}

export function validateStage1SharedIntakeResponseSchema(
  value: unknown,
): SchemaValidationResult<Stage1SharedIntakeStage> {
  const raw = toObjectRecord(value);
  if (!raw) {
    return {
      ok: false,
      missingKeys: [
        'analysis_stage',
        'submission_summary',
        'scope_snapshot',
        'unanswered_questions',
        'other_side_needed',
        'discussion_starting_points',
        'intake_status',
        'basis_note',
      ],
      invalidFields: ['root_not_object', 'analysis_stage'],
    };
  }

  const requiredKeys = [
    'analysis_stage',
    'submission_summary',
    'scope_snapshot',
    'unanswered_questions',
    'other_side_needed',
    'discussion_starting_points',
    'intake_status',
    'basis_note',
  ] as const;
  const missingKeys = requiredKeys.filter((key) => raw[key] === undefined);
  const invalidFields: string[] = [];
  const analysisStage = normalizeOpportunityReviewStage(raw.analysis_stage);
  if (analysisStage !== STAGE1_SHARED_INTAKE_STAGE) {
    invalidFields.push('analysis_stage');
  }

  const submissionSummary = asText(raw.submission_summary || raw.summary || raw.executive_summary);
  if (!submissionSummary) {
    invalidFields.push('submission_summary');
  }

  const basisNote = asText(raw.basis_note || raw.disclaimer || raw.scope_note);
  if (!basisNote) {
    invalidFields.push('basis_note');
  }

  const scope_snapshot = ensureStringArrayField(
    raw.scope_snapshot ?? raw.scope ?? raw.scope_points,
    'scope_snapshot',
    invalidFields,
  );
  const unanswered_questions = ensureStringArrayField(
    raw.unanswered_questions ?? raw.still_unanswered ?? raw.open_questions ?? raw.missing,
    'unanswered_questions',
    invalidFields,
  );
  const other_side_needed = ensureStringArrayField(
    raw.other_side_needed ?? raw.clarifications_needed ?? raw.other_side_materials,
    'other_side_needed',
    invalidFields,
  );
  const discussion_starting_points = ensureStringArrayField(
    raw.discussion_starting_points ?? raw.discussion_points ?? raw.starting_points ?? raw.next_actions,
    'discussion_starting_points',
    invalidFields,
  );

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
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary: submissionSummary,
      scope_snapshot,
      unanswered_questions,
      other_side_needed,
      discussion_starting_points,
      intake_status: normalizeSharedIntakeStatus(raw.intake_status),
      basis_note: basisNote,
    },
  };
}

export function validatePreSendResponseSchema(
  value: unknown,
): SchemaValidationResult<PreSendReviewStage> {
  const raw = toObjectRecord(value);
  if (!raw) {
    return {
      ok: false,
      missingKeys: [
        'analysis_stage',
        'readiness_status',
        'send_readiness_summary',
        'missing_information',
        'ambiguous_terms',
        'likely_recipient_questions',
        'likely_pushback_areas',
        'commercial_risks',
        'implementation_risks',
        'suggested_clarifications',
      ],
      invalidFields: ['root_not_object', 'analysis_stage'],
    };
  }

  const requiredKeys = [
    'analysis_stage',
    'readiness_status',
    'send_readiness_summary',
    'missing_information',
    'ambiguous_terms',
    'likely_recipient_questions',
    'likely_pushback_areas',
    'commercial_risks',
    'implementation_risks',
    'suggested_clarifications',
  ] as const;
  const missingKeys = requiredKeys.filter((key) => raw[key] === undefined);
  const invalidFields: string[] = [];
  const analysisStage = normalizeOpportunityReviewStage(raw.analysis_stage);
  if (analysisStage !== PRE_SEND_STAGE) {
    invalidFields.push('analysis_stage');
  }

  const sendReadinessSummary = asText(raw.send_readiness_summary || raw.summary);
  if (!sendReadinessSummary) {
    invalidFields.push('send_readiness_summary');
  }

  const missing_information = ensureStringArrayField(
    raw.missing_information ?? raw.missing,
    'missing_information',
    invalidFields,
  );
  const ambiguous_terms = ensureStringArrayField(raw.ambiguous_terms, 'ambiguous_terms', invalidFields);
  const likely_recipient_questions = ensureStringArrayField(
    raw.likely_recipient_questions ?? raw.recipient_questions,
    'likely_recipient_questions',
    invalidFields,
  );
  const likely_pushback_areas = ensureStringArrayField(
    raw.likely_pushback_areas ?? raw.pushback_areas,
    'likely_pushback_areas',
    invalidFields,
  );
  const commercial_risks = ensureStringArrayField(raw.commercial_risks, 'commercial_risks', invalidFields);
  const implementation_risks = ensureStringArrayField(
    raw.implementation_risks,
    'implementation_risks',
    invalidFields,
  );
  const suggested_clarifications = ensureStringArrayField(
    raw.suggested_clarifications,
    'suggested_clarifications',
    invalidFields,
  );

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
      analysis_stage: PRE_SEND_STAGE,
      readiness_status: normalizeReadinessStatus(raw.readiness_status),
      send_readiness_summary: sendReadinessSummary,
      missing_information,
      ambiguous_terms,
      likely_recipient_questions,
      likely_pushback_areas,
      commercial_risks,
      implementation_risks,
      suggested_clarifications,
    },
  };
}

export function validateResponseSchema(
  value: unknown,
  stage: Stage1SharedIntakeStage,
): SchemaValidationResult<Stage1SharedIntakeStage>;
export function validateResponseSchema(
  value: unknown,
  stage: PreSendReviewStage,
): SchemaValidationResult<PreSendReviewStage>;
export function validateResponseSchema(
  value: unknown,
  stage: MediationReviewStage,
): SchemaValidationResult<MediationReviewStage>;
export function validateResponseSchema(
  value: unknown,
  stage: ReviewStage,
): SchemaValidationResult;
export function validateResponseSchema(value: unknown, stage: ReviewStage): SchemaValidationResult {
  if (stage === STAGE1_SHARED_INTAKE_STAGE) {
    return validateStage1SharedIntakeResponseSchema(value);
  }
  return stage === PRE_SEND_STAGE
    ? validatePreSendResponseSchema(value)
    : validateMediationResponseSchema(value);
}

export function coerceToSmallSchema(
  value: unknown,
  stage: Stage1SharedIntakeStage,
): CoercedSchemaCandidate<Stage1SharedIntakeStage>;
export function coerceToSmallSchema(
  value: unknown,
  stage: PreSendReviewStage,
): CoercedSchemaCandidate<PreSendReviewStage>;
export function coerceToSmallSchema(
  value: unknown,
  stage: MediationReviewStage,
): CoercedSchemaCandidate<MediationReviewStage>;
export function coerceToSmallSchema(
  value: unknown,
  stage: ReviewStage,
): CoercedSchemaCandidate;
export function coerceToSmallSchema(
  value: unknown,
  stage: ReviewStage,
): CoercedSchemaCandidate {
  const raw = toObjectRecord(value);
  if (!raw) {
    return { candidate: value, coerced: false };
  }

  if (stage === STAGE1_SHARED_INTAKE_STAGE) {
    const hasCanonicalStage1Shape =
      raw.analysis_stage === STAGE1_SHARED_INTAKE_STAGE &&
      raw.submission_summary !== undefined &&
      raw.scope_snapshot !== undefined &&
      raw.unanswered_questions !== undefined &&
      raw.other_side_needed !== undefined &&
      raw.discussion_starting_points !== undefined &&
      raw.intake_status !== undefined &&
      raw.basis_note !== undefined;
    if (hasCanonicalStage1Shape) {
      return { candidate: value, coerced: false };
    }

    const synthetic: VertexEvaluationV2Stage1SharedIntakeResponse = {
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary: asText(raw.submission_summary || raw.summary || raw.executive_summary),
      scope_snapshot: toStringArray(raw.scope_snapshot ?? raw.scope ?? raw.scope_points ?? raw.in_scope),
      unanswered_questions: toStringArray(
        raw.unanswered_questions ?? raw.still_unanswered ?? raw.open_questions ?? raw.missing ?? raw.missing_information,
      ),
      other_side_needed: toStringArray(
        raw.other_side_needed ??
          raw.clarifications_needed ??
          raw.other_side_materials ??
          raw.suggested_clarifications,
      ),
      discussion_starting_points: toStringArray(
        raw.discussion_starting_points ?? raw.discussion_points ?? raw.starting_points ?? raw.next_actions,
      ),
      intake_status: normalizeSharedIntakeStatus(raw.intake_status ?? raw.status),
      basis_note: asText(
        raw.basis_note ||
          raw.disclaimer ||
          raw.scope_note ||
          'Based only on the currently submitted materials. A fuller bilateral mediation analysis becomes possible once the other side responds.',
      ),
    };
    return { candidate: synthetic, coerced: true };
  }

  if (stage === PRE_SEND_STAGE) {
    const hasCanonicalPreSendShape =
      raw.analysis_stage === PRE_SEND_STAGE &&
      raw.readiness_status !== undefined &&
      raw.send_readiness_summary !== undefined &&
      raw.missing_information !== undefined &&
      raw.ambiguous_terms !== undefined &&
      raw.likely_recipient_questions !== undefined &&
      raw.likely_pushback_areas !== undefined &&
      raw.commercial_risks !== undefined &&
      raw.implementation_risks !== undefined &&
      raw.suggested_clarifications !== undefined;
    if (hasCanonicalPreSendShape) {
      return { candidate: value, coerced: false };
    }

    const why = toStringArray(raw.why);
    const synthetic: VertexEvaluationV2PreSendResponse = {
      analysis_stage: PRE_SEND_STAGE,
      readiness_status: normalizeReadinessStatus(raw.readiness_status ?? raw.status ?? raw.readiness),
      send_readiness_summary: asText(raw.send_readiness_summary || raw.summary || why[0]),
      missing_information: toStringArray(raw.missing_information ?? raw.missing),
      ambiguous_terms: toStringArray(raw.ambiguous_terms ?? raw.ambiguities),
      likely_recipient_questions: toStringArray(
        raw.likely_recipient_questions ?? raw.recipient_questions ?? raw.questions,
      ),
      likely_pushback_areas: toStringArray(raw.likely_pushback_areas ?? raw.pushback_areas ?? raw.pushback),
      commercial_risks: toStringArray(raw.commercial_risks ?? raw.commercial_flags),
      implementation_risks: toStringArray(raw.implementation_risks ?? raw.implementation_flags),
      suggested_clarifications: toStringArray(
        raw.suggested_clarifications ?? raw.next_actions ?? raw.clarifications,
      ),
    };
    return { candidate: synthetic, coerced: true };
  }

  const hasCanonicalMediationShape =
    raw.analysis_stage === MEDIATION_STAGE &&
    raw.fit_level !== undefined &&
    raw.confidence_0_1 !== undefined &&
    raw.why !== undefined &&
    raw.missing !== undefined &&
    raw.redactions !== undefined;
  if (hasCanonicalMediationShape) {
    return { candidate: value, coerced: false };
  }

  const summary = toObjectRecord(raw.summary) || {};
  const quality = toObjectRecord(raw.quality) || {};
  const flags = Array.isArray(raw.flags) ? raw.flags : [];
  const redactedFlags = flags
    .map((entry) => toObjectRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => asLower(entry.detail_level) === 'redacted')
    .map((entry) => readObjectTextLike(entry, ['title', 'type', 'detail']))
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
  const syntheticNegotiationAnalysis = raw.negotiation_analysis !== undefined
    ? raw.negotiation_analysis
    : (
        raw.party_a_demands !== undefined ||
        raw.party_a_priorities !== undefined ||
        raw.party_a_dealbreakers !== undefined ||
        raw.party_a_flexibility !== undefined ||
        raw.party_b_demands !== undefined ||
        raw.party_b_priorities !== undefined ||
        raw.party_b_dealbreakers !== undefined ||
        raw.party_b_flexibility !== undefined ||
        raw.compatibility_assessment !== undefined ||
        raw.compatibility_rationale !== undefined ||
        raw.bridgeability_notes !== undefined ||
        raw.critical_incompatibilities !== undefined
      )
      ? {
          proposing_party: {
            demands: raw.party_a_demands,
            priorities: raw.party_a_priorities,
            dealbreakers: raw.party_a_dealbreakers,
            flexibility: raw.party_a_flexibility,
          },
          counterparty: {
            demands: raw.party_b_demands,
            priorities: raw.party_b_priorities,
            dealbreakers: raw.party_b_dealbreakers,
            flexibility: raw.party_b_flexibility,
          },
          compatibility_assessment: raw.compatibility_assessment,
          compatibility_rationale: raw.compatibility_rationale,
          bridgeability_notes: raw.bridgeability_notes,
          critical_incompatibilities: raw.critical_incompatibilities,
        }
      : undefined;
  const negotiationAnalysis = normalizeNegotiationAnalysis(syntheticNegotiationAnalysis);
  const movementDirection = normalizeMovementDirection(raw.movement_direction);
  const deltaSummary = asText(raw.delta_summary);
  const resolvedSinceLastRound = normalizeProgressStringArray(raw.resolved_since_last_round, 4);
  const remainingDeltas = normalizeProgressStringArray(raw.remaining_deltas, 6);
  const newOpenIssues = normalizeProgressStringArray(raw.new_open_issues, 4);

  const synthetic: VertexEvaluationV2MediationResponse = {
    analysis_stage: MEDIATION_STAGE,
    fit_level: normalizeFitLevel(raw.fit_level ?? summary.fit_level ?? raw.answer),
    confidence_0_1: normalizeConfidence(raw.confidence_0_1 ?? quality.confidence_overall ?? raw.confidence),
    why,
    missing,
    redactions,
    ...(negotiationAnalysis ? { negotiation_analysis: negotiationAnalysis } : {}),
    ...(deltaSummary ? { delta_summary: deltaSummary } : {}),
    ...(resolvedSinceLastRound.length > 0 ? { resolved_since_last_round: resolvedSinceLastRound } : {}),
    ...(remainingDeltas.length > 0 ? { remaining_deltas: remainingDeltas } : {}),
    ...(newOpenIssues.length > 0 ? { new_open_issues: newOpenIssues } : {}),
    ...(movementDirection ? { movement_direction: movementDirection } : {}),
  };
  return { candidate: synthetic, coerced: true };
}
