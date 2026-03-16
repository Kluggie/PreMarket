import { and, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { ApiError } from './errors.js';
import { newId } from './ids.js';
import { getProposalFinalOutcomeStatus } from './proposal-outcomes.js';
import { schema } from './db/client.js';

export const STARTER_LIMITS = {
  opportunitiesPerMonth: 3,
  activeOpportunities: 2,
  aiEvaluationsPerMonth: 10,
  uploadBytesPerOpportunity: 25 * 1024 * 1024,
  uploadBytesPerMonth: 100 * 1024 * 1024,
} as const;

const STARTER_PLAN_ALIASES = new Set(['starter', 'free']);
const UPLOAD_BYTES_EVENT = 'upload_bytes';

function normalizePlan(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function toCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function toPositiveBytes(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function getMonthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export async function getUserPlanTier(db: any, userId: string) {
  const [billingRow] = await db
    .select({ plan: schema.billingReferences.plan })
    .from(schema.billingReferences)
    .where(eq(schema.billingReferences.userId, userId))
    .limit(1);
  const normalized = normalizePlan(billingRow?.plan);
  return normalized || 'starter';
}

export function isStarterPlan(planTier: unknown) {
  const normalized = normalizePlan(planTier);
  return normalized ? STARTER_PLAN_ALIASES.has(normalized) : true;
}

function buildLimitError(params: {
  code:
    | 'starter_opportunities_monthly_limit_reached'
    | 'starter_active_opportunities_limit_reached'
    | 'starter_ai_evaluations_monthly_limit_reached'
    | 'starter_upload_per_opportunity_limit_exceeded'
    | 'starter_upload_monthly_limit_exceeded';
  message: string;
  extra: Record<string, unknown>;
}) {
  return new ApiError(429, params.code, params.message, {
    plan: 'starter',
    ...params.extra,
  });
}

export async function assertStarterOpportunityCreateAllowed(db: any, userId: string, now = new Date()) {
  const planTier = await getUserPlanTier(db, userId);
  if (!isStarterPlan(planTier)) {
    return;
  }

  const { start, end } = getMonthWindow(now);
  const [monthlyCreatedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.proposals)
    .where(
      and(
        eq(schema.proposals.userId, userId),
        gte(schema.proposals.createdAt, start),
        lt(schema.proposals.createdAt, end),
      ),
    );
  const monthlyCreated = toCount(monthlyCreatedRow?.count);

  if (monthlyCreated >= STARTER_LIMITS.opportunitiesPerMonth) {
    throw buildLimitError({
      code: 'starter_opportunities_monthly_limit_reached',
      message: 'Starter plan allows up to 3 new opportunities per month.',
      extra: {
        limit: STARTER_LIMITS.opportunitiesPerMonth,
        used: monthlyCreated,
      },
    });
  }

  const activeCandidates = await db
    .select({
      id: schema.proposals.id,
      status: schema.proposals.status,
      partyAOutcome: schema.proposals.partyAOutcome,
      partyBOutcome: schema.proposals.partyBOutcome,
    })
    .from(schema.proposals)
    .where(
      and(
        eq(schema.proposals.userId, userId),
        isNull(schema.proposals.deletedByPartyAAt),
        isNull(schema.proposals.archivedByPartyAAt),
        isNull(schema.proposals.archivedAt),
      ),
    );

  const activeCount = activeCandidates.filter((row: any) => {
    const finalOutcome = getProposalFinalOutcomeStatus(row);
    if (finalOutcome === 'won' || finalOutcome === 'lost') {
      return false;
    }
    const normalizedStatus = String(row?.status || '').trim().toLowerCase();
    return normalizedStatus !== 'won' && normalizedStatus !== 'lost';
  }).length;

  if (activeCount >= STARTER_LIMITS.activeOpportunities) {
    throw buildLimitError({
      code: 'starter_active_opportunities_limit_reached',
      message: 'Starter plan allows up to 2 active opportunities at a time.',
      extra: {
        limit: STARTER_LIMITS.activeOpportunities,
        used: activeCount,
      },
    });
  }
}

export async function assertStarterAiEvaluationAllowed(
  db: any,
  params: {
    userId: string;
    userEmail?: string | null;
    now?: Date;
  },
) {
  const planTier = await getUserPlanTier(db, params.userId);
  if (!isStarterPlan(planTier)) {
    return;
  }

  const { start, end } = getMonthWindow(params.now || new Date());

  const [proposalEvalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.proposalEvaluations)
    .where(
      and(
        eq(schema.proposalEvaluations.userId, params.userId),
        eq(schema.proposalEvaluations.status, 'completed'),
        gte(schema.proposalEvaluations.createdAt, start),
        lt(schema.proposalEvaluations.createdAt, end),
      ),
    );

  const normalizedEmail = String(params.userEmail || '').trim().toLowerCase();
  const sharedRecipientPredicate = normalizedEmail
    ? or(
        eq(schema.sharedLinks.authorizedUserId, params.userId),
        ilike(schema.sharedLinks.recipientEmail, normalizedEmail),
      )
    : eq(schema.sharedLinks.authorizedUserId, params.userId);

  const [sharedEvalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sharedReportEvaluationRuns)
    .innerJoin(
      schema.sharedLinks,
      eq(schema.sharedReportEvaluationRuns.sharedLinkId, schema.sharedLinks.id),
    )
    .where(
      and(
        gte(schema.sharedReportEvaluationRuns.createdAt, start),
        lt(schema.sharedReportEvaluationRuns.createdAt, end),
        eq(schema.sharedReportEvaluationRuns.actorRole, 'recipient'),
        eq(schema.sharedReportEvaluationRuns.status, 'success'),
        sharedRecipientPredicate,
      ),
    );

  const used = toCount(proposalEvalRow?.count) + toCount(sharedEvalRow?.count);

  if (used >= STARTER_LIMITS.aiEvaluationsPerMonth) {
    throw buildLimitError({
      code: 'starter_ai_evaluations_monthly_limit_reached',
      message: 'Starter plan allows up to 10 AI evaluations per month.',
      extra: {
        limit: STARTER_LIMITS.aiEvaluationsPerMonth,
        used,
      },
    });
  }
}

export function sumComparisonInputUploadBytes(params: {
  docAFiles: unknown;
  docBFiles: unknown;
}) {
  return sumFileMetadataBytes(params.docAFiles) + sumFileMetadataBytes(params.docBFiles);
}

function readSizeFromMetadata(entry: any) {
  if (entry === null || entry === undefined) {
    return 0;
  }

  if (typeof entry === 'number' || typeof entry === 'string') {
    return toPositiveBytes(entry);
  }

  if (typeof entry !== 'object' || Array.isArray(entry)) {
    return 0;
  }

  return toPositiveBytes(
    entry.sizeBytes ?? entry.size_bytes ?? entry.bytes ?? entry.size ?? entry.fileSizeBytes,
  );
}

function sumFileMetadataBytes(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.reduce((total, entry) => total + readSizeFromMetadata(entry), 0);
}

export async function assertStarterPerOpportunityUploadLimit(db: any, userId: string, totalBytes: number) {
  const planTier = await getUserPlanTier(db, userId);
  if (!isStarterPlan(planTier)) {
    return;
  }

  if (toPositiveBytes(totalBytes) > STARTER_LIMITS.uploadBytesPerOpportunity) {
    throw buildLimitError({
      code: 'starter_upload_per_opportunity_limit_exceeded',
      message: 'Starter plan allows up to 25MB of uploads per opportunity.',
      extra: {
        limit_bytes: STARTER_LIMITS.uploadBytesPerOpportunity,
        used_bytes: toPositiveBytes(totalBytes),
      },
    });
  }
}

export async function assertStarterMonthlyUploadAllowed(
  db: any,
  params: {
    userId: string;
    incomingBytes: number;
    now?: Date;
  },
) {
  const planTier = await getUserPlanTier(db, params.userId);
  if (!isStarterPlan(planTier)) {
    return;
  }

  const incomingBytes = toPositiveBytes(params.incomingBytes);
  if (incomingBytes <= 0) {
    return;
  }

  const { start, end } = getMonthWindow(params.now || new Date());
  const [usageRow] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${schema.starterUsageEvents.quantity}), 0)::bigint` })
    .from(schema.starterUsageEvents)
    .where(
      and(
        eq(schema.starterUsageEvents.userId, params.userId),
        eq(schema.starterUsageEvents.eventType, UPLOAD_BYTES_EVENT),
        gte(schema.starterUsageEvents.createdAt, start),
        lt(schema.starterUsageEvents.createdAt, end),
      ),
    );

  const usedBytes = toCount(usageRow?.totalBytes);
  if (usedBytes + incomingBytes > STARTER_LIMITS.uploadBytesPerMonth) {
    throw buildLimitError({
      code: 'starter_upload_monthly_limit_exceeded',
      message: 'Starter plan allows up to 100MB of uploads per month.',
      extra: {
        limit_bytes: STARTER_LIMITS.uploadBytesPerMonth,
        used_bytes: usedBytes,
        requested_bytes: incomingBytes,
      },
    });
  }
}

export async function recordStarterUploadUsage(
  db: any,
  params: {
    userId: string;
    bytes: number;
    scopeId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const bytes = toPositiveBytes(params.bytes);
  if (bytes <= 0) {
    return;
  }

  await db.insert(schema.starterUsageEvents).values({
    id: newId('usage'),
    userId: params.userId,
    eventType: UPLOAD_BYTES_EVENT,
    quantity: bytes,
    scopeId: params.scopeId || null,
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
    createdAt: new Date(),
  });
}
