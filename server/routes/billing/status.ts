import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';
import { getStripeCheckoutConfig } from './_stripe.js';

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

    ok(res, 200, {
      billing,
      stripe: {
        configured: stripe.configured,
      },
    });
  });
}
