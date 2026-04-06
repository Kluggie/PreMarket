import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { hasMeaningfulRecipientContribution } from '../../../_lib/meaningful-recipient-contribution.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { resolveLatestActiveSharedReportLink } from '../../../_lib/proposal-agreement-request-emails.js';
import { buildProposalHistoryQueries } from '../../../_lib/proposal-history.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  buildDraftContributionEntries,
  formatContributionsForAi,
  HISTORY_AUTHOR_PROPOSER,
  HISTORY_AUTHOR_RECIPIENT,
  loadSharedReportHistory,
} from '../../../_lib/shared-report-history.js';
import {
  evaluateDocumentComparisonWithVertex,
  evaluateProposalWithVertex,
} from '../../../_lib/vertex-evaluation.js';
import { evaluateWithVertexV2 } from '../../../_lib/vertex-evaluation-v2.js';
import {
  buildMediationRoundContext,
  extractMediationReport,
  type MediationRoundContext,
} from '../../../_lib/mediation-progress.js';
import { selectRelevantDocuments } from '../../../_lib/user-documents-context.js';
import { assertStarterAiEvaluationAllowed } from '../../../_lib/starter-entitlements.js';
import { buildStoredV2Evaluation } from '../../document-comparisons/_helpers.js';
import {
  buildSharedReportHref,
  buildLegacyOpportunityNotificationHref,
  buildNotificationTargetMetadata,
} from '../../../../src/lib/notificationTargets.js';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
} from '../../../../src/lib/opportunityReviewStage.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
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
  if (runtimeEnv === 'production') {
    return 'v2';
  }
  return 'v1';
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseValue(rawValue: string | null) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function normalizeParty(value: unknown): 'a' | 'b' {
  return asText(value).toLowerCase() === 'b' ? 'b' : 'a';
}

function normalizeVisibility(value: unknown): 'full' | 'partial' | 'hidden' {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'hidden') return 'hidden';
  if (normalized === 'partial') return 'partial';
  return 'full';
}

function normalizeUpdatedBy(value: unknown): 'proposer' | 'recipient' | 'system' {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'recipient') return 'recipient';
  if (normalized === 'system') return 'system';
  return 'proposer';
}

function normalizeVerifiedStatus(value: unknown):
  | 'self_declared'
  | 'evidence_attached'
  | 'tier1_verified'
  | 'disputed'
  | 'unknown' {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'evidence_attached' || normalized === 'evidence') return 'evidence_attached';
  if (normalized === 'tier1_verified' || normalized === 'verified') return 'tier1_verified';
  if (normalized === 'disputed') return 'disputed';
  if (normalized === 'unknown') return 'unknown';
  return 'self_declared';
}

function toObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function normalizeQuestionParty(question: any, responseRow: any): 'a' | 'b' {
  const metadata = toObject(question?.metadata);
  const metadataParty = asText(metadata.party || metadata.to_party || metadata.owner_party).toLowerCase();
  if (metadataParty === 'b' || metadataParty === 'recipient' || metadataParty === 'party_b') {
    return 'b';
  }

  if (responseRow?.enteredByParty) {
    return normalizeParty(responseRow.enteredByParty);
  }

  return 'a';
}

