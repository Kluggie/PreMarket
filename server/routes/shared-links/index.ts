import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { assertProposalOwnership, requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../_lib/env.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId, newToken } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function buildSharedReportUrl(token: string) {
  const appBaseUrl = String(process.env.APP_BASE_URL || '').trim();
  const returnPath = `/SharedReport?token=${encodeURIComponent(String(token || ''))}`;

  if (!appBaseUrl) {
    return returnPath;
  }

  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function mapLink(row, proposal) {
  return {
    id: row.id,
    token: row.token,
    url: buildSharedReportUrl(row.token),
    proposalId: row.proposalId,
    status: row.status,
    recipientEmail: row.recipientEmail,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    uses: row.uses,
    reportMetadata: row.reportMetadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
    proposal: proposal
      ? {
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          template_name: proposal.templateName,
        }
      : null,
  };
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/shared-links', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const proposalId = String(body.proposalId || body.proposal_id || '').trim();

    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'proposalId is required');
    }

    const proposal = await assertProposalOwnership(auth.user.id, proposalId);
    const db = getDb();

    const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || '').trim() || null;

    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(schema.sharedLinks)
        .where(
          and(
            eq(schema.sharedLinks.userId, auth.user.id),
            eq(schema.sharedLinks.idempotencyKey, idempotencyKey),
          ),
        )
        .orderBy(desc(schema.sharedLinks.createdAt))
        .limit(1);

      if (existing) {
        ok(res, 200, {
          sharedLink: mapLink(existing, proposal),
          idempotent: true,
        });
        return;
      }
    }

    const recipientEmail = String(body.recipientEmail || body.recipient_email || '').trim() || null;
    const reportMetadata =
      body.reportMetadata && typeof body.reportMetadata === 'object' ? body.reportMetadata : {};

    const maxUsesRaw = Number(body.maxUses || body.max_uses || 1);
    const maxUses = Number.isFinite(maxUsesRaw) ? Math.min(Math.max(Math.floor(maxUsesRaw), 1), 1000) : 1;

    let expiresAt = null;
    if (body.expiresAt || body.expires_at) {
      const dateCandidate = new Date(String(body.expiresAt || body.expires_at));
      if (!Number.isNaN(dateCandidate.getTime())) {
        expiresAt = dateCandidate;
      }
    }

    const now = new Date();

    let created;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const rows = await db
          .insert(schema.sharedLinks)
          .values({
            id: newId('share'),
            token: newToken(24),
            userId: auth.user.id,
            proposalId,
            recipientEmail,
            status: 'active',
            maxUses,
            uses: 0,
            expiresAt,
            idempotencyKey,
            reportMetadata,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        created = rows[0];
        break;
      } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('shared_links_token_unique')) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new ApiError(500, 'token_generation_failed', 'Unable to create a unique shared token');
    }

    ok(res, 201, {
      sharedLink: mapLink(created, proposal),
    });
  });
}
