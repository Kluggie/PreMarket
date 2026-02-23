import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  evaluateDocumentComparisonWithVertex,
  evaluateProposalWithVertex,
} from '../../../_lib/vertex-evaluation.js';

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
    provider: evaluation.provider,
    model: evaluation.model,
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

function toFailedResult(error: any) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const code = asText(error?.code) || 'evaluation_failed';
  const message = asText(error?.message) || 'Evaluation failed';

  return {
    error: {
      statusCode,
      code,
      message,
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
    summary: asText(params.error?.message) || 'Evaluation failed',
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
        const comparisonEvaluation = await evaluateDocumentComparisonWithVertex({
          title: comparison.title || proposal.title || 'Document Comparison',
          docAText: comparison.docAText || '',
          docBText: comparison.docBText || '',
          docASpans: Array.isArray(comparison.docASpans) ? comparison.docASpans : [],
          docBSpans: Array.isArray(comparison.docBSpans) ? comparison.docBSpans : [],
          partyALabel: comparison.partyALabel || 'Document A',
          partyBLabel: comparison.partyBLabel || 'Document B',
        });

        result = buildProposalResultFromEvaluation(proposal, comparisonEvaluation, {
          document_comparison_id: comparison.id,
          hidden_spans:
            Number(Array.isArray(comparison.docASpans) ? comparison.docASpans.length : 0) +
            Number(Array.isArray(comparison.docBSpans) ? comparison.docBSpans.length : 0),
          doc_a_length: String(comparison.docAText || '').length,
          doc_b_length: String(comparison.docBText || '').length,
        });

        await db
          .update(schema.documentComparisons)
          .set({
            status: 'evaluated',
            draftStep: 4,
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
        const proposalEvaluation = await evaluateProposalWithVertex(proposalInput);
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

    const [saved] = await db
      .insert(schema.proposalEvaluations)
      .values({
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
      })
      .returning();

    const [updatedProposal] = await db
      .update(schema.proposals)
      .set({
        status: evaluationStatus,
        evaluatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, proposal.id))
      .returning();

    ok(res, 200, {
      evaluation: {
        id: saved.id,
        proposal_id: saved.proposalId,
        source: saved.source,
        status: saved.status,
        score: saved.score,
        summary: saved.summary,
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
