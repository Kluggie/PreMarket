import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import dashboardSummaryHandler from '../../server/routes/dashboard/summary.ts';
import dashboardActivityHandler from '../../server/routes/dashboard/activity.ts';
import contactRequestsHandler from '../../server/routes/contact-requests/index.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import templatesHandler from '../../server/routes/templates/index.ts';
import templateUseHandler from '../../server/routes/templates/[id]/use.ts';
import templateViewHandler from '../../server/routes/templates/[id]/view.ts';
import proposalResponsesHandler from '../../server/routes/proposals/[id]/responses.ts';
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
    assert.equal(listPayload.templates.length >= 3, true);

    const names = new Set(listPayload.templates.map((template) => template.name));
    assert.equal(names.has('Universal Enterprise Onboarding'), true);
    assert.equal(names.has('Universal Finance Deal Pre-Qual'), true);
    assert.equal(names.has('Universal Profile Matching'), true);
    assert.equal(names.has('M&A Pre-Qualification'), false);
    assert.equal(names.has('Talent Acquisition Pre-Qualification'), false);

    const enterpriseTemplate = listPayload.templates.find(
      (template) => template.slug === 'universal_enterprise_onboarding',
    );
    assert.equal(Boolean(enterpriseTemplate), true);

    const viewReq = createMockReq({
      method: 'POST',
      url: `/api/templates/${enterpriseTemplate.id}/view`,
      headers: { cookie: ownerCookie },
      query: { id: enterpriseTemplate.id },
      body: {},
    });
    const viewRes = createMockRes();
    await templateViewHandler(viewReq, viewRes, enterpriseTemplate.id);
    assert.equal(viewRes.statusCode, 200);
    assert.equal(viewRes.jsonBody().template.view_count >= 1, true);

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

    const saveResponsesReq = createMockReq({
      method: 'PUT',
      url: `/api/proposals/${proposalId}/responses`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
      body: {
        responses: [
          {
            question_id: 'mode',
            value: 'Investor Fit',
            value_type: 'text',
            entered_by_party: 'a',
            visibility: 'full',
          },
          {
            question_id: 'target_sector_counterparty',
            value: 'Fintech',
            value_type: 'text',
            entered_by_party: 'b',
            visibility: 'full',
          },
        ],
      },
    });
    const saveResponsesRes = createMockRes();
    await proposalResponsesHandler(saveResponsesReq, saveResponsesRes, proposalId);
    assert.equal(saveResponsesRes.statusCode, 200);
    assert.equal(saveResponsesRes.jsonBody().responses.length, 2);

    const getResponsesReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${proposalId}/responses`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
    });
    const getResponsesRes = createMockRes();
    await proposalResponsesHandler(getResponsesReq, getResponsesRes, proposalId);
    assert.equal(getResponsesRes.statusCode, 200);
    const getResponsesPayload = getResponsesRes.jsonBody();
    assert.equal(getResponsesPayload.responses.some((row) => row.question_id === 'mode'), true);
    assert.equal(
      getResponsesPayload.responses.some(
        (row) => row.question_id === 'target_sector_counterparty' && row.entered_by_party === 'b',
      ),
      true,
    );
  });

  test('custom template request persists even when email integration is unavailable', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = getCookie('p0_contact_owner', 'owner@example.com');

    const req = createMockReq({
      method: 'POST',
      url: '/api/contact-requests',
      headers: { cookie: ownerCookie },
      body: {
        name: 'Owner Person',
        email: 'owner@example.com',
        message: 'Please build a custom template for procurement onboarding.',
      },
    });
    const res = createMockRes();
    await contactRequestsHandler(req, res);

    assert.equal(res.statusCode, 201);
    const payload = res.jsonBody();
    assert.equal(payload.ok, true);
    assert.equal(Boolean(payload.request?.id), true);
    assert.equal(['db', 'email'].includes(payload.delivery), true);

    const db = getDb();
    const rows = await db.execute(
      sql`select count(*)::int as count from contact_requests where user_id = 'p0_contact_owner'`,
    );
    assert.equal(Number(rows.rows?.[0]?.count || 0), 1);
  });
}
