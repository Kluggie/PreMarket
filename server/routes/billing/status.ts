import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';
import { getStripeCheckoutConfig, getStripeSubscription } from './_stripe.js';

function parsePeriodEnd(unixSeconds: unknown) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(Math.floor(numeric) * 1000);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/billing/status', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const row = await ensureBillingRow(auth.user.id);
    const stripe = getStripeCheckoutConfig();

    // Override plan_tier with the session-resolved value from auth.js, which
    // correctly accounts for betaSignups (early access) and trialEndsAt expiry.
    // mapBilling reads only billingReferences.plan and would return 'starter'
    // for EA users whose plan is determined by betaSignups, not by a billing row.
    const billing = mapBilling(row);
    billing.plan_tier = auth.user.plan_tier || billing.plan_tier;

    // Lazy sync: when a subscription is scheduled to cancel but current_period_end
    // is missing from the DB (e.g. cancellation was set via admin, Stripe dashboard,
    // or a path that predates the cancel route fix), fetch it from Stripe once and
    // persist it so the UI can show the exact cancellation date.
    const stripeSubId =
      typeof row?.stripeSubscriptionId === 'string' && row.stripeSubscriptionId.length > 0
        ? row.stripeSubscriptionId
        : null;

    if (stripe.configured && row?.cancelAtPeriodEnd && !row?.currentPeriodEnd && stripeSubId) {
      try {
        const sub = await getStripeSubscription(stripeSubId);
        const currentPeriodEnd = parsePeriodEnd(sub?.current_period_end);
        if (currentPeriodEnd) {
          const db = getDb();
          await db
            .update(schema.billingReferences)
            .set({ currentPeriodEnd, updatedAt: new Date() })
            .where(eq(schema.billingReferences.userId, auth.user.id));
          // Reflect the synced value in this response without a second DB round-trip.
          billing.current_period_end = currentPeriodEnd;
        }
      } catch {
        // Degrade gracefully — status still returns, just without the period end date.
      }
    }

    ok(res, 200, {
      billing,
      stripe: {
        configured: stripe.configured,
      },
    });
  });
}
