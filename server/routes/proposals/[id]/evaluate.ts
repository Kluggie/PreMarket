import { and, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
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

function isNonEmptyValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function buildEvaluationResult(proposal, responses = []) {
  const ownerResponses = responses.filter((row) => String(row.enteredByParty || 'a').toLowerCase() === 'a');
  const recipientResponses = responses.filter(
    (row) => String(row.enteredByParty || '').toLowerCase() === 'b',
  );

  const ownerComplete = ownerResponses.filter((row) => {
    if (row.valueType === 'range') {
      return (row.rangeMin || '').trim().length > 0 || (row.rangeMax || '').trim().length > 0;
    }
    return isNonEmptyValue(parseValue(row.value));
  }).length;

  const hiddenCount = ownerResponses.filter((row) => String(row.visibility || '').toLowerCase() === 'hidden').length;
  const responseCoverage = ownerResponses.length > 0 ? ownerComplete / ownerResponses.length : 0;
  const recipientCoverage =
    recipientResponses.length > 0
      ? recipientResponses.filter((row) => isNonEmptyValue(parseValue(row.value))).length /
        recipientResponses.length
      : 0;

  const rawScore = Math.round(responseCoverage * 70 + recipientCoverage * 20 + (hiddenCount === 0 ? 10 : 5));
  const score = Math.min(Math.max(rawScore, 0), 100);

  let recommendation = 'Needs Review';
  if (score >= 80) recommendation = 'Strong Fit';
  else if (score >= 60) recommendation = 'Promising';
  else if (score < 40) recommendation = 'Weak Fit';

  const nowIso = new Date().toISOString();

  return {
    score,
    recommendation,
    generated_at: nowIso,
    stats: {
      total_owner_questions: ownerResponses.length,
      owner_completed: ownerComplete,
      recipient_inputs: recipientResponses.length,
      hidden_fields: hiddenCount,
    },
    summary:
      `Evaluation score ${score}/100. ${ownerComplete}/${ownerResponses.length || 0}` +
      ` owner responses complete. Recommendation: ${recommendation}.`,
    sections: [
      {
        key: 'coverage',
        title: 'Coverage',
        value: `${ownerComplete}/${ownerResponses.length || 0}`,
      },
      {
        key: 'recipient',
        title: 'Recipient Inputs',
        value: `${recipientResponses.length}`,
      },
      {
        key: 'confidentiality',
        title: 'Hidden Fields',
        value: `${hiddenCount}`,
      },
    ],
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

    const result = buildEvaluationResult(proposal, responses);
    const now = new Date();
    const evaluationStatus =
      String(proposal.status || '').toLowerCase() === 'under_verification' ? 're_evaluated' : 'under_verification';

    const [saved] = await db
      .insert(schema.proposalEvaluations)
      .values({
        id: newId('eval'),
        proposalId: proposal.id,
        userId: proposal.userId,
        source: 'manual',
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
