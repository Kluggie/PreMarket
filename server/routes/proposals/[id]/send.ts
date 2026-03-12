import { and, eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { getDatabaseIdentitySnapshot, getDb, schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { getResendConfig } from '../../../_lib/integrations.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { buildProposalHistoryQueries } from '../../../_lib/proposal-history.js';
import { assertProposalOpenForNegotiation, buildPendingWonReset } from '../../../_lib/proposal-outcomes.js';
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

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    recipient_email: row.partyBEmail || null,
    owner_user_id: row.userId,
    sent_at: row.sentAt || null,
    received_at: row.receivedAt || null,
    evaluated_at: row.evaluatedAt || null,
    last_shared_at: row.lastSharedAt || null,
    user_id: row.userId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

async function sendProposalEmail(params: {
  recipientEmail: string;
  senderEmail: string;
  proposalTitle: string;
}) {
  const resend = getResendConfig();
  if (!resend.ready) {
    throw new ApiError(501, 'not_configured', 'Resend email delivery is not configured');
  }

  const sender = asText(params.senderEmail) || 'A PreMarket user';
  const title = asText(params.proposalTitle) || 'Untitled proposal';
  const subject = `${sender} sent you a proposal: ${title}`;
  const text = [
    `${sender} sent you a proposal on PreMarket.`,
    '',
    `Title: ${title}`,
    '',
    'Sign in to PreMarket to review and respond.',
  ].join('\n');

  const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
  const payload: Record<string, unknown> = {
    from,
    to: [params.recipientEmail],
    subject,
    text,
  };

  if (resend.replyTo) {
    payload.reply_to = resend.replyTo;
  }

  let response: Response;
  let responseBody: any = {};
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    responseBody = await response.json().catch(() => ({}));
  } catch {
    throw new ApiError(502, 'email_send_failed', 'Email provider is unavailable');
  }

  if (!response.ok) {
    throw new ApiError(502, 'email_send_failed', 'Email provider rejected the request', {
      providerStatus: response.status,
      providerError: asText(responseBody?.message || responseBody?.error) || null,
    });
  }

  return asText(responseBody?.id) || null;
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
    const dbIdentity = getDatabaseIdentitySnapshot();
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
    assertProposalOpenForNegotiation(existing);

    const body = await readJsonBody(req);
    const recipientEmail =
      normalizeEmail(body.recipientEmail || body.recipient_email || existing.partyBEmail || '') || null;

    if (!recipientEmail || !isLikelyEmail(recipientEmail)) {
      throw new ApiError(400, 'invalid_input', 'A valid recipient_email is required before sending');
    }

    const createShareLink = body.createShareLink !== false;
    const emailProviderMessageId = await sendProposalEmail({
      recipientEmail,
      senderEmail: auth.user.email,
      proposalTitle: existing.title,
    });

    const sentAt = new Date();
    const pendingWonReset = buildPendingWonReset(existing, sentAt) || {};
    const nextProposal = {
      ...existing,
      status: 'sent',
      draftStep: 4,
      partyBEmail: recipientEmail,
      sentAt,
      lastSharedAt: createShareLink ? sentAt : existing.lastSharedAt || null,
      ...pendingWonReset,
      updatedAt: sentAt,
    };

    let updatedProposal = null;
    let createdSharedLink = null;

    if (createShareLink) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const sharedLinkValues = {
            id: newId('share'),
            token: newToken(24),
            userId: auth.user.id,
            proposalId: existing.id,
            recipientEmail,
            status: 'active',
            mode: 'workspace',
            canView: true,
            canEdit: true,
            canEditConfidential: true,
            canReevaluate: true,
            canSendBack: true,
            maxUses: 50,
            uses: 0,
            expiresAt: null,
            idempotencyKey: null,
            reportMetadata: {},
            createdAt: sentAt,
            updatedAt: sentAt,
          };
          const { queries: historyQueries } = buildProposalHistoryQueries(db, {
            proposal: nextProposal,
            actorUserId: auth.user.id,
            actorRole: 'party_a',
            milestone: 'send',
            eventType: 'proposal.sent',
            eventData: {
              recipient_email: recipientEmail,
              has_shared_link: true,
            },
            sharedLinks: [sharedLinkValues],
            createdAt: sentAt,
            requestId: context.requestId,
          });

          const [proposalRows, sharedLinkRows] = await db.batch([
            db
              .update(schema.proposals)
              .set({
                status: nextProposal.status,
                draftStep: nextProposal.draftStep,
                partyBEmail: nextProposal.partyBEmail,
                sentAt: nextProposal.sentAt,
                lastSharedAt: nextProposal.lastSharedAt,
                ...pendingWonReset,
                updatedAt: nextProposal.updatedAt,
              })
              .where(eq(schema.proposals.id, existing.id))
              .returning(),
            db.insert(schema.sharedLinks).values(sharedLinkValues).returning(),
            ...historyQueries,
          ]);
          updatedProposal = proposalRows[0];
          createdSharedLink = sharedLinkRows[0];
          break;
        } catch (error) {
          if (String(error?.message || '').toLowerCase().includes('shared_links_token_unique')) {
            continue;
          }
          throw error;
        }
      }

      if (!createdSharedLink) {
        throw new ApiError(500, 'token_generation_failed', 'Unable to create shared link');
      }

      await logAuditEventBestEffort({
        eventType: 'share.link.created',
        userId: auth.user.id,
        req,
        metadata: {
          share_id: createdSharedLink.id,
          proposal_id: updatedProposal.id,
          mode: createdSharedLink.mode,
        },
      });
    } else {
      const { queries: historyQueries } = buildProposalHistoryQueries(db, {
        proposal: nextProposal,
        actorUserId: auth.user.id,
        actorRole: 'party_a',
        milestone: 'send',
        eventType: 'proposal.sent',
        eventData: {
          recipient_email: recipientEmail,
          has_shared_link: false,
        },
        createdAt: sentAt,
        requestId: context.requestId,
      });
      const [proposalRows] = await db.batch([
        db
          .update(schema.proposals)
          .set({
            status: nextProposal.status,
            draftStep: nextProposal.draftStep,
            partyBEmail: nextProposal.partyBEmail,
            sentAt: nextProposal.sentAt,
            ...pendingWonReset,
            updatedAt: nextProposal.updatedAt,
          })
          .where(eq(schema.proposals.id, existing.id))
          .returning(),
        ...historyQueries,
      ]);
      updatedProposal = proposalRows[0];
    }

    const sharedLink = createdSharedLink
      ? {
          id: createdSharedLink.id,
          token: createdSharedLink.token,
          url: buildSharedReportUrl(createdSharedLink.token),
          status: createdSharedLink.status,
          mode: createdSharedLink.mode,
          recipient_email: createdSharedLink.recipientEmail,
          can_view: Boolean(createdSharedLink.canView),
          can_edit: Boolean(createdSharedLink.canEdit),
          can_edit_confidential: Boolean(createdSharedLink.canEditConfidential),
          can_reevaluate: Boolean(createdSharedLink.canReevaluate),
          can_send_back: Boolean(createdSharedLink.canSendBack),
          max_uses: createdSharedLink.maxUses,
          uses: createdSharedLink.uses,
          expires_at: createdSharedLink.expiresAt,
          created_date: createdSharedLink.createdAt,
        }
      : null;

    console.info(
      JSON.stringify({
        level: 'info',
        route: '/api/proposals/[id]/send',
        event: 'proposal_sent',
        requestId: context.requestId,
        userId: auth.user.id,
        proposalId: updatedProposal.id,
        sentAt: sentAt.toISOString(),
        hasSharedLink: Boolean(sharedLink?.token),
        emailProviderMessageId,
        vercelEnv: dbIdentity.vercelEnv,
        dbHost: dbIdentity.dbHost,
        dbName: dbIdentity.dbName,
        dbSchema: dbIdentity.dbSchema,
        dbUrlHash: dbIdentity.dbUrlHash,
      }),
    );

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
            emailCategory: 'proposal_received',
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
