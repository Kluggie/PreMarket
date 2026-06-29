import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ok } from '../_lib/api-response.js';
import { getDb, schema } from '../_lib/db/client.js';
import { ApiError } from '../_lib/errors.js';
import { readRawBody } from '../_lib/http.js';
import { getResendWebhookSecret } from '../_lib/integrations.js';
import { ensureMethod, withApiRoute } from '../_lib/route.js';

const RESEND_WEBHOOK_TOLERANCE_SECONDS = 60 * 5;

type ResendWebhookEvent = {
  type?: string;
  created_at?: string;
  data?: Record<string, unknown>;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function toObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function getHeader(req: any, name: string) {
  const direct = req?.headers?.[name];
  if (Array.isArray(direct)) {
    return asText(direct[0]);
  }
  if (typeof direct === 'string') {
    return direct.trim();
  }

  const normalizedName = name.toLowerCase();
  const headers = req?.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (String(key || '').toLowerCase() !== normalizedName) {
      continue;
    }
    if (Array.isArray(value)) {
      return asText(value[0]);
    }
    return asText(value);
  }

  return '';
}

function normalizeSharedReportDeliveryStatus(value: unknown) {
  const status = asLower(value);
  if (status === 'sent' || status === 'queued' || status === 'email.sent') {
    return 'queued' as const;
  }
  if (status === 'delivered' || status === 'email.delivered') {
    return 'delivered' as const;
  }
  if (status === 'bounced' || status === 'bounce' || status === 'email.bounced') {
    return 'bounced' as const;
  }
  return 'failed' as const;
}

function isTerminalSharedReportDeliveryStatus(
  status: ReturnType<typeof normalizeSharedReportDeliveryStatus>,
) {
  return status === 'delivered' || status === 'bounced' || status === 'failed';
}

function canApplySharedReportDeliveryStatusTransition(
  currentStatus: ReturnType<typeof normalizeSharedReportDeliveryStatus>,
  nextStatus: ReturnType<typeof normalizeSharedReportDeliveryStatus>,
) {
  if (currentStatus === nextStatus) {
    return true;
  }

  if (!isTerminalSharedReportDeliveryStatus(currentStatus)) {
    return true;
  }

  return false;
}

