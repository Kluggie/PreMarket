import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { getResendConfig } from '../../_lib/integrations.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/email/send', async (context) => {
    ensureMethod(req, ['POST']);

    const resend = getResendConfig();
    if (!resend.ready) {
      throw new ApiError(501, 'not_configured', 'Email integration is not configured');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const to = asText(body.to || body.recipientEmail || body.recipient_email);
    const subject = asText(body.subject);
    const text = asText(body.text);
    const html = asText(body.html);

    if (!to || !isLikelyEmail(to)) {
      throw new ApiError(400, 'invalid_input', 'A valid recipient email is required');
    }

    if (!subject) {
      throw new ApiError(400, 'invalid_input', 'Email subject is required');
    }

    if (!text && !html) {
      throw new ApiError(400, 'invalid_input', 'Email text or html content is required');
    }

    const from = resend.fromName
      ? `${resend.fromName} <${resend.fromEmail}>`
      : resend.fromEmail;

    const payload: Record<string, unknown> = {
      from,
      to: [to],
      subject,
    };

    if (text) {
      payload.text = text;
    }

    if (html) {
      payload.html = html;
    }

    if (resend.replyTo) {
      payload.reply_to = resend.replyTo;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new ApiError(400, 'email_send_failed', 'Email provider rejected the request');
      }

      throw new ApiError(502, 'email_send_failed', 'Email provider is unavailable');
    }

    ok(res, 200, {});
  });
}
