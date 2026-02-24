import { ok } from '../../_lib/api-response.js';
import { isEmailCategory, sendCategorizedEmail } from '../../_lib/email-delivery.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
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

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const to = asText(body.to || body.recipientEmail || body.recipient_email);
    const subject = asText(body.subject);
    const dedupeKey = asText(body.dedupeKey || body.dedupe_key) || null;
    const text = asText(body.text);
    const html = asText(body.html);
    const rawCategory = asText(body.category).toLowerCase();

    if (!to || !isLikelyEmail(to)) {
      throw new ApiError(400, 'invalid_input', 'A valid recipient email is required');
    }

    if (!subject) {
      throw new ApiError(400, 'invalid_input', 'Email subject is required');
    }

    if (!text && !html) {
      throw new ApiError(400, 'invalid_input', 'Email text or html content is required');
    }

    if (!isEmailCategory(rawCategory)) {
      throw new ApiError(400, 'invalid_input', 'A valid email category is required');
    }

    const delivery = await sendCategorizedEmail({
      category: rawCategory,
      to,
      subject,
      dedupeKey,
      text,
      html,
    });

    if (delivery.status === 'not_configured') {
      throw new ApiError(501, 'not_configured', 'Email integration is not configured');
    }

    if (delivery.status === 'failed') {
      if (delivery.reason === 'provider_rejected') {
        throw new ApiError(400, 'email_send_failed', 'Email provider rejected the request');
      }
      throw new ApiError(502, 'email_send_failed', 'Email provider is unavailable');
    }

    if (delivery.status === 'invalid_input') {
      throw new ApiError(400, 'invalid_input', 'Email payload is invalid');
    }

    ok(res, 200, {
      sent: delivery.status === 'sent',
      blocked: delivery.blocked,
      mode: delivery.mode,
      category: rawCategory,
    });
  });
}
