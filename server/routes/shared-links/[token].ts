import { and, eq, sql } from 'drizzle-orm';
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
    recipientEmail: row.recipientEmail,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    uses: row.uses,
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

    if (shouldConsume) {
      const [updated] = await db
        .update(schema.sharedLinks)
        .set({
          uses: sql`${schema.sharedLinks.uses} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.sharedLinks.id, link.id))
        .returning();

      if (updated) {
        nextLink = updated;
      }
    }

    ok(res, 200, {
      sharedLink: mapLink(nextLink, proposal || null),
    });
  });
}
