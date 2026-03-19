import { and, eq, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  buildSharedHistoryComposite,
  loadSharedReportHistory,
} from '../../_lib/shared-report-history.js';
import { buildRecipientSafeEvaluationProjection } from '../document-comparisons/_helpers.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function isExpired(expiresAt: Date | string | null) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

function toObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/sharedReports/[token]', async (context) => {
    ensureMethod(req, ['GET']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const db = getDb();
    const [joined] = await db
      .select({
        link: schema.sharedLinks,
        proposal: schema.proposals,
      })
      .from(schema.sharedLinks)
      .leftJoin(schema.proposals, eq(schema.proposals.id, schema.sharedLinks.proposalId))
      .where(eq(schema.sharedLinks.token, token))
      .limit(1);

    const link = joined?.link || null;
    const proposal = joined?.proposal || null;

    if (!link || !proposal) {
      throw new ApiError(404, 'token_not_found', 'Shared report link not found');
    }

    context.userId = link.userId;
    if (link.mode !== 'shared_report') {
      throw new ApiError(404, 'token_not_found', 'Shared report link not found');
    }

    if (!link.canView) {
      throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared report');
    }
    if (link.status !== 'active') {
      throw new ApiError(410, 'token_inactive', 'Shared report link is inactive');
    }
    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared report link has expired');
    }
    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared report link reached its usage limit');
    }

    const [updatedLink] = await db
      .update(schema.sharedLinks)
      .set({
        uses: sql`${schema.sharedLinks.uses} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    const [comparison] =
      proposal.documentComparisonId
        ? await db
            .select()
            .from(schema.documentComparisons)
            .where(eq(schema.documentComparisons.id, proposal.documentComparisonId))
            .limit(1)
        : [null];

    const sharedHistory = await loadSharedReportHistory({
      db,
      proposal,
      comparison,
    });
    const sharedContent = buildSharedHistoryComposite(sharedHistory.sharedEntries);

    const projection = buildRecipientSafeEvaluationProjection({
      evaluationResult: comparison?.evaluationResult || {},
      publicReport: comparison?.publicReport || {},
      confidentialText: comparison?.docAText || '',
      sharedText: sharedContent.text || comparison?.docBText || '',
      title: comparison?.title || proposal.title || 'Shared Report',
    });

    ok(res, 200, {
      sharedReport: {
        token: updatedLink.token,
        title: comparison?.title || proposal.title || 'Shared Report',
        proposal_id: proposal.id,
        comparison_id: comparison?.id || null,
        status: proposal.status || updatedLink.status,
        shared_content: {
          label: 'Shared Information',
          text: sharedContent.text || comparison?.docBText || '',
          html: sharedContent.html,
        },
        shared_history: {
          entries: sharedHistory.sharedEntries,
          max_round_number: sharedHistory.maxRoundNumber,
        },
        ai_report: projection.public_report || {},
        uses: updatedLink.uses,
        max_uses: updatedLink.maxUses,
        created_at: updatedLink.createdAt,
        expires_at: updatedLink.expiresAt || null,
        recipient_email_locked: Boolean(updatedLink.recipientEmail),
      },
    });
  });
}
