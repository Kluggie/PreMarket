import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function getNotificationId(req: any, notificationIdParam?: string) {
  if (notificationIdParam && notificationIdParam.trim().length > 0) {
    return notificationIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any, notificationIdParam?: string) {
  await withApiRoute(req, res, '/api/notifications/[id]', async (context) => {
    ensureMethod(req, ['PATCH']);
    const notificationId = getNotificationId(req, notificationIdParam);

    if (!notificationId) {
      throw new ApiError(400, 'invalid_input', 'Notification id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;
    const body = await readJsonBody(req);
    const shouldMarkRead = body.read === undefined ? true : Boolean(body.read);
    if (!shouldMarkRead) {
      throw new ApiError(400, 'invalid_input', 'Only read=true is supported');
    }

    const now = new Date();
    const db = getDb();
    const [updated] = await db
      .update(schema.notifications)
      .set({
        readAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.notifications.id, notificationId),
          eq(schema.notifications.userId, auth.user.id),
        ),
      )
      .returning({
        id: schema.notifications.id,
      });

    if (!updated) {
      throw new ApiError(404, 'notification_not_found', 'Notification not found');
    }

    ok(res, 200, {
      notification: {
        id: updated.id,
        read: true,
      },
    });
  });
}
