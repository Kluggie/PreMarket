import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

// Import handlers to test actual API behavior
async function importProposalsHandler() {
  const mod = await import('../../server/routes/proposals/index.ts');
  return mod.default;
}

async function importDebugDbHandler() {
  const mod = await import('../../server/routes/debug/db.ts');
  return mod.default;
}

async function importBetaSignupsStatsHandler() {
  const mod = await import('../../server/routes/beta-signups/stats.ts');
  return mod.default;
}

async function createProposalViaHandler(cookie, body) {
  const handler = await importProposalsHandler();
  const req = createMockReq({
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 201, `Expected 201 but got ${res.statusCode}: ${res.body}`);
  return res.jsonBody().proposal;
}

async function listProposalsViaHandler(cookie, query = {}) {
  const handler = await importProposalsHandler();
  const req = createMockReq({
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  return res.jsonBody().proposals || [];
}

async function getDbDiagnosticsViaHandler(cookie) {
  const handler = await importDebugDbHandler();
  const req = createMockReq({
    method: 'GET',
    url: '/api/debug/db',
    headers: { cookie },
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

if (!hasDatabaseUrl()) {
  test('database persistence across deploy (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('CRITICAL: proposals persist after simulated redeploy (db client reset)', async () => {
    // This test simulates what happens after a Vercel deployment:
    // 1. Create a proposal
    // 2. Clear the memoized DB client (simulates cold start / new instance)
    // 3. Verify the proposal still exists
    // This would catch if we were accidentally using in-memory storage.
    
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('deploy_test_owner', 'deploy-owner@example.com');
    const proposalTitle = `Deploy Test ${Date.now()}`;

    // Create a proposal
    const proposal = await createProposalViaHandler(ownerCookie, {
      title: proposalTitle,
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });

    // Verify it exists
    const beforeReset = await listProposalsViaHandler(ownerCookie, { limit: '50' });
    const foundBefore = beforeReset.find((p) => p.id === proposal.id);
    assert.ok(foundBefore, 'Proposal should exist before simulated redeploy');
    assert.equal(foundBefore.title, proposalTitle);

    // SIMULATE VERCEL DEPLOYMENT: Clear the memoized db client
    // In production, each new deployment gets fresh serverless instances
    // with no global state preserved
    delete globalThis.__pm_drizzle_db;

    // Verify proposal still exists after simulated cold start
    const afterReset = await listProposalsViaHandler(ownerCookie, { limit: '50' });
    const foundAfter = afterReset.find((p) => p.id === proposal.id);
    assert.ok(foundAfter, 'Proposal MUST persist after simulated redeploy. This failure indicates ephemeral storage!');
    assert.equal(foundAfter.title, proposalTitle, 'Proposal data must be intact');
  });

  test('dbUrlHash remains stable across simulated deploys', async () => {
    // This test verifies that the database identity hash doesn't change
    // between "deploys" - which would indicate different databases being used.
    
    await ensureMigrated();
    
    const ownerCookie = authCookie('hash_test_owner', 'hash-owner@example.com');

    // Get initial diagnostics
    const diag1 = await getDbDiagnosticsViaHandler(ownerCookie);
    const hash1 = diag1.dbUrlHash;
    const host1 = diag1.dbHost;
    const name1 = diag1.dbName;

    assert.ok(hash1, 'dbUrlHash must be present');
    assert.ok(host1, 'dbHost must be present');
    assert.ok(name1, 'dbName must be present');

    // Simulate redeploy
    delete globalThis.__pm_drizzle_db;

    // Get diagnostics again
    const diag2 = await getDbDiagnosticsViaHandler(ownerCookie);
    
    assert.equal(diag2.dbUrlHash, hash1, 'dbUrlHash MUST remain stable across redeploys');
    assert.equal(diag2.dbHost, host1, 'dbHost MUST remain stable across redeploys');
    assert.equal(diag2.dbName, name1, 'dbName MUST remain stable across redeploys');
  });

  test('/api/debug/db returns comprehensive persistence diagnostics', async () => {
    await ensureMigrated();
    // Ensure a valid user exists for auth
    const db = getDb();
    await db.execute(sql`
      insert into users (id, email, full_name, role, created_at, updated_at)
      values ('diag_test_owner', 'diag-owner@example.com', 'Diag Owner', 'user', now(), now())
      on conflict (id) do nothing
    `);
    
    const ownerCookie = authCookie('diag_test_owner', 'diag-owner@example.com');
    const diagnostics = await getDbDiagnosticsViaHandler(ownerCookie);

    // Verify all required diagnostic fields are present
    assert.equal(diagnostics.runtime, 'nodejs');
    assert.equal(diagnostics.dbConfigured, true);
    assert.equal(diagnostics.dbConnected, true);
    assert.equal(diagnostics.sourceEnvKey, 'DATABASE_URL');
    assert.ok(diagnostics.dbHost, 'dbHost must be present');
    assert.ok(diagnostics.dbName, 'dbName must be present');
    assert.ok(diagnostics.dbUrlHash, 'dbUrlHash must be present');
    
    // Verify data counts are present in the response (may be null if no proposals exist yet)
    assert.ok('dataCounts' in diagnostics, 'dataCounts must be present in response');
    assert.ok(typeof diagnostics.dataCounts === 'object' && diagnostics.dataCounts !== null, 'dataCounts must be an object');
    
    // Verify schema version info (may not be available in test environment)
    assert.ok('dbSchemaVersion' in diagnostics, 'dbSchemaVersion must be present in response');
    assert.ok(typeof diagnostics.dbSchemaVersion === 'object', 'dbSchemaVersion must be an object');
    // Note: schemaVersion.available can be false in test environments with rapid sequential
    // resetTable calls, but the field must always be present.
  });

  test('CRITICAL: beta seat count correct after simulated redeploy', async () => {
    // Regression test for the beta_signups persistence bug:
    // If the beta_signups table rows survive a simulated cold start (globalThis reset),
    // the seat count must remain the same after "redeploy".
    // This would also catch if the seat count is computed from in-memory state.

    await ensureMigrated();
    await resetTables();

    const betaStatsHandler = await importBetaSignupsStatsHandler();

    async function getStats() {
      const req = createMockReq({ method: 'GET', url: '/api/beta-signups/stats' });
      const res = createMockRes();
      await betaStatsHandler(req, res);
      return res;
    }

    // Seed some beta signups directly into the DB
    const db = getDb();
    await db.execute(sql`
      insert into beta_signups (id, email, email_normalized, user_id, source, created_at)
      values
        (gen_random_uuid(), 'alpha@example.com', 'alpha@example.com', null, 'landing', now()),
        (gen_random_uuid(), 'bravo@example.com', 'bravo@example.com', null, 'landing', now()),
        (gen_random_uuid(), 'charlie@example.com', 'charlie@example.com', null, 'landing', now())
      on conflict (email_normalized) do nothing
    `);

    const statsBefore = await getStats();
    assert.equal(statsBefore.statusCode, 200);
    assert.equal(statsBefore.jsonBody().seatsClaimed, 3, 'Should show 3 seats claimed before simulated redeploy');

    // Simulate redeploy: clear the memoized DB client
    delete globalThis.__pm_drizzle_db;

    const statsAfter = await getStats();
    assert.equal(statsAfter.statusCode, 200, 'Stats endpoint must return 200 after simulated redeploy');
    assert.equal(
      statsAfter.jsonBody().seatsClaimed,
      3,
      'Beta seat count MUST remain 3 after simulated redeploy. ' +
        'This failure means seat count is NOT persisted in the DB, or a different DB is being used.',
    );
    assert.equal(statsAfter.jsonBody().seatsTotal, 50);
  });

  test('REGRESSION: beta stats endpoint returns 503 db_schema_missing (not 200 with seatsClaimed=0) when table absent', async () => {
    // This test verifies the key regression guard: if the beta_signups table
    // does not exist (migration not applied), the API must return 503
    // db_schema_missing — NOT a 200 with seatsClaimed=0.
    //
    // A silent empty-list response would look to users and operators like
    // "data was wiped" when actually the migration just wasn't applied.
    // A 503 db_schema_missing is immediately actionable: run db:migrate.
    //
    // We test this by simulating the PG error via toApiError() directly,
    // since we cannot drop the real table in an integration test.

    const { toApiError } = await import('../../server/_lib/errors.js');

    const undefinedTableError = new Error('relation "beta_signups" does not exist');
    undefinedTableError.code = '42P01';

    const apiError = toApiError(undefinedTableError);

    assert.equal(
      apiError.statusCode,
      503,
      'A missing table must produce a 503, not a 200 with empty data.',
    );
    assert.equal(
      apiError.code,
      'db_schema_missing',
      'Error code must be db_schema_missing so operators know to run db:migrate.',
    );
  });
}
