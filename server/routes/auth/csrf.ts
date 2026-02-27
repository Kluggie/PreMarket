import {
  enforceCanonicalRedirect,
  getSessionConfig,
  respondIfSessionEnvMissing,
  shouldUseSecureCookies,
} from '../../_lib/env.js';
import { ok } from '../../_lib/api-response.js';
import { mintCsrfToken, setCsrfCookie } from '../../_lib/csrf.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/auth/csrf', async () => {
    ensureMethod(req, ['GET']);

    if (respondIfSessionEnvMissing(res)) {
      return;
    }

    const sessionConfig = getSessionConfig();

    if (enforceCanonicalRedirect(req, res, sessionConfig.appBaseUrl)) {
      return;
    }

    const csrfToken = mintCsrfToken(sessionConfig.sessionSecret);
    const secure = shouldUseSecureCookies(req, sessionConfig.appBaseUrl);
    setCsrfCookie(res, csrfToken, secure);

    ok(res, 200, { csrfToken });
  });
}
