import { enforceCanonicalRedirect, getSessionConfig, respondIfSessionEnvMissing } from '../_lib/env';
import { json, methodNotAllowed } from '../_lib/http';
import { getSessionFromRequest } from '../_lib/session';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
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

  if (!session) {
    json(res, 401, { authenticated: false });
    return;
  }

  json(res, 200, {
    authenticated: true,
    user: {
      id: session.sub,
      sub: session.sub,
      email: session.email,
      name: session.name,
      full_name: session.name,
      picture: session.picture,
      hd: session.hd,
    },
  });
}
