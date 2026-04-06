export const PRE_SEND_REVIEW_STAGE = 'pre_send_review';
export const STAGE1_SHARED_INTAKE_STAGE = 'stage1_shared_intake';
export const MEDIATION_REVIEW_STAGE = 'mediation_review';

const STAGE1_SOURCES = new Set([
  'document_comparison_stage1_intake',
  'proposal_stage1_intake',
]);

const PRE_SEND_SOURCES = new Set([
  'document_comparison_pre_send',
  'document_comparison_vertex',
  'proposal_vertex',
]);

const MEDIATION_SOURCES = new Set([
  'document_comparison_mediation',
  'shared_report_mediation',
  'shared_report_recipient',
]);

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

export function normalizeOpportunityReviewStage(value, fallback = '') {
  const normalized = asText(value).toLowerCase();
  if (
    normalized === STAGE1_SHARED_INTAKE_STAGE ||
    normalized === 'shared_intake_summary' ||
    normalized === 'shared_intake' ||
    normalized === 'submission_overview' ||
    normalized === 'intake_overview' ||
    normalized === 'discussion_setup' ||
    normalized === 'opportunity_overview'
  ) {
    return STAGE1_SHARED_INTAKE_STAGE;
  }
  if (
    normalized === PRE_SEND_REVIEW_STAGE ||
    normalized === 'pre-send_review' ||
    normalized === 'pre_send' ||
    normalized === 'draft_readiness_review' ||
    normalized === 'sender_side_review'
  ) {
    return PRE_SEND_REVIEW_STAGE;
  }
  if (
    normalized === MEDIATION_REVIEW_STAGE ||
    normalized === 'ai_mediation_review' ||
    normalized === 'bilateral_review'
  ) {
    return MEDIATION_REVIEW_STAGE;
  }

  const normalizedFallback = asText(fallback).toLowerCase();
  return normalizedFallback === MEDIATION_REVIEW_STAGE
    ? MEDIATION_REVIEW_STAGE
    : normalizedFallback === PRE_SEND_REVIEW_STAGE
      ? PRE_SEND_REVIEW_STAGE
      : '';
}

export function inferOpportunityReviewStageFromSource(source, fallback = '') {
  const normalized = asText(source).toLowerCase();
  if (STAGE1_SOURCES.has(normalized)) {
    return STAGE1_SHARED_INTAKE_STAGE;
  }
  if (PRE_SEND_SOURCES.has(normalized)) {
    return PRE_SEND_REVIEW_STAGE;
  }
  if (MEDIATION_SOURCES.has(normalized)) {
    return MEDIATION_REVIEW_STAGE;
  }
  return normalizeOpportunityReviewStage(fallback);
}

export function reportHasPreSendShape(report) {
  const safeReport = toObject(report);
  if (!safeReport) return false;
  return Boolean(
    asText(safeReport.readiness_status) ||
      asText(safeReport.send_readiness_summary) ||
      (Array.isArray(safeReport.missing_information) && safeReport.missing_information.length > 0) ||
      (Array.isArray(safeReport.ambiguous_terms) && safeReport.ambiguous_terms.length > 0) ||
      (Array.isArray(safeReport.likely_recipient_questions) &&
        safeReport.likely_recipient_questions.length > 0) ||
      (Array.isArray(safeReport.likely_pushback_areas) && safeReport.likely_pushback_areas.length > 0) ||
      (Array.isArray(safeReport.commercial_risks) && safeReport.commercial_risks.length > 0) ||
      (Array.isArray(safeReport.implementation_risks) &&
        safeReport.implementation_risks.length > 0) ||
      (Array.isArray(safeReport.suggested_clarifications) &&
        safeReport.suggested_clarifications.length > 0)
  );
}

export function reportHasStage1Shape(report) {
  const safeReport = toObject(report);
  if (!safeReport) return false;
  return Boolean(
    asText(safeReport.submission_summary) ||
      (Array.isArray(safeReport.scope_snapshot) && safeReport.scope_snapshot.length > 0) ||
      (Array.isArray(safeReport.unanswered_questions) && safeReport.unanswered_questions.length > 0) ||
      (Array.isArray(safeReport.other_side_needed) && safeReport.other_side_needed.length > 0) ||
      (Array.isArray(safeReport.discussion_starting_points) &&
        safeReport.discussion_starting_points.length > 0) ||
      asText(safeReport.intake_status) ||
      asText(safeReport.basis_note)
  );
}

export function reportHasMediationShape(report) {
  const safeReport = toObject(report);
  if (!safeReport) return false;
  return Boolean(
    (Array.isArray(safeReport.why) && safeReport.why.length > 0) ||
      safeReport.fit_level !== undefined ||
      safeReport.confidence_0_1 !== undefined ||
      (safeReport.negotiation_analysis &&
        typeof safeReport.negotiation_analysis === 'object' &&
        !Array.isArray(safeReport.negotiation_analysis))
  );
}

export function resolveOpportunityReviewStage(report, options = {}) {
  const safeReport = toObject(report);
  const directStage = normalizeOpportunityReviewStage(
    safeReport?.analysis_stage ||
      safeReport?.review_stage ||
      safeReport?.report_stage ||
      safeReport?.evaluation_mode ||
      safeReport?.review_mode ||
      options.analysisStage,
  );
  if (directStage) {
    return directStage;
  }

  const sourceStage = inferOpportunityReviewStageFromSource(options.source);
  if (sourceStage) {
    return sourceStage;
  }

  if (reportHasStage1Shape(safeReport)) {
    return STAGE1_SHARED_INTAKE_STAGE;
  }

  if (reportHasPreSendShape(safeReport)) {
    return PRE_SEND_REVIEW_STAGE;
  }

  if (options.hasRecipientContributions === true) {
    return MEDIATION_REVIEW_STAGE;
  }

  if (options.hasRecipientContributions === false && reportHasMediationShape(safeReport)) {
    return PRE_SEND_REVIEW_STAGE;
  }

  if (reportHasMediationShape(safeReport)) {
    return normalizeOpportunityReviewStage(options.fallbackStage, MEDIATION_REVIEW_STAGE);
  }

  return normalizeOpportunityReviewStage(options.fallbackStage, STAGE1_SHARED_INTAKE_STAGE);
}

export function isSharedIntakeReviewStage(stage) {
  return normalizeOpportunityReviewStage(stage) === STAGE1_SHARED_INTAKE_STAGE;
}

export function isLegacyPreSendReviewStage(stage) {
  return normalizeOpportunityReviewStage(stage) === PRE_SEND_REVIEW_STAGE;
}

export function isPreSendReviewStage(stage) {
  const normalized = normalizeOpportunityReviewStage(stage);
  return normalized === PRE_SEND_REVIEW_STAGE || normalized === STAGE1_SHARED_INTAKE_STAGE;
}

export function isMediationReviewStage(stage) {
  return normalizeOpportunityReviewStage(stage, MEDIATION_REVIEW_STAGE) === MEDIATION_REVIEW_STAGE;
}
