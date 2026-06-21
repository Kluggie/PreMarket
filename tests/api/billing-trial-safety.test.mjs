import assert from 'node:assert/strict';
import test from 'node:test';
import billingHandler from '../../server/routes/billing/index.ts';
import billingStatusHandler from '../../server/routes/billing/status.ts';
import { getDb, schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

async function callHandler(handler, reqOptions) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res);
  return res;
}

async function seedUser(userId, email, role = 'user') {
  const db = getDb();
  await db
    .insert(schema.users)
    .values({ id: userId, email, role })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email, role, updatedAt: new Date() },
    });
}

async function seedBilling(userId, plan, status = 'active') {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan,
      status,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: { plan, status, updatedAt: now },
    });
}

if (!hasDatabaseUrl()) {
  test('billing trial safety (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('normal users cannot self-grant Professional through PATCH /api/billing', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'billing_patch_regular_user';
    const email = 'billing-patch-user@example.com';
    await seedUser(userId, email);

    const cookie = makeSessionCookie({ sub: userId, email });
    const patchRes = await callHandler(billingHandler, {
      method: 'PATCH',
      url: '/api/billing',
      headers: { cookie },
      body: {
        plan_tier: 'professional',
        subscription_status: 'active',
      },
    });

    assert.equal(patchRes.statusCode, 403);
    assert.equal(patchRes.jsonBody().error?.code, 'forbidden');

    const statusRes = await callHandler(billingStatusHandler, {
      method: 'GET',
      url: '/api/billing/status',
      headers: { cookie },
    });

    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.jsonBody().billing.plan_tier, 'starter');
  });

  test('unknown and free billing plans fail closed to Starter', async () => {
    await ensureMigrated();
    await resetTables();

    for (const [index, plan] of ['custom', 'free', 'early_access'].entries()) {
      const userId = `billing_unknown_plan_${index}`;
      const email = `billing-unknown-${index}@example.com`;
      await seedUser(userId, email);
      await seedBilling(userId, plan, 'active');

      const statusRes = await callHandler(billingStatusHandler, {
        method: 'GET',
        url: '/api/billing/status',
        headers: { cookie: makeSessionCookie({ sub: userId, email }) },
      });

      assert.equal(statusRes.statusCode, 200);
      assert.equal(statusRes.jsonBody().billing.plan_tier, 'starter');
    }
  });

  test('admin manual billing grants remain explicit', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'billing_patch_admin_user';
    const email = 'billing-patch-admin@example.com';
    await seedUser(userId, email, 'admin');

    const cookie = makeSessionCookie({ sub: userId, email });
    const patchRes = await callHandler(billingHandler, {
      method: 'PATCH',
      url: '/api/billing',
      headers: { cookie },
      body: {
        plan_tier: 'enterprise',
        subscription_status: 'active',
      },
    });

    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.jsonBody().billing.plan_tier, 'enterprise');
    assert.equal(patchRes.jsonBody().billing.subscription_status, 'active');
  });
}
