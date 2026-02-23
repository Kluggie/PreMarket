import { eq, inArray, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { getSessionFromRequest } from '../../_lib/session.js';

const BETA_LIMIT = 50;
const ALLOWED_SOURCES = new Set(['pricing']);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSource(value: unknown) {
  const source = asText(value).toLowerCase();
  if (!source) {
    return 'pricing';
  }
  if (ALLOWED_SOURCES.has(source)) {
    return source;
  }
  return 'pricing';
}

function getOptionalSessionUserId(req: any) {
  const sessionSecret = asText(process.env.SESSION_SECRET);
  if (!sessionSecret) {
    return null;
  }

  const session = getSessionFromRequest(req, sessionSecret);
  if (!session?.sub) {
    return null;
  }

  return asText(session.sub) || null;
}

async function getOptionalUserId(req: any, db: any) {
  const sessionUserId = getOptionalSessionUserId(req);
  if (!sessionUserId) {
    return null;
  }

  const [existing] = await db
    .select({
      id: schema.users.id,
    })
    .from(schema.users)
    .where(eq(schema.users.id, sessionUserId))
    .limit(1);

  return existing?.id || null;
}

async function getClaimedCount(db: any) {
  const [row] = await db
    .select({
      claimed: sql<number>`cast(count(*) as integer)`,
    })
    .from(schema.betaApplications)
    .where(inArray(schema.betaApplications.status, ['applied', 'approved']));

  return Number(row?.claimed || 0);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/beta/apply', async () => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const source = normalizeSource(body.source);

    if (!email || !isLikelyEmail(email)) {
      throw new ApiError(400, 'invalid_input', 'A valid email is required');
    }

    const db = getDb();
    const now = new Date();
    const userId = await getOptionalUserId(req, db);

    await db
      .insert(schema.betaApplications)
      .values({
        id: newId('beta_app'),
        email,
        status: 'applied',
        userId,
        source,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.betaApplications.email,
        set: {
          status: 'applied',
          source,
          ...(userId ? { userId } : {}),
          updatedAt: now,
        },
      });

    const claimed = await getClaimedCount(db);

    ok(res, 200, {
      claimed,
      limit: BETA_LIMIT,
      applied: true,
    });
  });
}
