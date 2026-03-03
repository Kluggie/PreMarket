import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { listRecentAuditEventsForUser } from '../../_lib/audit-events.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function parseLimit(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 50;
  }
  return Math.min(Math.max(Math.floor(numeric), 1), 200);
}

function mapEvent(row: any) {
  return {
    id: row.id,
    event_type: row.eventType,
    created_at: row.createdAt || null,
    ip_hash: row.ipHash || null,
    user_agent: row.userAgent || null,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/activity', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const limit = parseLimit(req.query?.limit);
    const events = await listRecentAuditEventsForUser({
      userId: auth.user.id,
      limit,
    });

    ok(res, 200, {
      events: events.map(mapEvent),
    });
  });
}
