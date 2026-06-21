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

export const PLAN_AI_ASSISTANCE_LIMITS = {
  starter: 20,
  free: 20,
  professional: 200,
  early_access: 200,
  early_access_program: 200,
  team: 500,
} as const;

const STARTER_PLAN_ALIASES = new Set(['starter', 'free']);
const ELEVATED_BILLING_PLAN_ALIASES = new Set(['professional', 'team', 'enterprise']);
const ELEVATED_PLAN_ALIASES = new Set([
  'professional',
  'team',
  'enterprise',
  'early_access',
  'early_access_program',
]);
const CUSTOM_LIMIT_PLAN_ALIASES = new Set(['enterprise']);
const UPLOAD_BYTES_EVENT = 'upload_bytes';
const AI_ASSISTANCE_EVENT = 'ai_assistance_call';
const AI_REVIEW_RESERVATION_EVENT = 'ai_mediation_review_reservation';
const AI_REVIEW_RESERVATION_TTL_MS = 10 * 60 * 1000;
const SHARED_LINK_AI_ASSISTANCE_DAILY_LIMIT = 20;
const COMPANY_CONTEXT_SCOPE_DAILY_LIMIT = 5;
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

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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

  // Only explicit paid/manual plans can elevate through billingReferences.
  // Trial access must come from betaSignups with a finite future expiry.
  if (ELEVATED_BILLING_PLAN_ALIASES.has(billingPlan)) {
    return billingPlan;
  }

  // betaSignups entry means Early Access only while a recorded trial expiry is
  // still in the future. Missing/malformed trial state fails closed to Starter.
  if (row?.betaId) {
    const trialEndsAt = row.betaTrialEndsAt ? new Date(row.betaTrialEndsAt) : null;
    if (trialEndsAt && Number.isFinite(trialEndsAt.getTime()) && trialEndsAt > now) {
      return 'early_access';
    }
  }

  return 'starter';
}

export function isStarterPlan(planTier: unknown) {
  const normalized = normalizePlan(planTier);
  return !normalized || STARTER_PLAN_ALIASES.has(normalized) || !ELEVATED_PLAN_ALIASES.has(normalized);
}

export function getAiMediationReviewLimitForPlan(planTier: unknown): number | null {
  const normalized = normalizePlan(planTier);
  if (!normalized) {
    return PLAN_REVIEW_CREDIT_LIMITS.starter;
  }
  if (CUSTOM_LIMIT_PLAN_ALIASES.has(normalized)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(PLAN_REVIEW_CREDIT_LIMITS, normalized)) {
    return PLAN_REVIEW_CREDIT_LIMITS[normalized as keyof typeof PLAN_REVIEW_CREDIT_LIMITS];
  }
  return PLAN_REVIEW_CREDIT_LIMITS.starter;
}

