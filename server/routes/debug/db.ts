import { sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, getDatabaseIdentitySnapshot } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function toResultRows(value: any) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.rows)) {
    return value.rows;
  }
  return [];
}

function asDateIso(value: unknown) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/debug/db', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const identity = getDatabaseIdentitySnapshot();
    let dbConnected = false;
    let schemaVersion = {
      available: false,
      migrationCount: null as number | null,
      latestMigrationAt: null as string | null,
      errorCode: null as string | null,
    };

    if (identity.configured) {
      try {
        const db = getDb();
        dbConnected = true;
        const migrationResult = await db.execute(
          sql`select count(*)::int as migration_count, max(created_at) as latest_migration_at from "__drizzle_migrations"`,
        );
        const migrationRow = toResultRows(migrationResult)[0] || {};
        const migrationCount = Number(migrationRow.migration_count || 0);
        schemaVersion = {
          available: true,
          migrationCount: Number.isFinite(migrationCount) ? migrationCount : 0,
          latestMigrationAt: asDateIso(migrationRow.latest_migration_at),
          errorCode: null,
        };
      } catch {
        schemaVersion = {
          available: false,
          migrationCount: null,
          latestMigrationAt: null,
          errorCode: 'migrations_table_unavailable',
        };
      }
    }

    ok(res, 200, {
      runtime: 'nodejs',
      vercelEnv: identity.vercelEnv,
      dbConfigured: identity.configured,
      dbConnected,
      sourceEnvKey: identity.sourceEnvKey,
      dbHost: identity.dbHost,
      dbName: identity.dbName,
      dbSchema: identity.dbSchema,
      dbUrlHash: identity.dbUrlHash,
      envPresence: identity.envPresence,
      alternativeDbUrlHashes: identity.alternativeDbUrlHashes,
      dbSchemaVersion: schemaVersion,
    });
  });
}