function parseEventTimestamp(value: unknown) {
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

function normalizeErrorForStorage(message: unknown) {
  const text = asText(message);
  if (!text) {
    return null;
  }
  return text.replace(/\s+/g, ' ').slice(0, 400);
}

function constantTimeStringEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSignatureCandidates(headerValue: string) {
  return headerValue
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const commaIndex = part.indexOf(',');
      if (commaIndex < 0) {
        return { version: '', signature: '' };
      }
      return {
        version: part.slice(0, commaIndex).trim(),
        signature: part.slice(commaIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.version === 'v1' && entry.signature);
}

function verifyResendWebhook(rawBody: Buffer, req: any, secret: string) {
  const svixId = getHeader(req, 'svix-id');
  const svixTimestamp = getHeader(req, 'svix-timestamp');
  const svixSignature = getHeader(req, 'svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new ApiError(400, 'invalid_signature', 'Missing webhook signature headers');
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new ApiError(400, 'invalid_signature', 'Invalid webhook timestamp');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > RESEND_WEBHOOK_TOLERANCE_SECONDS) {
    throw new ApiError(400, 'invalid_signature', 'Webhook timestamp is outside tolerance');
  }

  const secretPayload = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const secretBytes = Buffer.from(secretPayload, 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
  const expectedSignature = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const matched = parseSignatureCandidates(svixSignature).some((candidate) =>
    constantTimeStringEquals(candidate.signature, expectedSignature),
  );

  if (!matched) {
    throw new ApiError(400, 'invalid_signature', 'Webhook signature verification failed');
  }

  return {
    svixId,
    svixTimestamp,
  };
}

function parseWebhookEvent(rawBody: Buffer): ResendWebhookEvent {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as ResendWebhookEvent;
    if (!asText(parsed?.type)) {
      throw new Error('missing_type');
    }
    return parsed;
  } catch {
    throw new ApiError(400, 'invalid_payload', 'Invalid Resend webhook payload');
  }
}

function mapResendEventTypeToDeliveryStatus(value: unknown) {
  const type = asLower(value);
  switch (type) {
    case 'email.sent':
      return 'queued' as const;
    case 'email.delivered':
      return 'delivered' as const;
    case 'email.bounced':
      return 'bounced' as const;
    case 'email.failed':
      return 'failed' as const;
    default:
      return null;
  }
}

function buildDeliveryError(eventType: string, data: Record<string, unknown>) {
  if (eventType === 'email.bounced') {
    const bounce = toObject(data.bounce);
    return (
      normalizeErrorForStorage(bounce.message) ||
      normalizeErrorForStorage(bounce.subType) ||
      normalizeErrorForStorage(bounce.type) ||
      'Email bounced'
    );
  }

  if (eventType === 'email.failed') {
    const failed = toObject(data.failed);
    return normalizeErrorForStorage(failed.reason) || 'Email failed';
  }

  return null;
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/resendWebhook', async () => {
    ensureMethod(req, ['POST']);

    const secret = getResendWebhookSecret();
    if (!secret) {
      throw new ApiError(500, 'server_not_configured', 'RESEND_WEBHOOK_SECRET is required');
    }

    const rawBody = await readRawBody(req);
    if (!rawBody.length) {
      throw new ApiError(400, 'invalid_payload', 'Webhook payload is required');
    }

    const signature = verifyResendWebhook(rawBody, req, secret);
    const event = parseWebhookEvent(rawBody);
    const nextStatus = mapResendEventTypeToDeliveryStatus(event.type);

    if (!nextStatus) {
      ok(res, 200, {
        received: true,
        matched: false,
        ignored: true,
      });
      return;
    }

    const data = toObject(event.data);
    const emailId = asText(data.email_id);
    if (!emailId) {
      throw new ApiError(400, 'invalid_payload', 'Resend webhook email_id is required');
    }

    const db = getDb();
    const [delivery] = await db
      .select()
      .from(schema.sharedReportDeliveries)
      .where(eq(schema.sharedReportDeliveries.providerMessageId, emailId))
      .limit(1);

    if (!delivery) {
      ok(res, 200, {
        received: true,
        matched: false,
      });
      return;
    }

    const currentStatus = normalizeSharedReportDeliveryStatus(delivery.status);
    const currentMetadata = toObject(delivery.metadata);
    const webhookMetadata = toObject(currentMetadata.resend_webhook);
    const incomingEventAt = parseEventTimestamp(event.created_at) || new Date();
    const previousEventAt = parseEventTimestamp(webhookMetadata.last_event_at);
    const previousSvixId = asText(webhookMetadata.svix_id);

    if (previousSvixId && previousSvixId === signature.svixId) {
      ok(res, 200, {
        received: true,
        matched: true,
        ignored: true,
      });
      return;
    }

    if (previousEventAt && incomingEventAt.getTime() < previousEventAt.getTime()) {
      ok(res, 200, {
        received: true,
        matched: true,
        ignored: true,
      });
      return;
    }

    if (!canApplySharedReportDeliveryStatusTransition(currentStatus, nextStatus)) {
      ok(res, 200, {
        received: true,
        matched: true,
        ignored: true,
      });
      return;
    }

    const updatedMetadata = {
      ...currentMetadata,
      resend_webhook: {
        ...webhookMetadata,
        svix_id: signature.svixId,
        last_event_type: asText(event.type),
        last_event_at: incomingEventAt.toISOString(),
        email_id: emailId,
        message_id: asText(data.message_id) || null,
      },
    };

    await db
      .update(schema.sharedReportDeliveries)
      .set({
        status: nextStatus,
        lastError: buildDeliveryError(asLower(event.type), data),
        metadata: updatedMetadata,
        updatedAt: new Date(),
      })
      .where(eq(schema.sharedReportDeliveries.id, delivery.id));

    ok(res, 200, {
      received: true,
      matched: true,
    });
  });
}
