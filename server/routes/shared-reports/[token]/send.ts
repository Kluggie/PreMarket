import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { getResendConfig } from '../../../_lib/integrations.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function buildShareUrl(token: string) {
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  const returnPath = `/share/${encodeURIComponent(String(token || ''))}`;
  if (!appBaseUrl) {
    return returnPath;
  }
  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function normalizeErrorForStorage(message: unknown) {
  const text = asText(message);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').slice(0, 400);
}

function isExpired(expiresAt: Date | string | null) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

async function createDeliveryLog(params: {
  db: any;
  sharedLinkId: string;
  proposalId: string;
  userId: string;
  sentToEmail: string;
  status: 'queued' | 'sent' | 'failed';
  providerMessageId?: string | null;
  lastError?: string | null;
}) {
  const now = new Date();
  const [created] = await params.db
    .insert(schema.sharedReportDeliveries)
    .values({
      id: newId('share_delivery'),
      sharedLinkId: params.sharedLinkId,
      proposalId: params.proposalId,
      userId: params.userId,
      sentToEmail: params.sentToEmail,
      status: params.status,
      providerMessageId: params.providerMessageId || null,
      lastError: params.lastError || null,
      sentAt: params.status === 'sent' ? now : null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/sharedReports/[token]/send', async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [joined] = await db
      .select({
        link: schema.sharedLinks,
        proposal: schema.proposals,
      })
      .from(schema.sharedLinks)
      .leftJoin(schema.proposals, eq(schema.proposals.id, schema.sharedLinks.proposalId))
      .where(
        and(eq(schema.sharedLinks.token, token), eq(schema.sharedLinks.userId, auth.user.id)),
      )
      .limit(1);

    const link = joined?.link || null;
    const proposal = joined?.proposal || null;
    if (!link || !proposal) {
      throw new ApiError(404, 'shared_report_not_found', 'Shared report link not found');
    }
    if (link.mode !== 'shared_report') {
      throw new ApiError(404, 'shared_report_not_found', 'Shared report link not found');
    }
    if (link.status !== 'active' || !link.canView) {
      throw new ApiError(409, 'token_inactive', 'Shared report link is not active');
    }
    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared report link has expired');
    }
    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared report link reached its usage limit');
    }

    const body = await readJsonBody(req);
    const recipientEmail = normalizeEmail(
      body.recipientEmail || body.recipient_email || link.recipientEmail || proposal.partyBEmail,
    );
    if (!recipientEmail) {
      throw new ApiError(400, 'invalid_input', 'recipientEmail is required');
    }

    const senderName = asText((auth.user as any)?.name) || asText(auth.user.email) || 'PreMarket';
    const title = asText(proposal.title) || 'Shared report';
    const shareUrl = buildShareUrl(link.token);
    const subject = `${senderName} shared a report: ${title}`;
    const textLines = [
      `${senderName} shared a report with you.`,
      '',
      `Title: ${title}`,
      '',
      `Open report: ${shareUrl}`,
    ].join('\n');
    const html = [
      `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">`,
      `<h2 style="margin:0 0 12px;font-size:20px;">${title}</h2>`,
      `<p style="margin:0 0 12px;">${senderName} shared a report with you on PreMarket.</p>`,
      `<p style="margin:0 0 20px;">Use the button below to view the shared report.</p>`,
      `<a href="${shareUrl}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;">Open Shared Report</a>`,
      `<p style="margin:20px 0 0;color:#64748b;font-size:12px;">If the button does not work, use this link: ${shareUrl}</p>`,
      `</div>`,
    ].join('');

    const resend = getResendConfig();
    if (!resend.ready) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: link.id,
        proposalId: proposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: 'Resend is not configured',
      });
      throw new ApiError(
        501,
        'not_configured',
        'Resend email delivery is not configured',
        { deliveryId: delivery.id },
      );
    }

    const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
    const payload: Record<string, unknown> = {
      from,
      to: [recipientEmail],
      subject,
      text: textLines,
      html,
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
    } catch (error: any) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: link.id,
        proposalId: proposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: normalizeErrorForStorage(error?.message || 'Email provider unavailable'),
      });
      throw new ApiError(502, 'email_send_failed', 'Failed to send email', { deliveryId: delivery.id });
    }

    if (!response.ok) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: link.id,
        proposalId: proposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: normalizeErrorForStorage(
          responseBody?.message || responseBody?.error || `Provider status ${response.status}`,
        ),
      });
      throw new ApiError(502, 'email_send_failed', 'Failed to send email', {
        deliveryId: delivery.id,
        providerStatus: response.status,
      });
    }

    const providerMessageId = asText(responseBody?.id) || null;
    const delivery = await createDeliveryLog({
      db,
      sharedLinkId: link.id,
      proposalId: proposal.id,
      userId: auth.user.id,
      sentToEmail: recipientEmail,
      status: 'sent',
      providerMessageId,
      lastError: null,
    });

    await db
      .update(schema.sharedLinks)
      .set({
        recipientEmail,
        updatedAt: new Date(),
      })
      .where(eq(schema.sharedLinks.id, link.id));

    await db
      .update(schema.proposals)
      .set({
        status: 'sent',
        sentAt: new Date(),
        partyBEmail: recipientEmail,
        lastSharedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.proposals.id, proposal.id));

    ok(res, 200, {
      sent: true,
      token: link.token,
      url: shareUrl,
      delivery: {
        id: delivery.id,
        status: delivery.status,
        sent_to_email: delivery.sentToEmail,
        provider_message_id: delivery.providerMessageId || null,
        last_error: delivery.lastError || null,
        sent_at: delivery.sentAt || null,
      },
    });
  });
}
