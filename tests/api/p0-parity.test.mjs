import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import templatesHandler from '../../server/routes/templates/index.ts';
import templateUseHandler from '../../server/routes/templates/[id]/use.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function getCookie(subject, email) {
  return makeSessionCookie({ sub: subject, email });
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

if (!hasDatabaseUrl()) {
  test('p0 parity integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('dashboard summary and activity return scoped metrics and chart series', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = getCookie('p0_dash_owner', 'owner@example.com');
    const otherCookie = getCookie('p0_dash_other', 'other@example.com');

    await createProposal(ownerCookie, {
      title: 'Owner Draft',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Owner Sent',
      status: 'sent',
      partyBEmail: 'recipient@example.com',
    });
    await createProposal(otherCookie, {
      title: 'Inbound For Owner',
      status: 'sent',
      partyBEmail: 'owner@example.com',
    });
    await createProposal(otherCookie, {
      title: 'Unrelated External',
      status: 'sent',
      partyBEmail: 'third@example.com',
    });

    const summaryReq = createMockReq({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie: ownerCookie },
    });
    const summaryRes = createMockRes();
    await dashboardSummaryHandler(summaryReq, summaryRes);

    assert.equal(summaryRes.statusCode, 200);
    const summaryPayload = summaryRes.jsonBody();
    assert.equal(summaryPayload.ok, true);
    assert.equal(summaryPayload.summary.sentCount, 1);
    assert.equal(summaryPayload.summary.receivedCount, 1);
    assert.equal(summaryPayload.summary.draftsCount, 1);
    assert.equal(summaryPayload.summary.totalCount, 3);

    const activityReq = createMockReq({
      method: 'GET',
      url: '/api/dashboard/activity',
      query: { range: '30' },
      headers: { cookie: ownerCookie },
    });
    const activityRes = createMockRes();
    await dashboardActivityHandler(activityReq, activityRes);

    assert.equal(activityRes.statusCode, 200);
    const activityPayload = activityRes.jsonBody();
    assert.equal(activityPayload.ok, true);
    assert.equal(activityPayload.range, '30');
    assert.equal(Array.isArray(activityPayload.points), true);
    assert.equal(activityPayload.points.length > 0, true);

    const aggregate = activityPayload.points.reduce(
      (acc, point) => {
        acc.sent += Number(point?.sent || 0);
        acc.received += Number(point?.received || 0);
        acc.active += Number(point?.active || 0);
        acc.mutual += Number(point?.mutual || 0);
        return acc;
      },
      { sent: 0, received: 0, active: 0, mutual: 0 },
    );

    assert.equal(aggregate.sent >= 1, true);
    assert.equal(aggregate.received >= 1, true);
    assert.equal(aggregate.active >= 2, true);
  });

  test('proposals list supports owner scoping, tab/status filtering, and search', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = getCookie('p0_list_owner', 'owner@example.com');
    const otherCookie = getCookie('p0_list_other', 'other@example.com');

    await createProposal(ownerCookie, {
      title: 'Draft Alpha',
      status: 'draft',
      partyBEmail: 'recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Sent Bravo',
      status: 'sent',
      partyBEmail: 'recipient@example.com',
    });
    await createProposal(ownerCookie, {
      title: 'Mutual Charlie',
      status: 'mutual_interest',
      partyBEmail: 'recipient@example.com',
    });
    await createProposal(otherCookie, {
      title: 'Incoming Delta',
      status: 'sent',
      partyBEmail: 'owner@example.com',
    });
    await createProposal(otherCookie, {
      title: 'Hidden Echo',
      status: 'sent',
      partyBEmail: 'someone-else@example.com',
    });

    const listAllReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { limit: '20' },
      headers: { cookie: ownerCookie },
    });
    const listAllRes = createMockRes();
    await proposalsHandler(listAllReq, listAllRes);
    assert.equal(listAllRes.statusCode, 200);
    const allPayload = listAllRes.jsonBody();
    assert.equal(allPayload.ok, true);
    assert.equal(allPayload.proposals.some((proposal) => proposal.title === 'Hidden Echo'), false);

    const draftsReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { tab: 'drafts' },
      headers: { cookie: ownerCookie },
    });
    const draftsRes = createMockRes();
    await proposalsHandler(draftsReq, draftsRes);
    assert.equal(draftsRes.statusCode, 200);
    const draftsPayload = draftsRes.jsonBody();
    assert.equal(draftsPayload.proposals.length, 1);
    assert.equal(draftsPayload.proposals[0].title, 'Draft Alpha');

    const receivedReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { tab: 'received' },
      headers: { cookie: ownerCookie },
    });
    const receivedRes = createMockRes();
    await proposalsHandler(receivedReq, receivedRes);
    assert.equal(receivedRes.statusCode, 200);
    const receivedPayload = receivedRes.jsonBody();
    assert.equal(receivedPayload.proposals.some((proposal) => proposal.title === 'Incoming Delta'), true);
    assert.equal(receivedPayload.proposals.some((proposal) => proposal.list_type === 'received'), true);

    const statusReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { status: 'mutual_interest' },
      headers: { cookie: ownerCookie },
    });
    const statusRes = createMockRes();
    await proposalsHandler(statusReq, statusRes);
    assert.equal(statusRes.statusCode, 200);
    const statusPayload = statusRes.jsonBody();
    assert.equal(statusPayload.proposals.length, 1);
    assert.equal(statusPayload.proposals[0].title, 'Mutual Charlie');

    const searchReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { query: 'Bravo' },
      headers: { cookie: ownerCookie },
    });
    const searchRes = createMockRes();
    await proposalsHandler(searchReq, searchRes);
    assert.equal(searchRes.statusCode, 200);
    const searchPayload = searchRes.jsonBody();
    assert.equal(searchPayload.proposals.length, 1);
    assert.equal(searchPayload.proposals[0].title, 'Sent Bravo');
  });

  test('templates list and use flow create persisted draft proposal and related records', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = getCookie('p0_tpl_owner', 'owner@example.com');
    const listReq = createMockReq({
      method: 'GET',
      url: '/api/templates',
      headers: { cookie: ownerCookie },
    });
    const listRes = createMockRes();
    await templatesHandler(listReq, listRes);

    assert.equal(listRes.statusCode, 200);
    const listPayload = listRes.jsonBody();
    assert.equal(listPayload.ok, true);
    assert.equal(Array.isArray(listPayload.templates), true);
    assert.equal(listPayload.templates.length > 0, true);

    const [template] = listPayload.templates;
    assert.equal(Boolean(template?.id), true);

    const idempotencyKey = 'p0-template-use-key';

    const useReq = createMockReq({
      method: 'POST',
      url: `/api/templates/${template.id}/use`,
      headers: { cookie: ownerCookie },
      query: { id: template.id },
      body: {
        title: 'Template Draft One',
        partyBEmail: 'recipient@example.com',
        idempotencyKey,
      },
    });
    const useRes = createMockRes();
    await templateUseHandler(useReq, useRes, template.id);

    assert.equal(useRes.statusCode, 201);
    const usePayload = useRes.jsonBody();
    assert.equal(usePayload.ok, true);
    assert.equal(Boolean(usePayload.proposal?.id), true);
    assert.equal(Boolean(usePayload.snapshot?.id), true);
    assert.equal(usePayload.idempotent, false);

    const proposalId = usePayload.proposal.id;

    const useAgainReq = createMockReq({
      method: 'POST',
      url: `/api/templates/${template.id}/use`,
      headers: { cookie: ownerCookie },
      query: { id: template.id },
      body: {
        title: 'Template Draft One',
        partyBEmail: 'recipient@example.com',
        idempotencyKey,
      },
    });
    const useAgainRes = createMockRes();
    await templateUseHandler(useAgainReq, useAgainRes, template.id);

    assert.equal(useAgainRes.statusCode, 200);
    const secondPayload = useAgainRes.jsonBody();
    assert.equal(secondPayload.ok, true);
    assert.equal(secondPayload.idempotent, true);
    assert.equal(secondPayload.proposal.id, proposalId);

    const proposalsReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      query: { query: 'Template Draft One' },
      headers: { cookie: ownerCookie },
    });
    const proposalsRes = createMockRes();
    await proposalsHandler(proposalsReq, proposalsRes);

    assert.equal(proposalsRes.statusCode, 200);
    const proposalsPayload = proposalsRes.jsonBody();
    assert.equal(proposalsPayload.proposals.some((proposal) => proposal.id === proposalId), true);

    const db = getDb();
    const snapshotRows = await db.execute(
      sql`select count(*)::int as count from proposal_snapshots where source_proposal_id = ${proposalId}`,
    );
    const responseRows = await db.execute(
      sql`select count(*)::int as count from proposal_responses where proposal_id = ${proposalId}`,
    );

    assert.equal(Number(snapshotRows.rows?.[0]?.count || 0) >= 1, true);
    assert.equal(Number(responseRows.rows?.[0]?.count || 0) >= 1, true);
  });
}
