import { getEnvReadiness } from './_lib/env';
import { json, methodNotAllowed } from './_lib/http';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  const env = getEnvReadiness();
  const healthy = env.APP_BASE_URL && env.SESSION_SECRET && env.GOOGLE_CLIENT_ID;

  json(res, healthy ? 200 : 500, {
    status: healthy ? 'healthy' : 'unhealthy',
    deployment: {
      vercelEnv: process.env.VERCEL_ENV || null,
      nodeEnv: process.env.NODE_ENV || null,
      region: process.env.VERCEL_REGION || null,
    },
    version: {
      appVersion: process.env.npm_package_version || null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null,
    },
    env,
  });
}
