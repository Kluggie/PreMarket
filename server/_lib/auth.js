import { and, eq, or, sql } from 'drizzle-orm';
import { createAuthSession, getAuthSessionForUser, maybeTouchAuthSessionLastSeen } from './auth-sessions.js';
import { ApiError } from './errors.js';
import {
  enforceCanonicalRedirect,
  getSessionConfig,
  respondIfSessionEnvMissing,
  shouldUseSecureCookies,
} from './env.js';
import { createSessionToken, getSessionFromRequest, setSessionCookie } from './session.js';
import { getDb, hasDatabaseUrl, schema } from './db/client.js';

const EARLY_ACCESS_BILLING_ALIASES = new Set([
  'early_access',
  'early-access',
  'early access',
  'early_access_program',
  'early-access-program',
  'early access program',
]);

function resolvePlanTier(billingRow, betaRow) {
  if (billingRow?.plan) {
    return billingRow.plan;
  }
  // No billing row: the betaSignups table is exclusively for early-access
  // members. Any entry here means the user is in Early Access, regardless of
  // the source column value (e.g. 'pricing', 'early_access', null, etc.).
  if (betaRow) {
    return 'early_access';
  }
  return 'starter';
}

function mapDatabaseUser(userRow, billingRow, betaRow = null) {
  return {
    id: userRow.id,
    sub: userRow.id,
    email: userRow.email,
    name: userRow.fullName,
    full_name: userRow.fullName,
    picture: userRow.picture,
    role: userRow.role || 'user',
    plan_tier: resolvePlanTier(billingRow, betaRow),
    subscription_status: billingRow?.status || 'inactive',
    stripe_customer_id: billingRow?.stripeCustomerId || null,
    stripe_subscription_id: billingRow?.stripeSubscriptionId || null,
    cancel_at_period_end: Boolean(billingRow?.cancelAtPeriodEnd),
    current_period_end: billingRow?.currentPeriodEnd || null,
    created_date: userRow.createdAt,
  };
}

export async function upsertAuthUserFromSession(session, options = {}) {
  const db = getDb();
  const now = new Date();
  const updateLastLogin = options.updateLastLogin !== false;

  const upsertValues = {
    email: session.email,
    fullName: session.name || null,
    picture: session.picture || null,
    updatedAt: now,
  };
  if (updateLastLogin) {
    upsertValues.lastLoginAt = now;
  }

  await db
    .insert(schema.users)
    .values({
      id: session.sub,
      email: session.email,
      fullName: session.name || null,
      picture: session.picture || null,
      lastLoginAt: updateLastLogin ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: upsertValues,
    });

  const [joinedRow] = await db
    .select({
      user: schema.users,
      billing: schema.billingReferences,
      beta: schema.betaSignups,
    })
    .from(schema.users)
    .leftJoin(
      schema.billingReferences,
      eq(schema.billingReferences.userId, schema.users.id),
    )
    .leftJoin(
      schema.betaSignups,
      or(
        eq(schema.betaSignups.userId, schema.users.id),
        eq(schema.betaSignups.emailNormalized, sql`lower(trim(${schema.users.email}))`),
      ),
    )
    .where(eq(schema.users.id, session.sub))
    .limit(1);

  if (!joinedRow?.user) {
    throw new ApiError(500, 'user_upsert_failed', 'Unable to persist user record');
  }

  return mapDatabaseUser(joinedRow.user, joinedRow.billing || null, joinedRow.beta || null);
}

function toSessionIdentity(session) {
  return {
    sub: session.sub,
    email: session.email,
    name: session.name,
    picture: session.picture,
    hd: session.hd,
  };
}

async function ensurePersistedSession(req, res, config, session) {
  let sessionId = typeof session.sid === 'string' ? session.sid.trim() : '';

  if (!sessionId) {
    // auth_sessions.user_id has an FK to users.id, so ensure a user row exists
    // before creating a persisted session for first-request cookies.
    await upsertAuthUserFromSession(session, { updateLastLogin: false });

    const created = await createAuthSession({
      userId: session.sub,
      req,
      mfaPassed: Boolean(session.mfa_passed),
    });

    if (!created?.id) {
      throw new ApiError(500, 'session_persist_failed', 'Unable to initialize session');
    }

    sessionId = created.id;
    session.sid = sessionId;

    const rotatedToken = createSessionToken(toSessionIdentity(session), config.sessionSecret, undefined, {
      sessionId,
      mfaRequired: Boolean(session.mfa_required),
      mfaPassed: Boolean(session.mfa_passed),
    });
    setSessionCookie(res, rotatedToken, shouldUseSecureCookies(req, config.appBaseUrl));
    return created;
  }

  const existing = await getAuthSessionForUser(sessionId, session.sub);
  if (!existing || existing.revokedAt) {
    throw new ApiError(401, 'unauthorized', 'Authentication required');
  }

  return maybeTouchAuthSessionLastSeen(existing);
}

export async function requireUser(req, res, options = {}) {
  if (respondIfSessionEnvMissing(res)) {
    return { ok: false, handled: true };
  }

  if (!hasDatabaseUrl()) {
    throw new ApiError(503, 'not_configured', 'DATABASE_URL is required for authenticated routes');
  }

  const config = getSessionConfig();

  if (enforceCanonicalRedirect(req, res, config.appBaseUrl)) {
    return { ok: false, handled: true };
  }

  const session = getSessionFromRequest(req, config.sessionSecret);

  if (!session) {
    throw new ApiError(401, 'unauthorized', 'Authentication required');
  }

  const persistedSession = await ensurePersistedSession(req, res, config, session);

  const mfaRequired = Boolean(session.mfa_required);
  const mfaPassed = mfaRequired ? Boolean(session.mfa_passed) : true;
  const allowPendingMfa = Boolean(options.allowPendingMfa);

  if (mfaRequired && !mfaPassed && !allowPendingMfa) {
    throw new ApiError(401, 'mfa_required', 'Two-factor authentication required');
  }

  const user = await upsertAuthUserFromSession(session);
  return {
    ok: true,
    user,
    session,
    sessionId: session.sid || null,
    sessionRecord: persistedSession,
    mfaPending: mfaRequired && !mfaPassed,
    config,
  };
}

export async function getUserById(userId) {
  const db = getDb();

  const [joinedRow] = await db
    .select({
      user: schema.users,
      billing: schema.billingReferences,
      beta: schema.betaSignups,
    })
    .from(schema.users)
    .leftJoin(
      schema.billingReferences,
      eq(schema.billingReferences.userId, schema.users.id),
    )
    .leftJoin(
      schema.betaSignups,
      or(
        eq(schema.betaSignups.userId, schema.users.id),
        eq(schema.betaSignups.emailNormalized, sql`lower(trim(${schema.users.email}))`),
      ),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!joinedRow?.user) {
    return null;
  }

  return mapDatabaseUser(joinedRow.user, joinedRow.billing || null, joinedRow.beta || null);
}

export async function assertProposalOwnership(userId, proposalId) {
  const db = getDb();

  const [proposal] = await db
    .select()
    .from(schema.proposals)
    .where(and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, userId)))
    .limit(1);

  if (!proposal) {
    throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
  }

  return proposal;
}