function buildProposalInput(proposal: any, template: any, templateQuestions: any[], responses: any[]) {
  const responseMap = new Map<string, any>();
  responses.forEach((row) => {
    const questionId = asText(row.questionId);
    if (!questionId) return;
    if (!responseMap.has(questionId)) {
      responseMap.set(questionId, row);
    }
  });

  const knownQuestionIds = new Set<string>();
  const normalizedResponses = templateQuestions
    .map((question) => {
      const questionId = asText(question.questionKey || question.id);
      if (!questionId) {
        return null;
      }
      knownQuestionIds.add(questionId);

      const responseRow = responseMap.get(questionId) || null;
      const metadata = toObject(question?.metadata);

      return {
        questionId,
        label: asText(question.label) || questionId,
        party: normalizeQuestionParty(question, responseRow),
        required: Boolean(question.required),
        value: responseRow ? parseValue(responseRow.value) : null,
        valueType: asText(responseRow?.valueType || question.valueType || metadata.value_type) || 'text',
        rangeMin: responseRow?.rangeMin || null,
        rangeMax: responseRow?.rangeMax || null,
        visibility: normalizeVisibility(responseRow?.visibility || question.visibilityDefault || metadata.visibility),
        updatedBy: responseRow
          ? normalizeUpdatedBy(responseRow.enteredByParty === 'b' ? 'recipient' : 'proposer')
          : 'system',
        verifiedStatus: responseRow
          ? normalizeVerifiedStatus(responseRow.claimType || metadata.verified_status)
          : 'unknown',
        moduleKey: asText(metadata.module_key || metadata.moduleKey || question.sectionId) || null,
        sectionId: asText(question.sectionId) || null,
      };
    })
    .filter(Boolean);

  responses.forEach((row) => {
    const questionId = asText(row.questionId);
    if (!questionId || knownQuestionIds.has(questionId)) {
      return;
    }

    normalizedResponses.push({
      questionId,
      label: questionId,
      party: normalizeParty(row.enteredByParty),
      required: false,
      value: parseValue(row.value),
      valueType: asText(row.valueType) || 'text',
      rangeMin: row.rangeMin || null,
      rangeMax: row.rangeMax || null,
      visibility: normalizeVisibility(row.visibility),
      updatedBy: normalizeUpdatedBy(row.enteredByParty === 'b' ? 'recipient' : 'proposer'),
      verifiedStatus: normalizeVerifiedStatus(row.claimType),
      moduleKey: asText(row.sectionId) || null,
      sectionId: asText(row.sectionId) || null,
    });
  });

  return {
    templateId: asText(template?.id || proposal.templateId) || 'template_unknown',
    templateName: asText(template?.name || proposal.templateName) || 'Proposal Template',
    partyALabel: asText(template?.partyALabel || proposal.partyAEmail || 'Party A') || 'Party A',
    partyBLabel: asText(template?.partyBLabel || proposal.partyBEmail || 'Party B') || 'Party B',
    responses: normalizedResponses,
    rubric: toObject(template?.metadata).evaluation_rubric_json || null,
    computedSignals: null,
  };
}

function buildProposalResultFromEvaluation(proposal: any, evaluation: any, extras: Record<string, unknown> = {}) {
  const provider = asText(evaluation?.provider) || 'unknown';
  const model = asText(evaluation?.model) || null;
  const evaluationProvider = asLower(evaluation?.evaluation_provider || provider) === 'vertex' ? 'vertex' : 'fallback';
  const evaluationProviderReason =
    evaluationProvider === 'fallback'
      ? asText(evaluation?.evaluation_provider_reason || evaluation?.fallbackReason) ||
        (asLower(provider) === 'mock' ? 'vertex_mock_enabled' : 'provider_not_vertex')
      : null;
  return {
    score: evaluation.score,
    recommendation: evaluation.recommendation,
    generated_at: evaluation.generatedAt,
    summary: evaluation.summary,
    stats: {
      proposal_type: proposal.proposalType || 'standard',
      ...extras,
    },
    quality: evaluation.report?.quality || {},
    sections: Array.isArray(evaluation?.report?.sections) ? evaluation.report.sections : [],
    report: evaluation.report || {},
    provider,
    model,
    evaluation_provider: evaluationProvider,
    evaluation_provider_model: model,
    evaluation_provider_version: model,
    evaluation_provider_reason: evaluationProviderReason,
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      template_name: proposal.templateName,
      party_a_email: proposal.partyAEmail,
      party_b_email: proposal.partyBEmail,
    },
  };
}

function convertV2ResponseToEvaluation(
  v2Result: any,
  options: {
    mediationRoundContext?: MediationRoundContext;
  } = {},
): Record<string, unknown> {
  return buildStoredV2Evaluation(v2Result, options);
}

async function loadPriorBilateralRoundContext(params: {
  db: any;
  proposalId: string;
  userId: string;
}) {
  const rows = await params.db
    .select({
      id: schema.proposalEvaluations.id,
      result: schema.proposalEvaluations.result,
    })
    .from(schema.proposalEvaluations)
    .where(
      and(
        eq(schema.proposalEvaluations.proposalId, params.proposalId),
        eq(schema.proposalEvaluations.userId, params.userId),
        eq(schema.proposalEvaluations.status, 'completed'),
        or(
          eq(schema.proposalEvaluations.source, 'document_comparison_mediation'),
          eq(schema.proposalEvaluations.source, 'shared_report_mediation'),
        ),
      ),
    )
    .orderBy(desc(schema.proposalEvaluations.createdAt));

  const priorRows = rows
    .map((row: any) => ({
      id: asText(row?.id),
      report: extractMediationReport(row?.result),
    }))
    .filter((row) => row.id && row.report);

  return buildMediationRoundContext({
    bilateralRoundNumber: priorRows.length + 1,
    priorBilateralRoundId: priorRows[0]?.id || null,
    priorReport: priorRows[0]?.report || null,
  });
}

