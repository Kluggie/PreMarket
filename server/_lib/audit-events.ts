import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { newId } from './ids.js';
import { asText, getRequestUserAgent, hashRequestIp } from './security.js';

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source).slice(0, 20);
  return Object.fromEntries(
    entries.map(([key, entry]) => [
      asText(key).slice(0, 64),
      typeof entry === 'string' ? entry.slice(0, 300) : entry,
    ]),
  );
}

export async function logAuditEvent(params: {
  eventType: string;
  userId?: string | null;
  orgId?: string | null;
  req?: any;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
}) {
  const eventType = asText(params.eventType);
  if (!eventType) {
    return;
  }

  const now = params.createdAt || new Date();
  const db = getDb();

  await db.insert(schema.auditEvents).values({
    id: newId('audit_evt'),
    userId: asText(params.userId) || null,
    orgId: asText(params.orgId) || null,
    eventType,
    createdAt: now,
    ipHash: params.req ? hashRequestIp(params.req) : null,
    userAgent: params.userAgent || (params.req ? getRequestUserAgent(params.req) : null),
    metadata: normalizeMetadata(params.metadata || {}),
  });
}

export async function logAuditEventBestEffort(params: {
  eventType: string;
  userId?: string | null;
  orgId?: string | null;
  req?: any;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
}) {
  try {
    await logAuditEvent(params);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        route: 'audit_events',
        action: 'insert_failed',
        eventType: asText(params.eventType) || null,
        message: error instanceof Error ? error.message : String(error || 'unknown'),
      }),
    );
  }
}

export async function listRecentAuditEventsForUser(params: {
  userId: string;
  limit: number;
  orgId?: string | null;
}) {
  const db = getDb();
  const cappedLimit = Math.min(Math.max(Math.floor(Number(params.limit || 50)), 1), 200);
  const userId = asText(params.userId);
  const orgId = asText(params.orgId || '');

  const whereClause = orgId
    ? and(eq(schema.auditEvents.userId, userId), eq(schema.auditEvents.orgId, orgId))
    : eq(schema.auditEvents.userId, userId);

  return db
    .select()
    .from(schema.auditEvents)
    .where(whereClause)
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(cappedLimit);
}
