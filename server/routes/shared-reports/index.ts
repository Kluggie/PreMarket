import { and, desc, eq, inArray } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../_lib/env.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId, newToken } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  const normalized = asText(value).toLowerCase();
  return normalized || '';
}

function buildSharedReportUrl(token: string) {
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  const returnPath = `/share/${encodeURIComponent(String(token || ''))}`;

  if (!appBaseUrl) {
    return returnPath;
  }

  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function parseExpiresAt(value: unknown) {
  const text = asText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getComparisonIdFromBody(body: Record<string, unknown>) {
  return asText(body.comparisonId || body.comparison_id);
}

function mapDelivery(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    sent_to_email: row.sentToEmail,
    provider_message_id: row.providerMessageId || null,
    last_error: row.lastError || null,
    sent_at: row.sentAt || null,
    created_at: row.createdAt,
  };
}

function mapSharedReportLink(row: any, comparisonId: string | null, deliveries: any[]) {
  const sortedDeliveries = Array.isArray(deliveries)
    ? deliveries.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    : [];

  return {
    id: row.id,
    token: row.token,
    url: buildSharedReportUrl(row.token),
    proposal_id: row.proposalId,
    comparison_id: comparisonId,
    recipient_email: row.recipientEmail || null,
    status: row.status,
    mode: row.mode,
    can_view: Boolean(row.canView),
    can_edit: Boolean(row.canEdit),
    can_reevaluate: Boolean(row.canReevaluate),
    can_send_back: Boolean(row.canSendBack),
    max_uses: row.maxUses,
    uses: row.uses,
    expires_at: row.expiresAt || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_delivery: sortedDeliveries.length > 0 ? mapDelivery(sortedDeliveries[0]) : null,
    deliveries: sortedDeliveries.slice(0, 5).map(mapDelivery),
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/sharedReports', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    if (req.method === 'GET') {
      const comparisonId = asText(req.query?.comparisonId || req.query?.comparison_id);
      const proposalIdRaw = asText(req.query?.proposalId || req.query?.proposal_id);

      let proposalId = proposalIdRaw;
      let resolvedComparisonId: string | null = null;

      if (comparisonId) {
        const [comparison] = await db
          .select()
          .from(schema.documentComparisons)
          .where(
            and(
              eq(schema.documentComparisons.id, comparisonId),
              eq(schema.documentComparisons.userId, auth.user.id),
            ),
          )
          .limit(1);

        if (!comparison) {
          throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
        }

        proposalId = String(comparison.proposalId || '').trim();
        resolvedComparisonId = comparison.id;
      }

      if (!proposalId) {
        throw new ApiError(400, 'invalid_input', 'comparisonId or proposalId is required');
      }

      const [proposal] = await db
        .select()
        .from(schema.proposals)
        .where(and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id)))
        .limit(1);

      if (!proposal) {
        throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
      }

      if (!resolvedComparisonId && proposal.documentComparisonId) {
        resolvedComparisonId = proposal.documentComparisonId;
      }

      const links = await db
        .select()
        .from(schema.sharedLinks)
        .where(
          and(
            eq(schema.sharedLinks.proposalId, proposal.id),
            eq(schema.sharedLinks.userId, auth.user.id),
            eq(schema.sharedLinks.mode, 'shared_report'),
          ),
        )
        .orderBy(desc(schema.sharedLinks.createdAt))
        .limit(20);

      const linkIds = links.map((link) => link.id);
      const deliveries =
        linkIds.length > 0
          ? await db
              .select()
              .from(schema.sharedReportDeliveries)
              .where(inArray(schema.sharedReportDeliveries.sharedLinkId, linkIds))
              .orderBy(desc(schema.sharedReportDeliveries.createdAt))
          : [];

      const deliveriesByLinkId = new Map<string, any[]>();
      deliveries.forEach((delivery) => {
        const key = String(delivery.sharedLinkId || '');
        if (!deliveriesByLinkId.has(key)) {
          deliveriesByLinkId.set(key, []);
        }
        deliveriesByLinkId.get(key)?.push(delivery);
      });

      ok(res, 200, {
        sharedReports: links.map((link) =>
          mapSharedReportLink(link, resolvedComparisonId, deliveriesByLinkId.get(link.id) || []),
        ),
      });
      return;
    }

    const body = await readJsonBody(req);
    const comparisonId = getComparisonIdFromBody(body);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'comparisonId is required');
    }

    const [comparison] = await db
      .select()
      .from(schema.documentComparisons)
      .where(
        and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.userId, auth.user.id),
        ),
      )
      .limit(1);

    if (!comparison) {
      throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
    }

    const proposalId = asText(comparison.proposalId);
    if (!proposalId) {
      throw new ApiError(
        400,
        'proposal_link_required',
        'Document comparison must be linked to a proposal before sharing',
      );
    }

    const [proposal] = await db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id)))
      .limit(1);

    if (!proposal) {
      throw new ApiError(404, 'proposal_not_found', 'Linked proposal not found');
    }

    const recipientEmail = normalizeEmail(body.recipientEmail || body.recipient_email || proposal.partyBEmail);

    const maxUsesRaw = Number(body.maxUses || body.max_uses || 50);
    const maxUses = Number.isFinite(maxUsesRaw)
      ? Math.min(Math.max(Math.floor(maxUsesRaw), 1), 1000)
      : 50;
    const expiresAt = parseExpiresAt(body.expiresAt || body.expires_at);
    const now = new Date();

    // TODO: migrate shared link token storage from plaintext token -> token_hash.
    const [created] = await db
      .insert(schema.sharedLinks)
      .values({
        id: newId('share'),
        token: newToken(24),
        userId: auth.user.id,
        proposalId: proposal.id,
        recipientEmail: recipientEmail || null,
        status: 'active',
        mode: 'shared_report',
        canView: true,
        canEdit: false,
        canReevaluate: false,
        canSendBack: false,
        maxUses,
        uses: 0,
        lastUsedAt: null,
        expiresAt,
        idempotencyKey: null,
        reportMetadata: {
          workflow: 'single_shared_report',
          comparison_id: comparison.id,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db
      .update(schema.proposals)
      .set({
        lastSharedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, proposal.id));

    ok(res, 201, {
      token: created.token,
      url: buildSharedReportUrl(created.token),
      expiresAt: created.expiresAt || null,
      sharedReport: mapSharedReportLink(created, comparison.id, []),
    });
  });
}

