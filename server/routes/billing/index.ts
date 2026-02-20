import { eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { ensureBillingRow, mapBilling } from './_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/billing', async (context) => {
    ensureMethod(req, ['GET', 'PATCH']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();

    if (req.method === 'GET') {
      const row = await ensureBillingRow(auth.user.id);
      ok(res, 200, {
        billing: mapBilling(row),
      });
      return;
    }

    const body = await readJsonBody(req);

    const updateValues = {
      plan: String(body.plan_tier || body.plan || 'starter').trim().toLowerCase() || 'starter',
      status:
        String(body.subscription_status || body.status || 'inactive').trim().toLowerCase() ||
        'inactive',
      stripeCustomerId:
        String(body.stripe_customer_id || body.stripeCustomerId || '').trim() || null,
      stripeSubscriptionId:
        String(body.stripe_subscription_id || body.stripeSubscriptionId || '').trim() || null,
      stripePriceId: String(body.stripe_price_id || body.stripePriceId || '').trim() || null,
      stripeCheckoutSessionId:
        String(body.stripe_checkout_session_id || body.stripeCheckoutSessionId || '').trim() || null,
      cancelAtPeriodEnd: Boolean(body.cancel_at_period_end || body.cancelAtPeriodEnd),
      currentPeriodEnd:
        body.current_period_end || body.currentPeriodEnd
          ? new Date(String(body.current_period_end || body.currentPeriodEnd))
          : null,
      updatedAt: new Date(),
    };

    await db
      .insert(schema.billingReferences)
      .values({
        userId: auth.user.id,
        ...updateValues,
        createdAt: new Date(),
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
      billing: mapBilling(row),
    });
  });
}
