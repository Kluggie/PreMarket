import { desc, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { mapNotificationRow } from '../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown) {
  const candidate = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(candidate)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(candidate), 1), MAX_LIMIT);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/notifications', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }

    context.userId = auth.user.id;
    const limit = parseLimit(req.query?.limit);
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, auth.user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);

    ok(res, 200, {
      notifications: rows.map((row) => mapNotificationRow(row)),
    });
  });
}
