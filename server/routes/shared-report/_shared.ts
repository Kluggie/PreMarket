import { createHash } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { ApiError } from '../../_lib/errors.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { newId } from '../../_lib/ids.js';
import { PRIVATE_SENDER_LABEL } from '../../_lib/private-mode.js';
import { clientIpForRateLimit } from '../../_lib/security.js';
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
};

export async function resolveSharedReportToken(params: ResolveParams) {
  const { context, token } = params;
  const consumeView = Boolean(params.consumeView);
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

  // When comparisonId comes from reportMetadata.comparison_id ownership was verified at
  // link-creation time, so query by ID alone.  A null/mismatched proposalId column must
  // never silently drop the comparison and empty shared information for the recipient.
  // When falling back to proposal.documentComparisonId, keep the proposalId constraint
  // as an extra consistency guard.
  let comparison: any = null;
  if (comparisonId) {
    const whereClause = reportMetadataComparisonId
      ? eq(schema.documentComparisons.id, comparisonId)
      : and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.proposalId, proposal.id),
        );
    const [found] = await db
      .select()
      .from(schema.documentComparisons)
      .where(whereClause)
      .limit(1);
    comparison = found || null;

    console.info(
      JSON.stringify({
        level: 'info',
        fn: 'resolveSharedReportToken',
        comparisonId,
        source: reportMetadataComparisonId ? 'reportMetadata' : 'proposalLink',
        found: Boolean(comparison),
        docBTextLen: comparison ? String(comparison.docBText || '').length : null,
        publicReportKeys: comparison?.publicReport ? Object.keys(comparison.publicReport) : null,
        proposalId: proposal.id,
        reportMetadata,
      }),
    );
  } else {
    console.info(
      JSON.stringify({
        level: 'warn',
        fn: 'resolveSharedReportToken',
        warning: 'no_comparison_id',
        reportMetadataComparisonId: reportMetadataComparisonId || null,
        linkedComparisonId: linkedComparisonId || null,
        proposalId: proposal.id,
        reportMetadata,
      }),
    );
  }

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

export function buildParentView(params: {
  proposal: any;
  comparison: any;
  owner: any;
  outcome?: Record<string, unknown> | null;
  primaryStatusKey?: string | null;
  primaryStatusLabel?: string | null;
}) {
  const {
    proposal,
    comparison,
    owner,
    outcome = null,
    primaryStatusKey = null,
    primaryStatusLabel = null,
  } = params;
  const isPrivateMode = Boolean((proposal as any)?.isPrivateMode);
  return {
    id: proposal.id,
    proposal_id: proposal.id,
    comparison_id: comparison?.id || proposal.documentComparisonId || null,
    title: asText(comparison?.title) || asText(proposal.title) || 'Shared Report',
    status: asText(proposal.status) || null,
    outcome: outcome || null,
    primary_status_key: asText(primaryStatusKey) || null,
    primary_status_label: asText(primaryStatusLabel) || null,
    created_at: proposal.createdAt || null,
    proposer_name: isPrivateMode ? PRIVATE_SENDER_LABEL : asText(owner?.fullName) || null,
    proposer_email: isPrivateMode ? null : normalizeEmail(owner?.email) || null,
  };
}

export function buildDefaultSharedPayload(params: { proposal: any; comparison: any }) {
  const { proposal, comparison } = params;
  const comparisonInputs = toObject(comparison?.inputs);

  // Every storage path the save flow ever writes to.  The column (docBText) is
  // canonical; fall through to every inputs key that the update handler writes.
  const sources = {
    column_docBText:        asText(comparison?.docBText),
    inputs_shared_doc:      asText(comparisonInputs.shared_doc_content as string),
    inputs_doc_b_text:      asText(comparisonInputs.doc_b_text as string),
    inputs_docBText:        asText((comparisonInputs as any).docBText),
    inputs_shared_doc_html: asText(comparisonInputs.doc_b_html as string),
  };

  const resolvedText =
    sources.column_docBText ||
    sources.inputs_shared_doc ||
    sources.inputs_doc_b_text ||
    sources.inputs_docBText;

  const resolvedHtml =
    asText(comparisonInputs.doc_b_html as string) || '';

  // Always log in dev so we can confirm what ended up being served.
  console.info(
    JSON.stringify({
      level: 'info',
      fn: 'buildDefaultSharedPayload',
      comparisonId: comparison?.id || null,
      sources: {
        column_docBText_len:        sources.column_docBText.length,
        inputs_shared_doc_len:      sources.inputs_shared_doc.length,
        inputs_doc_b_text_len:      sources.inputs_doc_b_text.length,
        inputs_docBText_len:        sources.inputs_docBText.length,
        inputs_doc_b_html_len:      resolvedHtml.length,
      },
      resolvedTextLen:   resolvedText.length,
      resolvedHtmlLen:   resolvedHtml.length,
      inputsKeys:        Object.keys(comparisonInputs),
    }),
  );

  const defaultPayload: Record<string, unknown> = {
    label: 'Shared Information',
    title: asText(comparison?.title) || asText(proposal.title) || 'Shared Report',
    text: resolvedText,
  };

  // Always include html if available — renderDocumentReadOnly can use it even
  // when the plain-text field is empty (e.g. rich-text editors storing only HTML).
  if (resolvedHtml) {
    defaultPayload.html = resolvedHtml;
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

  // comparison.publicReport is already the "public" version of the report —
  // it is set explicitly by the evaluate route as the recipient-safe object.
  // Running it through buildRecipientSafeEvaluationProjection again strips the
  // v2 `why` and `missing` arrays, breaking the shared report layout.
  // Return it directly so ComparisonAiReportTab receives the same structure on
  // all views (proposer, recipient Step 0, recipient Step 3, PDF).
  const publicReport = comparison?.publicReport;
  if (
    publicReport &&
    typeof publicReport === 'object' &&
    !Array.isArray(publicReport) &&
    Object.keys(publicReport).length > 0
  ) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          fn: 'buildLatestReport',
          comparisonId: comparison?.id || null,
          publicReportKeys: Object.keys(publicReport),
          hasWhy: Array.isArray((publicReport as any).why),
          whyLength: Array.isArray((publicReport as any).why) ? (publicReport as any).why.length : 0,
          recommendation: (publicReport as any).recommendation || null,
        }),
      );
    }
    return publicReport;
  }

  // Fallback for comparisons that have never been evaluated.
  if (process.env.NODE_ENV !== 'production') {
    console.info(
      JSON.stringify({
        level: 'info',
        fn: 'buildLatestReport',
        comparisonId: comparison?.id || null,
        result: 'no_public_report',
        proposalId: proposal?.id || null,
      }),
    );
  }
  return {};
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
  const ip = clientIpForRateLimit(params.req);
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
