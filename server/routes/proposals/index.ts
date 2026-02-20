import { and, desc, eq, ilike, lt, ne, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function mapProposalRow(proposal, ownerEmail, currentUser) {
  const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
  const currentUserId = String(currentUser?.id || '').trim();
  const senderEmail = String(proposal.partyAEmail || ownerEmail || '').trim().toLowerCase();
  const recipientEmail = String(proposal.partyBEmail || '').trim().toLowerCase();

  let listType = 'sent';
  if (proposal.status === 'draft') {
    listType = 'draft';
  } else if (recipientEmail && recipientEmail === currentEmail && proposal.userId !== currentUserId) {
    listType = 'received';
  } else if (recipientEmail && recipientEmail === currentEmail && senderEmail && senderEmail !== currentEmail) {
    listType = 'received';
  }

  const directionalStatus =
    listType === 'draft' ? 'draft' : listType === 'received' ? 'received' : 'sent';

  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    directional_status: directionalStatus,
    list_type: listType,
    template_id: proposal.templateId,
    template_name: proposal.templateName,
    party_a_email: proposal.partyAEmail || ownerEmail,
    party_b_email: proposal.partyBEmail,
    summary: proposal.summary,
    payload: proposal.payload || {},
    user_id: proposal.userId,
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

      const ownerScope = hasUserEmail
        ? or(eq(schema.proposals.userId, auth.user.id), ilike(schema.proposals.partyAEmail, userEmail))
        : eq(schema.proposals.userId, auth.user.id);
      const recipientScope = hasUserEmail
        ? ilike(schema.proposals.partyBEmail, userEmail)
        : eq(schema.proposals.userId, '__no_recipient_scope__');

      const conditions = [] as any[];
      const listScope = hasUserEmail
        ? or(
            eq(schema.proposals.userId, auth.user.id),
            ilike(schema.proposals.partyAEmail, userEmail),
            ilike(schema.proposals.partyBEmail, userEmail),
          )
        : eq(schema.proposals.userId, auth.user.id);
      conditions.push(listScope);

      if (tab === 'drafts') {
        conditions.push(and(ownerScope, eq(schema.proposals.status, 'draft')));
      } else if (tab === 'sent') {
        conditions.push(and(ownerScope, ne(schema.proposals.status, 'draft')));
      } else if (tab === 'received') {
        conditions.push(and(recipientScope, ne(schema.proposals.status, 'draft')));
      }

      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'draft') {
          conditions.push(eq(schema.proposals.status, 'draft'));
        } else if (statusFilter === 'sent') {
          conditions.push(and(ownerScope, ne(schema.proposals.status, 'draft')));
        } else if (statusFilter === 'received') {
          conditions.push(and(recipientScope, ne(schema.proposals.status, 'draft')));
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

      const rows = await db
        .select()
        .from(schema.proposals)
        .where(whereClause)
        .orderBy(desc(schema.proposals.createdAt), desc(schema.proposals.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

      ok(res, 200, {
        proposals: pageRows.map((row) => mapProposalRow(row, auth.user.email, auth.user)),
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
    const templateId = String(body.templateId || body.template_id || '').trim() || null;
    const templateName = String(body.templateName || body.template_name || '').trim() || null;
    const partyAEmail = normalizeEmail(body.partyAEmail || body.party_a_email || auth.user.email || '') || null;
    const partyBEmail = normalizeEmail(body.partyBEmail || body.party_b_email || '') || null;
    const summary = String(body.summary || '').trim() || null;
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    const now = new Date();
    const proposalId = newId('proposal');

    const [created] = await db
      .insert(schema.proposals)
      .values({
        id: proposalId,
        userId: auth.user.id,
        title,
        status,
        templateId,
        templateName,
        partyAEmail,
        partyBEmail,
        summary,
        payload,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    ok(res, 201, {
      proposal: mapProposalRow(created, auth.user.email, auth.user),
    });
  });
}
