import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { newId } from './ids.js';
import { asText, getRequestUserAgent, hashRequestIp } from './security.js';

export const SESSION_LAST_SEEN_WRITE_THROTTLE_MS = 10 * 60 * 1000;

export function normalizeSessionId(value: unknown) {
  return asText(value);
}

export async function createAuthSession(params: {
  userId: string;
  req?: any;
  sessionId?: string | null;
  mfaPassed?: boolean;
  now?: Date;
}) {
  const db = getDb();
  const now = params.now || new Date();
  const sessionId = normalizeSessionId(params.sessionId) || newId('sess');

  const [created] = await db
    .insert(schema.authSessions)
    .values({
      id: sessionId,
      userId: asText(params.userId),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
      ipHash: params.req ? hashRequestIp(params.req) : null,
      userAgent: params.req ? getRequestUserAgent(params.req) : null,
      deviceLabel: null,
      mfaPassedAt: params.mfaPassed ? now : null,
    })
    .returning();

  return created || null;
}

export async function getAuthSessionForUser(sessionId: string, userId: string) {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.authSessions)
    .where(
      and(eq(schema.authSessions.id, asText(sessionId)), eq(schema.authSessions.userId, asText(userId))),
    )
    .limit(1);

  return session || null;
}

export async function maybeTouchAuthSessionLastSeen(session: any, now = new Date()) {
  if (!session) {
    return session;
  }

  const lastSeenAt = session.lastSeenAt ? new Date(session.lastSeenAt) : null;
  if (lastSeenAt && now.getTime() - lastSeenAt.getTime() < SESSION_LAST_SEEN_WRITE_THROTTLE_MS) {
    return session;
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.authSessions)
    .set({
      lastSeenAt: now,
    })
    .where(eq(schema.authSessions.id, session.id))
    .returning();

  return updated || session;
}

export async function listActiveAuthSessionsForUser(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.authSessions)
    .where(and(eq(schema.authSessions.userId, asText(userId)), isNull(schema.authSessions.revokedAt)))
    .orderBy(desc(schema.authSessions.lastSeenAt));
}

export async function revokeAuthSessionForUser(params: {
  userId: string;
  sessionId: string;
  now?: Date;
}) {
  const db = getDb();
  const now = params.now || new Date();

  const [updated] = await db
    .update(schema.authSessions)
    .set({
      revokedAt: now,
    })
    .where(
      and(
        eq(schema.authSessions.id, asText(params.sessionId)),
        eq(schema.authSessions.userId, asText(params.userId)),
        isNull(schema.authSessions.revokedAt),
      ),
    )
    .returning();

  return updated || null;
}

export async function revokeAllAuthSessionsForUser(params: {
  userId: string;
  exceptSessionId?: string | null;
  includeCurrent?: boolean;
  now?: Date;
}) {
  const db = getDb();
  const now = params.now || new Date();
  const includeCurrent = Boolean(params.includeCurrent);
  const exceptSessionId = normalizeSessionId(params.exceptSessionId);

  const base = [
    eq(schema.authSessions.userId, asText(params.userId)),
    isNull(schema.authSessions.revokedAt),
  ];

  if (!includeCurrent && exceptSessionId) {
    base.push(ne(schema.authSessions.id, exceptSessionId));
  }

  const rows = await db
    .update(schema.authSessions)
    .set({
      revokedAt: now,
    })
    .where(and(...base))
    .returning({
      id: schema.authSessions.id,
    });

  return rows.map((row) => row.id);
}

export async function markAuthSessionMfaPassed(params: {
  userId: string;
  sessionId: string;
  now?: Date;
}) {
  const db = getDb();
  const now = params.now || new Date();

  const [updated] = await db
    .update(schema.authSessions)
    .set({
      mfaPassedAt: now,
      lastSeenAt: now,
    })
    .where(
      and(
        eq(schema.authSessions.id, asText(params.sessionId)),
        eq(schema.authSessions.userId, asText(params.userId)),
      ),
    )
    .returning();

  return updated || null;
}

export async function getRevokedAuthSessionIdsForUser(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.authSessions.id,
    })
    .from(schema.authSessions)
    .where(and(eq(schema.authSessions.userId, asText(userId)), sql`${schema.authSessions.revokedAt} is not null`));

  return rows.map((row) => row.id);
}
