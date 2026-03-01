import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedLinksHandler from '../../server/routes/shared-links/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
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
  return res.jsonBody();
}

async function createWorkspaceLink(cookie, proposalId, recipientEmail, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/shared-links',
    headers: { cookie },
    body: {
      proposalId,
      recipientEmail,
      mode: 'workspace',
      canView: true,
      canEdit: true,
      canEditConfidential: true,
      maxUses: 20,
      ...overrides,
    },
  });
  const res = createMockRes();
  await sharedLinksHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().sharedLink;
}

async function getRecipientWorkspace(token) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/shared-report/${token}`,
    query: { token },
  });
  const res = createMockRes();
  await sharedReportRecipientTokenHandler(req, res, token);
  return res;
}

async function saveRecipientDraft(token, body) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    query: { token },
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function setSharedLinkFields(token, patchSql) {
  const db = getDb();
  await db.execute(sql`update shared_links set ${patchSql}, updated_at = now() where token = ${token}`);
}

if (!hasDatabaseUrl()) {
  test('recipient shared report contract suite (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('A1 token validation matrix + A2 public access + A3 no confidential leak', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('a123');
    const confidentialMarker = 'CONFIDENTIAL_TOKEN_987654';
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Contract Matrix',
      docAText: `Private details ${confidentialMarker} never leak`,
      docBText: 'Shared details visible to recipient',
    });

    // public access without cookies
    const activeShare = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      maxUses: 20,
    });

    const activeRead = await getRecipientWorkspace(activeShare.token);
    assert.equal(activeRead.statusCode, 200);
    const activeBody = activeRead.jsonBody();
    assert.equal(activeBody.ok, true);
    assert.equal(activeBody.share.permissions.can_edit_shared, true);
    assert.equal(activeBody.share.permissions.can_edit_confidential, true);
    assert.equal(String(activeBody.defaults.shared_payload.text || '').includes('Shared details visible'), true);

    const serialized = JSON.stringify(activeBody);
    assert.equal(serialized.includes(confidentialMarker), false);
    assert.equal(serialized.includes('doc_a_text'), false);
    assert.equal(serialized.includes('docAText'), false);

    // invalid token
    const invalidRead = await getRecipientWorkspace('missing_shared_report_token');
    assert.equal(invalidRead.statusCode, 404);
    assert.equal(invalidRead.jsonBody().ok, false);
    assert.equal(invalidRead.jsonBody().error.code, 'token_not_found');

    // wrong mode
    const workspaceLink = await createWorkspaceLink(ownerCookie, comparison.proposal_id, 'recipient@example.com');
    const wrongModeRead = await getRecipientWorkspace(workspaceLink.token);
    assert.equal(wrongModeRead.statusCode, 404);
    assert.equal(wrongModeRead.jsonBody().error.code, 'token_not_found');

    // revoked
    const revokedShare = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com');
    await setSharedLinkFields(revokedShare.token, sql`status = 'revoked'`);
    const revokedRead = await getRecipientWorkspace(revokedShare.token);
    assert.equal(revokedRead.statusCode, 410);
    assert.equal(revokedRead.jsonBody().error.code, 'token_inactive');

    // expired
    const expiredShare = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const expiredRead = await getRecipientWorkspace(expiredShare.token);
    assert.equal(expiredRead.statusCode, 410);
    assert.equal(expiredRead.jsonBody().error.code, 'token_expired');

    // max uses reached
    const maxUsesShare = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      maxUses: 1,
    });
    const firstUse = await getRecipientWorkspace(maxUsesShare.token);
    assert.equal(firstUse.statusCode, 200);
    const secondUse = await getRecipientWorkspace(maxUsesShare.token);
    assert.equal(secondUse.statusCode, 410);
    assert.equal(secondUse.jsonBody().error.code, 'max_uses_reached');
  });

  test('A4 draft save permissions matrix', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('a4');
    const comparison = await createComparison(ownerCookie, {
      title: 'Permission Matrix',
      docAText: 'private source',
      docBText: 'shared source',
    });

    const matrix = [
      {
        label: 'shared=true confidential=true',
        canEdit: true,
        canEditConfidential: true,
        mutateShared: true,
        mutateConfidential: true,
        expectedStatus: 200,
      },
      {
        label: 'shared=false confidential=true',
        canEdit: false,
        canEditConfidential: true,
        mutateShared: true,
        mutateConfidential: true,
        expectedStatus: 403,
        expectedCode: 'edit_not_allowed',
      },
      {
        label: 'shared=true confidential=false',
        canEdit: true,
        canEditConfidential: false,
        mutateShared: false,
        mutateConfidential: true,
        expectedStatus: 403,
        expectedCode: 'confidential_edit_not_allowed',
      },
      {
        label: 'shared=false confidential=false no-change',
        canEdit: false,
        canEditConfidential: false,
        mutateShared: false,
        mutateConfidential: false,
        expectedStatus: 200,
      },
    ];

    for (const [index, entry] of matrix.entries()) {
      const link = await createSharedReportLink(
        ownerCookie,
        comparison.id,
        `recipient${index}@example.com`,
        {
          canEdit: entry.canEdit,
          canEditConfidential: entry.canEditConfidential,
          maxUses: 20,
        },
      );

      const readRes = await getRecipientWorkspace(link.token);
      assert.equal(readRes.statusCode, 200, `${entry.label} should load workspace`);
      const readBody = readRes.jsonBody();
      const sharedPayload = {
        ...(readBody.defaults?.shared_payload || {}),
      };
      const confidentialPayload = {
        ...(readBody.defaults?.recipient_confidential_payload || {}),
      };

      if (entry.mutateShared) {
        sharedPayload.text = `${sharedPayload.text || ''} :: shared update ${index}`;
      }
      if (entry.mutateConfidential) {
        confidentialPayload.notes = `private update ${index}`;
      }

      const saveRes = await saveRecipientDraft(link.token, {
        shared_payload: sharedPayload,
        recipient_confidential_payload: confidentialPayload,
      });
      assert.equal(saveRes.statusCode, entry.expectedStatus, `${entry.label} unexpected status`);

      const saveBody = saveRes.jsonBody();
      if (entry.expectedStatus === 200) {
        assert.equal(saveBody.ok, true);
        assert.equal(Boolean(saveBody.draft_id), true);
      } else {
        assert.equal(saveBody.ok, false);
        assert.equal(saveBody.error.code, entry.expectedCode);
      }
    }
  });

  test('A5 payload object validation + size limits', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('a5');
    const comparison = await createComparison(ownerCookie, {
      title: 'Validation Limits',
      docAText: 'private data',
      docBText: 'shared data',
    });
    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      maxUses: 20,
    });

    const invalidShared = await saveRecipientDraft(link.token, {
      shared_payload: 'not-an-object',
      recipient_confidential_payload: {},
    });
    assert.equal(invalidShared.statusCode, 400);
    assert.equal(invalidShared.jsonBody().error.code, 'invalid_input');

    const invalidConfidential = await saveRecipientDraft(link.token, {
      shared_payload: {},
      recipient_confidential_payload: [],
    });
    assert.equal(invalidConfidential.statusCode, 400);
    assert.equal(invalidConfidential.jsonBody().error.code, 'invalid_input');

    const hugeValue = 'x'.repeat(205 * 1024);
    const oversized = await saveRecipientDraft(link.token, {
      shared_payload: { text: hugeValue },
      recipient_confidential_payload: {},
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.jsonBody().error.code, 'payload_too_large');
  });
}
