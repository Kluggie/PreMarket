import { hasDatabaseUrl } from '../../_lib/db/client.js';
import { getEnvReadiness } from '../../_lib/env.js';
import { json, methodNotAllowed } from '../../_lib/http.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  const readiness = getEnvReadiness();

  json(res, 200, {
    csrfConfigured: Boolean(readiness.APP_BASE_URL && readiness.SESSION_SECRET),
    sessionConfigured: Boolean(readiness.SESSION_SECRET),
    dbConfigured: hasDatabaseUrl(),
  });
}
