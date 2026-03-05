import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import betaSignupsHandler from '../../server/routes/beta-signups/index.ts';
import betaSignupsStatsHandler from '../../server/routes/beta-signups/stats.ts';
import { ensureTestEnv } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import { schema } from '../../server/_lib/db/client.js';

ensureTestEnv();

async function callHandler(handler, reqOptions) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res);
  return res;
}

if (!hasDatabaseUrl()) {
  test('beta signups persistence (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('POST /api/beta-signups accepts a new email and increments seats', async () => {
    await ensureMigrated();
    await resetTables();

    const firstCreate = await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: 'new-beta-user@example.com',
        source: 'landing',
      },
    });

    assert.equal(firstCreate.statusCode, 200);
    assert.equal(firstCreate.jsonBody().ok, true);
    assert.equal(firstCreate.jsonBody().seatsClaimed, 1);
    assert.equal(firstCreate.jsonBody().seatsTotal, 50);

    const stats = await callHandler(betaSignupsStatsHandler, {
      method: 'GET',
      url: '/api/beta-signups/stats',
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.jsonBody().ok, true);
    assert.equal(stats.jsonBody().seatsClaimed, 1);
    assert.equal(stats.jsonBody().seatsTotal, 50);
  });

  test('duplicate signup is deduped case-insensitively and returns already_signed_up', async () => {
    await ensureMigrated();
    await resetTables();

    const firstCreate = await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: '  BetaApplicant@Example.com ',
        source: 'landing',
      },
    });

    assert.equal(firstCreate.statusCode, 200);
    assert.equal(firstCreate.jsonBody().seatsClaimed, 1);

    const duplicateCreate = await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: 'betaapplicant@example.com',
        source: 'landing',
      },
    });

    assert.equal(duplicateCreate.statusCode, 409);
    assert.equal(duplicateCreate.jsonBody().ok, false);
    assert.equal(duplicateCreate.jsonBody().error?.code, 'already_signed_up');
    assert.equal(duplicateCreate.jsonBody().error?.seatsClaimed, 1);
    assert.equal(duplicateCreate.jsonBody().error?.seatsTotal, 50);

    const stats = await callHandler(betaSignupsStatsHandler, {
      method: 'GET',
      url: '/api/beta-signups/stats',
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.jsonBody().seatsClaimed, 1);

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.betaSignups)
      .where(eq(schema.betaSignups.emailNormalized, 'betaapplicant@example.com'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'BetaApplicant@Example.com');
  });

  test('GET /api/beta-signups/stats reflects persisted count', async () => {
    await ensureMigrated();
    await resetTables();

    await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: 'first@example.com',
        source: 'landing',
      },
    });

    await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: 'second@example.com',
        source: 'settings',
      },
    });

    const stats = await callHandler(betaSignupsStatsHandler, {
      method: 'GET',
      url: '/api/beta-signups/stats',
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.jsonBody().seatsClaimed, 2);
    assert.equal(stats.jsonBody().seatsTotal, 50);
  });

  test('legacy beta_applications rows are counted and deduped by normalized email', async () => {
    await ensureMigrated();
    await resetTables();

    const db = getDb();

    await db.insert(schema.betaApplications).values({
      id: 'beta_app_legacy_1',
      email: '  Kluggie2000@gmail.com ',
      status: 'applied',
      userId: null,
      source: 'pricing',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const stats = await callHandler(betaSignupsStatsHandler, {
      method: 'GET',
      url: '/api/beta-signups/stats',
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.jsonBody().ok, true);
    assert.equal(stats.jsonBody().seatsClaimed, 1);
    assert.equal(stats.jsonBody().seatsTotal, 50);
  });

  test('legacy signup returns already_signed_up and does not increment count', async () => {
    await ensureMigrated();
    await resetTables();

    const db = getDb();

    await db.insert(schema.betaApplications).values({
      id: 'beta_app_legacy_2',
      email: 'kluggie2000@gmail.com',
      status: 'applied',
      userId: null,
      source: 'pricing',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const duplicateCreate = await callHandler(betaSignupsHandler, {
      method: 'POST',
      url: '/api/beta-signups',
      body: {
        email: ' KLUGGIE2000@gmail.com ',
        source: 'landing',
      },
    });

    assert.equal(duplicateCreate.statusCode, 409);
    assert.equal(duplicateCreate.jsonBody().ok, false);
    assert.equal(duplicateCreate.jsonBody().error?.code, 'already_signed_up');
    assert.equal(duplicateCreate.jsonBody().error?.seatsClaimed, 1);

    const stats = await callHandler(betaSignupsStatsHandler, {
      method: 'GET',
      url: '/api/beta-signups/stats',
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.jsonBody().seatsClaimed, 1);
  });
}
