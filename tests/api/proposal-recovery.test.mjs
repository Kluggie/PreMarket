import assert from 'node:assert/strict';
import test from 'node:test';
import { desc, eq } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import adminProposalRecoveryHandler from '../../server/routes/admin/proposals/recovery.ts';
import { schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function callHandler(handler, reqOptions, ...args) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res, ...args);
  return res;
}

async function seedUser(id, email, role = 'user') {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.users)
    .values({
      id,
      email,
      role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email,
        role,
        updatedAt: now,
      },
    });
}

async function createProposal(cookie, body) {
  const res = await callHandler(proposalsHandler, {
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
  });
  assert.equal(res.statusCode, 201);
  return res.jsonBody().proposal;
}

async function deleteProposal(cookie, proposalId) {
  return callHandler(
    proposalDetailHandler,
    {
      method: 'DELETE',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
}

async function archiveProposal(cookie, proposalId) {
  return callHandler(
    proposalArchiveHandler,
    {
      method: 'PATCH',
      url: `/api/proposals/${proposalId}/archive`,
      headers: { cookie },
      query: { id: proposalId },
    },
    proposalId,
  );
}

async function listProposals(cookie, query = {}) {
  const res = await callHandler(proposalsHandler, {
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().proposals || [];
}

async function lookupRecovery(cookie, query) {
  const res = await callHandler(adminProposalRecoveryHandler, {
    method: 'GET',
    url: '/api/admin/proposals/recovery',
    headers: { cookie },
    query,
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody().results || [];
}

async function recoveryAction(cookie, body) {
  const res = await callHandler(adminProposalRecoveryHandler, {
    method: 'POST',
    url: '/api/admin/proposals/recovery',
    headers: { cookie },
    body,
  });
  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

if (!hasDatabaseUrl()) {
  test('proposal recovery integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('admin recovery lookup classifies archived and soft-deleted proposals, then restores visibility', { concurrency: false }, async () => {
    await ensureMigrated();
    await resetTables();

    const adminId = 'proposal_recovery_admin';
    const adminEmail = 'proposal-recovery-admin@example.com';
    const ownerId = 'proposal_recovery_owner';
    const ownerEmail = 'proposal-recovery-owner@example.com';
    const recipientId = 'proposal_recovery_recipient';
    const recipientEmail = 'proposal-recovery-recipient@example.com';

    await seedUser(adminId, adminEmail, 'admin');
    await seedUser(ownerId, ownerEmail, 'user');
    await seedUser(recipientId, recipientEmail, 'user');

    const adminCookie = authCookie(adminId, adminEmail);
    const ownerCookie = authCookie(ownerId, ownerEmail);
    const recipientCookie = authCookie(recipientId, recipientEmail);

    const softDeleteProposal = await createProposal(ownerCookie, {
      title: 'Soft Delete Recoverable',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: recipientEmail,
    });

    const receivedBeforeDelete = await listProposals(recipientCookie, { tab: 'received' });
    assert.equal(receivedBeforeDelete.some((row) => row.id === softDeleteProposal.id), true);

    const softDeleteRes = await deleteProposal(recipientCookie, softDeleteProposal.id);
    assert.equal(softDeleteRes.statusCode, 200);
    assert.equal(softDeleteRes.jsonBody().mode, 'soft');

    const receivedAfterDelete = await listProposals(recipientCookie, { tab: 'received' });
    assert.equal(receivedAfterDelete.some((row) => row.id === softDeleteProposal.id), false);

    const softDeleteLookup = await lookupRecovery(adminCookie, { proposal_id: softDeleteProposal.id });
    assert.equal(softDeleteLookup.length, 1);
    assert.equal(softDeleteLookup[0].classification, 'EXISTS_BUT_SOFT_DELETED');
    assert.equal(softDeleteLookup[0].visibility.recipient.softDeleted, true);

    const restoreSoftDeleted = await recoveryAction(adminCookie, {
      action: 'restore_visibility',
      proposal_id: softDeleteProposal.id,
      restoreDeletedByPartyB: true,
    });
    assert.equal(restoreSoftDeleted.restored, true);

    const receivedAfterRestore = await listProposals(recipientCookie, { tab: 'received' });
    assert.equal(receivedAfterRestore.some((row) => row.id === softDeleteProposal.id), true);

    const archivedProposal = await createProposal(ownerCookie, {
      title: 'Archive Recoverable',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: recipientEmail,
    });

    const archiveRes = await archiveProposal(ownerCookie, archivedProposal.id);
    assert.equal(archiveRes.statusCode, 200);

    const ownerActiveAfterArchive = await listProposals(ownerCookie, { tab: 'all' });
    assert.equal(ownerActiveAfterArchive.some((row) => row.id === archivedProposal.id), false);

    const archivedLookup = await lookupRecovery(adminCookie, { proposal_id: archivedProposal.id });
    assert.equal(archivedLookup.length, 1);
    assert.equal(archivedLookup[0].classification, 'EXISTS_BUT_ARCHIVED');
    assert.equal(archivedLookup[0].visibility.owner.archived, true);

    const restoreArchived = await recoveryAction(adminCookie, {
      action: 'restore_visibility',
      proposal_id: archivedProposal.id,
      restoreArchivedByPartyA: true,
    });
    assert.equal(restoreArchived.restored, true);

    const ownerActiveAfterRestore = await listProposals(ownerCookie, { tab: 'all' });
    assert.equal(ownerActiveAfterRestore.some((row) => row.id === archivedProposal.id), true);

    const emailLookup = await lookupRecovery(adminCookie, { email: recipientEmail });
    const recoveredIds = emailLookup.map((row) => row.proposal_id);
    assert.equal(recoveredIds.includes(softDeleteProposal.id), true);
    assert.equal(recoveredIds.includes(archivedProposal.id), true);
  });

  test('proposal versions and events preserve create/send/delete/reconstruct history and reconstruction is marked clearly', { concurrency: false }, async () => {
    await ensureMigrated();
    await resetTables();

    const adminId = 'proposal_recovery_admin_history';
    const adminEmail = 'proposal-recovery-admin-history@example.com';
    const ownerId = 'proposal_recovery_owner_history';
    const ownerEmail = 'proposal-recovery-owner-history@example.com';
    const recipientEmail = 'proposal-recovery-send@example.com';

    await seedUser(adminId, adminEmail, 'admin');
    await seedUser(ownerId, ownerEmail, 'user');

    const adminCookie = authCookie(adminId, adminEmail);
    const ownerCookie = authCookie(ownerId, ownerEmail);
    const db = getDb();

    const sendableDraft = await createProposal(ownerCookie, {
      title: 'Send Milestone History',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: recipientEmail,
    });

    const sentVersions = await db
      .select()
      .from(schema.proposalVersions)
      .where(eq(schema.proposalVersions.proposalId, sendableDraft.id))
      .orderBy(desc(schema.proposalVersions.createdAt));
    const sentEvents = await db
      .select()
      .from(schema.proposalEvents)
      .where(eq(schema.proposalEvents.proposalId, sendableDraft.id))
      .orderBy(desc(schema.proposalEvents.createdAt));

    assert.equal(sentVersions.some((row) => row.milestone === 'create'), true);
    assert.equal(sentVersions.some((row) => row.milestone === 'send'), true);
    assert.equal(sentEvents.some((row) => row.eventType === 'proposal.created'), true);
    assert.equal(sentEvents.some((row) => row.eventType === 'proposal.sent'), true);

    const recoverableDraft = await createProposal(ownerCookie, {
      title: 'Hard Delete Reconstructable',
      status: 'draft',
      payload: {
        sections: [{ title: 'Scope', value: 'Recoverable draft content' }],
      },
    });

    const hardDeleteRes = await deleteProposal(ownerCookie, recoverableDraft.id);
    assert.equal(hardDeleteRes.statusCode, 200);
    assert.equal(hardDeleteRes.jsonBody().mode, 'hard');

    const lookupAfterDelete = await lookupRecovery(adminCookie, { proposal_id: recoverableDraft.id });
    assert.equal(lookupAfterDelete.length, 1);
    assert.equal(lookupAfterDelete[0].classification, 'EXISTS_IN_LINKED_RECORDS_ONLY');
    assert.equal(lookupAfterDelete[0].reconstruction.available, true);

    const reconstructRes = await recoveryAction(adminCookie, {
      action: 'reconstruct_from_latest_version',
      proposal_id: recoverableDraft.id,
    });
    assert.equal(reconstructRes.restored, true);
    assert.equal(reconstructRes.action, 'reconstruct_from_latest_version');

    const [restoredProposal] = await db
      .select()
      .from(schema.proposals)
      .where(eq(schema.proposals.id, recoverableDraft.id))
      .limit(1);
    assert.ok(restoredProposal, 'reconstructed proposal must exist');
    assert.ok(restoredProposal.reconstructedAt, 'reconstructed proposal must be marked');
    assert.equal(restoredProposal.recoverySource, 'proposal_version');
    assert.equal(restoredProposal.reconstructedFromVersionId !== null, true);
    assert.equal(restoredProposal.payload?.recovery?.reconstructed, true);

    const restoredLookup = await lookupRecovery(adminCookie, { user_id: ownerId });
    const restoredRecord = restoredLookup.find((row) => row.proposal_id === recoverableDraft.id);
    assert.ok(restoredRecord, 'admin lookup by user_id should find reconstructed proposal');
    assert.equal(restoredRecord.classification, 'EXISTS_AND_VISIBLE');

    const reconstructedVersions = await db
      .select()
      .from(schema.proposalVersions)
      .where(eq(schema.proposalVersions.proposalId, recoverableDraft.id))
      .orderBy(desc(schema.proposalVersions.createdAt));
    const reconstructedEvents = await db
      .select()
      .from(schema.proposalEvents)
      .where(eq(schema.proposalEvents.proposalId, recoverableDraft.id))
      .orderBy(desc(schema.proposalEvents.createdAt));

    assert.equal(reconstructedVersions.some((row) => row.milestone === 'delete_hard'), true);
    assert.equal(reconstructedVersions.some((row) => row.milestone === 'reconstruct'), true);
    assert.equal(reconstructedEvents.some((row) => row.eventType === 'proposal.deleted.hard'), true);
    assert.equal(reconstructedEvents.some((row) => row.eventType === 'proposal.reconstructed'), true);
  });
}
