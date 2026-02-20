import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../_lib/env.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function isExpired(expiresAt) {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() < Date.now();
}

function buildSharedReportUrl(token: string) {
  const appBaseUrl = String(process.env.APP_BASE_URL || '').trim();
  const returnPath = `/SharedReport?token=${encodeURIComponent(String(token || ''))}`;

  if (!appBaseUrl) {
    return returnPath;
  }

  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function mapLink(row, proposal) {
  return {
    id: row.id,
    token: row.token,
    url: buildSharedReportUrl(row.token),
    proposalId: row.proposalId,
    status: row.status,
    mode: row.mode,
    recipientEmail: row.recipientEmail,
    canView: Boolean(row.canView),
    canEdit: Boolean(row.canEdit),
    canReevaluate: Boolean(row.canReevaluate),
    canSendBack: Boolean(row.canSendBack),
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    uses: row.uses,
    lastUsedAt: row.lastUsedAt || null,
    reportMetadata: row.reportMetadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
    proposal: proposal
      ? {
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          template_name: proposal.templateName,
          summary: proposal.summary,
          payload: proposal.payload || {},
          proposal_type: proposal.proposalType || 'standard',
          document_comparison_id: proposal.documentComparisonId || null,
          sent_at: proposal.sentAt || null,
          received_at: proposal.receivedAt || null,
          evaluated_at: proposal.evaluatedAt || null,
        }
      : null,
  };
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/shared-links/[token]', async (context) => {
    ensureMethod(req, ['GET']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const db = getDb();
    const [joinedRow] = await db
      .select({
        link: schema.sharedLinks,
        proposal: schema.proposals,
      })
      .from(schema.sharedLinks)
      .leftJoin(
        schema.proposals,
        eq(schema.proposals.id, schema.sharedLinks.proposalId),
      )
      .where(eq(schema.sharedLinks.token, token))
      .limit(1);

    if (!joinedRow?.link) {
      throw new ApiError(404, 'token_not_found', 'Shared link not found');
    }

    const { link, proposal } = joinedRow;
    context.userId = link.userId;

    if (link.status !== 'active') {
      throw new ApiError(410, 'token_inactive', 'Shared link is inactive');
    }

    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared link has expired');
    }

    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared link has reached its usage limit');
    }

    const shouldConsume = String(req.query?.consume || '').toLowerCase() === 'true';
    let nextLink = link;

    if (!link.canView) {
      throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared link');
    }

    if (shouldConsume) {
      const [updated] = await db
        .update(schema.sharedLinks)
        .set({
          uses: sql`${schema.sharedLinks.uses} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.sharedLinks.id, link.id))
        .returning();

      if (updated) {
        nextLink = updated;
      }
    }

    const proposalId = nextLink.proposalId || proposal?.id || null;
    const [responses, evaluations, comparison] = proposalId
      ? await Promise.all([
          db
            .select()
            .from(schema.proposalResponses)
            .where(eq(schema.proposalResponses.proposalId, proposalId))
            .orderBy(asc(schema.proposalResponses.createdAt)),
          db
            .select()
            .from(schema.proposalEvaluations)
            .where(eq(schema.proposalEvaluations.proposalId, proposalId))
            .orderBy(desc(schema.proposalEvaluations.createdAt))
            .limit(10),
          proposal?.documentComparisonId
            ? db
                .select()
                .from(schema.documentComparisons)
                .where(eq(schema.documentComparisons.id, proposal.documentComparisonId))
                .limit(1)
                .then((rows) => rows[0] || null)
            : Promise.resolve(null),
        ])
      : [[], [], null];

    ok(res, 200, {
      sharedLink: mapLink(nextLink, proposal || null),
      responses: responses.map((row) => ({
        id: row.id,
        question_id: row.questionId,
        section_id: row.sectionId,
        value: row.value,
        value_type: row.valueType,
        range_min: row.rangeMin,
        range_max: row.rangeMax,
        visibility: row.visibility,
        entered_by_party: row.enteredByParty,
        claim_type: row.claimType,
        created_date: row.createdAt,
        updated_date: row.updatedAt,
      })),
      evaluations: evaluations.map((row) => ({
        id: row.id,
        source: row.source,
        status: row.status,
        score: row.score,
        summary: row.summary,
        result: row.result || {},
        created_date: row.createdAt,
      })),
      documentComparison: comparison
        ? {
            id: comparison.id,
            title: comparison.title,
            status: comparison.status,
            draft_step: comparison.draftStep,
            party_a_label: comparison.partyALabel,
            party_b_label: comparison.partyBLabel,
            doc_a_text: comparison.docAText,
            doc_b_text: comparison.docBText,
            doc_a_spans: comparison.docASpans || [],
            doc_b_spans: comparison.docBSpans || [],
            evaluation_result: comparison.evaluationResult || {},
            public_report: comparison.publicReport || {},
            updated_date: comparison.updatedAt,
          }
        : null,
    });
  });
}
