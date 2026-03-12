import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { buildProposalHistoryQueries } from '../../_lib/proposal-history.js';
import {
  buildLegacyOutcomeSeed,
  getProposalArchivedAtForActor,
  mapProposalOutcomeForUser,
} from '../../_lib/proposal-outcomes.js';
import {
  buildProposalVisibilityScopes,
  getRecipientSharedProposalIds,
  listRecipientSharedReportLinks,
  matchesSharedReportAuthorizedUser,
  matchesSharedReportRecipientEmail,
} from '../../_lib/proposal-visibility.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// Legacy status set kept for reference only. Tab membership is now controlled
// exclusively by sent_at (NULL = unsent/draft, NOT NULL = sent). Status values
// like 'under_verification' must not evict a proposal from Drafts.
const DRAFT_STATUSES = ['draft', 'ready'] as const;

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

function mapProposalRow(proposal, currentUser, sharedReportLink = null, resumeStepOverride: unknown = null) {
  const outcome = mapProposalOutcomeForUser(proposal, currentUser);
  const effectiveStatus = outcome.final_status || proposal.status;
  const archivedAt = getProposalArchivedAtForActor(proposal, outcome.actor_role);
  const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
  const currentUserId = String(currentUser?.id || '').trim();
  const senderEmail = String(proposal.partyAEmail || '').trim().toLowerCase();
  const recipientEmail = String(proposal.partyBEmail || '').trim().toLowerCase();
  const normalizedStatus = String(effectiveStatus || '').trim().toLowerCase();
  const sharedReportToken = String(sharedReportLink?.token || '').trim();
  const hasSharedReportLink = Boolean(sharedReportToken);
  const isSent = Boolean(proposal.sentAt);
  const isOwner =
    String(proposal.userId || '').trim() === currentUserId ||
    Boolean(currentEmail && senderEmail && senderEmail === currentEmail);
  // sent_at IS NULL → still a draft; status alone does not determine tab membership.
  const isDraft = !isSent;

  let listType = 'sent';
  if (hasSharedReportLink && !isOwner) {
    listType = 'received';
  } else if (isDraft) {
    listType = 'draft';
  } else if (
    isSent &&
    recipientEmail &&
    recipientEmail === currentEmail &&
    !isOwner
  ) {
    listType = 'received';
  }

  let directionalStatus = listType === 'draft' ? 'draft' : listType === 'received' ? 'received' : 'sent';

  if (normalizedStatus && normalizedStatus !== 'draft' && normalizedStatus !== 'sent') {
    directionalStatus = normalizedStatus;
  }

  if (listType === 'received' && (normalizedStatus === 'sent' || normalizedStatus === 'received')) {
    directionalStatus = 'received';
  }

  const normalizedDraftStep = clampResumeStep(proposal.draftStep || 1, 1);
  const resolvedResumeStep = clampResumeStep(resumeStepOverride, normalizedDraftStep);

  return {
    id: proposal.id,
    title: proposal.title,
    status: effectiveStatus,
    status_reason: proposal.statusReason || null,
    directional_status: directionalStatus,
    outcome,
    list_type: listType,
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
    summary: proposal.summary,
    payload: proposal.payload || {},
    recipient_email: proposal.partyBEmail || null,
    owner_user_id: proposal.userId,
    sent_at: proposal.sentAt || null,
    received_at: proposal.receivedAt || null,
    evaluated_at: proposal.evaluatedAt || null,
    last_shared_at: proposal.lastSharedAt || null,
    archived_at: archivedAt,
    closed_at: proposal.closedAt || null,
    party_a_outcome: proposal.partyAOutcome || null,
    party_a_outcome_at: proposal.partyAOutcomeAt || null,
    party_b_outcome: proposal.partyBOutcome || null,
    party_b_outcome_at: proposal.partyBOutcomeAt || null,
    user_id: proposal.userId,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    created_date: proposal.createdAt,
    updated_date: proposal.updatedAt,
  };
}