export function getAiAssistanceLimitForPlan(planTier: unknown): number | null {
  const normalized = normalizePlan(planTier);
  if (!normalized) {
    return PLAN_AI_ASSISTANCE_LIMITS.starter;
  }
  if (CUSTOM_LIMIT_PLAN_ALIASES.has(normalized)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(PLAN_AI_ASSISTANCE_LIMITS, normalized)) {
    return PLAN_AI_ASSISTANCE_LIMITS[normalized as keyof typeof PLAN_AI_ASSISTANCE_LIMITS];
  }
  return PLAN_AI_ASSISTANCE_LIMITS.starter;
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

async function countActiveAiMediationReviewReservations(
  db: any,
  params: {
    userId: string;
    start: Date;
    end: Date;
    now: Date;
  },
) {
  const reservationFloor = new Date(params.now.getTime() - AI_REVIEW_RESERVATION_TTL_MS);
  const [reservationRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.starterUsageEvents)
    .where(
      and(
        eq(schema.starterUsageEvents.userId, params.userId),
        eq(schema.starterUsageEvents.eventType, AI_REVIEW_RESERVATION_EVENT),
        gte(schema.starterUsageEvents.createdAt, params.start),
        lt(schema.starterUsageEvents.createdAt, params.end),
        gte(schema.starterUsageEvents.createdAt, reservationFloor),
      ),
    );

  return toCount(reservationRow?.count);
}

async function countAiAssistanceUsage(
  db: any,
  params: {
    userId: string;
    start: Date;
    end: Date;
    scopeId?: string | null;
  },
) {
  const conditions = [
    eq(schema.starterUsageEvents.userId, params.userId),
    eq(schema.starterUsageEvents.eventType, AI_ASSISTANCE_EVENT),
    gte(schema.starterUsageEvents.createdAt, params.start),
    lt(schema.starterUsageEvents.createdAt, params.end),
  ];
  if (params.scopeId) {
    conditions.push(eq(schema.starterUsageEvents.scopeId, params.scopeId));
  }

  const [usageRow] = await db
    .select({ count: sql<number>`coalesce(sum(${schema.starterUsageEvents.quantity}), 0)::int` })
    .from(schema.starterUsageEvents)
    .where(and(...conditions));

  return toCount(usageRow?.count);
}

function buildLimitError(params: {
  code:
    | 'starter_opportunities_monthly_limit_reached'
    | 'starter_active_opportunities_limit_reached'
    | 'starter_ai_evaluations_monthly_limit_reached'
    | 'ai_mediation_reviews_monthly_limit_reached'
    | 'ai_assistance_monthly_limit_reached'
    | 'ai_assistance_shared_link_limit_reached'
    | 'company_context_daily_limit_reached'
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

  const now = params.now || new Date();
  const { start, end } = getMonthWindow(now);
  const used = await countOwnerAiMediationReviewsThisMonth(db, {
    userId: params.userId,
    start,
    end,
  });
  const reserved = await countActiveAiMediationReviewReservations(db, {
    userId: params.userId,
    start,
    end,
    now,
  });

  if (used + reserved >= reviewLimit) {
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
        reserved,
      },
    });
  }
}

export async function reserveAiMediationReviewCredit(
  db: any,
  params: {
    userId: string;
    userEmail?: string | null;
    source?: string | null;
    scopeId?: string | null;
    requestId?: string | null;
    now?: Date;
  },
) {
  const now = params.now || new Date();
  const planTier = await getUserPlanTier(db, params.userId, now);
  const reviewLimit = getAiMediationReviewLimitForPlan(planTier);
  if (reviewLimit === null) {
    return null;
  }

  const { start, end } = getMonthWindow(now);
  const reservationFloor = new Date(now.getTime() - AI_REVIEW_RESERVATION_TTL_MS);
  const id = newId('usage');
  const metadata = JSON.stringify({
    source: params.source || null,
    request_id: params.requestId || null,
    expires_after_ms: AI_REVIEW_RESERVATION_TTL_MS,
  });
  const reviewSources = sql.join(
    AI_REVIEW_PROPOSAL_SOURCES.map((source) => sql`${source}`),
    sql`, `,
  );

  const result = await db.execute(sql`
    with reservation_lock as (
      select pg_advisory_xact_lock(hashtext(${`ai_review:${params.userId}`}))
    ),
    usage_count as (
      select (
        (
          select count(*)::int
          from proposal_evaluations
          where user_id = ${params.userId}
            and status = 'completed'
            and source in (${reviewSources})
            and created_at >= ${start}
            and created_at < ${end}
        ) + (
          select count(*)::int
          from shared_report_evaluation_runs runs
          join shared_links links on runs.shared_link_id = links.id
          where links.user_id = ${params.userId}
            and runs.actor_role = 'recipient'
            and runs.status = 'success'
            and runs.created_at >= ${start}
            and runs.created_at < ${end}
        ) + (
          select count(*)::int
          from starter_usage_events
          where user_id = ${params.userId}
            and event_type = ${AI_REVIEW_RESERVATION_EVENT}
            and created_at >= ${start}
            and created_at < ${end}
            and created_at >= ${reservationFloor}
        )
      )::int as used
    )
    insert into starter_usage_events (
      id,
      user_id,
      event_type,
      quantity,
      scope_id,
      metadata,
      created_at
    )
    select
      ${id},
      ${params.userId},
      ${AI_REVIEW_RESERVATION_EVENT},
      1,
      ${params.scopeId || null},
      ${metadata}::jsonb,
      ${now}
    from usage_count, reservation_lock
    where usage_count.used < ${reviewLimit}
    returning id
  `);
  const rows = Array.isArray(result)
    ? result
    : Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : [];
  if (rows[0]?.id) {
    return rows[0].id;
  }

  await assertAiMediationReviewAllowed(db, {
    userId: params.userId,
    userEmail: params.userEmail,
    now,
  });

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
      used: reviewLimit,
      reserved: 0,
    },
  });
}

