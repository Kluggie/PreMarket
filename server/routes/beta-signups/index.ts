import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { getSessionFromRequest } from '../../_lib/session.js';

const BETA_SEATS_TOTAL = 50;
const PROMO_TRIAL_DAYS = 30;
const FIRST_50_TRIAL_SOURCE = 'first_50_professional_offer';
const MAX_EMAIL_LENGTH = 320;
const MAX_SOURCE_LENGTH = 64;

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
  const normalized = asText(value).toLowerCase();
  if (!normalized) {
    return 'landing';
  }
  return normalized.slice(0, MAX_SOURCE_LENGTH);
}

function shouldLog() {
  return process.env.NODE_ENV !== 'production';
}

function logEvent(event: string, payload: Record<string, unknown>) {
  if (!shouldLog()) {
    return;
  }

  console.info(
    JSON.stringify({
      level: 'info',
      route: 'beta_signups',
      event,
      ...payload,
    }),
  );
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
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, sessionUserId))
    .limit(1);

  return existing?.id || null;
}

async function getSeatsClaimed(db: any) {
  const currentRows = await db
    .select({
      emailNormalized: schema.betaSignups.emailNormalized,
    })
    .from(schema.betaSignups);

  const legacyRows = await db
    .select({
      email: schema.betaApplications.email,
    })
    .from(schema.betaApplications)
    .where(inArray(schema.betaApplications.status, ['applied', 'approved']));

  const uniqueEmails = new Set<string>();

  for (const row of currentRows) {
    const normalized = normalizeEmail(row?.emailNormalized);
    if (normalized) {
      uniqueEmails.add(normalized);
    }
  }

  for (const row of legacyRows) {
    const normalized = normalizeEmail(row?.email);
    if (normalized) {
      uniqueEmails.add(normalized);
    }
  }

  return uniqueEmails.size;
}

function isProductionRuntime() {
  const runtimeEnv = String(process.env.VERCEL_ENV || process.env.NODE_ENV || '').toLowerCase();
  return runtimeEnv === 'production';
}

async function handleCreate(req: any, res: any) {
  const body = await readJsonBody(req);
  const email = asText(body.email);
  const emailNormalized = normalizeEmail(body.email);
  const source = normalizeSource(body.source);

  if (!email || email.length > MAX_EMAIL_LENGTH || !isLikelyEmail(emailNormalized)) {
    throw new ApiError(400, 'invalid_input', 'A valid email is required');
  }

  const db = getDb();
  const userId = await getOptionalUserId(req, db);
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + PROMO_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const userIdParam = userId || '';

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
    duplicate_claim as (
      select (
        exists (
          select 1
          from beta_signups
          where email_normalized = ${emailNormalized}
             or (${userIdParam} <> '' and user_id = ${userIdParam})
        )
        or exists (
          select 1
          from beta_applications
          where status in ('applied', 'approved')
            and lower(trim(coalesce(email, ''))) = ${emailNormalized}
        )
      ) as found
    )
    insert into beta_signups (
      id,
      email,
      email_normalized,
      user_id,
      source,
      trial_ends_at,
      created_at
    )
    select
      ${randomUUID()},
      ${email},
      ${emailNormalized},
      ${userId},
      ${FIRST_50_TRIAL_SOURCE},
      ${trialEndsAt},
      ${now}
    from trial_lock, seat_count, duplicate_claim
    where seat_count.claimed < ${BETA_SEATS_TOTAL}
      and duplicate_claim.found = false
    on conflict (email_normalized) do nothing
    returning id
  `);

  const insertedRows = Array.isArray(insertResult)
    ? insertResult
    : Array.isArray((insertResult as any)?.rows)
      ? (insertResult as any).rows
      : [];

  const seatsClaimed = await getSeatsClaimed(db);

  if (insertedRows[0]?.id) {
    logEvent('insert_success', {
      emailNormalized,
      seatsClaimed,
      source,
      trialSource: FIRST_50_TRIAL_SOURCE,
      trialEndsAt: trialEndsAt.toISOString(),
      hadUserId: Boolean(userId),
    });

    ok(res, 200, {
      seatsClaimed,
      seatsTotal: BETA_SEATS_TOTAL,
      trialEndsAt,
    });
    return;
  }

  const duplicateConditions = userId
    ? or(eq(schema.betaSignups.emailNormalized, emailNormalized), eq(schema.betaSignups.userId, userId))
    : eq(schema.betaSignups.emailNormalized, emailNormalized);

  const [existingCurrentSignup] = await db
    .select({
      id: schema.betaSignups.id,
    })
    .from(schema.betaSignups)
    .where(duplicateConditions)
    .limit(1);

  const [existingLegacySignup] = await db
    .select({
      id: schema.betaApplications.id,
      email: schema.betaApplications.email,
      source: schema.betaApplications.source,
    })
    .from(schema.betaApplications)
    .where(
      and(
        inArray(schema.betaApplications.status, ['applied', 'approved']),
        sql`trim(coalesce(${schema.betaApplications.email}, '')) <> ''`,
        sql`lower(trim(${schema.betaApplications.email})) = ${emailNormalized}`,
      ),
    )
    .limit(1);

  if (existingCurrentSignup || existingLegacySignup) {
    logEvent('insert_duplicate', {
      emailNormalized,
      seatsClaimed,
      source,
      hadUserId: Boolean(userId),
      inLegacy: Boolean(existingLegacySignup),
      inCurrent: Boolean(existingCurrentSignup),
    });

    throw new ApiError(409, 'already_signed_up', "You're already signed up.", {
      seatsClaimed,
      seatsTotal: BETA_SEATS_TOTAL,
    });
  }

  logEvent('insert_full', {
    emailNormalized,
    seatsClaimed,
    source,
    hadUserId: Boolean(userId),
  });

  throw new ApiError(409, 'trial_offer_full', 'The first 50 Professional trial seats have already been claimed.', {
    seatsClaimed,
    seatsTotal: BETA_SEATS_TOTAL,
  });
}

async function handleList(req: any, res: any, context: any) {
  const auth = await requireUser(req, res);
  if (!auth.ok) {
    return;
  }

  context.userId = auth.user.id;

  if (isProductionRuntime() && auth.user.role !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Admin access required');
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.betaSignups.id,
      email: schema.betaSignups.email,
      createdAt: schema.betaSignups.createdAt,
      source: schema.betaSignups.source,
    })
    .from(schema.betaSignups)
    .orderBy(desc(schema.betaSignups.createdAt))
    .limit(1000);

  ok(res, 200, {
    seatsClaimed: rows.length,
    seatsTotal: BETA_SEATS_TOTAL,
    signups: rows,
  });
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/beta-signups', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    if (req.method === 'GET') {
      return handleList(req, res, context);
    }

    return handleCreate(req, res);
  });
}
