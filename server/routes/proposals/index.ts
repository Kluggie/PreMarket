import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
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

function mapProposalRow(proposal, currentUser, sharedReportLink = null) {
  const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
  const currentUserId = String(currentUser?.id || '').trim();
  const senderEmail = String(proposal.partyAEmail || '').trim().toLowerCase();
  const recipientEmail = String(proposal.partyBEmail || '').trim().toLowerCase();
  const normalizedStatus = String(proposal.status || '').trim().toLowerCase();
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

  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    status_reason: proposal.statusReason || null,
    directional_status: directionalStatus,
    list_type: listType,
    shared_report_token: hasSharedReportLink ? sharedReportToken : null,
    shared_report_status: hasSharedReportLink ? String(sharedReportLink.status || '').toLowerCase() || 'active' : null,
    shared_report_expires_at: hasSharedReportLink ? sharedReportLink.expiresAt || null : null,
    shared_report_last_updated_at: hasSharedReportLink ? sharedReportLink.updatedAt || null : null,
    shared_report_sent_at: hasSharedReportLink ? sharedReportLink.createdAt || null : null,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    proposal_type: proposal.proposalType || 'standard',
    draft_step: Number(proposal.draftStep || 1),
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
      const query = String(req.query?.query || req.query?.q || '').trim();
      const statusFilter = String(req.query?.status || '').trim().toLowerCase();
      const cursor = decodeCursor(String(req.query?.cursor || ''));

      const hasUserEmail = typeof auth.user.email === 'string' && auth.user.email.trim().length > 0;
      const userEmail = hasUserEmail ? normalizeEmail(auth.user.email) : '';
      const dbIdentity = getDatabaseIdentitySnapshot();
      const recipientSharedLinks = hasUserEmail
        ? await db
            .select({
              proposalId: schema.sharedLinks.proposalId,
              token: schema.sharedLinks.token,
              status: schema.sharedLinks.status,
              expiresAt: schema.sharedLinks.expiresAt,
              createdAt: schema.sharedLinks.createdAt,
              updatedAt: schema.sharedLinks.updatedAt,
            })
            .from(schema.sharedLinks)
            .where(
              and(
                eq(schema.sharedLinks.mode, 'shared_report'),
                ilike(schema.sharedLinks.recipientEmail, userEmail),
                ne(schema.sharedLinks.userId, auth.user.id),
              ),
            )
            .orderBy(desc(schema.sharedLinks.updatedAt), desc(schema.sharedLinks.createdAt))
        : [];
      const sharedReportByProposalId = new Map<string, any>();
      recipientSharedLinks.forEach((link) => {
        const key = String(link.proposalId || '').trim();
        if (!key || sharedReportByProposalId.has(key)) {
          return;
        }
        sharedReportByProposalId.set(key, link);
      });
      const recipientSharedProposalIds = Array.from(sharedReportByProposalId.keys());
      const sharedRecipientScope = recipientSharedProposalIds.length > 0
        ? inArray(schema.proposals.id, recipientSharedProposalIds)
        : null;
      const ownerScope = hasUserEmail
        ? or(
            eq(schema.proposals.userId, auth.user.id),
            ilike(schema.proposals.partyAEmail, userEmail),
          )
        : eq(schema.proposals.userId, auth.user.id);
      const recipientScope = hasUserEmail
        ? sharedRecipientScope
          ? or(
              ilike(schema.proposals.partyBEmail, userEmail),
              sharedRecipientScope,
            )
          : ilike(schema.proposals.partyBEmail, userEmail)
        : eq(schema.proposals.userId, '__no_recipient_scope__');
      const directReceivedScope = hasUserEmail
        ? and(
            ilike(schema.proposals.partyBEmail, userEmail),
            isNotNull(schema.proposals.sentAt),
            ne(schema.proposals.userId, auth.user.id),
          )
        : eq(schema.proposals.userId, '__no_recipient_scope__');
      const sharedLinkReceivedScope = sharedRecipientScope
        ? and(sharedRecipientScope, ne(schema.proposals.userId, auth.user.id))
        : null;

      const conditions = [] as any[];
      const listScope = hasUserEmail
        ? or(
            ownerScope,
            recipientScope,
          )
        : ownerScope;
      conditions.push(listScope);

      if (tab === 'drafts') {
        // Any proposal you own where sent_at IS NULL is a draft, regardless of status.
        // This keeps under_verification, needs_changes, etc. in Drafts until email is sent.
        conditions.push(and(ownerScope, isNull(schema.proposals.sentAt)));
      } else if (tab === 'sent') {
        conditions.push(and(ownerScope, isNotNull(schema.proposals.sentAt)));
      } else if (tab === 'received') {
        conditions.push(
          sharedLinkReceivedScope
            ? or(directReceivedScope, sharedLinkReceivedScope)
            : directReceivedScope,
        );
      } else if (tab === 'mutual_interest') {
        conditions.push(
          and(
            ownerScope,
            or(
              eq(schema.proposals.status, 'mutual_interest'),
              eq(schema.proposals.status, 'received'),
            ),
          ),
        );
      }

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'draft') {
          conditions.push(and(ownerScope, isNull(schema.proposals.sentAt)));
        } else if (statusFilter === 'sent') {
          conditions.push(and(ownerScope, isNotNull(schema.proposals.sentAt)));
        } else if (statusFilter === 'received') {
          conditions.push(
            sharedLinkReceivedScope
              ? or(directReceivedScope, sharedLinkReceivedScope)
              : directReceivedScope,
          );
        } else if (statusFilter === 'mutual_interest') {
          conditions.push(
            or(
              eq(schema.proposals.status, 'mutual_interest'),
              and(ownerScope, eq(schema.proposals.status, 'received')),
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
          mapProposalRow(row, auth.user, sharedReportByProposalId.get(String(row.id || '')) || null),
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

    let created;
    try {
      [created] = await db
        .insert(schema.proposals)
        .values({
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
          createdAt: now,
          updatedAt: now,
        })
        .returning();
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
