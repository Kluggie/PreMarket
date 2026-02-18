import assert from 'node:assert/strict';
import test from 'node:test';
import proposalsHandler from '../../api/proposals/index.ts';
import sharedLinksCreateHandler from '../../api/shared-links/index.ts';
import sharedLinkReadHandler from '../../api/shared-links/[token].ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

if (!hasDatabaseUrl()) {
  test('shared link token fetch integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('shared link can be created by owner and opened by token', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeSessionCookie({
      sub: 'user_share_owner',
      email: 'share-owner@example.com',
    });

    const createProposalReq = createMockReq({
      method: 'POST',
      url: '/api/proposals',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Shared proposal',
        partyBEmail: 'recipient@example.com',
      },
    });
    const createProposalRes = createMockRes();
    await proposalsHandler(createProposalReq, createProposalRes);

    const proposalId = createProposalRes.jsonBody().proposal.id;

    const createShareReq = createMockReq({
      method: 'POST',
      url: '/api/shared-links',
      headers: { cookie: ownerCookie },
      body: {
        proposalId,
        recipientEmail: 'recipient@example.com',
        idempotencyKey: `${proposalId}:test-share`,
        maxUses: 5,
        reportMetadata: {
          stage: 'phase2-test',
        },
      },
    });
    const createShareRes = createMockRes();
    await sharedLinksCreateHandler(createShareReq, createShareRes);

    assert.equal(createShareRes.statusCode, 201);
    const createdShare = createShareRes.jsonBody().sharedLink;

    const readShareReq = createMockReq({
      method: 'GET',
      url: `/api/shared-links/${createdShare.token}`,
      query: {
        token: createdShare.token,
        consume: 'true',
      },
    });
    const readShareRes = createMockRes();
    await sharedLinkReadHandler(readShareReq, readShareRes);

    assert.equal(readShareRes.statusCode, 200);
    const readPayload = readShareRes.jsonBody();

    assert.equal(readPayload.ok, true);
    assert.equal(readPayload.sharedLink.token, createdShare.token);
    assert.equal(readPayload.sharedLink.proposal.id, proposalId);
    assert.equal(readPayload.sharedLink.reportMetadata.stage, 'phase2-test');
  });
}
