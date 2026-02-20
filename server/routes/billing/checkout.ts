import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../_lib/env.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';
import { createCheckoutSession, createStripeCustomer, getStripeCheckoutConfig } from './_stripe.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/billing/checkout', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const checkoutConfig = getStripeCheckoutConfig();
    if (!checkoutConfig.configured) {
      throw new ApiError(501, 'not_configured', 'Stripe checkout is not configured');
    }

    const db = getDb();
    const currentRow = await ensureBillingRow(auth.user.id);
    let customerId = asText(currentRow?.stripeCustomerId);

    if (!customerId) {
      const createdCustomer = await createStripeCustomer(auth.user.email, auth.user.id);
      customerId = asText(createdCustomer?.id);

      if (!customerId) {
        throw new ApiError(502, 'stripe_request_failed', 'Stripe customer creation failed');
      }
    }

    const successUrl = toCanonicalAppUrl(checkoutConfig.appBaseUrl, '/Billing?upgrade=success');
    const cancelUrl = toCanonicalAppUrl(checkoutConfig.appBaseUrl, '/Pricing?upgrade=canceled');

    const checkoutSession = await createCheckoutSession({
      customerId,
      priceId: checkoutConfig.priceId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      successUrl,
      cancelUrl,
    });

    const sessionId = asText(checkoutSession?.id);
    const checkoutUrl = asText(checkoutSession?.url);
    const subscriptionId = asText(checkoutSession?.subscription);

    if (!sessionId || !checkoutUrl) {
      throw new ApiError(502, 'stripe_request_failed', 'Stripe checkout session creation failed');
    }

    const now = new Date();
    const updateValues = {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId || currentRow?.stripeSubscriptionId || null,
      stripePriceId: checkoutConfig.priceId,
      stripeCheckoutSessionId: sessionId,
      updatedAt: now,
    };

    await db
      .insert(schema.billingReferences)
      .values({
        userId: auth.user.id,
        plan: currentRow?.plan || 'starter',
        status: currentRow?.status || 'inactive',
        cancelAtPeriodEnd: Boolean(currentRow?.cancelAtPeriodEnd),
        createdAt: now,
        ...updateValues,
      })
      .onConflictDoUpdate({
        target: schema.billingReferences.userId,
        set: updateValues,
      });

    const [row] = await db
      .select()
      .from(schema.billingReferences)
      .where(eq(schema.billingReferences.userId, auth.user.id))
      .limit(1);

    ok(res, 200, {
      checkout: {
        session_id: sessionId,
        url: checkoutUrl,
      },
      billing: mapBilling(row),
    });
  });
}
