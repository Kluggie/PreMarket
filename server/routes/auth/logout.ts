import {
  enforceCanonicalRedirect,
  getSessionConfig,
  respondIfSessionEnvMissing,
  shouldUseSecureCookies,
  toCanonicalAppUrl,
} from '../../_lib/env.js';
import { json, methodNotAllowed } from '../../_lib/http.js';
import { clearSessionCookie, getSessionFromRequest } from '../../_lib/session.js';
import { clearCsrfCookie } from '../../_lib/csrf.js';
import { revokeAuthSessionForUser } from '../../_lib/auth-sessions.js';
import { logAuditEventBestEffort } from '../../_lib/audit-events.js';
import { hasDatabaseUrl } from '../../_lib/db/client.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  if (respondIfSessionEnvMissing(res)) {
    return;
  }

  const config = getSessionConfig();

  if (enforceCanonicalRedirect(req, res, config.appBaseUrl)) {
    return;
  }

  const session = getSessionFromRequest(req, config.sessionSecret);
  if (session?.sub && session?.sid && hasDatabaseUrl()) {
    try {
      await revokeAuthSessionForUser({
        userId: session.sub,
        sessionId: session.sid,
      });
      await logAuditEventBestEffort({
        eventType: 'auth.logout',
        userId: session.sub,
        req,
        metadata: {
          session_id: session.sid,
        },
      });
    } catch {
      // Best effort: local cookie clear should still complete.
    }
  }

  const secure = shouldUseSecureCookies(req, config.appBaseUrl);
  clearSessionCookie(res, secure);
  clearCsrfCookie(res, secure);

  json(res, 200, {
    ok: true,
    redirectTo: toCanonicalAppUrl(config.appBaseUrl),
  });
}