function buildStageFallbackV2Data(analysisStage: string, reason: 'unexpected_error' | 'unavailable') {
  if (analysisStage === STAGE1_SHARED_INTAKE_STAGE) {
    return {
      analysis_stage: STAGE1_SHARED_INTAKE_STAGE,
      submission_summary:
        reason === 'unexpected_error'
          ? 'The Shared Intake Summary could not be generated due to an unexpected internal error.'
          : 'The Shared Intake Summary could not be generated because the model output was unavailable or invalid.',
      scope_snapshot: [
        'The current submission has been received, but a fuller intake summary could not be assembled from the current run.',
      ],
      unanswered_questions: [
        'What is the confirmed scope and set of deliverables?',
        'What assumptions should be made explicit in the current submission?',
        'What timeline, ownership, or approval detail still needs clarification?',
      ],
      other_side_needed: [
        'The responding side’s priorities, constraints, and any corrections or additions to the current submission.',
      ],
      discussion_starting_points: [
        'Confirm what has been submitted so far and what still needs to be added before bilateral mediation.',
      ],
      intake_status: 'awaiting_other_side_input',
      basis_note:
        'Based only on the currently submitted materials. A fuller bilateral mediation analysis becomes possible once the other side responds.',
    };
  }

  if (analysisStage === PRE_SEND_REVIEW_STAGE) {
    return {
      analysis_stage: PRE_SEND_REVIEW_STAGE,
      readiness_status: 'not_ready_to_send',
      send_readiness_summary:
        reason === 'unexpected_error'
          ? 'The Shared Intake Summary could not be generated due to an unexpected internal error.'
          : 'The Shared Intake Summary could not be generated because the model output was unavailable or invalid.',
      missing_information: [
        'What is the confirmed scope and set of deliverables?',
        'What assumptions should be explicit in the current brief?',
        'What timeline, ownership, or approval detail is still implied rather than stated?',
      ],
      ambiguous_terms: ['Which draft terms would a reasonable recipient still find unclear?'],
      likely_recipient_questions: ['What would the recipient need clarified before responding?'],
      likely_pushback_areas: ['Which current terms are most likely to trigger pushback if shared as-is?'],
      commercial_risks: [],
      implementation_risks: [],
      suggested_clarifications: ['Tighten the open items above and re-run the Shared Intake Summary.'],
    };
  }

  return {
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: 'unknown',
    confidence_0_1: 0.2,
    why: [
      reason === 'unexpected_error'
        ? 'Executive Summary: The AI mediation review could not be generated due to an unexpected internal error.'
        : 'Executive Summary: The AI mediation review could not be generated. This review is incomplete.',
      'Key Strengths: Unable to assess due to the current evaluation failure.',
      'Key Risks: Core negotiation issues could not be assessed reliably.',
      'Decision Readiness: Incomplete. Please address missing items and retry.',
      'Recommended Path: Review the missing items below and re-run AI mediation.',
    ],
    missing: [
      'What is the confirmed scope and set of deliverables?',
      'What is the confirmed timeline and go-live date?',
      'What are the measurable success criteria (KPIs)?',
    ],
    redactions: [],
  };
}

function getComparisonEvaluationSource(analysisStage: string) {
  if (analysisStage === STAGE1_SHARED_INTAKE_STAGE) {
    return 'proposal_stage1_intake';
  }
  return analysisStage === PRE_SEND_REVIEW_STAGE
    ? 'document_comparison_pre_send'
    : 'document_comparison_mediation';
}

function getReviewNotificationCopy(analysisStage: string, title: string) {
  const safeTitle = title || 'your proposal';
  if (analysisStage === STAGE1_SHARED_INTAKE_STAGE || analysisStage === PRE_SEND_REVIEW_STAGE) {
    return {
      title: 'Shared Intake Summary ready',
      message: `A Shared Intake Summary is ready for "${safeTitle}".`,
      emailSubject: 'Shared Intake Summary ready',
      emailText: `Your proposal "${safeTitle}" has a new Shared Intake Summary.\n\nSign in to PreMarket to review the neutral intake summary based on the current submitted materials so far.`,
    };
  }
  return {
    title: 'AI Mediation Review ready',
    message: `An AI Mediation Review is ready for "${safeTitle}".`,
    emailSubject: 'AI Mediation Review ready',
    emailText: `Your proposal "${safeTitle}" has a new AI Mediation Review.\n\nSign in to PreMarket to review the full bilateral mediation review.`,
  };
}

