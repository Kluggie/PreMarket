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

    ok(res, 200, {
      billing: mapBilling(row),
      stripe: {
        configured: stripe.configured,
      },
    });
  });
}
