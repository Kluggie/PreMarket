import { eq, sql } from 'drizzle-orm';
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
  const result = await db.execute(sql`
    select count(distinct email_normalized)::int as claimed
    from (
      select lower(trim(email_normalized)) as email_normalized
      from beta_signups
      where trim(coalesce(email_normalized, '')) <> ''
      union
      select lower(trim(email)) as email_normalized
      from beta_applications
      where status in ('applied', 'approved')
        and trim(coalesce(email, '')) <> ''
    ) seats
  `);
  const rows = Array.isArray(result)
    ? result
    : Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : [];

  return Number(rows[0]?.claimed || 0);
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
    const insertResult = await db.execute(sql`
      with trial_lock as (
        select pg_advisory_xact_lock(hashtext('first_50_professional_trial'))
      ),
      seat_count as (
        select count(distinct email_normalized)::int as claimed
        from (
          select lower(trim(email_normalized)) as email_normalized
          from beta_signups
          where trim(coalesce(email_normalized, '')) <> ''
          union
          select lower(trim(email)) as email_normalized
          from beta_applications
          where status in ('applied', 'approved')
            and trim(coalesce(email, '')) <> ''
        ) seats
      ),
      existing_application as (
        select exists (
          select 1
          from beta_applications
          where email = ${email}
        ) as found
      )
      insert into beta_applications (
        id,
        email,
        status,
        user_id,
        source,
        created_at,
        updated_at
      )
      select
        ${newId('beta_app')},
        ${email},
        'applied',
        ${userId},
        ${source},
        ${now},
        ${now}
      from trial_lock, seat_count, existing_application
      where existing_application.found = true
         or seat_count.claimed < ${BETA_LIMIT}
      on conflict (email) do update set
        status = 'applied',
        source = excluded.source,
        user_id = coalesce(excluded.user_id, beta_applications.user_id),
        updated_at = excluded.updated_at
      returning id
    `);
    const insertedRows = Array.isArray(insertResult)
      ? insertResult
      : Array.isArray((insertResult as any)?.rows)
        ? (insertResult as any).rows
        : [];

    const claimed = await getClaimedCount(db);

    if (!insertedRows[0]?.id) {
      throw new ApiError(409, 'trial_offer_full', 'The first 50 Professional trial seats have already been claimed.', {
        claimed,
        limit: BETA_LIMIT,
      });
    }

    ok(res, 200, {
      claimed,
      limit: BETA_LIMIT,
      applied: true,
    });
  });
}
