import { sql } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from '../_lib/db/client.js';
import { getEnvReadiness } from '../_lib/env.js';
import { json, methodNotAllowed } from '../_lib/http.js';
import { getIntegrationsReadiness } from '../_lib/integrations.js';

const REQUIRED_SHARED_LINK_COLUMNS = ['authorized_user_id', 'authorized_email', 'authorized_at'] as const;

function asBool(value: unknown) {
  if (value === true || value === 1 || value === '1' || value === 't' || value === 'true') {
    return true;
  }
  return false;
}

async function getRecipientAuthorizationSchemaStatus(db: any) {
  const columnRows = await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_links'
      and column_name in ('authorized_user_id', 'authorized_email', 'authorized_at')
  `);
  const availableColumns = new Set(
    (columnRows?.rows || []).map((row: any) => String(row?.column_name || '').trim().toLowerCase()),
  );
  const missing = REQUIRED_SHARED_LINK_COLUMNS.filter((columnName) => !availableColumns.has(columnName));

  const tableRows = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'shared_link_verifications'
    ) as present
  `);
  const hasVerificationTable = asBool((tableRows?.rows || [])[0]?.present);
  if (!hasVerificationTable) {
    missing.push('shared_link_verifications');
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

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
    schemaReady: false,
    missingSchema: [] as string[],
    schemaCheck: 'not_run' as 'not_run' | 'ok' | 'failed',
  };

  if (database.configured) {
    try {
      const db = getDb();
      await db.execute(sql`select 1 as ok`);
      const schemaStatus = await getRecipientAuthorizationSchemaStatus(db);
      database = {
        configured: true,
        connected: true,
        schemaReady: schemaStatus.ready,
        missingSchema: schemaStatus.missing,
        schemaCheck: 'ok',
      };
    } catch {
      database = {
        configured: true,
        connected: false,
        schemaReady: false,
        missingSchema: [],
        schemaCheck: 'failed',
      };
    }
  }

  const schemaErrorCode =
    database.schemaCheck === 'failed'
      ? 'schema_check_failed'
      : database.connected && !database.schemaReady
        ? 'schema_missing'
        : null;
  const healthy = Boolean(requiredEnvReady && database.connected && database.schemaReady);

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
    internalError: schemaErrorCode,
    env,
    integrations,
  });
}
