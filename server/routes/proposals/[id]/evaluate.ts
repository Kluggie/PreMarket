import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { buildProposalHistoryQueries } from '../../../_lib/proposal-history.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  evaluateDocumentComparisonWithVertex,
  evaluateProposalWithVertex,
} from '../../../_lib/vertex-evaluation.js';
import { evaluateWithVertexV2 } from '../../../_lib/vertex-evaluation-v2.js';
import { selectRelevantDocuments } from '../../../_lib/user-documents-context.js';
import { assertStarterAiEvaluationAllowed } from '../../../_lib/starter-entitlements.js';
import { buildMediationReviewSections } from '../../document-comparisons/_helpers.js';
import {
  buildDocumentComparisonReportHref,
  buildLegacyOpportunityNotificationHref,
  buildNotificationTargetMetadata,
} from '../../../../src/lib/notificationTargets.js';

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

function convertV2ResponseToEvaluation(v2Result: any): Record<string, unknown> {
  const data = v2Result?.data || {};
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

  return {
    provider: 'vertex',
    model: asText(v2Result?.model) || process.env.VERTEX_MODEL || 'gemini-2.0-flash-001',
    generatedAt,
    score: Math.round(normalizedConfidence * 100),
    confidence: normalizedConfidence,
    recommendation,
    summary: why[0] || 'AI mediation review complete',
    report: {
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
    },
    evaluation_provider: 'vertex',
    evaluation_model: asText(v2Result?.model) || process.env.VERTEX_MODEL || 'gemini-2.0-flash-001',
    evaluation_provider_reason: null,
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

function toFailedResult(error: any) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const code = asText(error?.code) || 'evaluation_failed';
  const message = asText(error?.message) || 'AI mediation failed';
  const parseErrorKind = asText(error?.extra?.parseErrorKind || error?.extra?.reasonCode) || null;
  const parseErrorMessage = error?.extra?.parseErrorMessage ? JSON.parse(String(error.extra.parseErrorMessage)) : null;
  const attemptHistory = Array.isArray(error?.extra?.attempt_history) ? error.extra.attempt_history : null;
  const attemptCount = Array.isArray(attemptHistory) ? attemptHistory.length : 0;
  
  // Build user-friendly error message
  let userMessage = 'AI mediation could not be completed. Please try again.';
  let details_safe = parseErrorKind ? `${parseErrorKind}: ` : '';
  
  if (parseErrorKind === 'truncated_output') {
    userMessage = 'AI response was cut off due to size limits. Please retry AI mediation.';
    details_safe += 'The model output was truncated and incomplete.';
  } else if (parseErrorKind === 'empty_output') {
    userMessage = 'AI returned no content. Please retry AI mediation.';
    details_safe += 'The model generated no output.';
  } else if (parseErrorKind === 'json_parse_error') {
    userMessage = 'AI output was not valid JSON. Please retry AI mediation.';
    details_safe += 'The response could not be parsed as JSON.';
  } else if (parseErrorKind === 'schema_validation_error') {
    userMessage = 'AI response was incomplete (missing sections). Please retry AI mediation.';
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
    summary: asText(params.error?.message) || 'AI mediation failed',
    result: toFailedResult(params.error),
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
        evaluationSource = 'document_comparison_vertex';
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
        if (process.env.NODE_ENV !== 'production') {
          console.info(
            JSON.stringify({
              level: 'info',
              route: '/api/proposals/[id]/evaluate',
              event: 'proposal_document_comparison_evaluation_start',
              requestId,
              proposalId: proposal.id,
              comparisonId: comparison.id,
              inputChars: String(comparison.docAText || '').length + String(comparison.docBText || '').length,
            }),
          );
        }
        let comparisonEvaluation: any;
        if (docComparisonEngine === 'v2') {
          const v2Result = await evaluateWithVertexV2({
            sharedText: String(comparison.docBText || ''),
            confidentialText: String(comparison.docAText || ''),
            requestId,
            enforceLeakGuard: false,
          });
          if (!v2Result.ok) {
            throw toV2ApiError(v2Result.error);
          }
          comparisonEvaluation = convertV2ResponseToEvaluation(v2Result);
        } else {
          comparisonEvaluation = await evaluateDocumentComparisonWithVertex(
            {
              title: comparison.title || proposal.title || 'Document Comparison',
              docAText: comparison.docAText || '',
              docBText: comparison.docBText || '',
              docASpans: [],
              docBSpans: [],
              partyALabel: 'Confidential Information',
              partyBLabel: 'Shared Information',
            },
            {
              correlationId: requestId,
              routeName: '/api/proposals/[id]/evaluate',
              entityId: comparison.id,
              inputChars: String(comparison.docAText || '').length + String(comparison.docBText || '').length,
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
          doc_a_length: String(comparison.docAText || '').length,
          doc_b_length: String(comparison.docBText || '').length,
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
            evaluationResult: toFailedResult(error),
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
      const legacyActionUrl = buildLegacyOpportunityNotificationHref({
        proposalId: proposal.id,
      });
      const canonicalActionUrl = isComparisonNotification
        ? buildDocumentComparisonReportHref(comparisonId)
        : null;

      await createNotificationEvent({
        db,
        userId: proposal.userId,
        userEmail: proposal.partyAEmail || auth.user.email,
        eventType: 'evaluation_update',
        emailCategory: 'evaluation_complete',
        dedupeKey: `evaluation_update:${proposal.id}:${saved.id}`,
        title: 'AI mediation review ready',
        message: `An AI mediation review is ready for "${proposal.title || 'your proposal'}".`,
        actionUrl: canonicalActionUrl || legacyActionUrl,
        metadata: isComparisonNotification
          ? buildNotificationTargetMetadata({
              route: 'DocumentComparisonDetail',
              tab: 'report',
              workflowType: 'document_comparison',
              entityType: 'document_comparison',
              comparisonId,
              proposalId: proposal.id,
              legacyActionUrl,
            })
          : null,
        emailSubject: 'AI mediation review ready',
        emailText: [
          `Your proposal "${proposal.title || 'Untitled Proposal'}" has a new AI mediation review.`,
          '',
          `Score: ${saved.score ?? 'N/A'}`,
          '',
          'Sign in to PreMarket to review the full mediation review.',
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
