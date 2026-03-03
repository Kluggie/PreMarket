import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { revokeAllAuthSessionsForUser } from '../../../_lib/auth-sessions.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { clearCsrfCookie } from '../../../_lib/csrf.js';
import { shouldUseSecureCookies } from '../../../_lib/env.js';
import { readJsonBody } from '../../../_lib/http.js';
import { clearSessionCookie } from '../../../_lib/session.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/sessions/revoke-all', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const includeCurrent = Boolean(body.includeCurrent ?? body.include_current);

    const revokedSessionIds = await revokeAllAuthSessionsForUser({
      userId: auth.user.id,
      exceptSessionId: auth.sessionId || null,
      includeCurrent,
    });

    if (includeCurrent) {
      const secure = shouldUseSecureCookies(req, auth.config.appBaseUrl);
      clearSessionCookie(res, secure);
      clearCsrfCookie(res, secure);
    }

    await logAuditEventBestEffort({
      eventType: 'auth.sessions.revoked_all',
      userId: auth.user.id,
      req,
      metadata: {
        include_current: includeCurrent,
        revoked_count: revokedSessionIds.length,
      },
    });

    ok(res, 200, {
      revoked: true,
      include_current: includeCurrent,
      revoked_count: revokedSessionIds.length,
      signed_out: includeCurrent,
    });
  });
}
