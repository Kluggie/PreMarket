import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';
import { getStripeCheckoutConfig, getStripeSubscription, listStripeCustomerSubscriptions } from './_stripe.js';

function parsePeriodEnd(unixSeconds: unknown) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(Math.floor(numeric) * 1000);
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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
    // is missing from the DB, fetch it from Stripe once and persist it so the UI
    // can show the exact cancellation date.
    // Gate: only needs STRIPE_SECRET_KEY — intentionally does NOT require the full
    // checkout config (PROFESSIONAL_STRIPE_PRICE_ID + APP_BASE_URL), which may be
    // absent in some envs even when Stripe reads are functional.
    const stripeReadConfigured = Boolean(asText(process.env.STRIPE_SECRET_KEY));

    if (stripeReadConfigured && row?.cancelAtPeriodEnd && !row?.currentPeriodEnd) {
      try {
        const db = getDb();
        let stripeSubId = asText(row?.stripeSubscriptionId);

        // Sub-case B: recover the subscription ID via customer lookup
        if (!stripeSubId) {
          const customerId = asText(row?.stripeCustomerId);
          if (customerId) {
            const subs = await listStripeCustomerSubscriptions(customerId);
            const activeSub = (subs as any)?.data?.[0];
            const recoveredId = asText(activeSub?.id);
            if (recoveredId) {
              stripeSubId = recoveredId;
              // Persist the recovered subscription ID
              await db
                .update(schema.billingReferences)
                .set({ stripeSubscriptionId: recoveredId, updatedAt: new Date() })
                .where(eq(schema.billingReferences.userId, auth.user.id));
            }
          }
        }

        // Sub-cases A and B (after recovery): fetch subscription and sync date
        if (stripeSubId) {
          const sub = await getStripeSubscription(stripeSubId);
          const currentPeriodEnd = parsePeriodEnd(sub?.current_period_end);
          if (currentPeriodEnd) {
            await db
              .update(schema.billingReferences)
              .set({ currentPeriodEnd, updatedAt: new Date() })
              .where(eq(schema.billingReferences.userId, auth.user.id));
            // Reflect the synced value in this response without a second DB round-trip.
            billing.current_period_end = currentPeriodEnd;
          }
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