export async function releaseAiMediationReviewReservation(db: any, reservationId?: string | null) {
  if (!reservationId) {
    return;
  }
  await db
    .delete(schema.starterUsageEvents)
    .where(
      and(
        eq(schema.starterUsageEvents.id, reservationId),
        eq(schema.starterUsageEvents.eventType, AI_REVIEW_RESERVATION_EVENT),
      ),
    );
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

export async function assertAiAssistanceAllowed(
  db: any,
  params: {
    userId: string;
    actorRole?: 'owner' | 'recipient' | string;
    action?: string | null;
    scopeId?: string | null;
    now?: Date;
  },
) {
  const now = params.now || new Date();
  const planTier = await getUserPlanTier(db, params.userId, now);
  const monthlyLimit = getAiAssistanceLimitForPlan(planTier);

  if (monthlyLimit !== null) {
    const { start, end } = getMonthWindow(now);
    const used = await countAiAssistanceUsage(db, {
      userId: params.userId,
      start,
      end,
    });

    if (used >= monthlyLimit) {
      throw buildLimitError({
        code: 'ai_assistance_monthly_limit_reached',
        message: 'AI assistance is temporarily limited for this month. You can still run AI mediation reviews if credits remain.',
        plan: normalizePlan(planTier) || 'starter',
        extra: {
          limit: monthlyLimit,
          used,
        },
      });
    }
  }

  const scopeId = asText(params.scopeId);
  if (!scopeId) {
    return;
  }

  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const scopedUsed = await countAiAssistanceUsage(db, {
    userId: params.userId,
    start: dayStart,
    end: now,
    scopeId,
  });
  const action = normalizePlan(params.action);
  const isCompanyContext =
    action === 'company_brief' ||
    action === 'company_context' ||
    action === 'generate_company_context';

  if (isCompanyContext && scopedUsed >= COMPANY_CONTEXT_SCOPE_DAILY_LIMIT) {
    throw buildLimitError({
      code: 'company_context_daily_limit_reached',
      message: 'Company Context is temporarily limited for this opportunity. Try again later.',
      plan: normalizePlan(planTier) || 'starter',
      extra: {
        limit: COMPANY_CONTEXT_SCOPE_DAILY_LIMIT,
        used: scopedUsed,
        scope_id: scopeId,
      },
    });
  }

  if (normalizePlan(params.actorRole) === 'recipient' && scopedUsed >= SHARED_LINK_AI_ASSISTANCE_DAILY_LIMIT) {
    throw buildLimitError({
      code: 'ai_assistance_shared_link_limit_reached',
      message: 'AI assistance is temporarily limited for this shared opportunity. You can still view and reply.',
      plan: normalizePlan(planTier) || 'starter',
      extra: {
        limit: SHARED_LINK_AI_ASSISTANCE_DAILY_LIMIT,
        used: scopedUsed,
        scope_id: scopeId,
      },
    });
  }
}

export async function recordAiAssistanceUsage(
  db: any,
  params: {
    userId: string;
    action: string;
    actorRole?: 'owner' | 'recipient' | string;
    scopeId?: string | null;
    comparisonId?: string | null;
    sharedLinkId?: string | null;
    provider?: string | null;
    model?: string | null;
    requestId?: string | null;
    now?: Date;
  },
) {
  const now = params.now || new Date();
  await db.insert(schema.starterUsageEvents).values({
    id: newId('usage'),
    userId: params.userId,
    eventType: AI_ASSISTANCE_EVENT,
    quantity: 1,
    scopeId: params.scopeId || null,
    metadata: {
      action: params.action,
      actor_role: params.actorRole || 'owner',
      comparison_id: params.comparisonId || null,
      shared_link_id: params.sharedLinkId || null,
      provider: params.provider || null,
      model: params.model || null,
      request_id: params.requestId || null,
    },
    createdAt: now,
  });
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
