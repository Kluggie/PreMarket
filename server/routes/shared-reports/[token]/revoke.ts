import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
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

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/sharedReports/[token]/revoke', async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [link] = await db
      .select()
      .from(schema.sharedLinks)
      .where(
        and(
          eq(schema.sharedLinks.token, token),
          eq(schema.sharedLinks.userId, auth.user.id),
          eq(schema.sharedLinks.mode, 'shared_report'),
        ),
      )
      .limit(1);

    if (!link) {
      throw new ApiError(404, 'shared_report_not_found', 'Shared report link not found');
    }

    const now = new Date();
    const metadata =
      link.reportMetadata && typeof link.reportMetadata === 'object' && !Array.isArray(link.reportMetadata)
        ? link.reportMetadata
        : {};

    const [updated] = await db
      .update(schema.sharedLinks)
      .set({
        status: 'revoked',
        canView: false,
        reportMetadata: {
          ...metadata,
          revoked_at: now.toISOString(),
        },
        updatedAt: now,
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    if (!updated) {
      throw new ApiError(500, 'revoke_failed', 'Unable to revoke shared report link');
    }

    ok(res, 200, {
      revoked: true,
      sharedReport: {
        id: updated.id,
        token: updated.token,
        status: updated.status,
        recipient_email: asText(updated.recipientEmail) || null,
        revoked_at:
          updated.reportMetadata && typeof updated.reportMetadata === 'object'
            ? (updated.reportMetadata as Record<string, unknown>).revoked_at || now.toISOString()
            : now.toISOString(),
      },
    });
  });
}
