import { createHash } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { ApiError } from '../../_lib/errors.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { newId } from '../../_lib/ids.js';
import { buildRecipientSafeEvaluationProjection } from '../document-comparisons/_helpers.js';

export const SHARED_REPORT_ROUTE = '/api/shared-report/[token]';
export const RECIPIENT_ROLE = 'recipient';
export const DRAFT_STATUS = 'draft';
export const SENT_STATUS = 'sent';
export const SUPERSEDED_STATUS = 'superseded';
export const MAX_PAYLOAD_BYTES = 200 * 1024;
const VERIFY_RATE_LIMIT_ENTITY_TYPE = 'shared_report_verify_rate_limit';

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

export function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }
  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

export function isExpired(expiresAt: Date | string | null) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

export function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getCurrentUserId(currentUser: any) {
  return asText(currentUser?.id || currentUser?.sub || '');
}

export function getRecipientAuthorizationState(link: any, currentUser: any) {
  const invitedEmail = normalizeEmail(link?.recipientEmail);
  const authorizedUserId = asText(link?.authorizedUserId);
  const currentUserId = getCurrentUserId(currentUser);
  const currentEmail = normalizeEmail(currentUser?.email);
  const directEmailMatch = Boolean(invitedEmail && currentEmail && invitedEmail === currentEmail);
  const aliasVerifiedMatch = Boolean(authorizedUserId && currentUserId && authorizedUserId === currentUserId);
  const authorized = !invitedEmail || directEmailMatch || aliasVerifiedMatch;
  const hasCurrentUser = Boolean(currentUserId || currentEmail);

  return {
    invitedEmail: invitedEmail || null,
    currentEmail: currentEmail || null,
    authorized,
    directEmailMatch,
    aliasVerifiedMatch,
    requiresVerification: Boolean(invitedEmail && hasCurrentUser && !authorized),
  };
}

export function requireRecipientAuthorization(link: any, currentUser: any) {
  const state = getRecipientAuthorizationState(link, currentUser);
  if (!state.authorized) {
    throw new ApiError(
      403,
      'recipient_email_mismatch',
      'This link was sent to a different recipient email',
      {
        invitedEmail: state.invitedEmail,
      },
    );
  }
  return state;
}

