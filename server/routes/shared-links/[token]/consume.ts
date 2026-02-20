import { eq, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

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

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/shared-links/[token]/consume', async (context) => {
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

    if (!link.canView) {
      throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared link');
    }

    if (link.status !== 'active') {
      throw new ApiError(410, 'token_inactive', 'Shared link is inactive');
    }

    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared link has expired');
    }

    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared link has reached its usage limit');
    }

    const [updated] = await db
      .update(schema.sharedLinks)
      .set({
        uses: sql`${schema.sharedLinks.uses} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    ok(res, 200, {
      sharedLink: {
        id: updated.id,
        token: updated.token,
        status: updated.status,
        mode: updated.mode,
        uses: updated.uses,
        max_uses: updated.maxUses,
        last_used_at: updated.lastUsedAt || null,
        proposal_id: updated.proposalId,
        recipient_email: updated.recipientEmail,
      },
    });
  });
}
