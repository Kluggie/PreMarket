import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';
import { cancelStripeSubscription, getStripeCheckoutConfig } from './_stripe.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePeriodEnd(unixSeconds: unknown) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(Math.floor(numeric) * 1000);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/billing/cancel', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const checkoutConfig = getStripeCheckoutConfig();
    if (!checkoutConfig.configured) {
      throw new ApiError(501, 'not_configured', 'Stripe cancellation is not configured');
    }

    const existing = await ensureBillingRow(auth.user.id);
    const subscriptionId = asText(existing?.stripeSubscriptionId);
    if (!subscriptionId) {
      throw new ApiError(400, 'invalid_input', 'No active Stripe subscription to cancel');
    }

    const canceled = await cancelStripeSubscription(subscriptionId);
    const currentPeriodEnd = parsePeriodEnd(canceled?.current_period_end);

    const db = getDb();
    const updateValues = {
      cancelAtPeriodEnd: true,
      currentPeriodEnd,
      status: asText(canceled?.status) || existing?.status || 'active',
      updatedAt: new Date(),
    };

    await db
      .update(schema.billingReferences)
      .set(updateValues)
      .where(eq(schema.billingReferences.userId, auth.user.id));

    const [row] = await db
      .select()
      .from(schema.billingReferences)
      .where(eq(schema.billingReferences.userId, auth.user.id))
      .limit(1);

    ok(res, 200, {
      billing: mapBilling(row),
    });
  });
}
