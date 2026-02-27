import { and, eq } from 'drizzle-orm';
import { ApiError } from './errors.js';
import { enforceCanonicalRedirect, getSessionConfig, respondIfSessionEnvMissing } from './env.js';
import { getSessionFromRequest } from './session.js';
import { getDb, hasDatabaseUrl, schema } from './db/client.js';

function mapDatabaseUser(userRow, billingRow) {
  return {
    id: userRow.id,
    sub: userRow.id,
    email: userRow.email,
    name: userRow.fullName,
    full_name: userRow.fullName,
    picture: userRow.picture,
    role: userRow.role || 'user',
    plan_tier: billingRow?.plan || 'starter',
    subscription_status: billingRow?.status || 'inactive',
    stripe_customer_id: billingRow?.stripeCustomerId || null,
    stripe_subscription_id: billingRow?.stripeSubscriptionId || null,
    cancel_at_period_end: Boolean(billingRow?.cancelAtPeriodEnd),
    current_period_end: billingRow?.currentPeriodEnd || null,
    created_date: userRow.createdAt,
  };
}

async function upsertAuthUserFromSession(session) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.users)
    .values({
      id: session.sub,
      email: session.email,
      fullName: session.name || null,
      picture: session.picture || null,
      lastLoginAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: session.email,
        fullName: session.name || null,
        picture: session.picture || null,
        lastLoginAt: now,
        updatedAt: now,
      },
    });

  const [joinedRow] = await db
    .select({
      user: schema.users,
      billing: schema.billingReferences,
    })
    .from(schema.users)
    .leftJoin(
      schema.billingReferences,
      eq(schema.billingReferences.userId, schema.users.id),
    )
    .where(eq(schema.users.id, session.sub))
    .limit(1);

  if (!joinedRow?.user) {
    throw new ApiError(500, 'user_upsert_failed', 'Unable to persist user record');
  }

  return mapDatabaseUser(joinedRow.user, joinedRow.billing || null);
}

export async function requireUser(req, res) {
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

  const user = await upsertAuthUserFromSession(session);
  return {
    ok: true,
    user,
    session,
    config,
  };
}

export async function getUserById(userId) {
  const db = getDb();

  const [joinedRow] = await db
    .select({
      user: schema.users,
      billing: schema.billingReferences,
    })
    .from(schema.users)
    .leftJoin(
      schema.billingReferences,
      eq(schema.billingReferences.userId, schema.users.id),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!joinedRow?.user) {
    return null;
  }

  return mapDatabaseUser(joinedRow.user, joinedRow.billing || null);
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
