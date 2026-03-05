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
    assert.equal(
      ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL', 'DIRECT_URL'].includes(
        diagnostics.sourceEnvKey,
      ),
      true,
      'sourceEnvKey must be one of the supported DB env keys',
    );
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
}
