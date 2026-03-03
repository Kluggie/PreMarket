import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { revokeAuthSessionForUser } from '../../../_lib/auth-sessions.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { shouldUseSecureCookies } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { clearSessionCookie } from '../../../_lib/session.js';
import { clearCsrfCookie } from '../../../_lib/csrf.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/sessions/revoke', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const sessionId = asText(body.sessionId || body.session_id);
    if (!sessionId) {
      throw new ApiError(400, 'invalid_input', 'sessionId is required');
    }

    const revoked = await revokeAuthSessionForUser({
      userId: auth.user.id,
      sessionId,
    });
    if (!revoked) {
      throw new ApiError(404, 'session_not_found', 'Session not found');
    }

    const isCurrent = Boolean(auth.sessionId && sessionId === auth.sessionId);
    if (isCurrent) {
      const secure = shouldUseSecureCookies(req, auth.config.appBaseUrl);
      clearSessionCookie(res, secure);
      clearCsrfCookie(res, secure);
    }

    await logAuditEventBestEffort({
      eventType: 'auth.session.revoked',
      userId: auth.user.id,
      req,
      metadata: {
        session_id: sessionId,
        current_session: isCurrent,
      },
    });

    ok(res, 200, {
      revoked: true,
      session_id: sessionId,
      signed_out: isCurrent,
    });
  });
}
