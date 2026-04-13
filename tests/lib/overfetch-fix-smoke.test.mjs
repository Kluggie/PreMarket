/**
 * overfetch-fix-smoke.test.mjs
 *
 * Smoke test to verify the overfetch-fix queries execute without SQL errors.
 * Requires DATABASE_URL to be set (via .env.local or environment).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Load .env.local so DATABASE_URL is available ──────────────────────────
function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore missing file
  }
}

const root = resolve(import.meta.dirname, '../..');
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log('⚠ DATABASE_URL not set – skipping overfetch smoke tests');
  process.exit(0);
}

// ── Minimal Drizzle setup (same driver as production) ─────────────────────
const { neon } = await import('@neondatabase/serverless');
const { drizzle } = await import('drizzle-orm/neon-http');
const { desc, eq, sql, inArray } = await import('drizzle-orm');
const schema = await import('../../server/_lib/db/schema.js');

const sqlClient = neon(DATABASE_URL);
const db = drizzle({ client: sqlClient, schema });

// ── Test 1: Comparisons list query (lightweight columns) ─────────────────
test('comparisons list query selects only lightweight columns', async () => {
  const listColumns = {
    id: schema.documentComparisons.id,
    userId: schema.documentComparisons.userId,
    proposalId: schema.documentComparisons.proposalId,
    title: schema.documentComparisons.title,
    status: schema.documentComparisons.status,
    draftStep: schema.documentComparisons.draftStep,
    companyName: schema.documentComparisons.companyName,
    companyWebsite: schema.documentComparisons.companyWebsite,
    recipientName: schema.documentComparisons.recipientName,
    recipientEmail: schema.documentComparisons.recipientEmail,
    createdAt: schema.documentComparisons.createdAt,
    updatedAt: schema.documentComparisons.updatedAt,
  };

  const rows = await db
    .select(listColumns)
    .from(schema.documentComparisons)
    .orderBy(desc(schema.documentComparisons.updatedAt))
    .limit(3);

  assert.ok(Array.isArray(rows), 'should return array');
  for (const row of rows) {
    assert.ok(typeof row.id === 'string', 'id should be string');
    assert.ok(typeof row.title === 'string', 'title should be string');
    // Heavy fields must NOT be present
    assert.strictEqual(row.docAText, undefined, 'docAText must not be present');
    assert.strictEqual(row.docBText, undefined, 'docBText must not be present');
    assert.strictEqual(row.evaluationResult, undefined, 'evaluationResult must not be present');
    assert.strictEqual(row.publicReport, undefined, 'publicReport must not be present');
    assert.strictEqual(row.inputs, undefined, 'inputs must not be present');
    assert.strictEqual(row.metadata, undefined, 'metadata must not be present');
  }
});

// ── Test 2: Proposals comparison batch with boolean flags ────────────────
test('proposals comparison batch query uses boolean flags', async () => {
  // Get a few comparison IDs to test with
  const sampleRows = await db
    .select({ id: schema.documentComparisons.id })
    .from(schema.documentComparisons)
    .limit(3);

  const ids = sampleRows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) {
    console.log('  (no comparisons in DB, skipping batch query test)');
    return;
  }

  const rows = await db
    .select({
      id: schema.documentComparisons.id,
      title: schema.documentComparisons.title,
      status: schema.documentComparisons.status,
      draftStep: schema.documentComparisons.draftStep,
      hasDocAText: sql`length(coalesce(${schema.documentComparisons.docAText}, '')) > 0`,
      hasDocBText: sql`length(coalesce(${schema.documentComparisons.docBText}, '')) > 0`,
      hasInputsContent: sql`${schema.documentComparisons.inputs} != '{}'::jsonb`,
      hasEvaluationResult: sql`${schema.documentComparisons.evaluationResult} != '{}'::jsonb`,
      hasPublicReport: sql`${schema.documentComparisons.publicReport} != '{}'::jsonb`,
    })
    .from(schema.documentComparisons)
    .where(inArray(schema.documentComparisons.id, ids));

  assert.ok(Array.isArray(rows), 'should return array');
  for (const row of rows) {
    assert.ok(typeof row.id === 'string', 'id should be string');
    // Boolean flags should be actual booleans (or truthy/falsy values from PG)
    assert.ok(
      typeof row.hasDocAText === 'boolean' || typeof row.hasDocAText === 'string',
      `hasDocAText should be boolean-ish, got ${typeof row.hasDocAText}`,
    );
    // Heavy fields must NOT be present
    assert.strictEqual(row.docAText, undefined, 'docAText must not be present');
    assert.strictEqual(row.docBText, undefined, 'docBText must not be present');
  }
});

// ── Test 3: Shared report activity jsonb_build_object query ──────────────
test('shared report activity query narrows both eventData and versionSnapshot', async () => {
  // Get a proposal ID to test with
  const [sampleProposal] = await db
    .select({ id: schema.proposals.id })
    .from(schema.proposals)
    .limit(1);

  if (!sampleProposal) {
    console.log('  (no proposals in DB, skipping activity query test)');
    return;
  }

  const rows = await db
    .select({
      id: schema.proposalEvents.id,
      eventType: schema.proposalEvents.eventType,
      actorRole: schema.proposalEvents.actorRole,
      createdAt: schema.proposalEvents.createdAt,
      eventData: sql`jsonb_build_object(
        'shared_link_id', coalesce(${schema.proposalEvents.eventData}->>'shared_link_id', ${schema.proposalEvents.eventData}->>'sharedLinkId', ${schema.proposalEvents.eventData}->>'link_id', ${schema.proposalEvents.eventData}->>'linkId', ${schema.proposalEvents.eventData}->>'share_id', ${schema.proposalEvents.eventData}->>'shareId', ${schema.proposalEvents.eventData}->>'shared_report_link_id', ${schema.proposalEvents.eventData}->>'sharedReportLinkId'),
        'shared_link_token', coalesce(${schema.proposalEvents.eventData}->>'shared_link_token', ${schema.proposalEvents.eventData}->>'sharedLinkToken', ${schema.proposalEvents.eventData}->>'share_token', ${schema.proposalEvents.eventData}->>'shareToken', ${schema.proposalEvents.eventData}->>'link_token', ${schema.proposalEvents.eventData}->>'linkToken', ${schema.proposalEvents.eventData}->>'token'),
        'recipient_email', coalesce(${schema.proposalEvents.eventData}->>'recipient_email', ${schema.proposalEvents.eventData}->>'recipientEmail'),
        'revision_id', coalesce(${schema.proposalEvents.eventData}->>'revision_id', ${schema.proposalEvents.eventData}->>'revisionId'),
        'evaluation_run_id', coalesce(${schema.proposalEvents.eventData}->>'evaluation_run_id', ${schema.proposalEvents.eventData}->>'evaluationRunId'),
        'comparison_id', coalesce(${schema.proposalEvents.eventData}->>'comparison_id', ${schema.proposalEvents.eventData}->>'comparisonId', ${schema.proposalEvents.eventData}->>'document_comparison_id', ${schema.proposalEvents.eventData}->>'documentComparisonId')
      )`,
      versionSnapshot: sql`jsonb_build_object(
        'proposal', jsonb_build_object(
          'partyBEmail', ${schema.proposalVersions.snapshotData}->'proposal'->>'partyBEmail',
          'party_b_email', ${schema.proposalVersions.snapshotData}->'proposal'->>'party_b_email',
          'documentComparisonId', ${schema.proposalVersions.snapshotData}->'proposal'->>'documentComparisonId',
          'document_comparison_id', ${schema.proposalVersions.snapshotData}->'proposal'->>'document_comparison_id'
        ),
        'sharedLinks', coalesce(${schema.proposalVersions.snapshotData}->'sharedLinks', '[]'::jsonb),
        'recipientRevisions', coalesce(${schema.proposalVersions.snapshotData}->'recipientRevisions', '[]'::jsonb),
        'evaluations', coalesce(${schema.proposalVersions.snapshotData}->'evaluations', '[]'::jsonb),
        'documentComparison', jsonb_build_object(
          'id', ${schema.proposalVersions.snapshotData}->'documentComparison'->>'id'
        )
      )`,
    })
    .from(schema.proposalEvents)
    .leftJoin(
      schema.proposalVersions,
      eq(schema.proposalVersions.id, schema.proposalEvents.proposalVersionId),
    )
    .where(eq(schema.proposalEvents.proposalId, sampleProposal.id))
    .orderBy(desc(schema.proposalEvents.createdAt))
    .limit(5);

  assert.ok(Array.isArray(rows), 'should return array');
  for (const row of rows) {
    assert.ok(typeof row.id === 'string', 'id should be string');
    assert.ok(typeof row.eventType === 'string', 'eventType should be string');
    // eventData should only contain scope fields
    if (row.eventData && typeof row.eventData === 'object') {
      const allowedKeys = new Set([
        'shared_link_id', 'shared_link_token', 'recipient_email',
        'revision_id', 'evaluation_run_id', 'comparison_id',
      ]);
      for (const key of Object.keys(row.eventData)) {
        assert.ok(allowedKeys.has(key), `eventData contains unexpected key "${key}"`);
      }
    }
    // versionSnapshot should be an object (or null for events without versions)
    if (row.versionSnapshot !== null) {
      assert.ok(typeof row.versionSnapshot === 'object', 'versionSnapshot should be object');
      const snapshot = row.versionSnapshot;
      if (snapshot.proposal) {
        assert.strictEqual(snapshot.proposal.payload, undefined, 'proposal.payload must not be extracted');
        assert.strictEqual(snapshot.proposal.summary, undefined, 'proposal.summary must not be extracted');
      }
    }
  }
});

// ── Test 4: Shared reports ownership check uses narrow projection ────────
test('shared-reports comparison lookup returns only id and proposalId', async () => {
  const [sample] = await db
    .select({
      id: schema.documentComparisons.id,
      proposalId: schema.documentComparisons.proposalId,
    })
    .from(schema.documentComparisons)
    .limit(1);

  if (!sample) {
    console.log('  (no comparisons in DB, skipping ownership check test)');
    return;
  }

  assert.ok(typeof sample.id === 'string', 'id should be string');
  assert.strictEqual(sample.docAText, undefined, 'docAText must not be present');
  assert.strictEqual(sample.docBText, undefined, 'docBText must not be present');
  assert.strictEqual(sample.evaluationResult, undefined, 'evaluationResult must not be present');
});

// ── Test 5: Proposal detail versions narrow snapshotData ─────────────────
test('proposal detail versions query narrows snapshotData to proposal+documentComparison', async () => {
  const [sampleProposal] = await db
    .select({ id: schema.proposals.id })
    .from(schema.proposals)
    .limit(1);

  if (!sampleProposal) {
    console.log('  (no proposals in DB, skipping versions narrowing test)');
    return;
  }

  const rows = await db
    .select({
      id: schema.proposalVersions.id,
      proposalId: schema.proposalVersions.proposalId,
      actorRole: schema.proposalVersions.actorRole,
      milestone: schema.proposalVersions.milestone,
      status: schema.proposalVersions.status,
      snapshotMeta: schema.proposalVersions.snapshotMeta,
      createdAt: schema.proposalVersions.createdAt,
      snapshotData: sql`jsonb_build_object(
        'proposal', ${schema.proposalVersions.snapshotData}->'proposal',
        'documentComparison', ${schema.proposalVersions.snapshotData}->'documentComparison'
      )`,
    })
    .from(schema.proposalVersions)
    .where(eq(schema.proposalVersions.proposalId, sampleProposal.id))
    .orderBy(desc(schema.proposalVersions.createdAt))
    .limit(5);

  assert.ok(Array.isArray(rows), 'should return array');
  for (const row of rows) {
    assert.ok(typeof row.id === 'string', 'id should be string');
    assert.ok(row.snapshotData && typeof row.snapshotData === 'object', 'snapshotData should be object');
    // Should only contain proposal and documentComparison keys
    const keys = Object.keys(row.snapshotData);
    assert.ok(keys.includes('proposal'), 'snapshotData should have proposal key');
    assert.ok(keys.includes('documentComparison'), 'snapshotData should have documentComparison key');
    // Must NOT contain heavy arrays like responses, evaluations, sharedLinks
    assert.strictEqual(row.snapshotData.responses, undefined, 'responses must not be present');
    assert.strictEqual(row.snapshotData.evaluations, undefined, 'evaluations must not be present');
    assert.strictEqual(row.snapshotData.sharedLinks, undefined, 'sharedLinks must not be present');
    assert.strictEqual(row.snapshotData.recipientRevisions, undefined, 'recipientRevisions must not be present');
  }
});

// ── Test 6: Proposals list excludes payload column ───────────────────────
test('proposals list query excludes payload column', async () => {
  const { getTableColumns } = await import('drizzle-orm');
  const { payload: _payload, ...proposalListColumns } = getTableColumns(schema.proposals);

  const rows = await db
    .select(proposalListColumns)
    .from(schema.proposals)
    .orderBy(desc(schema.proposals.updatedAt))
    .limit(3);

  assert.ok(Array.isArray(rows), 'should return array');
  for (const row of rows) {
    assert.ok(typeof row.id === 'string', 'id should be string');
    assert.strictEqual(row.payload, undefined, 'payload must not be present');
    // Other fields should still be present
    assert.ok(row.title !== undefined, 'title should be present');
    assert.ok(row.status !== undefined, 'status should be present');
    assert.ok(row.userId !== undefined, 'userId should be present');
  }
});