function decodeCursor(rawCursor) {
  if (!rawCursor || typeof rawCursor !== 'string') {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    const id = String(decoded?.id || '').trim();
    const createdAt = new Date(String(decoded?.createdAt || ''));

    if (!id || Number.isNaN(createdAt.getTime())) {
      return null;
    }

    return {
      id,
      createdAt,
    };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  if (!row?.id || !row?.createdAt) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
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
      const tab = String(req.query?.tab || 'all').trim().toLowerCase();
      const isArchivedTab = tab === 'archived';
      const isClosedTab = tab === 'closed';
      const query = String(req.query?.query || req.query?.q || '').trim();
      const statusFilter = String(req.query?.status || '').trim().toLowerCase();
      const cursor = decodeCursor(String(req.query?.cursor || ''));

      const hasUserEmail = typeof auth.user.email === 'string' && auth.user.email.trim().length > 0;
      const userEmail = hasUserEmail ? normalizeEmail(auth.user.email) : '';
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
      const {
        ownerTabScope,
        recipientTabScope,
        directReceivedScope,
        sharedLinkReceivedScope,
      } = buildProposalVisibilityScopes(auth.user, recipientSharedProposalIds, {
        isArchivedTab,
      });
      const ownerAgreementRequestedScope = and(
        ownerTabScope,
        isNotNull(schema.proposals.sentAt),
        eq(schema.proposals.partyBOutcome, 'won'),
        isNull(schema.proposals.partyAOutcome),
      );
      const recipientAgreementRequestedScope = and(
        recipientTabScope,
        isNotNull(schema.proposals.sentAt),
        eq(schema.proposals.partyAOutcome, 'won'),
        isNull(schema.proposals.partyBOutcome),
      );

      const conditions = [] as any[];
      const listScope = hasUserEmail
        ? or(
            ownerTabScope,
            recipientTabScope,
          )
        : ownerTabScope;
      conditions.push(listScope);

      if (isClosedTab) {
        conditions.push(
          or(
            eq(schema.proposals.status, 'won'),
            eq(schema.proposals.status, 'lost'),
          ),
        );
      } else if (tab === 'drafts') {
        // Any proposal you own where sent_at IS NULL is a draft, regardless of status.
        // This keeps under_verification, needs_changes, etc. in Drafts until email is sent.
        conditions.push(and(ownerTabScope, isNull(schema.proposals.sentAt)));
      } else if (tab === 'sent') {
        conditions.push(and(ownerTabScope, isNotNull(schema.proposals.sentAt)));
      } else if (tab === 'received') {
        conditions.push(
          sharedLinkReceivedScope
            ? or(directReceivedScope, sharedLinkReceivedScope)
            : directReceivedScope,
        );
      } else if (tab === 'mutual_interest') {
        conditions.push(
          and(
            ownerTabScope,
            or(
              eq(schema.proposals.status, 'mutual_interest'),
              eq(schema.proposals.status, 'received'),
            ),
          ),
        );
      }

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'draft') {
          conditions.push(and(ownerTabScope, isNull(schema.proposals.sentAt)));
        } else if (statusFilter === 'sent') {
          conditions.push(and(ownerTabScope, isNotNull(schema.proposals.sentAt)));
        } else if (statusFilter === 'received') {
          conditions.push(
            sharedLinkReceivedScope
              ? or(directReceivedScope, sharedLinkReceivedScope)
              : directReceivedScope,
          );
        } else if (statusFilter === 'agreement_requested') {
          conditions.push(
            hasUserEmail
              ? or(ownerAgreementRequestedScope, recipientAgreementRequestedScope)
              : ownerAgreementRequestedScope,
          );
        } else if (statusFilter === 'mutual_interest') {
          conditions.push(
            or(
              and(ownerTabScope, eq(schema.proposals.status, 'mutual_interest')),
              and(ownerTabScope, eq(schema.proposals.status, 'received')),
            ),
          );
        } else {
          conditions.push(eq(schema.proposals.status, statusFilter));
        }
      }

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

      if (cursor) {
        conditions.push(
          or(
            lt(schema.proposals.createdAt, cursor.createdAt),
            and(eq(schema.proposals.createdAt, cursor.createdAt), lt(schema.proposals.id, cursor.id)),
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
          .orderBy(desc(schema.proposals.createdAt), desc(schema.proposals.id))
          .limit(limit + 1);
        
        // Log empty results with context for debugging
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

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

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
          resultCount: pageRows.length,
          fetchedCount: rows.length,
          hasMore,
          vercelEnv: dbIdentity.vercelEnv,
          dbHost: dbIdentity.dbHost,
          dbName: dbIdentity.dbName,
          dbSchema: dbIdentity.dbSchema,
          dbUrlHash: dbIdentity.dbUrlHash,
        }),
      );

      ok(res, 200, {
        proposals: pageRows.map((row) =>
          mapProposalRow(
            row,
            auth.user,
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
    const summary = String(body.summary || '').trim() || null;
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const sentAt = parseDateOrNull(body.sentAt || body.sent_at);
    const receivedAt = parseDateOrNull(body.receivedAt || body.received_at);
    const evaluatedAt = parseDateOrNull(body.evaluatedAt || body.evaluated_at);
    const lastSharedAt = parseDateOrNull(body.lastSharedAt || body.last_shared_at);

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
      summary,
      payload,
      sentAt,
      receivedAt,
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
      proposal: mapProposalRow(created, auth.user),
    });
  });
}
