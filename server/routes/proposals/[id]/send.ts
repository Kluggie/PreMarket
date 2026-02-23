import { and, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildSharedReportUrl(token: string) {
  const appBaseUrl = String(process.env.APP_BASE_URL || '').trim();
  const returnPath = `/SharedReport?token=${encodeURIComponent(String(token || ''))}`;

  if (!appBaseUrl) {
    return returnPath;
  }

  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function mapProposalRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    status_reason: row.statusReason || null,
    template_id: row.templateId,
    template_name: row.templateName,
    proposal_type: row.proposalType || 'standard',
    draft_step: Number(row.draftStep || 1),
    source_proposal_id: row.sourceProposalId || null,
    document_comparison_id: row.documentComparisonId || null,
    party_a_email: row.partyAEmail,
    party_b_email: row.partyBEmail,
    summary: row.summary,
    payload: row.payload || {},
    sent_at: row.sentAt || null,
    received_at: row.receivedAt || null,
    evaluated_at: row.evaluatedAt || null,
    last_shared_at: row.lastSharedAt || null,
    user_id: row.userId,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/send', async (context) => {
    ensureMethod(req, ['POST']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const currentEmail = normalizeEmail(auth.user.email);
    const proposalScope = currentEmail
      ? and(
          eq(schema.proposals.id, proposalId),
          or(
            eq(schema.proposals.userId, auth.user.id),
            ilike(schema.proposals.partyAEmail, currentEmail),
          ),
        )
      : and(eq(schema.proposals.id, proposalId), eq(schema.proposals.userId, auth.user.id));

    const [existing] = await db.select().from(schema.proposals).where(proposalScope).limit(1);
    if (!existing) {
      throw new ApiError(404, 'proposal_not_found', 'Proposal not found');
    }

    const body = await readJsonBody(req);
    const recipientEmail =
      normalizeEmail(body.recipientEmail || body.recipient_email || existing.partyBEmail || '') || null;
    const createShareLink = body.createShareLink !== false;
    const now = new Date();

    const [updatedProposal] = await db
      .update(schema.proposals)
      .set({
        status: 'sent',
        draftStep: 4,
        partyBEmail: recipientEmail,
        sentAt: now,
        updatedAt: now,
      })
      .where(eq(schema.proposals.id, existing.id))
      .returning();

    let sharedLink = null;

    if (createShareLink && recipientEmail) {
      let created = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const rows = await db
            .insert(schema.sharedLinks)
            .values({
              id: newId('share'),
              token: newToken(24),
              userId: auth.user.id,
              proposalId: updatedProposal.id,
              recipientEmail,
              status: 'active',
              mode: 'workspace',
              canView: true,
              canEdit: true,
              canReevaluate: true,
              canSendBack: true,
              maxUses: 50,
              uses: 0,
              expiresAt: null,
              idempotencyKey: null,
              reportMetadata: {},
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
        throw new ApiError(500, 'token_generation_failed', 'Unable to create shared link');
      }

      await db
        .update(schema.proposals)
        .set({
          lastSharedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, updatedProposal.id));

      sharedLink = {
        id: created.id,
        token: created.token,
        url: buildSharedReportUrl(created.token),
        status: created.status,
        mode: created.mode,
        recipient_email: created.recipientEmail,
        can_view: Boolean(created.canView),
        can_edit: Boolean(created.canEdit),
        can_reevaluate: Boolean(created.canReevaluate),
        can_send_back: Boolean(created.canSendBack),
        max_uses: created.maxUses,
        uses: created.uses,
        expires_at: created.expiresAt,
        created_date: created.createdAt,
      };
    }

    if (recipientEmail) {
      try {
        const [recipientUser] = await db
          .select({
            id: schema.users.id,
            email: schema.users.email,
          })
          .from(schema.users)
          .where(ilike(schema.users.email, recipientEmail))
          .limit(1);

        if (recipientUser && recipientUser.id !== auth.user.id) {
          await createNotificationEvent({
            db,
            userId: recipientUser.id,
            userEmail: recipientUser.email,
            eventType: 'new_proposal',
            dedupeKey: `new_proposal:${updatedProposal.id}:${recipientUser.id}`,
            title: 'New proposal received',
            message: `${auth.user.email} sent you "${updatedProposal.title || 'a proposal'}".`,
            actionUrl: `/ProposalDetail?id=${encodeURIComponent(updatedProposal.id)}`,
            emailSubject: 'New proposal received on PreMarket',
            emailText: [
              `You received a new proposal from ${auth.user.email}.`,
              '',
              `Title: ${updatedProposal.title || 'Untitled Proposal'}`,
              '',
              'Sign in to PreMarket to review it.',
            ].join('\n'),
          });
        }
      } catch {
        // Best-effort notifications should not block proposal delivery.
      }
    }

    ok(res, 200, {
      proposal: mapProposalRow(updatedProposal),
      sharedLink,
    });
  });
}
