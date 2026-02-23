import { and, eq, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeVisibility(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hidden' || normalized === 'not_shared' || normalized === 'private') {
    return 'hidden';
  }
  return 'full';
}

function normalizeValue(rawValue: unknown) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (typeof rawValue === 'object') {
    return JSON.stringify(rawValue);
  }

  const text = String(rawValue);
  return text.length > 0 ? text : null;
}

function parseResponseRows(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      const questionId = String(entry?.question_id || entry?.questionId || '').trim();
      if (!questionId) {
        return null;
      }

      const incomingValue = entry?.value;
      const isRange = incomingValue && typeof incomingValue === 'object' && incomingValue.type === 'range';

      return {
        questionId,
        sectionId: String(entry?.section_id || entry?.sectionId || '').trim() || null,
        valueType: isRange
          ? 'range'
          : String(entry?.value_type || entry?.valueType || 'text').trim() || 'text',
        value: isRange ? null : normalizeValue(incomingValue),
        rangeMin: isRange
          ? String(incomingValue?.min || '').trim() || null
          : String(entry?.range_min || entry?.rangeMin || '').trim() || null,
        rangeMax: isRange
          ? String(incomingValue?.max || '').trim() || null
          : String(entry?.range_max || entry?.rangeMax || '').trim() || null,
        visibility: normalizeVisibility(entry?.visibility),
        metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
      };
    })
    .filter(Boolean);
}

function buildReevaluationResult(proposalId: string, rows: any[]) {
  const answered = rows.filter((row) => row.value || row.rangeMin || row.rangeMax).length;
  const total = rows.length;
  const score = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;

  let recommendation = 'Needs Review';
  if (score >= 80) recommendation = 'Strong Fit';
  else if (score >= 60) recommendation = 'Promising';
  else if (score < 40) recommendation = 'Weak Fit';

  return {
    score,
    recommendation,
    generated_at: new Date().toISOString(),
    summary: `Recipient re-evaluation score ${score}/100 based on ${answered}/${total} answered inputs.`,
    proposal_id: proposalId,
  };
}

