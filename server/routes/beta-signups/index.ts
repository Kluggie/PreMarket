import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { getSessionFromRequest } from '../../_lib/session.js';

const BETA_SEATS_TOTAL = 50;
const PROMO_TRIAL_DAYS = 30;
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
  const [existingCurrentSignup] = await db
    .select({
      id: schema.betaSignups.id,
    })
    .from(schema.betaSignups)
    .where(eq(schema.betaSignups.emailNormalized, emailNormalized))
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
    if (!existingCurrentSignup && existingLegacySignup) {
      await db
        .insert(schema.betaSignups)
        .values({
          id: randomUUID(),
          email: asText(existingLegacySignup.email) || email,
          emailNormalized,
          userId,
          source: normalizeSource(existingLegacySignup.source || source),
          createdAt: new Date(),
        })
        .onConflictDoNothing({
          target: schema.betaSignups.emailNormalized,
        });
    }

    const seatsClaimed = await getSeatsClaimed(db);

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

  const inserted = await db
    .insert(schema.betaSignups)
    .values({
      id: randomUUID(),
      email,
      emailNormalized,
      userId,
      source,
      trialEndsAt: new Date(Date.now() + PROMO_TRIAL_DAYS * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: schema.betaSignups.emailNormalized,
    })
    .returning({ id: schema.betaSignups.id });

  const seatsClaimed = await getSeatsClaimed(db);

  if (!inserted.length) {
    throw new ApiError(409, 'already_signed_up', "You're already signed up.", {
      seatsClaimed,
      seatsTotal: BETA_SEATS_TOTAL,
    });
  }

  logEvent('insert_success', {
    emailNormalized,
    seatsClaimed,
    source,
    hadUserId: Boolean(userId),
  });

  ok(res, 200, {
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
