import { json, methodNotAllowed } from '../../_lib/http.js';
import { getVertexConfigSnapshot } from '../../_lib/integrations.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  json(res, 200, {
    ...getVertexConfigSnapshot(),
    deployment: {
      vercelEnv: process.env.VERCEL_ENV || null,
      nodeEnv: process.env.NODE_ENV || null,
      region: process.env.VERCEL_REGION || null,
    },
  });
}