function toV2ApiError(error: any) {
  const parseKind = asLower(error?.parse_error_kind);
  const details =
    error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  const upstreamStatus = Number((details as any).status || 0);
  const statusCode =
    parseKind === 'vertex_timeout'
      ? 504
      : Number.isFinite(upstreamStatus) && upstreamStatus > 0
        ? upstreamStatus
        : 502;
  const code =
    parseKind === 'vertex_timeout'
      ? 'vertex_timeout'
      : parseKind === 'vertex_http_error' && statusCode === 501
        ? 'not_configured'
        : parseKind === 'vertex_http_error'
          ? 'vertex_request_failed'
          : 'invalid_model_output';

  return new ApiError(statusCode, code, 'Vertex evaluation failed', {
    reasonCode: parseKind || null,
    parseErrorKind: parseKind || null,
    parseErrorName: parseKind || null,
    parseErrorMessage: JSON.stringify({
      parse_error_kind: parseKind || null,
      raw_text_length: Number(error?.raw_text_length || 0) || 0,
      had_json_fence: null,
      finish_reason: asText(error?.finish_reason) || null,
      schema_missing_keys: Array.isArray((details as any).schema_missing_keys)
        ? (details as any).schema_missing_keys
        : [],
      category_count: null,
    }),
    rawTextLength: Number(error?.raw_text_length || 0) || 0,
    finishReason: asText(error?.finish_reason) || null,
    retryable: Boolean(error?.retryable),
    upstreamStatus: Number.isFinite(upstreamStatus) && upstreamStatus > 0 ? upstreamStatus : null,
    ...details,
  });
}

function getReviewLabelForSource(source: unknown) {
  return ['document_comparison_pre_send', 'document_comparison_stage1_intake', 'proposal_stage1_intake'].includes(asText(source))
    ? 'Shared Intake Summary'
    : 'AI Mediation Review';
}

function toFailedResult(error: any, source?: unknown) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const code = asText(error?.code) || 'evaluation_failed';
  const reviewLabel = getReviewLabelForSource(source);
  const message = asText(error?.message) || `${reviewLabel} failed`;
  const parseErrorKind = asText(error?.extra?.parseErrorKind || error?.extra?.reasonCode) || null;
  const parseErrorMessage = error?.extra?.parseErrorMessage ? JSON.parse(String(error.extra.parseErrorMessage)) : null;
  const attemptHistory = Array.isArray(error?.extra?.attempt_history) ? error.extra.attempt_history : null;
  const attemptCount = Array.isArray(attemptHistory) ? attemptHistory.length : 0;
  
  // Build user-friendly error message
  let userMessage = `${reviewLabel} could not be completed. Please try again.`;
  let details_safe = parseErrorKind ? `${parseErrorKind}: ` : '';
  
  if (parseErrorKind === 'truncated_output') {
    userMessage = `AI response was cut off due to size limits. Please retry ${reviewLabel}.`;
    details_safe += 'The model output was truncated and incomplete.';
  } else if (parseErrorKind === 'empty_output') {
    userMessage = `AI returned no content. Please retry ${reviewLabel}.`;
    details_safe += 'The model generated no output.';
  } else if (parseErrorKind === 'json_parse_error') {
    userMessage = `AI output was not valid JSON. Please retry ${reviewLabel}.`;
    details_safe += 'The response could not be parsed as JSON.';
  } else if (parseErrorKind === 'schema_validation_error') {
    userMessage = `AI response was incomplete (missing sections). Please retry ${reviewLabel}.`;
    details_safe += 'The response was missing required schema fields.';
  } else if (parseErrorKind === 'confidential_leak_detected') {
    userMessage = 'A confidentiality check failed. Please review your input and retry.';
    details_safe += 'Confidential information was detected in the output.';
  } else if (code === 'not_configured') {
    userMessage = 'Vertex AI is not configured. Please contact support.';
  }

  return {
    error: {
      statusCode,
      code,
      message,
      parse_error_kind: parseErrorKind,
      user_message: userMessage,
      details_safe,
      attempt_count: attemptCount,
      attempt_history: attemptHistory,
      parse_error_diagnostics: parseErrorMessage,
      details: error?.extra && typeof error.extra === 'object' ? error.extra : {},
    },
  };
}

