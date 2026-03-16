import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { buildProposalHistoryQueries } from '../../_lib/proposal-history.js';
import {
  buildLegacyOutcomeSeed,
} from '../../_lib/proposal-outcomes.js';
import {
  getProposalThreadState,
  matchesProposalInboxFilter,
  matchesProposalThreadBucket,
  matchesProposalThreadStatus,
  toDateOrNull,
} from '../../_lib/proposal-thread-state.js';
import { seedProposalThreadActivityFromTimeline } from '../../_lib/proposal-thread-activity.js';
import {
  buildProposalVisibilityScopes,
  getRecipientSharedProposalIds,
  listRecipientSharedReportLinks,
  matchesSharedReportAuthorizedUser,
  matchesSharedReportRecipientEmail,
} from '../../_lib/proposal-visibility.js';
import {
  applyPrivateModeMask,
  isPlanEligibleForPrivateMode,
  shouldMaskPrivateSender,
} from '../../_lib/private-mode.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function clampResumeStep(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numeric), 1), 3);
}

function hasStep2DraftContent(comparison: any) {
  if (!comparison || typeof comparison !== 'object') {
    return false;
  }

  if (asText(comparison.docAText).length > 0 || asText(comparison.docBText).length > 0) {
    return true;
  }

  const inputs =
    comparison.inputs && typeof comparison.inputs === 'object' && !Array.isArray(comparison.inputs)
      ? (comparison.inputs as Record<string, unknown>)
      : {};

  const inputTextFields = [
    inputs.doc_a_html,
    inputs.doc_b_html,
    inputs.doc_a_url,
    inputs.doc_b_url,
    inputs.shared_doc_content,
  ];
  if (inputTextFields.some((value) => asText(value).length > 0)) {
    return true;
  }

  const hasDocAJson = Boolean(inputs.doc_a_json && typeof inputs.doc_a_json === 'object' && !Array.isArray(inputs.doc_a_json));
  const hasDocBJson = Boolean(inputs.doc_b_json && typeof inputs.doc_b_json === 'object' && !Array.isArray(inputs.doc_b_json));
  if (hasDocAJson || hasDocBJson) {
    return true;
  }

  return (
    (Array.isArray(inputs.doc_a_files) && inputs.doc_a_files.length > 0) ||
    (Array.isArray(inputs.doc_b_files) && inputs.doc_b_files.length > 0)
  );
}

function hasEvaluationProjection(comparison: any) {
  if (!comparison || typeof comparison !== 'object') {
    return false;
  }

  const evaluationResult =
    comparison.evaluationResult &&
    typeof comparison.evaluationResult === 'object' &&
    !Array.isArray(comparison.evaluationResult)
      ? comparison.evaluationResult
      : {};
  const publicReport =
    comparison.publicReport &&
    typeof comparison.publicReport === 'object' &&
    !Array.isArray(comparison.publicReport)
      ? comparison.publicReport
      : {};

  return Object.keys(evaluationResult).length > 0 || Object.keys(publicReport).length > 0;
}

function hasEvaluationStatus(comparison: any) {
  const status = asLower(comparison?.status);
  return (
    status === 'running' ||
    status === 'queued' ||
    status === 'evaluating' ||
    status === 'evaluated' ||
    status === 'failed'
  );
}

function resolveDocumentComparisonResumeStep(params: {
  comparison: any;
  hasEvaluationAttempt: boolean;
  proposalDraftStep: unknown;
}) {
  const fallbackStep = clampResumeStep(params.proposalDraftStep, 1);
  const comparisonDraftStep = clampResumeStep(params.comparison?.draftStep, 1);

  if (
    params.hasEvaluationAttempt ||
    comparisonDraftStep >= 3 ||
    hasEvaluationStatus(params.comparison) ||
    hasEvaluationProjection(params.comparison)
  ) {
    return 3;
  }

  if (comparisonDraftStep >= 2 || hasStep2DraftContent(params.comparison) || fallbackStep >= 2) {
    return 2;
  }

  return 1;
}

