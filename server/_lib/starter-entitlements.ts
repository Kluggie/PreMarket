import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { ApiError } from './errors.js';
import { newId } from './ids.js';
import { getProposalFinalOutcomeStatus } from './proposal-outcomes.js';
import { schema } from './db/client.js';

export const STARTER_LIMITS = {
  opportunitiesPerMonth: 1,
  activeOpportunities: 1,
  aiEvaluationsPerMonth: 3,
  uploadBytesPerOpportunity: 25 * 1024 * 1024,
  uploadBytesPerMonth: 100 * 1024 * 1024,
} as const;

export const PLAN_REVIEW_CREDIT_LIMITS = {
  starter: 3,
  free: 3,
  professional: 20,
  early_access: 20,
  early_access_program: 20,
  team: 100,
} as const;

const STARTER_PLAN_ALIASES = new Set(['starter', 'free']);
const UPLOAD_BYTES_EVENT = 'upload_bytes';
const AI_REVIEW_PROPOSAL_SOURCES: string[] = [
  'proposal_stage1_intake',
  'document_comparison_stage1_intake',
  'document_comparison_pre_send',
  'document_comparison_mediation',
  'document_comparison_vertex',
];

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

export async function getUserPlanTier(db: any, userId: string, now = new Date()) {
  // Join through users so we can also check betaSignups via userId OR
  // emailNormalized (for pre-account beta signups).
  const [row] = await db
    .select({
      plan: schema.billingReferences.plan,
      betaId: schema.betaSignups.id,
      betaTrialEndsAt: schema.betaSignups.trialEndsAt,
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

  const billingPlan = normalizePlan(row?.plan);

  // If the billing row carries an explicitly elevated plan, use it.
  if (billingPlan && billingPlan !== 'starter' && billingPlan !== 'free') {
    return billingPlan;
  }

  // betaSignups entry means Early Access - but only while the trial has not
  // expired. NULL trialEndsAt means pre-column row: treat as non-expired.
  if (row?.betaId) {
    const trialEndsAt = row.betaTrialEndsAt ? new Date(row.betaTrialEndsAt) : null;
    if (!trialEndsAt || trialEndsAt > now) {
      return 'early_access';
    }
  }

  return billingPlan || 'starter';
}

export function isStarterPlan(planTier: unknown) {
  const normalized = normalizePlan(planTier);
  return normalized ? STARTER_PLAN_ALIASES.has(normalized) : false;
}

export function getAiMediationReviewLimitForPlan(planTier: unknown): number | null {
  const normalized = normalizePlan(planTier);
  if (!normalized) {
    return PLAN_REVIEW_CREDIT_LIMITS.starter;
  }
  if (Object.prototype.hasOwnProperty.call(PLAN_REVIEW_CREDIT_LIMITS, normalized)) {
    return PLAN_REVIEW_CREDIT_LIMITS[normalized as keyof typeof PLAN_REVIEW_CREDIT_LIMITS];
  }
  return null;
}

function getPlanDisplayName(planTier: unknown) {
  const normalized = normalizePlan(planTier);
  if (normalized === 'professional') return 'Professional';
  if (normalized === 'early_access' || normalized === 'early_access_program') return 'Professional trial';
  if (normalized === 'team') return 'Team';
  if (normalized === 'enterprise') return 'Enterprise';
  return 'Starter';
}

async function countOwnerAiMediationReviewsThisMonth(
  db: any,
  params: {
    userId: string;
    start: Date;
    end: Date;
  },
) {
  const [proposalEvalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.proposalEvaluations)
    .where(
      and(
        eq(schema.proposalEvaluations.userId, params.userId),
        eq(schema.proposalEvaluations.status, 'completed'),
        inArray(schema.proposalEvaluations.source, AI_REVIEW_PROPOSAL_SOURCES),
        gte(schema.proposalEvaluations.createdAt, params.start),
        lt(schema.proposalEvaluations.createdAt, params.end),
      ),
    );

  const [sharedEvalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sharedReportEvaluationRuns)
    .innerJoin(
      schema.sharedLinks,
      eq(schema.sharedReportEvaluationRuns.sharedLinkId, schema.sharedLinks.id),
    )
    .where(
      and(
        eq(schema.sharedLinks.userId, params.userId),
        eq(schema.sharedReportEvaluationRuns.actorRole, 'recipient'),
        eq(schema.sharedReportEvaluationRuns.status, 'success'),
        gte(schema.sharedReportEvaluationRuns.createdAt, params.start),
        lt(schema.sharedReportEvaluationRuns.createdAt, params.end),
      ),
    );

  return toCount(proposalEvalRow?.count) + toCount(sharedEvalRow?.count);
}

function buildLimitError(params: {
  code:
    | 'starter_opportunities_monthly_limit_reached'
    | 'starter_active_opportunities_limit_reached'
    | 'starter_ai_evaluations_monthly_limit_reached'
    | 'ai_mediation_reviews_monthly_limit_reached'
    | 'starter_upload_per_opportunity_limit_exceeded'
    | 'starter_upload_monthly_limit_exceeded';
  message: string;
  plan?: string;
  extra: Record<string, unknown>;
}) {
  return new ApiError(429, params.code, params.message, {
    plan: params.plan || 'starter',
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
      message: 'Starter plan allows 1 new opportunity per month.',
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
      message: 'Starter plan allows 1 active opportunity at a time.',
      extra: {
        limit: STARTER_LIMITS.activeOpportunities,
        used: activeCount,
      },
    });
  }
}

export async function assertAiMediationReviewAllowed(
  db: any,
  params: {
    userId: string;
    userEmail?: string | null;
    now?: Date;
  },
) {
  const planTier = await getUserPlanTier(db, params.userId);
  const reviewLimit = getAiMediationReviewLimitForPlan(planTier);
  if (reviewLimit === null) {
    return;
  }

  const { start, end } = getMonthWindow(params.now || new Date());
  const used = await countOwnerAiMediationReviewsThisMonth(db, {
    userId: params.userId,
    start,
    end,
  });

  if (used >= reviewLimit) {
    const normalizedPlan = normalizePlan(planTier) || 'starter';
    const starterPlan = isStarterPlan(planTier);
    throw buildLimitError({
      code: starterPlan
        ? 'starter_ai_evaluations_monthly_limit_reached'
        : 'ai_mediation_reviews_monthly_limit_reached',
      message: `${getPlanDisplayName(planTier)} includes ${reviewLimit} AI mediation reviews per month.`,
      plan: starterPlan ? 'starter' : normalizedPlan,
      extra: {
        limit: reviewLimit,
        used,
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
  return assertAiMediationReviewAllowed(db, params);
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

export async function getStarterUsageSnapshot(
  db: any,
  params: {
    userId: string;
    userEmail?: string | null;
    now?: Date;
  },
) {
  const planTier = await getUserPlanTier(db, params.userId);
  if (!isStarterPlan(planTier)) {
    return null;
  }

  const { start, end } = getMonthWindow(params.now || new Date());

  const [monthlyCreatedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.proposals)
    .where(
      and(
        eq(schema.proposals.userId, params.userId),
        gte(schema.proposals.createdAt, start),
        lt(schema.proposals.createdAt, end),
      ),
    );
  const opportunitiesCreatedThisMonth = toCount(monthlyCreatedRow?.count);

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
        eq(schema.proposals.userId, params.userId),
        isNull(schema.proposals.deletedByPartyAAt),
        isNull(schema.proposals.archivedByPartyAAt),
        isNull(schema.proposals.archivedAt),
      ),
    );

  const activeOpportunities = activeCandidates.filter((row: any) => {
    const finalOutcome = getProposalFinalOutcomeStatus(row);
    if (finalOutcome === 'won' || finalOutcome === 'lost') {
      return false;
    }
    const normalizedStatus = String(row?.status || '').trim().toLowerCase();
    return normalizedStatus !== 'won' && normalizedStatus !== 'lost';
  }).length;

  const aiEvaluationsThisMonth = await countOwnerAiMediationReviewsThisMonth(db, {
    userId: params.userId,
    start,
    end,
  });

  const [uploadUsageRow] = await db
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

  const uploadBytesThisMonth = toCount(uploadUsageRow?.totalBytes);

  return {
    plan: 'starter',
    limits: {
      opportunitiesPerMonth: STARTER_LIMITS.opportunitiesPerMonth,
      activeOpportunities: STARTER_LIMITS.activeOpportunities,
      aiEvaluationsPerMonth: STARTER_LIMITS.aiEvaluationsPerMonth,
      aiMediationReviewsPerMonth: STARTER_LIMITS.aiEvaluationsPerMonth,
      uploadBytesPerOpportunity: STARTER_LIMITS.uploadBytesPerOpportunity,
      uploadBytesPerMonth: STARTER_LIMITS.uploadBytesPerMonth,
    },
    usage: {
      opportunitiesCreatedThisMonth,
      activeOpportunities,
      aiEvaluationsThisMonth,
      aiMediationReviewsThisMonth: aiEvaluationsThisMonth,
      uploadBytesThisMonth,
    },
    remaining: {
      opportunitiesPerMonth: Math.max(0, STARTER_LIMITS.opportunitiesPerMonth - opportunitiesCreatedThisMonth),
      activeOpportunities: Math.max(0, STARTER_LIMITS.activeOpportunities - activeOpportunities),
      aiEvaluationsPerMonth: Math.max(0, STARTER_LIMITS.aiEvaluationsPerMonth - aiEvaluationsThisMonth),
      aiMediationReviewsPerMonth: Math.max(0, STARTER_LIMITS.aiEvaluationsPerMonth - aiEvaluationsThisMonth),
      uploadBytesPerMonth: Math.max(0, STARTER_LIMITS.uploadBytesPerMonth - uploadBytesThisMonth),
    },
  };
}