async function persistFailedEvaluation(params: {
  db: any;
  proposal: any;
  source: string;
  error: any;
}) {
  const now = new Date();
  await params.db.insert(schema.proposalEvaluations).values({
    id: newId('eval'),
    proposalId: params.proposal.id,
    userId: params.proposal.userId,
    source: params.source,
    status: 'failed',
    score: null,
    summary: asText(params.error?.message) || `${getReviewLabelForSource(params.source)} failed`,
    result: toFailedResult(params.error, params.source),
    createdAt: now,
    updatedAt: now,
  });
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/evaluate', async (context) => {
    ensureMethod(req, ['POST']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;
    const requestId = asText((context as any)?.requestId) || newId('request');

    const db = getDb();
    const currentEmail = normalizeEmail(auth.user.email);
    const proposalScope = currentEmail
      ? and(
          eq(schema.proposals.id, proposalId),
          or(
            eq(schema.proposals.userId, auth.user.id),
            ilike(schema.proposals.partyAEmail, currentEmail),
            ilike(schema.proposals.partyBEmail, currentEmail),
          ),
        )
      : and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id));

    const [proposal] = await db.select().from(schema.proposals).where(proposalScope).limit(1);
    if (!proposal) {
      throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
    }

    await assertStarterAiEvaluationAllowed(db, {
      userId: proposal.userId,
      userEmail: proposal.partyAEmail || auth.user.email,
    });

    const responses = await db
      .select()
      .from(schema.proposalResponses)
      .where(eq(schema.proposalResponses.proposalId, proposalId));

    let result = null;
    let evaluationSource = 'proposal_vertex';
    let linkedComparison: any = null;

    const isDocumentComparisonProposal =
      String(proposal.proposalType || '').toLowerCase() === 'document_comparison' &&
      String(proposal.documentComparisonId || '').trim().length > 0;
    const docComparisonEngine = resolveDocumentComparisonEngine(req);

    try {
      if (isDocumentComparisonProposal) {
        evaluationSource = 'document_comparison_pre_send';
        const [comparison] = await db
          .select()
          .from(schema.documentComparisons)
          .where(eq(schema.documentComparisons.id, proposal.documentComparisonId))
          .limit(1);

        if (!comparison) {
          throw new ApiError(
            404,
            'document_comparison_not_found',
            'Linked document comparison not found for this proposal',
          );
        }

        linkedComparison = comparison;
        const sharedHistory = await loadSharedReportHistory({
          db,
          proposal,
          comparison,
        });
        const historyContributions = Array.isArray(sharedHistory?.contributions)
          ? sharedHistory.contributions
          : [];
        const latestProposerSharedEntry = [...historyContributions]
          .reverse()
          .find((entry) => entry.authorRole === HISTORY_AUTHOR_PROPOSER && entry.visibility === 'shared');
        const latestProposerConfidentialEntry = [...historyContributions]
          .reverse()
          .find((entry) => entry.authorRole === HISTORY_AUTHOR_PROPOSER && entry.visibility === 'confidential');
        const currentSharedPayload = {
          label: 'Shared by Proposer',
          text: String(comparison.docBText || ''),
          html: asText((comparison.inputs as any)?.doc_b_html),
          json: (comparison.inputs as any)?.doc_b_json,
          source: asText((comparison.inputs as any)?.doc_b_source) || 'typed',
          files: Array.isArray((comparison.inputs as any)?.doc_b_files) ? (comparison.inputs as any).doc_b_files : [],
        };
        const currentConfidentialPayload = {
          label: 'Confidential to Proposer',
          text: String(comparison.docAText || ''),
          notes: String(comparison.docAText || ''),
          html: asText((comparison.inputs as any)?.doc_a_html),
          json: (comparison.inputs as any)?.doc_a_json,
          source: asText((comparison.inputs as any)?.doc_a_source) || 'typed',
          files: Array.isArray((comparison.inputs as any)?.doc_a_files) ? (comparison.inputs as any).doc_a_files : [],
        };
        const currentComparisonEntries = buildDraftContributionEntries({
          authorRole: HISTORY_AUTHOR_PROPOSER,
          roundNumber: (Number(sharedHistory?.maxRoundNumber || 0) || 0) + 1,
          sharedPayload: currentSharedPayload,
          confidentialPayload: currentConfidentialPayload,
          sourceKind: 'draft',
          updatedAt: comparison.updatedAt,
        });
        const appendedComparisonEntries = currentComparisonEntries.filter((entry) => {
          const candidateText = asText(entry?.contentPayload?.text || entry?.contentPayload?.notes);
          if (!candidateText) {
            return false;
          }
          if (entry.visibility === 'shared') {
            return candidateText !== asText(latestProposerSharedEntry?.contentPayload?.text);
          }
          return candidateText !== asText(
            latestProposerConfidentialEntry?.contentPayload?.text ||
            latestProposerConfidentialEntry?.contentPayload?.notes,
          );
        });
        const attributedSharedEntries = [
          ...historyContributions.filter((entry) => entry.visibility === 'shared'),
          ...appendedComparisonEntries.filter((entry) => entry.visibility === 'shared'),
        ];
        const attributedConfidentialEntries = [
          ...historyContributions.filter((entry) => entry.visibility === 'confidential'),
          ...appendedComparisonEntries.filter((entry) => entry.visibility === 'confidential'),
        ];
        const hasRecipientContributions = hasMeaningfulRecipientContribution({
          recipientAuthorRole: HISTORY_AUTHOR_RECIPIENT,
          historyContributions,
          historyBaselinePayloads: {
            shared: currentSharedPayload,
            confidential: currentConfidentialPayload,
          },
        }).hasMeaningfulContribution;
        const analysisStage = hasRecipientContributions
          ? MEDIATION_REVIEW_STAGE
          : STAGE1_SHARED_INTAKE_STAGE;
        const mediationRoundContext = analysisStage === MEDIATION_REVIEW_STAGE
          ? await loadPriorBilateralRoundContext({
              db,
              proposalId: proposal.id,
              userId: proposal.userId,
            })
          : null;
        evaluationSource = getComparisonEvaluationSource(analysisStage);
        const comparisonSharedText = attributedSharedEntries.length > 0
          ? formatContributionsForAi(attributedSharedEntries)
          : String(comparison.docBText || '');
        const comparisonConfidentialText = attributedConfidentialEntries.length > 0
          ? formatContributionsForAi(attributedConfidentialEntries)
          : String(comparison.docAText || '');
        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/proposals/[id]/evaluate',
              event: 'proposal_document_comparison_evaluation_start',
              requestId,
              proposalId: proposal.id,
              comparisonId: comparison.id,
              inputChars: comparisonConfidentialText.length + comparisonSharedText.length,
              analysisStage,
              hasRecipientContributions,
            }),
          );
        }
        let comparisonEvaluation: any;
        if (docComparisonEngine === 'v2') {
          let v2Result: any;
          try {
            v2Result = await evaluateWithVertexV2({
              sharedText: comparisonSharedText,
              confidentialText: comparisonConfidentialText,
              analysisStage,
              requestId,
              enforceLeakGuard: false,
              ...(mediationRoundContext ? { mediationRoundContext } : {}),
            });
          } catch {
            v2Result = {
              ok: true,
              data: buildStageFallbackV2Data(analysisStage, 'unexpected_error'),
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
            const parseKind = asLower(error?.parse_error_kind);
            if (parseKind === 'confidential_leak_detected') {
              throw toV2ApiError(v2Result.error);
            }
            v2Result = {
              ok: true,
              data: buildStageFallbackV2Data(analysisStage, 'unavailable'),
              attempt_count: v2Result.attempt_count ?? 1,
              model: null,
              _internal: {
                warnings: ['vertex_invalid_response_fallback_used'],
                failure_kind: parseKind,
              },
            };
          }
          comparisonEvaluation = convertV2ResponseToEvaluation(v2Result, {
            ...(mediationRoundContext ? { mediationRoundContext } : {}),
          });
        } else {
          comparisonEvaluation = await evaluateDocumentComparisonWithVertex(
            {
              title: comparison.title || proposal.title || 'Document Comparison',
              docAText: comparisonConfidentialText,
              docBText: comparisonSharedText,
              docASpans: [],
              docBSpans: [],
              partyALabel: 'Confidential Information',
              partyBLabel: 'Shared Information',
            },
            {
              correlationId: requestId,
              routeName: '/api/proposals/[id]/evaluate',
              entityId: comparison.id,
              inputChars: comparisonConfidentialText.length + comparisonSharedText.length,
              disableConfidentialLeakGuard: true,
            },
          );
        }
        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/proposals/[id]/evaluate',
              event: 'proposal_document_comparison_evaluation_success',
              requestId,
              proposalId: proposal.id,
              comparisonId: comparison.id,
              engine: docComparisonEngine,
              provider:
                asText(comparisonEvaluation?.evaluation_provider || comparisonEvaluation?.provider) || null,
              model: asText(comparisonEvaluation?.evaluation_model || comparisonEvaluation?.model) || null,
            }),
          );
        }

        result = buildProposalResultFromEvaluation(proposal, comparisonEvaluation, {
          document_comparison_id: comparison.id,
          hidden_spans: 0,
          doc_a_length: comparisonConfidentialText.length,
          doc_b_length: comparisonSharedText.length,
        });

        await db
          .update(schema.documentComparisons)
          .set({
            status: 'evaluated',
            draftStep: 3,
            partyALabel: 'Confidential Information',
            partyBLabel: 'Shared Information',
            evaluationResult: comparisonEvaluation,
            publicReport: comparisonEvaluation.report,
            updatedAt: new Date(),
          })
          .where(eq(schema.documentComparisons.id, comparison.id));
      } else {
        const [template, templateQuestions] = await Promise.all([
          proposal.templateId
            ? db
                .select()
                .from(schema.templates)
                .where(eq(schema.templates.id, proposal.templateId))
                .limit(1)
                .then((rows) => rows[0] || null)
            : Promise.resolve(null),
          proposal.templateId
            ? db
                .select()
                .from(schema.templateQuestions)
                .where(eq(schema.templateQuestions.templateId, proposal.templateId))
                .orderBy(asc(schema.templateQuestions.sortOrder), asc(schema.templateQuestions.createdAt))
            : Promise.resolve([]),
        ]);

        const proposalInput = buildProposalInput(proposal, template, templateQuestions, responses);

        // Build a short context string from the proposal to drive relevance selection.
        // Use templateName + first few visible non-empty response labels/values.
        const contextParts: string[] = [
          String(proposal.title || '').trim(),
          String(proposalInput.templateName || '').trim(),
        ];
        const visibleResponses = proposalInput.responses
          .filter((r: any) => r.visibility !== 'hidden' && r.value != null && String(r.value).trim())
          .slice(0, 8);
        for (const r of visibleResponses) {
          contextParts.push(`${r.label}: ${String(r.value).slice(0, 120)}`);
        }
        const proposalContext = contextParts.filter(Boolean).join('\n');

        // Relevance-based document context — only included when docs match proposal context
        const docCtx = await selectRelevantDocuments(auth.user.id, proposalContext).catch(() => null);
        const enrichedProposalInput = docCtx
          ? { ...proposalInput, supplementaryContext: docCtx.contextBlock }
          : proposalInput;

        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/proposals/[id]/evaluate',
              event: 'proposal_vertex_evaluation_start',
              requestId,
              proposalId: proposal.id,
              responseCount: proposalInput.responses.length,
            }),
          );
        }
        const proposalEvaluation = await evaluateProposalWithVertex(enrichedProposalInput, {
          correlationId: requestId,
          routeName: '/api/proposals/[id]/evaluate',
          entityId: proposal.id,
          inputChars: JSON.stringify(proposalInput.responses || []).length,
        });
        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/proposals/[id]/evaluate',
              event: 'proposal_vertex_evaluation_success',
              requestId,
              proposalId: proposal.id,
              provider: asText(proposalEvaluation?.evaluation_provider || proposalEvaluation?.provider) || null,
              model: asText(proposalEvaluation?.evaluation_model || proposalEvaluation?.model) || null,
            }),
          );
        }
        result = buildProposalResultFromEvaluation(proposal, proposalEvaluation, {
          response_count: responses.length,
          template_question_count: templateQuestions.length,
        });
      }
    } catch (error: any) {
      await persistFailedEvaluation({
        db,
        proposal,
        source: evaluationSource,
        error,
      });

      if (linkedComparison) {
        await db
          .update(schema.documentComparisons)
          .set({
            status: 'failed',
            evaluationResult: toFailedResult(error, evaluationSource),
            updatedAt: new Date(),
          })
          .where(eq(schema.documentComparisons.id, linkedComparison.id));
      }

      throw error;
    }

    const now = new Date();
    const evaluationStatus =
      String(proposal.status || '').toLowerCase() === 'under_verification' ? 're_evaluated' : 'under_verification';

    const evaluationValues = {
      id: newId('eval'),
      proposalId: proposal.id,
      userId: proposal.userId,
      source: evaluationSource,
      status: 'completed',
      score: result.score,
      summary: result.summary,
      result,
      createdAt: now,
      updatedAt: now,
    };
    const nextProposal = {
      ...proposal,
      status: evaluationStatus,
      evaluatedAt: now,
      updatedAt: now,
    };
    const { queries: historyQueries } = buildProposalHistoryQueries(db, {
      proposal: nextProposal,
      actorUserId: auth.user.id,
      actorRole: 'party_a',
      milestone: 'evaluate',
      eventType: 'proposal.evaluated',
      eventData: {
        evaluation_source: evaluationSource,
        evaluation_id: evaluationValues.id,
      },
      evaluations: [evaluationValues],
      createdAt: now,
      requestId: context.requestId,
    });

    const [savedRows, updatedProposalRows] = await db.batch([
      db.insert(schema.proposalEvaluations).values(evaluationValues).returning(),
      db
        .update(schema.proposals)
        .set({
          status: nextProposal.status,
          evaluatedAt: nextProposal.evaluatedAt,
          updatedAt: nextProposal.updatedAt,
        })
        .where(eq(schema.proposals.id, proposal.id))
        .returning(),
      ...historyQueries,
    ]);
    const [saved] = savedRows;
    const [updatedProposal] = updatedProposalRows;

    try {
      const comparisonId = asText(linkedComparison?.id || proposal.documentComparisonId);
      const isComparisonNotification =
        asLower(proposal.proposalType) === 'document_comparison' && Boolean(comparisonId);
      const latestSharedReportLink = isComparisonNotification
        ? await resolveLatestActiveSharedReportLink(db, proposal.id, {
            recipientUserId: proposal.userId,
            recipientEmail: proposal.partyAEmail || auth.user.email,
          })
        : null;
      const sharedReportToken = asText(latestSharedReportLink?.token);
      const legacyActionUrl = buildLegacyOpportunityNotificationHref({
        proposalId: proposal.id,
      });
      const canonicalActionUrl = isComparisonNotification
        ? buildSharedReportHref(sharedReportToken)
        : null;
      const notificationCopy = getReviewNotificationCopy(
        evaluationSource === 'document_comparison_pre_send'
          ? PRE_SEND_REVIEW_STAGE
          : MEDIATION_REVIEW_STAGE,
        proposal.title || '',
      );

      await createNotificationEvent({
        db,
        userId: proposal.userId,
        userEmail: proposal.partyAEmail || auth.user.email,
        eventType: 'evaluation_update',
        emailCategory: 'evaluation_complete',
        dedupeKey: `evaluation_update:${proposal.id}:${saved.id}`,
        title: notificationCopy.title,
        message: notificationCopy.message,
        actionUrl: canonicalActionUrl || legacyActionUrl,
        metadata: isComparisonNotification && sharedReportToken
          ? buildNotificationTargetMetadata({
              route: 'SharedReport',
              workflowType: 'document_comparison',
              entityType: 'document_comparison',
              comparisonId,
              proposalId: proposal.id,
              sharedReportToken,
              legacyActionUrl,
            })
          : null,
        emailSubject: notificationCopy.emailSubject,
        emailText: [
          notificationCopy.emailText,
          '',
          `Score: ${saved.score ?? 'N/A'}`,
        ].join('\n'),
      });
    } catch {
      // Best-effort notifications should not block evaluation responses.
    }

    ok(res, 200, {
      evaluation: {
        id: saved.id,
        proposal_id: saved.proposalId,
        source: saved.source,
        status: saved.status,
        score: saved.score,
        summary: saved.summary,
        evaluation_provider:
          asLower((saved?.result as any)?.evaluation_provider || (saved?.result as any)?.provider) === 'vertex'
            ? 'vertex'
            : 'fallback',
        evaluation_model: asText((saved?.result as any)?.evaluation_model || (saved?.result as any)?.model) || null,
        evaluation_provider_reason:
          asText((saved?.result as any)?.evaluation_provider_reason || (saved?.result as any)?.fallbackReason) || null,
        result: saved.result || {},
        created_date: saved.createdAt,
        updated_date: saved.updatedAt,
      },
      proposal: {
        id: updatedProposal.id,
        status: updatedProposal.status,
        evaluated_at: updatedProposal.evaluatedAt,
      },
    });
  });
}