function mapProposalRow(
  proposal,
  threadState,
  sharedReportLink = null,
  resumeStepOverride: unknown = null,
) {
  const effectiveStatus = threadState.outcome.final_status || proposal.status;
  const sharedReportToken = String(sharedReportLink?.token || '').trim();
  const hasSharedReportLink = Boolean(sharedReportToken);
  const normalizedDraftStep = clampResumeStep(proposal.draftStep || 1, 1);
  const resolvedResumeStep = clampResumeStep(resumeStepOverride, normalizedDraftStep);

  const isPrivateMode = Boolean((proposal as any).isPrivateMode);
  const actorRole = String(threadState.outcome?.actor_role || threadState?.actorRole || '').trim().toLowerCase();
  const maskSender = shouldMaskPrivateSender(isPrivateMode, actorRole);

  const base = {
    id: proposal.id,
    title: proposal.title,
    status: effectiveStatus,
    status_reason: proposal.statusReason || null,
    directional_status: threadState.directionalStatus,
    outcome: threadState.outcome,
    list_type: threadState.listType,
    shared_report_token: hasSharedReportLink ? sharedReportToken : null,
    shared_report_status: hasSharedReportLink ? String(sharedReportLink.status || '').toLowerCase() || 'active' : null,
    shared_report_expires_at: hasSharedReportLink ? sharedReportLink.expiresAt || null : null,
    shared_report_last_updated_at: hasSharedReportLink ? sharedReportLink.updatedAt || null : null,
    shared_report_sent_at: hasSharedReportLink ? sharedReportLink.createdAt || null : null,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    proposal_type: proposal.proposalType || 'standard',
    draft_step: normalizedDraftStep,
    resume_step: resolvedResumeStep,
    source_proposal_id: proposal.sourceProposalId || null,
    document_comparison_id: proposal.documentComparisonId || null,
    party_a_email: proposal.partyAEmail || null,
    party_b_email: proposal.partyBEmail,
    party_b_name: (proposal as any).partyBName || null,
    summary: proposal.summary,
    payload: proposal.payload || {},
    recipient_email: proposal.partyBEmail || null,
    counterparty_email: threadState.counterpartyEmail,
    owner_user_id: proposal.userId,
    sent_at: proposal.sentAt || null,
    received_at: proposal.receivedAt || null,
    last_thread_activity_at: proposal.lastThreadActivityAt || null,
    last_thread_actor_role: proposal.lastThreadActorRole || null,
    last_thread_activity_type: proposal.lastThreadActivityType || null,
    evaluated_at: proposal.evaluatedAt || null,
    last_shared_at: proposal.lastSharedAt || null,
    archived_at: threadState.archivedAt,
    closed_at: proposal.closedAt || null,
    party_a_outcome: proposal.partyAOutcome || null,
    party_a_outcome_at: proposal.partyAOutcomeAt || null,
    party_b_outcome: proposal.partyBOutcome || null,
    party_b_outcome_at: proposal.partyBOutcomeAt || null,
    thread_bucket: threadState.bucket,
    latest_direction: threadState.latestDirection,
    needs_response: threadState.needsResponse,
    waiting_on_other_party: threadState.waitingOnOtherParty,
    win_confirmation_requested: threadState.winConfirmationRequested,
    review_status: threadState.reviewStatus,
    is_mutual_interest: threadState.isMutualInterest,
    is_latest_version: threadState.isLatestVersion,
    last_activity_at: threadState.sortAt || proposal.createdAt,
    is_private_mode: isPrivateMode,
    user_id: proposal.userId,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };

  return maskSender ? applyPrivateModeMask(base) : base;
}

function decodeCursor(rawCursor) {
  if (!rawCursor || typeof rawCursor !== 'string') {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    const id = String(decoded?.id || '').trim();
    const updatedAt = new Date(String(decoded?.updatedAt || decoded?.createdAt || ''));

    if (!id || Number.isNaN(updatedAt.getTime())) {
      return null;
    }

    return {
      id,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  if (!row?.id || !row?.updatedAt) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      id: row.id,
      updatedAt: new Date(row.updatedAt).toISOString(),
    }),
  ).toString('base64url');
}

function parseLimit(rawLimit) {
  const candidate = Number(rawLimit || DEFAULT_LIMIT);

  if (!Number.isFinite(candidate)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(candidate), 1), MAX_LIMIT);
}

