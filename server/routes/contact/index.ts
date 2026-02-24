import { ok } from '../../_lib/api-response.js';
import {
  resolveSalesInboxEmail,
  resolveSupportInboxEmail,
  sendCategorizedEmail,
} from '../../_lib/email-delivery.js';
import { ApiError } from '../../_lib/errors.js';
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
  const target = reason === 'sales' ? resolveSalesInboxEmail() : resolveSupportInboxEmail();
  return isLikelyEmail(target) ? target : '';
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

    const targetEmail = resolveTargetEmail(reason);
    if (!targetEmail) {
      throw new ApiError(501, 'not_configured', 'Contact email integration is not configured');
    }

    const reasonLabel = toReasonLabel(reason);
    const category = reason === 'sales' ? 'contact_sales' : 'contact_support';
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

    const delivery = await sendCategorizedEmail({
      category,
      to: targetEmail,
      replyTo: email,
      subject: `Contact: ${reasonLabel} - ${email}`,
      text,
    });

    if (delivery.status === 'not_configured') {
      throw new ApiError(501, 'not_configured', 'Contact email integration is not configured');
    }

    if (delivery.status === 'failed') {
      if (delivery.reason === 'provider_rejected') {
        throw new ApiError(400, 'email_send_failed', 'Email provider rejected the request');
      }
      throw new ApiError(502, 'email_send_failed', 'Email provider is unavailable');
    }

    if (delivery.status === 'invalid_input') {
      throw new ApiError(400, 'invalid_input', 'Contact email payload is invalid');
    }

    ok(res, 200, {});
  });
}