function isExpired(expiresAt) {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() < Date.now();
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/shared-links/[token]/respond', async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const db = getDb();
    const [link] = await db.select().from(schema.sharedLinks).where(eq(schema.sharedLinks.token, token)).limit(1);
    if (!link) {
      throw new ApiError(404, 'token_not_found', 'Shared link not found');
    }
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

    const body = await readJsonBody(req);
    const responderEmail = normalizeEmail(body.responderEmail || body.responder_email || body.email || '');

    if (link.recipientEmail && normalizeEmail(link.recipientEmail) !== responderEmail) {
      throw new ApiError(403, 'recipient_mismatch', 'This link belongs to a different recipient');
    }

    const shouldRunReevaluation = Boolean(body.runEvaluation || body.run_evaluation || false);
    const normalizedRows = parseResponseRows(body.responses || []);

    if (normalizedRows.length > 0 && !link.canEdit) {
      throw new ApiError(403, 'edit_not_allowed', 'Editing is disabled for this shared link');
    }

    if (shouldRunReevaluation && !link.canReevaluate) {
      throw new ApiError(403, 'reevaluation_not_allowed', 'Re-evaluation is disabled for this shared link');
    }

    if (normalizedRows.length === 0 && !shouldRunReevaluation) {
      throw new ApiError(400, 'invalid_input', 'responses or runEvaluation is required');
    }

    const now = new Date();

    if (normalizedRows.length > 0) {
      await db
        .delete(schema.proposalResponses)
        .where(
          and(
            eq(schema.proposalResponses.proposalId, link.proposalId),
            eq(schema.proposalResponses.userId, link.userId),
            eq(schema.proposalResponses.enteredByParty, 'b'),
          ),
        );

      await db.insert(schema.proposalResponses).values(
        normalizedRows.map((row) => ({
          id: newId('response'),
          proposalId: link.proposalId,
          userId: link.userId,
          questionId: row.questionId,
          sectionId: row.sectionId,
          value: row.value,
          valueType: row.valueType,
          rangeMin: row.rangeMin,
          rangeMax: row.rangeMax,
          visibility: row.visibility,
          claimType: 'counterparty_claim',
          enteredByParty: 'b',
          createdAt: now,
          updatedAt: now,
        })),
      );

      await db
        .delete(schema.sharedLinkResponses)
        .where(eq(schema.sharedLinkResponses.sharedLinkId, link.id));

      await db.insert(schema.sharedLinkResponses).values(
        normalizedRows.map((row) => ({
          id: newId('share_resp'),
          sharedLinkId: link.id,
          proposalId: link.proposalId,
          questionId: row.questionId,
          value: row.value,
          valueType: row.valueType,
          rangeMin: row.rangeMin,
          rangeMax: row.rangeMax,
          visibility: row.visibility,
          enteredByParty: 'b',
          responderEmail: responderEmail || null,
          metadata: row.metadata || {},
          createdAt: now,
          updatedAt: now,
        })),
      );

      await db
        .update(schema.proposals)
        .set({
          status: 'received',
          receivedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, link.proposalId));

      try {
        const [proposal] = await db
          .select({
            id: schema.proposals.id,
            title: schema.proposals.title,
            partyBEmail: schema.proposals.partyBEmail,
          })
          .from(schema.proposals)
          .where(eq(schema.proposals.id, link.proposalId))
          .limit(1);

        await createNotificationEvent({
          db,
          userId: link.userId,
          eventType: 'mutual_interest',
          title: 'Mutual interest update',
          message: `${responderEmail || proposal?.partyBEmail || 'The counterparty'} sent updates for "${
            proposal?.title || 'your proposal'
          }".`,
          actionUrl: `/ProposalDetail?id=${encodeURIComponent(link.proposalId)}`,
          emailSubject: 'Mutual interest activity on PreMarket',
          emailText: [
            `${responderEmail || 'A counterparty'} submitted updates to your proposal.`,
            '',
            `Proposal: ${proposal?.title || 'Untitled Proposal'}`,
            '',
            'Sign in to review the latest details.',
          ].join('\n'),
        });
      } catch {
        // Best-effort notifications should not block shared-link responses.
      }
    }

    let evaluation = null;
    if (shouldRunReevaluation) {
      const result = buildReevaluationResult(link.proposalId, normalizedRows);
      const [saved] = await db
        .insert(schema.proposalEvaluations)
        .values({
          id: newId('eval'),
          proposalId: link.proposalId,
          userId: link.userId,
          source: 'shared_link',
          status: 'completed',
          score: result.score,
          summary: result.summary,
          result,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await db
        .update(schema.proposals)
        .set({
          status: 're_evaluated',
          evaluatedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, link.proposalId));

      evaluation = {
        id: saved.id,
        score: saved.score,
        status: saved.status,
        summary: saved.summary,
        result: saved.result || {},
        created_date: saved.createdAt,
      };

      try {
        const [proposal] = await db
          .select({
            id: schema.proposals.id,
            title: schema.proposals.title,
          })
          .from(schema.proposals)
          .where(eq(schema.proposals.id, link.proposalId))
          .limit(1);

        await createNotificationEvent({
          db,
          userId: link.userId,
          eventType: 'evaluation_update',
          title: 'Evaluation complete',
          message: `A re-evaluation completed for "${proposal?.title || 'your proposal'}".`,
          actionUrl: `/ProposalDetail?id=${encodeURIComponent(link.proposalId)}`,
          emailSubject: 'Proposal re-evaluation complete',
          emailText: [
            `A re-evaluation has completed for "${proposal?.title || 'your proposal'}".`,
            '',
            `Score: ${saved.score ?? 'N/A'}`,
            '',
            'Sign in to review the updated report.',
          ].join('\n'),
        });
      } catch {
        // Best-effort notifications should not block shared-link responses.
      }
    }

    const [updatedLink] = await db
      .update(schema.sharedLinks)
      .set({
        uses: sql`${schema.sharedLinks.uses} + 1`,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    ok(res, 200, {
      sharedLink: {
        id: updatedLink.id,
        token: updatedLink.token,
        proposal_id: updatedLink.proposalId,
        status: updatedLink.status,
        mode: updatedLink.mode,
        uses: updatedLink.uses,
        max_uses: updatedLink.maxUses,
      },
      savedResponses: normalizedRows.length,
      evaluation,
    });
  });
}