export function maskTokenForLog(token: string) {
  const normalized = asText(token);
  if (!normalized) {
    return 'missing';
  }
  if (normalized.length <= 10) {
    return `${normalized.slice(0, 3)}...`;
  }
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function logTokenEvent(context: any, action: string, token: string, extra: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  console.info(
    JSON.stringify({
      level: 'info',
      route: SHARED_REPORT_ROUTE,
      action,
      requestId: context?.requestId || null,
      tokenPreview: maskTokenForLog(token),
      ...extra,
    }),
  );
}

type ResolveParams = {
  req: any;
  context: any;
  token: string;
  consumeView?: boolean;
  enforceMaxUses?: boolean;
};

export async function resolveSharedReportToken(params: ResolveParams) {
  const { context, token } = params;
  const consumeView = Boolean(params.consumeView);
  const enforceMaxUses = params.enforceMaxUses !== false;
  const db = getDb();

  const [joined] = await db
    .select({
      link: schema.sharedLinks,
      proposal: schema.proposals,
      owner: schema.users,
    })
    .from(schema.sharedLinks)
    .leftJoin(schema.proposals, eq(schema.proposals.id, schema.sharedLinks.proposalId))
    .leftJoin(schema.users, eq(schema.users.id, schema.sharedLinks.userId))
    .where(eq(schema.sharedLinks.token, token))
    .limit(1);

  const link = joined?.link || null;
  const proposal = joined?.proposal || null;
  const owner = joined?.owner || null;

  if (!link || !proposal) {
    throw new ApiError(404, 'token_not_found', 'Shared report link not found');
  }

  context.userId = link.userId;

  if (asText(link.mode) !== 'shared_report') {
    throw new ApiError(404, 'token_not_found', 'Shared report link not found');
  }
  if (!link.canView) {
    throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared report');
  }
  if (asText(link.status) !== 'active') {
    throw new ApiError(410, 'token_inactive', 'Shared report link is inactive');
  }
  if (isExpired(link.expiresAt)) {
    throw new ApiError(410, 'token_expired', 'Shared report link has expired');
  }
  if (enforceMaxUses && Number(link.maxUses || 0) > 0 && Number(link.uses || 0) >= Number(link.maxUses || 0)) {
    throw new ApiError(410, 'max_uses_reached', 'Shared report link reached its usage limit');
  }

  let effectiveLink = link;
  if (consumeView) {
    const [updated] = await db
      .update(schema.sharedLinks)
      .set({
        uses: sql`${schema.sharedLinks.uses} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    if (updated) {
      effectiveLink = updated;
    }
  }

  const reportMetadata = toObject(effectiveLink.reportMetadata);
  const reportMetadataComparisonId = asText(reportMetadata.comparison_id);
  const linkedComparisonId = asText(proposal.documentComparisonId);
  const comparisonId = reportMetadataComparisonId || linkedComparisonId || null;
  const [comparison] = comparisonId
    ? await db
        .select()
        .from(schema.documentComparisons)
        .where(and(eq(schema.documentComparisons.id, comparisonId), eq(schema.documentComparisons.proposalId, proposal.id)))
        .limit(1)
    : [null];

  return {
    db,
    link: effectiveLink,
    proposal,
    owner,
    comparison,
  };
}

export function buildShareView(link: any) {
  const invitedEmail = normalizeEmail(link.recipientEmail) || null;
  const authorizedEmail = normalizeEmail(link.authorizedEmail) || null;
  return {
    id: link.id,
    status: asText(link.status) || 'active',
    expires_at: link.expiresAt || null,
    max_uses: Number(link.maxUses || 0),
    use_count: Number(link.uses || 0),
    invited_email: invitedEmail,
    authorization: {
      authorized_email: authorizedEmail,
      authorized_at: link.authorizedAt || null,
    },
    permissions: {
      can_view: Boolean(link.canView),
      can_edit_shared: Boolean(link.canEdit),
      can_edit_confidential: Boolean(link.canEditConfidential),
      can_reevaluate: Boolean(link.canReevaluate),
      can_send_back: Boolean(link.canSendBack),
    },
  };
}

export function buildParentView(params: { proposal: any; comparison: any; owner: any }) {
  const { proposal, comparison, owner } = params;
  return {
    id: proposal.id,
    proposal_id: proposal.id,
    comparison_id: comparison?.id || proposal.documentComparisonId || null,
    title: asText(comparison?.title) || asText(proposal.title) || 'Shared Report',
    status: asText(proposal.status) || null,
    created_at: proposal.createdAt || null,
    proposer_name: asText(owner?.fullName) || null,
    proposer_email: normalizeEmail(owner?.email) || null,
  };
}

export function buildDefaultSharedPayload(params: { proposal: any; comparison: any }) {
  const { proposal, comparison } = params;
  const comparisonInputs = toObject(comparison?.inputs);
  const defaultPayload: Record<string, unknown> = {
    label: 'Shared Information',
    title: asText(comparison?.title) || asText(proposal.title) || 'Shared Report',
    text: String(comparison?.docBText || ''),
  };

  if (typeof comparisonInputs.doc_b_html === 'string') {
    defaultPayload.html = comparisonInputs.doc_b_html;
  }
  if (
    comparisonInputs.doc_b_json &&
    typeof comparisonInputs.doc_b_json === 'object' &&
    !Array.isArray(comparisonInputs.doc_b_json)
  ) {
    defaultPayload.json = comparisonInputs.doc_b_json;
  }
  if (typeof comparisonInputs.doc_b_source === 'string') {
    defaultPayload.source = comparisonInputs.doc_b_source;
  }

  return defaultPayload;
}

export function buildDefaultConfidentialPayload() {
  return {
    label: 'Confidential Information',
    notes: '',
  };
}

export function buildLatestReport(params: { proposal: any; comparison: any }) {
  const { proposal, comparison } = params;
  const projection = buildRecipientSafeEvaluationProjection({
    evaluationResult: comparison?.evaluationResult || {},
    publicReport: comparison?.publicReport || {},
    confidentialText: comparison?.docAText || '',
    sharedText: comparison?.docBText || '',
    title: asText(comparison?.title) || asText(proposal.title) || 'Shared Report',
  });

  return projection.public_report || {};
}

export async function getCurrentRecipientDraft(db: any, linkId: string) {
  const [draft] = await db
    .select()
    .from(schema.sharedReportRecipientRevisions)
    .where(
      and(
        eq(schema.sharedReportRecipientRevisions.sharedLinkId, linkId),
        eq(schema.sharedReportRecipientRevisions.actorRole, RECIPIENT_ROLE),
        eq(schema.sharedReportRecipientRevisions.status, DRAFT_STATUS),
      ),
    )
    .orderBy(desc(schema.sharedReportRecipientRevisions.updatedAt), desc(schema.sharedReportRecipientRevisions.createdAt))
    .limit(1);

  return draft || null;
}

export function mapDraftView(row: any) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    actor_role: row.actorRole,
    status: row.status,
    shared_payload: toObject(row.sharedPayload),
    recipient_confidential_payload: toObject(row.recipientConfidentialPayload),
    workflow_step: Number.isFinite(Number(row.workflowStep)) ? Number(row.workflowStep) : 0,
    editor_state: toObject(row.editorState),
    previous_revision_id: row.previousRevisionId || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function clampWorkflowStep(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), 3);
}

export function coercePayloadObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export function getPayloadText(payload: unknown, fallback = '') {
  const source = coercePayloadObject(payload);
  const direct = source.text;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const notes = source.notes;
  if (typeof notes === 'string' && notes.trim().length > 0) {
    return notes.trim();
  }
  const content = source.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim();
  }
  return String(fallback || '').trim();
}

export async function getLatestRecipientEvaluationRun(db: any, linkId: string) {
  const [run] = await db
    .select()
    .from(schema.sharedReportEvaluationRuns)
    .where(
      and(
        eq(schema.sharedReportEvaluationRuns.sharedLinkId, linkId),
        eq(schema.sharedReportEvaluationRuns.actorRole, RECIPIENT_ROLE),
      ),
    )
    .orderBy(
      desc(schema.sharedReportEvaluationRuns.createdAt),
      desc(schema.sharedReportEvaluationRuns.updatedAt),
    )
    .limit(1);
  return run || null;
}

export async function getLatestRecipientSentRevision(db: any, linkId: string) {
  const [row] = await db
    .select()
    .from(schema.sharedReportRecipientRevisions)
    .where(
      and(
        eq(schema.sharedReportRecipientRevisions.sharedLinkId, linkId),
        eq(schema.sharedReportRecipientRevisions.actorRole, RECIPIENT_ROLE),
        eq(schema.sharedReportRecipientRevisions.status, SENT_STATUS),
      ),
    )
    .orderBy(desc(schema.sharedReportRecipientRevisions.updatedAt))
    .limit(1);
  return row || null;
}

export function mapEvaluationRunView(row: any) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    revision_id: row.revisionId,
    actor_role: row.actorRole,
    status: row.status,
    public_report: toObject(row.resultPublicReport),
    result_json: toObject(row.resultJson),
    error_code: asText(row.errorCode) || null,
    error_message: asText(row.errorMessage) || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function assertJsonObjectField(value: unknown, fieldName: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_input', `${fieldName} must be a JSON object`);
  }
}

export function assertPayloadSize(value: unknown, fieldName: string) {
  const serialized = JSON.stringify(value ?? {});
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new ApiError(413, 'payload_too_large', `${fieldName} exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSort(entry));
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(input[key]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return value;
}

export function stableJsonEquals(left: unknown, right: unknown) {
  return JSON.stringify(stableSort(left ?? {})) === JSON.stringify(stableSort(right ?? {}));
}

function normalizeClientIp(req: any) {
  const forwarded = asText(req?.headers?.['x-forwarded-for']);
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return asText(req?.socket?.remoteAddress) || 'unknown';
}

function hashRateLimitKey(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export async function assertSharedReportVerifyRateLimit(params: {
  req: any;
  token: string;
  action: 'start' | 'confirm';
  limit: number;
  windowMs: number;
}) {
  const db = getDb();
  const ip = normalizeClientIp(params.req);
  const now = new Date();
  const windowStart = new Date(now.getTime() - params.windowMs);
  const rateLimitKey = hashRateLimitKey(`${params.action}:${params.token}:${ip}`);
  const [counter] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, VERIFY_RATE_LIMIT_ENTITY_TYPE),
        eq(schema.auditLogs.entityId, rateLimitKey),
        gt(schema.auditLogs.createdAt, windowStart),
      ),
    );

  const attemptsInWindow = Number(counter?.count || 0);
  if (attemptsInWindow >= params.limit) {
    throw new ApiError(429, 'rate_limited', 'Too many verification attempts. Please try again shortly.');
  }

  await db.insert(schema.auditLogs).values({
    id: newId('audit'),
    entityType: VERIFY_RATE_LIMIT_ENTITY_TYPE,
    entityId: rateLimitKey,
    userId: null,
    userEmail: null,
    action: `shared_report_verify_${params.action}`,
    details: {
      action: params.action,
      window_ms: params.windowMs,
    },
    createdAt: now,
  });
}
