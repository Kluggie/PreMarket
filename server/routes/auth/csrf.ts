import {
  enforceCanonicalRedirect,
  getSessionConfig,
  respondIfSessionEnvMissing,
  shouldUseSecureCookies,
} from '../../_lib/env.js';
import { json, methodNotAllowed } from '../../_lib/http.js';
import { mintCsrfToken, setCsrfCookie } from '../../_lib/csrf.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

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

  json(res, 200, { csrfToken });
}
