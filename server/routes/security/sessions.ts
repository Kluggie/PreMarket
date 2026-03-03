import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { listActiveAuthSessionsForUser } from '../../_lib/auth-sessions.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function mapSession(row: any, currentSessionId: string | null) {
  return {
    id: row.id,
    created_at: row.createdAt || null,
    last_seen_at: row.lastSeenAt || null,
    revoked_at: row.revokedAt || null,
    ip_hash: row.ipHash || null,
    user_agent: row.userAgent || null,
    device_label: row.deviceLabel || null,
    is_current: currentSessionId ? row.id === currentSessionId : false,
    isCurrent: currentSessionId ? row.id === currentSessionId : false,
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/sessions', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const sessions = await listActiveAuthSessionsForUser(auth.user.id);

    ok(res, 200, {
      sessions: sessions.map((row) => mapSession(row, auth.sessionId || null)),
    });
  });
}