function parseDateOrNull(value: unknown) {
  if (!value) {
    return null;
  }

  const candidate = new Date(String(value));
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate;
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/proposals', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    if (req.method === 'GET') {
      const limit = parseLimit(req.query?.limit);
      const rawTab = String(req.query?.tab || '').trim().toLowerCase();
      const query = String(req.query?.query || req.query?.q || '').trim();
      const rawStatusFilter = String(req.query?.status || '').trim().toLowerCase();
      const rawInboxFilter = String(req.query?.inbox || '').trim().toLowerCase();
      const cursor = decodeCursor(String(req.query?.cursor || ''));
      const tab = rawTab || rawInboxFilter ? rawTab || 'inbox' : 'all';
      const inboxFilter = rawInboxFilter;
      const statusFilter = rawStatusFilter;

      const hasUserEmail = typeof auth.user.email === 'string' && auth.user.email.trim().length > 0;
      const dbIdentity = getDatabaseIdentitySnapshot();
      const recipientSharedLinks = await listRecipientSharedReportLinks(db, auth.user);
      const recipientSharedLinkMatchCounts = recipientSharedLinks.reduce(
        (acc, link) => ({
          email: acc.email + (matchesSharedReportRecipientEmail(link, auth.user) ? 1 : 0),
          authorized: acc.authorized + (matchesSharedReportAuthorizedUser(link, auth.user) ? 1 : 0),
        }),
        { email: 0, authorized: 0 },
      );
      const sharedReportByProposalId = new Map<string, any>();
      recipientSharedLinks.forEach((link) => {
        const key = String(link.proposalId || '').trim();
        if (!key || sharedReportByProposalId.has(key)) {
          return;
        }
        sharedReportByProposalId.set(key, link);
      });
      const recipientSharedProposalIds = getRecipientSharedProposalIds(recipientSharedLinks);
      const { ownerVisibleScope, recipientVisibleScope } = buildProposalVisibilityScopes(
        auth.user,
        recipientSharedProposalIds,
        { isArchivedTab: false },
      );

      const conditions = [] as any[];
      const listScope = hasUserEmail
        ? or(
            ownerVisibleScope,
            recipientVisibleScope,
          )
        : ownerVisibleScope;
      conditions.push(listScope);

      if (query) {
        const pattern = `%${query}%`;
        conditions.push(
          or(
            ilike(schema.proposals.title, pattern),
            ilike(schema.proposals.templateName, pattern),
            ilike(schema.proposals.partyAEmail, pattern),
            ilike(schema.proposals.partyBEmail, pattern),
            ilike(schema.proposals.summary, pattern),
          ),
        );
      }

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/proposals',
          event: 'proposals_list_query_start',
          requestId: context.requestId,
          userId: auth.user.id,
          tab,
          statusFilter: statusFilter || 'all',
          inboxFilter: inboxFilter || 'all',
          hasSearchQuery: Boolean(query),
          recipientSharedProposalCount: recipientSharedProposalIds.length,
          recipientSharedLinkMatchesByEmail: recipientSharedLinkMatchCounts.email,
          recipientSharedLinkMatchesByAuthorizedUser: recipientSharedLinkMatchCounts.authorized,
          vercelEnv: dbIdentity.vercelEnv,
          dbHost: dbIdentity.dbHost,
          dbName: dbIdentity.dbName,
          dbSchema: dbIdentity.dbSchema,
          dbUrlHash: dbIdentity.dbUrlHash,
        }),
      );

      let rows;
      try {
        rows = await db
          .select()
          .from(schema.proposals)
          .where(whereClause)
          .orderBy(desc(schema.proposals.updatedAt), desc(schema.proposals.id));

        if (rows.length === 0) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              route: '/api/proposals',
              event: 'proposals_list_empty_result',
              requestId: context.requestId,
              userId: auth.user.id,
              userEmail: auth.user.email,
              tab,
              statusFilter,
              inboxFilter,
              recipientSharedProposalCount: recipientSharedProposalIds.length,
              recipientSharedLinkMatchesByEmail: recipientSharedLinkMatchCounts.email,
              recipientSharedLinkMatchesByAuthorizedUser: recipientSharedLinkMatchCounts.authorized,
              vercelEnv: dbIdentity.vercelEnv,
              dbHost: dbIdentity.dbHost,
              dbName: dbIdentity.dbName,
              dbSchema: dbIdentity.dbSchema,
            }),
          );
        }
      } catch (error: any) {
        console.error(
          JSON.stringify({
            level: 'error',
            route: '/api/proposals',
            event: 'proposals_list_query_failed',
            requestId: context.requestId,
            userId: auth.user.id,
            vercelEnv: dbIdentity.vercelEnv,
            dbHost: dbIdentity.dbHost,
            dbName: dbIdentity.dbName,
            dbSchema: dbIdentity.dbSchema,
            dbUrlHash: dbIdentity.dbUrlHash,
            errorMessage: error?.message || 'unknown_error',
          }),
        );
        throw new ApiError(500, 'proposals_query_failed', 'Failed to load proposals from the database');
      }

      const filteredEntries = rows
        .map((row) => ({
          row,
          threadState: getProposalThreadState(row, auth.user, {
            sharedReceivedProposalIds: recipientSharedProposalIds,
          }),
        }))
        .filter(({ threadState }) => matchesProposalThreadBucket(threadState, tab))
        .filter(({ threadState }) => matchesProposalThreadStatus(threadState, statusFilter))
        .filter(({ threadState }) =>
          tab === 'inbox' ? matchesProposalInboxFilter(threadState, inboxFilter) : true,
        )
        .sort((left, right) => {
          const leftTime = (left.threadState.sortAt || toDateOrNull(left.row.updatedAt) || toDateOrNull(left.row.createdAt) || new Date(0)).getTime();
          const rightTime =
            (right.threadState.sortAt || toDateOrNull(right.row.updatedAt) || toDateOrNull(right.row.createdAt) || new Date(0)).getTime();
          if (rightTime !== leftTime) {
            return rightTime - leftTime;
          }
          return String(right.row.id || '').localeCompare(String(left.row.id || ''));
        });

      const visibleEntries = cursor
        ? filteredEntries.filter(({ row, threadState }) => {
            const rowUpdatedAt =
              threadState.sortAt || toDateOrNull(row.updatedAt) || toDateOrNull(row.createdAt);
            if (!rowUpdatedAt) {
              return String(row.id || '') < cursor.id;
            }
            return (
              rowUpdatedAt.getTime() < cursor.updatedAt.getTime() ||
              (rowUpdatedAt.getTime() === cursor.updatedAt.getTime() &&
                String(row.id || '') < cursor.id)
            );
          })
        : filteredEntries;

      if (visibleEntries.length === 0) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            route: '/api/proposals',
            event: 'proposals_list_empty_filtered_result',
            requestId: context.requestId,
            userId: auth.user.id,
            userEmail: auth.user.email,
            tab,
            statusFilter,
            inboxFilter,
            hasSearchQuery: Boolean(query),
          }),
        );
      }

      const hasMore = visibleEntries.length > limit;
      const pageEntries = hasMore ? visibleEntries.slice(0, limit) : visibleEntries;
      const pageRows = pageEntries.map(({ row }) => row);
      const nextCursor = hasMore
        ? encodeCursor({
            id: pageEntries[pageEntries.length - 1]?.row?.id,
            updatedAt:
              pageEntries[pageEntries.length - 1]?.threadState?.sortAt ||
              pageEntries[pageEntries.length - 1]?.row?.updatedAt ||
              pageEntries[pageEntries.length - 1]?.row?.createdAt,
          })
        : null;

      const documentComparisonProposals = pageRows.filter(
        (row) =>
          asLower(row?.proposalType) === 'document_comparison' &&
          asText(row?.documentComparisonId).length > 0 &&
          asText(row?.id).length > 0,
      );
      const documentComparisonIds = Array.from(
        new Set(
          documentComparisonProposals
            .map((row) => asText(row.documentComparisonId))
            .filter(Boolean),
        ),
      );
      const documentComparisonProposalIds = Array.from(
        new Set(
          documentComparisonProposals
            .map((row) => asText(row.id))
            .filter(Boolean),
        ),
      );

      const [documentComparisonRows, documentComparisonEvaluationRows] = await Promise.all([
        documentComparisonIds.length > 0
          ? db
              .select({
                id: schema.documentComparisons.id,
                status: schema.documentComparisons.status,
                draftStep: schema.documentComparisons.draftStep,
                docAText: schema.documentComparisons.docAText,
                docBText: schema.documentComparisons.docBText,
                inputs: schema.documentComparisons.inputs,
                evaluationResult: schema.documentComparisons.evaluationResult,
                publicReport: schema.documentComparisons.publicReport,
              })
              .from(schema.documentComparisons)
              .where(inArray(schema.documentComparisons.id, documentComparisonIds))
          : Promise.resolve([]),
        documentComparisonProposalIds.length > 0
          ? db
              .select({
                proposalId: schema.proposalEvaluations.proposalId,
              })
              .from(schema.proposalEvaluations)
              .where(inArray(schema.proposalEvaluations.proposalId, documentComparisonProposalIds))
          : Promise.resolve([]),
      ]);

      const documentComparisonById = new Map<string, any>();
      documentComparisonRows.forEach((row) => {
        const id = asText(row?.id);
        if (id) {
          documentComparisonById.set(id, row);
        }
      });

      const hasEvaluationByProposalId = new Set<string>();
      documentComparisonEvaluationRows.forEach((row) => {
        const proposalId = asText(row?.proposalId);
        if (proposalId) {
          hasEvaluationByProposalId.add(proposalId);
        }
      });

      const resumeStepByProposalId = new Map<string, number>();
      documentComparisonProposals.forEach((proposalRow) => {
        const proposalId = asText(proposalRow?.id);
        const comparisonId = asText(proposalRow?.documentComparisonId);
        if (!proposalId || !comparisonId) {
          return;
        }
        const comparisonRow = documentComparisonById.get(comparisonId) || null;
        const resumeStep = resolveDocumentComparisonResumeStep({
          comparison: comparisonRow,
          hasEvaluationAttempt: hasEvaluationByProposalId.has(proposalId),
          proposalDraftStep: proposalRow?.draftStep,
        });
        resumeStepByProposalId.set(proposalId, resumeStep);
      });

      console.info(
        JSON.stringify({
          level: 'info',
          route: '/api/proposals',
          event: 'proposals_list_query_result',
          requestId: context.requestId,
          userId: auth.user.id,
          tab,
          statusFilter: statusFilter || 'all',
          inboxFilter: inboxFilter || 'all',
          resultCount: pageRows.length,
          fetchedCount: rows.length,
          matchedCount: filteredEntries.length,
          hasMore,
          vercelEnv: dbIdentity.vercelEnv,
          dbHost: dbIdentity.dbHost,
          dbName: dbIdentity.dbName,
          dbSchema: dbIdentity.dbSchema,
          dbUrlHash: dbIdentity.dbUrlHash,
        }),
      );

      ok(res, 200, {
        proposals: pageEntries.map(({ row, threadState }) =>
          mapProposalRow(
            row,
            threadState,
            sharedReportByProposalId.get(String(row.id || '')) || null,
            resumeStepByProposalId.get(String(row.id || '')) || null,
          ),
        ),
        page: {
          limit,
          nextCursor,
          hasMore,
        },
      });
      return;
    }

    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();

    if (!title) {
      throw new ApiError(400, 'invalid_input', 'Proposal title is required');
    }

    const status = String(body.status || 'draft').trim().toLowerCase() || 'draft';
    const statusReason = String(body.statusReason || body.status_reason || '').trim() || null;
    const templateId = String(body.templateId || body.template_id || '').trim() || null;
    const templateName = String(body.templateName || body.template_name || '').trim() || null;
    const proposalType =
      String(body.proposalType || body.proposal_type || '').trim().toLowerCase() || 'standard';
    const draftStepRaw = Number(body.draftStep || body.draft_step || 1);
    const draftStep = Number.isFinite(draftStepRaw)
      ? Math.min(Math.max(Math.floor(draftStepRaw), 1), 4)
      : 1;
    const sourceProposalId =
      String(body.sourceProposalId || body.source_proposal_id || '').trim() || null;
    const documentComparisonId =
      String(body.documentComparisonId || body.document_comparison_id || '').trim() || null;
    const partyAEmail = normalizeEmail(body.partyAEmail || body.party_a_email || auth.user.email || '') || null;
    const partyBEmail = normalizeEmail(body.partyBEmail || body.party_b_email || '') || null;
    const partyBName = asText(body.partyBName || body.party_b_name) || null;
    const summary = String(body.summary || '').trim() || null;
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const sentAt = parseDateOrNull(body.sentAt || body.sent_at);
    const receivedAt = parseDateOrNull(body.receivedAt || body.received_at);
    const evaluatedAt = parseDateOrNull(body.evaluatedAt || body.evaluated_at);
    const lastSharedAt = parseDateOrNull(body.lastSharedAt || body.last_shared_at);
    const isPrivateMode = Boolean(body.isPrivateMode || body.is_private_mode);

    // Plan gating: only Early Access, Professional, and Enterprise may create private opportunities.
    if (isPrivateMode) {
      const [billingRow] = await db
        .select({ plan: schema.billingReferences.plan })
        .from(schema.billingReferences)
        .where(eq(schema.billingReferences.userId, auth.user.id))
        .limit(1);
      const planTier = String(billingRow?.plan || 'starter').trim().toLowerCase();
      if (!isPlanEligibleForPrivateMode(planTier)) {
        throw new ApiError(
          403,
          'plan_not_eligible',
          'Private Mode is available on Early Access, Professional, and Enterprise plans',
        );
      }
    }

    const now = new Date();
    const proposalId = newId('proposal');
    const dbIdentity = getDatabaseIdentitySnapshot();

    const legacyOutcomeSeed = buildLegacyOutcomeSeed(status, now);
    const proposalValues = {
      id: proposalId,
      userId: auth.user.id,
      title,
      status,
      statusReason,
      templateId,
      templateName,
      proposalType,
      draftStep,
      sourceProposalId,
      documentComparisonId,
      partyAEmail,
      partyBEmail,
      partyBName,
      summary,
      payload,
      isPrivateMode,
      sentAt,
      receivedAt,
      ...seedProposalThreadActivityFromTimeline({
        sentAt,
        receivedAt,
      }),
      evaluatedAt,
      lastSharedAt,
      partyAOutcome: legacyOutcomeSeed.partyAOutcome,
      partyAOutcomeAt: legacyOutcomeSeed.partyAOutcomeAt,
      partyBOutcome: legacyOutcomeSeed.partyBOutcome,
      partyBOutcomeAt: legacyOutcomeSeed.partyBOutcomeAt,
      closedAt: legacyOutcomeSeed.closedAt,
      createdAt: now,
      updatedAt: now,
    };

    let created;
    try {
      const historyQueries = [];
      historyQueries.push(
        ...buildProposalHistoryQueries(db, {
          proposal: proposalValues,
          actorUserId: auth.user.id,
          actorRole: 'party_a',
          milestone: 'create',
          eventType: 'proposal.created',
          eventData: {
            status,
            proposal_type: proposalType,
          },
          createdAt: now,
          requestId: context.requestId,
        }).queries,
      );
      if (sentAt) {
        historyQueries.push(
          ...buildProposalHistoryQueries(db, {
            proposal: proposalValues,
            actorUserId: auth.user.id,
            actorRole: 'party_a',
            milestone: 'send',
            eventType: 'proposal.sent',
            eventData: {
              source: 'proposal_create',
            },
            createdAt: sentAt,
            requestId: context.requestId,
          }).queries,
        );
      }
      if (receivedAt) {
        historyQueries.push(
          ...buildProposalHistoryQueries(db, {
            proposal: proposalValues,
            actorUserId: auth.user.id,
            actorRole: 'party_b',
            milestone: 'receive',
            eventType: 'proposal.received',
            eventData: {
              source: 'proposal_create',
            },
            createdAt: receivedAt,
            requestId: context.requestId,
          }).queries,
        );
      }
      if (evaluatedAt) {
        historyQueries.push(
          ...buildProposalHistoryQueries(db, {
            proposal: proposalValues,
            actorUserId: auth.user.id,
            actorRole: 'party_a',
            milestone: 'evaluate',
            eventType: 'proposal.evaluated',
            eventData: {
              source: 'proposal_create',
            },
            createdAt: evaluatedAt,
            requestId: context.requestId,
          }).queries,
        );
      }
      const [createdRows] = await db.batch([
        db.insert(schema.proposals).values(proposalValues).returning(),
        ...historyQueries,
      ]);
      created = createdRows[0];
    } catch {
      throw new ApiError(500, 'proposal_create_failed', 'Failed to persist proposal to the database');
    }

    console.info(
      JSON.stringify({
        level: 'info',
        route: '/api/proposals',
        event: 'proposal_created',
        requestId: context.requestId,
        userId: auth.user.id,
        proposalId: created.id,
        status: created.status,
        vercelEnv: dbIdentity.vercelEnv,
        dbHost: dbIdentity.dbHost,
        dbName: dbIdentity.dbName,
        dbSchema: dbIdentity.dbSchema,
        dbUrlHash: dbIdentity.dbUrlHash,
      }),
    );

    ok(res, 201, {
      proposal: mapProposalRow(
        created,
        getProposalThreadState(created, auth.user),
      ),
    });
  });
}
