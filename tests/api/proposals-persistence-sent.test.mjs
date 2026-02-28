import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function createProposal(cookie, body) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body,
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().proposal;
}

async function listProposals(cookie, query = {}) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/proposals',
    headers: { cookie },
    query,
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  assert.equal(res.statusCode, 200);
  return res.jsonBody().proposals || [];
}

if (!hasDatabaseUrl()) {
  test('proposals persistence + sent semantics (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('proposals persist across a simulated fresh server instance and remain owner-scoped', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('persist_owner', 'owner@example.com');
    const otherCookie = authCookie('persist_other', 'other@example.com');

    const ownerProposal = await createProposal(ownerCookie, {
      title: 'Owner Persisted Proposal',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });

    await createProposal(otherCookie, {
      title: 'Other User Proposal',
      status: 'draft',
      partyBEmail: 'third@example.com',
    });

    const firstList = await listProposals(ownerCookie, { limit: '20' });
    assert.equal(firstList.some((row) => row.id === ownerProposal.id), true);
    assert.equal(firstList.some((row) => row.title === 'Other User Proposal'), false);

    // Simulate a cold start by clearing the memoized db client from global scope.
    delete globalThis.__pm_drizzle_db;

    const secondList = await listProposals(ownerCookie, { limit: '20' });
    assert.equal(secondList.some((row) => row.id === ownerProposal.id), true);
    assert.equal(secondList.some((row) => row.title === 'Other User Proposal'), false);
  });

  test('proposals remain visible when row ownership user_id differs but party_a_email matches current owner', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('legacy_owner_sub', 'owner@example.com');
    const outsiderCookie = authCookie('outsider_sub', 'outsider@example.com');

    const legacyDraft = await createProposal(ownerCookie, {
      title: 'Legacy Draft',
      status: 'draft',
      partyBEmail: null,
    });
    const legacySent = await createProposal(ownerCookie, {
      title: 'Legacy Sent',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient@example.com',
    });

    await createProposal(outsiderCookie, {
      title: 'Outsider Proposal',
      status: 'draft',
      partyBEmail: 'someone@example.com',
    });

    const db = getDb();
    await db.execute(
      sql`update proposals set user_id = 'outsider_sub' where id in (${legacyDraft.id}, ${legacySent.id})`,
    );

    const allRows = await listProposals(ownerCookie, { tab: 'all', limit: '20' });
    assert.equal(allRows.some((row) => row.id === legacyDraft.id), true);
    assert.equal(allRows.some((row) => row.id === legacySent.id), true);
    assert.equal(allRows.some((row) => row.title === 'Outsider Proposal'), false);

    const draftRows = await listProposals(ownerCookie, { tab: 'drafts' });
    assert.equal(draftRows.some((row) => row.id === legacyDraft.id), true);

    const sentRows = await listProposals(ownerCookie, { tab: 'sent' });
    assert.equal(sentRows.some((row) => row.id === legacySent.id), true);
  });

  test('sent, drafts, and received tabs use sent_at as source of truth', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('tab_owner', 'owner@example.com');
    const otherCookie = authCookie('tab_other', 'other@example.com');

    await createProposal(ownerCookie, {
      title: 'Ready Draft',
      status: 'ready',
      sentAt: null,
      partyBEmail: 'recipient@example.com',
    });

    await createProposal(ownerCookie, {
      title: 'Status Sent But Unemailed',
      status: 'sent',
      sentAt: null,
      partyBEmail: 'recipient@example.com',
    });

    const emailed = await createProposal(ownerCookie, {
      title: 'Actually Emailed',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'recipient@example.com',
    });

    await createProposal(otherCookie, {
      title: 'Inbound Emailed',
      status: 'sent',
      sentAt: new Date().toISOString(),
      partyBEmail: 'owner@example.com',
    });

    const sentRows = await listProposals(ownerCookie, { tab: 'sent' });
    assert.equal(sentRows.some((row) => row.id === emailed.id), true);
    assert.equal(sentRows.some((row) => row.title === 'Status Sent But Unemailed'), false);

    const draftRows = await listProposals(ownerCookie, { tab: 'drafts' });
    assert.equal(draftRows.some((row) => row.title === 'Ready Draft'), true);
    assert.equal(draftRows.some((row) => row.title === 'Status Sent But Unemailed'), false);

    const receivedRows = await listProposals(ownerCookie, { tab: 'received' });
    assert.equal(receivedRows.some((row) => row.title === 'Inbound Emailed'), true);
  });

  test('send action sets sent_at only after successful email delivery', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('send_owner', 'owner@example.com');

    const missingRecipient = await createProposal(ownerCookie, {
      title: 'Missing Recipient',
      status: 'draft',
      partyBEmail: null,
    });

    const missingRecipientReq = createMockReq({
      method: 'POST',
      url: `/api/proposals/${missingRecipient.id}/send`,
      headers: { cookie: ownerCookie },
      query: { id: missingRecipient.id },
      body: {},
    });
    const missingRecipientRes = createMockRes();
    await proposalSendHandler(missingRecipientReq, missingRecipientRes, missingRecipient.id);
    assert.equal(missingRecipientRes.statusCode, 400);

    const originalFetch = globalThis.fetch;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalResendFrom = process.env.RESEND_FROM_EMAIL;
    const originalResendName = process.env.RESEND_FROM_NAME;
    const originalResendReplyTo = process.env.RESEND_REPLY_TO;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    try {
      const successProposal = await createProposal(ownerCookie, {
        title: 'Send Success',
        status: 'draft',
        partyBEmail: 'recipient@example.com',
      });

      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_success_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const successReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${successProposal.id}/send`,
        headers: { cookie: ownerCookie },
        query: { id: successProposal.id },
        body: {
          recipientEmail: 'recipient@example.com',
          createShareLink: false,
        },
      });
      const successRes = createMockRes();
      await proposalSendHandler(successReq, successRes, successProposal.id);
      assert.equal(successRes.statusCode, 200);
      assert.equal(successRes.jsonBody().proposal.status, 'sent');
      assert.equal(Boolean(successRes.jsonBody().proposal.sent_at), true);

      const failureProposal = await createProposal(ownerCookie, {
        title: 'Send Failure',
        status: 'draft',
        partyBEmail: 'recipient@example.com',
      });

      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ message: 'provider error' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const failureReq = createMockReq({
        method: 'POST',
        url: `/api/proposals/${failureProposal.id}/send`,
        headers: { cookie: ownerCookie },
        query: { id: failureProposal.id },
        body: {
          recipientEmail: 'recipient@example.com',
          createShareLink: false,
        },
      });
      const failureRes = createMockRes();
      await proposalSendHandler(failureReq, failureRes, failureProposal.id);
      assert.equal(failureRes.statusCode, 502);
      assert.equal(failureRes.jsonBody().error.code, 'email_send_failed');

      const detailReq = createMockReq({
        method: 'GET',
        url: `/api/proposals/${failureProposal.id}`,
        headers: { cookie: ownerCookie },
        query: { id: failureProposal.id },
      });
      const detailRes = createMockRes();
      await proposalDetailHandler(detailReq, detailRes, failureProposal.id);
      assert.equal(detailRes.statusCode, 200);
      assert.equal(detailRes.jsonBody().proposal.status, 'draft');
      assert.equal(detailRes.jsonBody().proposal.sent_at, null);
    } finally {
      if (originalResendKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalResendKey;
      }

      if (originalResendFrom === undefined) {
        delete process.env.RESEND_FROM_EMAIL;
      } else {
        process.env.RESEND_FROM_EMAIL = originalResendFrom;
      }

      if (originalResendName === undefined) {
        delete process.env.RESEND_FROM_NAME;
      } else {
        process.env.RESEND_FROM_NAME = originalResendName;
      }

      if (originalResendReplyTo === undefined) {
        delete process.env.RESEND_REPLY_TO;
      } else {
        process.env.RESEND_REPLY_TO = originalResendReplyTo;
      }

      globalThis.fetch = originalFetch;
    }
  });
}
