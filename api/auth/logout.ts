import {
  enforceCanonicalRedirect,
  getSessionConfig,
  respondIfSessionEnvMissing,
  shouldUseSecureCookies,
  toCanonicalAppUrl,
} from '../_lib/env';
import { json, methodNotAllowed } from '../_lib/http';
import { clearSessionCookie } from '../_lib/session';
import { clearCsrfCookie } from '../_lib/csrf';

export default function handler(req: any, res: any) {
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

  const secure = shouldUseSecureCookies(config.appBaseUrl);
  clearSessionCookie(res, secure);
  clearCsrfCookie(res, secure);

  json(res, 200, {
    ok: true,
    redirectTo: toCanonicalAppUrl(config.appBaseUrl),
  });
}
