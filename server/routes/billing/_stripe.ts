import { ApiError } from '../../_lib/errors.js';

type StripeResponse = Record<string, unknown> & {
  error?: {
    message?: string;
  };
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toFormBody(params: Record<string, unknown>) {
  const body = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (entry === null || entry === undefined) return;
        body.append(`${key}[${index}]`, String(entry));
      });
      return;
    }

    body.append(key, String(value));
  });

  return body.toString();
}

async function stripeRequest(method: string, path: string, body?: Record<string, unknown>): Promise<StripeResponse> {
  const secret = asText(process.env.STRIPE_SECRET_KEY);
  if (!secret) {
    throw new ApiError(501, 'not_configured', 'Stripe integration is not configured');
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? toFormBody(body) : undefined,
  });

  const payload = await response.json().catch(() => ({} as StripeResponse)) as StripeResponse;

  if (!response.ok) {
    const message =
      typeof payload?.error?.message === 'string' && payload.error.message.trim().length > 0
        ? payload.error.message.trim()
        : 'Stripe request failed';
    throw new ApiError(502, 'stripe_request_failed', message);
  }

  return payload;
}

export function getStripeCheckoutConfig() {
  const priceId = asText(process.env.PROFESSIONAL_STRIPE_PRICE_ID);
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  const configured = Boolean(asText(process.env.STRIPE_SECRET_KEY) && priceId && appBaseUrl);

  return {
    configured,
    priceId,
    appBaseUrl,
  };
}

export async function createStripeCustomer(email: string, userId: string) {
  return stripeRequest('POST', '/customers', {
    email,
    'metadata[user_id]': userId,
    'metadata[user_email]': email,
  });
}

export async function createCheckoutSession(input: {
  customerId: string;
  priceId: string;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripeRequest('POST', '/checkout/sessions', {
    customer: input.customerId,
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'metadata[user_id]': input.userId,
    'metadata[user_email]': input.userEmail,
  });
}

export async function cancelStripeSubscription(subscriptionId: string) {
  return stripeRequest('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: 'true',
  });
}

export async function listStripeCustomerSubscriptions(customerId: string) {
  return stripeRequest('GET', `/subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=1`);
}
