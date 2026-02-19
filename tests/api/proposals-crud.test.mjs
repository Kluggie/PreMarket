import assert from 'node:assert/strict';
import test from 'node:test';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

if (!hasDatabaseUrl()) {
  test('proposals CRUD integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('proposals API supports create/list/view/update/delete with ownership checks', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeSessionCookie({
      sub: 'user_owner',
      email: 'owner@example.com',
    });

    const createReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Owner Proposal',
        templateName: 'M&A',
        partyBEmail: 'recipient@example.com',
      },
    });
    const createRes = createMockRes();
    await proposalsHandler(createReq, createRes);

    assert.equal(createRes.statusCode, 201);
    const createdPayload = createRes.jsonBody();
    assert.equal(createdPayload.ok, true);
    assert.equal(createdPayload.proposal.title, 'Owner Proposal');

    const proposalId = createdPayload.proposal.id;

    const listReq = createMockReq({
      method: 'GET',
      url: '/api/proposals',
      headers: { cookie: ownerCookie },
      query: { limit: '10' },
    });
    const listRes = createMockRes();
    await proposalsHandler(listReq, listRes);

    assert.equal(listRes.statusCode, 200);
    const listPayload = listRes.jsonBody();
    assert.equal(listPayload.ok, true);
    assert.equal(Array.isArray(listPayload.proposals), true);
    assert.equal(listPayload.proposals.some((proposal) => proposal.id === proposalId), true);

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
    });
    const getRes = createMockRes();
    await proposalDetailHandler(getReq, getRes, proposalId);

    assert.equal(getRes.statusCode, 200);
    const getPayload = getRes.jsonBody();
    assert.equal(getPayload.proposal.id, proposalId);

    const updateReq = createMockReq({
      method: 'PATCH',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
      body: { title: 'Owner Proposal Updated', status: 'sent' },
    });
    const updateRes = createMockRes();
    await proposalDetailHandler(updateReq, updateRes, proposalId);

    assert.equal(updateRes.statusCode, 200);
    const updatePayload = updateRes.jsonBody();
    assert.equal(updatePayload.proposal.title, 'Owner Proposal Updated');
    assert.equal(updatePayload.proposal.status, 'sent');

    const nonOwnerCookie = makeSessionCookie({
      sub: 'user_other',
      email: 'other@example.com',
    });

    const nonOwnerReq = createMockReq({
      method: 'GET',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: nonOwnerCookie },
      query: { id: proposalId },
    });
    const nonOwnerRes = createMockRes();
    await proposalDetailHandler(nonOwnerReq, nonOwnerRes, proposalId);

    assert.equal(nonOwnerRes.statusCode, 404);

    const deleteReq = createMockReq({
      method: 'DELETE',
      url: `/api/proposals/${proposalId}`,
      headers: { cookie: ownerCookie },
      query: { id: proposalId },
    });
    const deleteRes = createMockRes();
    await proposalDetailHandler(deleteReq, deleteRes, proposalId);

    assert.equal(deleteRes.statusCode, 200);
    assert.equal(deleteRes.jsonBody().deleted, true);
  });
}
