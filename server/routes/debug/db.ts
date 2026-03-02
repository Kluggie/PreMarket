import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, getDatabaseIdentitySnapshot } from '../../_lib/db/client.js';
import { getSessionConfig } from '../../_lib/env.js';
import { getSessionFromRequest } from '../../_lib/session.js';
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

function getRequestHost(req: any): string | null {
  const host = req?.headers?.host || req?.headers?.['x-forwarded-host'];
  return typeof host === 'string' ? host.trim() : null;
}

function shortHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/**
 * Soft auth: tries to parse session without requiring it.
 * Returns auth info without throwing 401 — used by debug diagnostics so
 * operators can call this endpoint even when their session is broken/expired.
 */
function tryGetSessionInfo(req: any): {
  present: boolean;
  reason: string | null;
  userId: string | null;
  email: string | null;
} {
  try {
    const config = getSessionConfig();
    const session = getSessionFromRequest(req, config.sessionSecret);
    if (session) {
      return {
        present: true,
        reason: null,
        userId: session.sub,
        email: session.email,
      };
    }
    return { present: false, reason: 'cookie_missing_or_invalid', userId: null, email: null };
  } catch {
    // getSessionConfig() throws if SESSION_SECRET or APP_BASE_URL is missing
    return { present: false, reason: 'session_config_missing', userId: null, email: null };
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/debug/db', async (context) => {
    ensureMethod(req, ['GET']);

    // Soft auth: diagnose without requiring session
    const sessionInfo = tryGetSessionInfo(req);
    if (sessionInfo.userId) {
      context.userId = sessionInfo.userId;
    }

    const identity = getDatabaseIdentitySnapshot();
    const requestHost = getRequestHost(req);
    const effectiveBaseUrl = (process.env.APP_BASE_URL || '').trim() || null;
    const currentUserIdHash = shortHash(sessionInfo.userId);

    let dbConnected = false;
    let schemaVersion = {
      available: false,
      migrationCount: null as number | null,
      latestMigrationAt: null as string | null,
      errorCode: null as string | null,
    };
    let proposalCountTotal: number | null = null;
    let proposalCountForUserId: number | null = null;
    let proposalCountSent: number | null = null;
    let proposalCountReceived: number | null = null;

    if (identity.configured) {
      try {
        const db = getDb();
        dbConnected = true;

        // Query migrations table
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

        // Total proposal count (always, regardless of auth)
        const totalResult = await db.execute(
          sql`select count(*)::int as proposal_count from proposals`,
        );
        const totalRow = toResultRows(totalResult)[0] || {};
        proposalCountTotal = Number.isFinite(Number(totalRow.proposal_count))
          ? Number(totalRow.proposal_count)
          : null;

        // Per-user counts (only when session is present)
        if (sessionInfo.present && sessionInfo.userId) {
          const userId = sessionInfo.userId;
          const userEmail = (sessionInfo.email || '').trim().toLowerCase();

          const perUserResult = await db.execute(sql`
            select
              (select count(*)::int from proposals where user_id = ${userId}) as user_count,
              (select count(*)::int from proposals
                where sent_at is not null
                  and (user_id = ${userId}
                    or (${userEmail} <> '' and lower(party_a_email) = ${userEmail}))
              ) as sent_count,
              (select count(*)::int from proposals
                where sent_at is not null
                  and ${userEmail} <> ''
                  and lower(party_b_email) = ${userEmail}
                  and user_id <> ${userId}
              ) as received_count
          `);
          const perUserRow = toResultRows(perUserResult)[0] || {};
          proposalCountForUserId = Number.isFinite(Number(perUserRow.user_count))
            ? Number(perUserRow.user_count)
            : null;
          proposalCountSent = Number.isFinite(Number(perUserRow.sent_count))
            ? Number(perUserRow.sent_count)
            : null;
          proposalCountReceived = Number.isFinite(Number(perUserRow.received_count))
            ? Number(perUserRow.received_count)
            : null;
        }
      } catch {
        schemaVersion = {
          available: false,
          migrationCount: null,
          latestMigrationAt: null,
          errorCode: 'migrations_table_unavailable',
        };
      }
    }

    // Structured diagnostic log — safe to ship to log drains
    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/debug/db',
        message: 'DB identity + auth diagnostic',
        vercelEnv: identity.vercelEnv,
        requestHost,
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || null,
        dbUrlHash: identity.dbUrlHash,
        dbHost: identity.dbHost,
        dbName: identity.dbName,
        proposalCountTotal,
        authPresent: sessionInfo.present,
        authReason: sessionInfo.reason,
        currentUserIdHash,
      }),
    );

    ok(res, 200, {
      runtime: 'nodejs',
      vercelEnv: identity.vercelEnv,
      requestHost,
      effectiveBaseUrl,
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || null,
      vercelUrl: process.env.VERCEL_URL || null,
      // Auth diagnostics
      authPresent: sessionInfo.present,
      authReason: sessionInfo.reason,
      currentUserIdHash,
      // DB identity
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
      // Persistence diagnostics (no raw emails/IDs returned)
      proposalCountTotal,
      proposalCountForUserId,
      proposalCountSent,
      proposalCountReceived,
    });
  });
}
