import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { ok } from '../_lib/api-response.js';
import { getDb, schema } from '../_lib/db/client.js';
import { ApiError } from '../_lib/errors.js';
import { getStripeWebhookSecret } from '../_lib/integrations.js';
import { readRawBody } from '../_lib/http.js';
import { ensureMethod, withApiRoute } from '../_lib/route.js';

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 60 * 5;

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: any;
  };
};

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function toDateFromUnixSeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return new Date(Math.floor(numeric) * 1000);
}

function getHeader(req: any, name: string) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) {
    return asString(value[0]);
  }
  return asString(value);
}

function parseStripeSignatureHeader(headerValue: string) {
  let timestamp = 0;
  const signatures: string[] = [];

  for (const part of headerValue.split(',')) {
    const [key, rawValue] = part.split('=', 2).map((segment) => segment.trim());

    if (key === 't') {
      timestamp = Number(rawValue || 0);
      continue;
    }

    if (key === 'v1' && rawValue) {
      signatures.push(rawValue);
    }
  }

  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new ApiError(400, 'invalid_signature', 'Invalid Stripe signature header');
  }

  return {
    timestamp,
    signatures,
  };
}

function safeHexEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}

function verifyStripeSignature(rawBody: Buffer, headerValue: string, secret: string) {
  const { timestamp, signatures } = parseStripeSignatureHeader(headerValue);

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new ApiError(400, 'invalid_signature', 'Stripe signature timestamp is outside tolerance');
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  const matched = signatures.some((candidate) => safeHexEqual(candidate, expected));

  if (!matched) {
    throw new ApiError(400, 'invalid_signature', 'Stripe signature verification failed');
  }
}

function parseStripeEvent(rawBody: Buffer) {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as StripeEvent;

    if (!asString(parsed?.id) || !asString(parsed?.type)) {
      throw new Error('invalid_shape');
    }

    return parsed;
  } catch {
    throw new ApiError(400, 'invalid_payload', 'Invalid Stripe payload');
  }
}

function toUpdateValues(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

async function upsertBillingByUserId(userId: string, values: Record<string, unknown>) {
  const db = getDb();
  const now = new Date();

  const updateValues = toUpdateValues({
    ...values,
    updatedAt: now,
  });

  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan: 'starter',
      status: 'inactive',
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
      ...values,
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: updateValues,
    });
}

async function resolveBillingUserId(customerId: string, subscriptionId: string, metadataUserId: string) {
  if (metadataUserId) {
    return metadataUserId;
  }

  const conditions = [];

  if (customerId) {
    conditions.push(eq(schema.billingReferences.stripeCustomerId, customerId));
  }

  if (subscriptionId) {
    conditions.push(eq(schema.billingReferences.stripeSubscriptionId, subscriptionId));
  }

  if (conditions.length === 0) {
    return '';
  }

  const db = getDb();
  const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);

  const [row] = await db
    .select({ userId: schema.billingReferences.userId })
    .from(schema.billingReferences)
    .where(whereClause)
    .limit(1);

  return asString(row?.userId);
}

async function handleCheckoutSessionCompleted(payload: any) {
  const userId = asString(payload?.metadata?.user_id || payload?.metadata?.userId);

  if (!userId) {
    return;
  }

  await upsertBillingByUserId(userId, {
    plan: 'professional',
    status: 'active',
    stripeCustomerId: asOptionalString(payload?.customer),
    stripeSubscriptionId: asOptionalString(payload?.subscription),
    cancelAtPeriodEnd: false,
  });
}

async function handleSubscriptionEvent(payload: any, deleted = false) {
  const customerId = asString(payload?.customer);
  const subscriptionId = asString(payload?.id);
  const metadataUserId = asString(payload?.metadata?.user_id || payload?.metadata?.userId);
  const userId = await resolveBillingUserId(customerId, subscriptionId, metadataUserId);

  if (!userId) {
    return;
  }

  const status = deleted ? 'canceled' : asString(payload?.status || 'inactive');

  await upsertBillingByUserId(userId, {
    plan: status === 'canceled' ? 'starter' : 'professional',
    status,
    stripeCustomerId: asOptionalString(customerId),
    stripeSubscriptionId: asOptionalString(subscriptionId),
    cancelAtPeriodEnd: deleted ? false : Boolean(payload?.cancel_at_period_end),
    currentPeriodEnd: toDateFromUnixSeconds(payload?.current_period_end),
  });
}

async function handleInvoiceEvent(payload: any, paymentSucceeded: boolean) {
  const customerId = asString(payload?.customer);
  const subscriptionId = asString(payload?.subscription);
  const metadataUserId = asString(
    payload?.subscription_details?.metadata?.user_id || payload?.subscription_details?.metadata?.userId,
  );

  const userId = await resolveBillingUserId(customerId, subscriptionId, metadataUserId);

  if (!userId) {
    return;
  }

  await upsertBillingByUserId(userId, {
    plan: paymentSucceeded ? 'professional' : undefined,
    status: paymentSucceeded ? 'active' : 'past_due',
    stripeCustomerId: asOptionalString(customerId),
    stripeSubscriptionId: asOptionalString(subscriptionId),
  });
}

async function applyStripeEvent(event: StripeEvent) {
  const payload = event?.data?.object;

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(payload);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionEvent(payload, false);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionEvent(payload, true);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoiceEvent(payload, true);
      break;
    case 'invoice.payment_failed':
      await handleInvoiceEvent(payload, false);
      break;
    default:
      break;
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/stripeWebhook', async () => {
    ensureMethod(req, ['POST']);

    const secret = getStripeWebhookSecret();
    if (!secret) {
      throw new ApiError(500, 'server_not_configured', 'STRIPE_WEBHOOK_SECRET is required');
    }

    const signature = getHeader(req, 'stripe-signature');
    if (!signature) {
      throw new ApiError(400, 'invalid_signature', 'Missing Stripe signature header');
    }

    const rawBody = await readRawBody(req);
    if (!rawBody.length) {
      throw new ApiError(400, 'invalid_payload', 'Stripe payload is required');
    }

    verifyStripeSignature(rawBody, signature, secret);
    const event = parseStripeEvent(rawBody);

    const requestId = getHeader(req, 'x-request-id') || randomUUID();

    console.log(
      JSON.stringify({
        requestId,
        eventType: asString(event.type),
        eventId: asString(event.id),
      }),
    );

    await applyStripeEvent(event);

    ok(res, 200, {});
  });
}
