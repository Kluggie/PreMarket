import { sql } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from '../_lib/db/client.js';
import { getEnvReadiness } from '../_lib/env.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { getIntegrationsReadiness } from '../_lib/integrations.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET']);
    return;
  }

  const env = getEnvReadiness();
  const integrations = getIntegrationsReadiness();
  const requiredEnvReady =
    env.APP_BASE_URL && env.SESSION_SECRET && env.GOOGLE_CLIENT_ID && env.DATABASE_URL;
  let database = {
    configured: hasDatabaseUrl(),
    connected: false,
  };

  if (database.configured) {
    try {
      const db = getDb();
      await db.execute(sql`select 1 as ok`);
      database = {
        configured: true,
        connected: true,
      };
    } catch {
      database = {
        configured: true,
        connected: false,
      };
    }
  }

  const healthy = Boolean(requiredEnvReady && database.connected);

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
    database,
    env,
    integrations,
  });
}
