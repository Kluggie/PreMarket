import { ok } from '../../_lib/api-response.js';
import { ApiError } from '../../_lib/errors.js';
import { getResendConfig } from '../../_lib/integrations.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const ALLOWED_REASONS = new Set([
  'support',
  'sales',
  'request',
  'customer_review',
  'complaint',
  'other',
]);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseReason(value: unknown) {
  const normalized = asText(value).toLowerCase();

  if (ALLOWED_REASONS.has(normalized)) {
    return normalized;
  }

  return '';
}

function toReasonLabel(reason: string) {
  switch (reason) {
    case 'sales':
      return 'Sales';
    case 'request':
      return 'Feature Request';
    case 'customer_review':
      return 'Customer Review';
    case 'complaint':
      return 'Complaint';
    case 'other':
      return 'Other';
    default:
      return 'Support';
  }
}

function resolveTargetEmail(reason: string) {
  const sharedContactEmail = asText(
    process.env.CONTACT_TO_EMAIL || process.env.CONTACT_SUPPORT_EMAIL || process.env.SUPPORT_EMAIL,
  );
  const salesEmail = asText(process.env.SALES_TO_EMAIL || process.env.CONTACT_SALES_EMAIL);

  if (reason === 'sales' && isLikelyEmail(salesEmail)) {
    return salesEmail;
  }

  if (isLikelyEmail(sharedContactEmail)) {
    return sharedContactEmail;
  }

  if (isLikelyEmail(salesEmail)) {
    return salesEmail;
  }

  return '';
}

async function sendContactNotification(input: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
}) {
  const payload: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
    reply_to: input.replyTo,
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new ApiError(500, 'email_send_failed', 'Unable to send contact message right now');
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/contact', async () => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const name = asText(body.name);
    const email = asText(body.email).toLowerCase();
    const organization = asText(body.organization);
    const reason = parseReason(body.reason);
    const message = asText(body.message || body.details);

    if (!name) {
      throw new ApiError(400, 'invalid_input', 'Name is required');
    }

    if (!email || !isLikelyEmail(email)) {
      throw new ApiError(400, 'invalid_input', 'A valid email is required');
    }

    if (!reason) {
      throw new ApiError(400, 'invalid_input', 'Reason is required');
    }

    if (!message) {
      throw new ApiError(400, 'invalid_input', 'Message is required');
    }

    const resend = getResendConfig();
    if (!resend.ready) {
      throw new ApiError(501, 'not_configured', 'Contact email integration is not configured');
    }

    const targetEmail = resolveTargetEmail(reason);
    if (!targetEmail) {
      throw new ApiError(501, 'not_configured', 'Contact email integration is not configured');
    }

    const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
    const reasonLabel = toReasonLabel(reason);
    const effectiveReplyTo = resend.replyTo || email;
    const text = [
      'New contact request',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Reason: ${reasonLabel}`,
      `Organization: ${organization || 'Not provided'}`,
      '',
      'Message:',
      message,
    ].join('\n');

    await sendContactNotification({
      apiKey: resend.apiKey,
      from,
      to: targetEmail,
      replyTo: effectiveReplyTo,
      subject: `Contact: ${reasonLabel} - ${email}`,
      text,
    });

    ok(res, 200, {});
  });
}
