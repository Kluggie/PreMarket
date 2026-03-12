import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import sharedReportVerifyStartHandler from '../../server/routes/shared-report/[token]/verify/start.ts';
import sharedReportVerifyConfirmHandler from '../../server/routes/shared-report/[token]/verify/confirm.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function makeOwnerCookie(seed) {
  return makeSessionCookie({
    sub: `${seed}_owner`,
    email: `${seed}_owner@example.com`,
  });
}

function makeAliasCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function startRecipientVerification(token, cookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/verify/start`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body: {},
  });
  const res = createMockRes();
  await sharedReportVerifyStartHandler(req, res, token);
  return res;
}

async function confirmRecipientVerification(token, code, cookie) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/verify/confirm`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body: { code },
  });
  const res = createMockRes();
  await sharedReportVerifyConfirmHandler(req, res, token);
  return res;
}

async function createComparison(cookie, input) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: input.title,
      createProposal: true,
      docAText: input.docAText,
      docBText: input.docBText,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison;
}

async function createSharedReportLink(cookie, comparisonId, recipientEmail, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
      ...overrides,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().sharedReport;
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
  return res;
}

async function getProposalDetail(cookie, proposalId) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/proposals/${proposalId}`,
    headers: { cookie },
    query: { id: proposalId },
  });
  const res = createMockRes();
  await proposalDetailHandler(req, res, proposalId);
  return res;
}

async function getSummary(cookie) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { cookie },
  });
  const res = createMockRes();
  await dashboardSummaryHandler(req, res);
  return res;
}

async function getActivity(cookie) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/dashboard/activity',
    headers: { cookie },
    query: { range: '30' },
  });
  const res = createMockRes();
  await dashboardActivityHandler(req, res);
  return res;
}

if (!hasDatabaseUrl()) {
  test('authorized recipient visibility regression (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('authorized shared-report recipient sees the canonical proposal in received list, summary, and activity', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('authorized_received');
    const aliasUserId = 'authorized_received_alias';
    const aliasEmail = 'authorized.received.alias@example.com';
    const invitedEmail = 'authorized.received.invited@example.com';
    const aliasCookie = makeAliasCookie(aliasUserId, aliasEmail);

    const comparison = await createComparison(ownerCookie, {
      title: 'Authorized Recipient Visibility',
      docAText: 'Owner confidential baseline for alias visibility regression.',
      docBText: 'Shared baseline text that should be visible in the received inbox.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, invitedEmail, {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 20,
    });

    const previousEmailMode = process.env.EMAIL_MODE;
    const previousResendApiKey = process.env.RESEND_API_KEY;
    const previousResendFromEmail = process.env.RESEND_FROM_EMAIL;
    const previousFetch = globalThis.fetch;
    const sentPayloads = [];
    process.env.EMAIL_MODE = 'transactional';
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('api.resend.com/emails')) {
        const payload = JSON.parse(String(init.body || '{}'));
        sentPayloads.push(payload);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'authorized_visibility_verify_email' }),
        };
      }
      return previousFetch(url, init);
    };

    try {
      const startRes = await startRecipientVerification(link.token, aliasCookie);
      assert.equal(startRes.statusCode, 200);
      assert.equal(startRes.jsonBody().started, true);
      assert.equal(sentPayloads.length, 1);
      const otpMatch = String(sentPayloads[0]?.text || '').match(/\b(\d{6})\b/);
      assert.equal(Boolean(otpMatch), true, 'verification email should contain a 6-digit code');
      const code = String(otpMatch?.[1] || '');

      const confirmRes = await confirmRecipientVerification(link.token, code, aliasCookie);
      assert.equal(confirmRes.statusCode, 200);
      assert.equal(confirmRes.jsonBody().verified, true);
      assert.equal(String(confirmRes.jsonBody().invited_email || ''), invitedEmail);
      assert.equal(String(confirmRes.jsonBody().authorized_email || ''), aliasEmail);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousEmailMode === undefined) {
        delete process.env.EMAIL_MODE;
      } else {
        process.env.EMAIL_MODE = previousEmailMode;
      }
      if (previousResendApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousResendApiKey;
      }
      if (previousResendFromEmail === undefined) {
        delete process.env.RESEND_FROM_EMAIL;
      } else {
        process.env.RESEND_FROM_EMAIL = previousResendFromEmail;
      }
    }

    const db = getDb();
    const proposalId = String(link.proposal_id || '');
    assert.ok(proposalId, 'shared report link should reference the canonical proposal row');
    await db.execute(
      sql`update proposals
          set status = 'sent',
              sent_at = now(),
              party_b_email = ${invitedEmail},
              updated_at = now()
          where id = ${proposalId}`,
    );

    const detailRes = await getProposalDetail(aliasCookie, proposalId);
    assert.equal(detailRes.statusCode, 200, 'authorized alias should resolve the canonical proposal detail');
    assert.equal(String(detailRes.jsonBody().proposal?.id || ''), proposalId);

    const listRes = await listProposals(aliasCookie, { tab: 'received', limit: 20 });
    assert.equal(listRes.statusCode, 200);
    const receivedRows = listRes.jsonBody().proposals || [];
    const matchingRow = receivedRows.find((row) => String(row.id || '') === proposalId);
    assert.equal(
      Boolean(matchingRow),
      true,
      'received inbox should include the canonical proposal row for an authorized recipient alias',
    );
    assert.equal(String(matchingRow?.list_type || ''), 'received');
    assert.equal(String(matchingRow?.shared_report_token || ''), String(link.token));

    const summaryRes = await getSummary(aliasCookie);
    assert.equal(summaryRes.statusCode, 200);
    assert.equal(
      Number(summaryRes.jsonBody().summary?.receivedCount || 0),
      1,
      'dashboard summary should count the authorized recipient proposal as received',
    );

    const activityRes = await getActivity(aliasCookie);
    assert.equal(activityRes.statusCode, 200);
    const points = Array.isArray(activityRes.jsonBody().points) ? activityRes.jsonBody().points : [];
    assert.equal(
      points.some((entry) => Number(entry?.received || 0) >= 1),
      true,
      'dashboard activity should record the authorized recipient proposal in the received series',
    );
  });
}
