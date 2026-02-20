import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../_lib/db/client.js';

export function mapBilling(row) {
  return {
    plan_tier: row?.plan || 'starter',
    subscription_status: row?.status || 'inactive',
    stripe_customer_id: row?.stripeCustomerId || null,
    stripe_subscription_id: row?.stripeSubscriptionId || null,
    stripe_price_id: row?.stripePriceId || null,
    stripe_checkout_session_id: row?.stripeCheckoutSessionId || null,
    cancel_at_period_end: Boolean(row?.cancelAtPeriodEnd),
    current_period_end: row?.currentPeriodEnd || null,
    updated_date: row?.updatedAt || null,
  };
}

export async function ensureBillingRow(userId: string) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan: 'starter',
      status: 'inactive',
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: schema.billingReferences.userId,
    });

  const [row] = await db
    .select()
    .from(schema.billingReferences)
    .where(eq(schema.billingReferences.userId, userId))
    .limit(1);

  return row || null;
}
