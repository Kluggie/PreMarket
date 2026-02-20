import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { ensureMigrated, getDb, hasDatabaseUrl } from '../helpers/db.mjs';

if (!hasDatabaseUrl()) {
  test('db smoke test (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('db connectivity and migrations are healthy', async () => {
    await ensureMigrated();

    const db = getDb();
    const ping = await db.execute(sql`select 1 as ok`);

    assert.equal(Number(ping.rows?.[0]?.ok || 0), 1);

    const tables = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );

    const tableNames = new Set((tables.rows || []).map((row) => row.table_name));

    assert.equal(tableNames.has('users'), true);
    assert.equal(tableNames.has('proposals'), true);
    assert.equal(tableNames.has('shared_links'), true);
    assert.equal(tableNames.has('billing_references'), true);
    assert.equal(tableNames.has('templates'), true);
    assert.equal(tableNames.has('template_sections'), true);
    assert.equal(tableNames.has('template_questions'), true);
    assert.equal(tableNames.has('proposal_responses'), true);
    assert.equal(tableNames.has('proposal_snapshots'), true);
    assert.equal(tableNames.has('snapshot_access'), true);
    assert.equal(tableNames.has('proposal_evaluations'), true);
    assert.equal(tableNames.has('document_comparisons'), true);
    assert.equal(tableNames.has('shared_link_responses'), true);
    assert.equal(tableNames.has('contact_requests'), true);
  });
}
