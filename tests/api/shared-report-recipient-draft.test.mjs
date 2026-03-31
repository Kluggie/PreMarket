import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonDetailHandler from '../../server/routes/document-comparisons/[id].ts';
import documentComparisonEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import sharedLinksHandler from '../../server/routes/shared-links/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientCoachHandler from '../../server/routes/shared-report/[token]/coach.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
import sharedReportVerifyStartHandler from '../../server/routes/shared-report/[token]/verify/start.ts';
import sharedReportVerifyConfirmHandler from '../../server/routes/shared-report/[token]/verify/confirm.ts';
import { buildSharedReportTurnCopy } from '../../src/lib/sharedReportSendDirection.js';
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

function makeRecipientCookie(seed, email = `${seed}_recipient@example.com`) {
  return makeSessionCookie({
    sub: `${seed}_recipient`,
    email,
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

async function getComparisonDetail(comparisonId, cookie, token = null) {
  const query = token ? { id: comparisonId, token } : { id: comparisonId };
  const req = createMockReq({
    method: 'GET',
    url: `/api/document-comparisons/${comparisonId}`,
    headers: cookie ? { cookie } : {},
    query,
  });
  const res = createMockRes();
  await documentComparisonDetailHandler(req, res, comparisonId);
  return res;
}

async function evaluateComparison(comparisonId, cookie, body = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/document-comparisons/${comparisonId}/evaluate`,
    headers: cookie ? { cookie } : {},
    query: { id: comparisonId },
    body,
  });
  const res = createMockRes();
  await documentComparisonEvaluateHandler(req, res, comparisonId);
  return res;
}

async function getRecipientWorkspace(token, cookie = null) {
  const req = createMockReq({
    method: 'GET',
    url: `/api/shared-report/${token}`,
    query: { token },
    headers: cookie ? { cookie } : {},
  });
  const res = createMockRes();
  await sharedReportRecipientTokenHandler(req, res, token);
  return res;
}

async function saveRecipientDraft(token, body, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/draft`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientDraftHandler(req, res, token);
  return res;
}

async function evaluateRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function coachRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/coach`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientCoachHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, body = {}, cookie = null) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    query: { token },
    headers: cookie ? { cookie } : {},
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
  return res;
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
    assert.equal(Boolean(workspaceLink.token), true);
    assert.equal(String(workspaceLink.mode || '').toLowerCase(), 'workspace');
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

    // Shared-report links must remain accessible across repeated opens/refreshes
    // even when maxUses is configured.
    const maxUsesShare = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      maxUses: 1,
    });
    const firstUse = await getRecipientWorkspace(maxUsesShare.token);
    assert.equal(firstUse.statusCode, 200);
    const secondUse = await getRecipientWorkspace(maxUsesShare.token);
    assert.equal(secondUse.statusCode, 200);
    const thirdUse = await getRecipientWorkspace(maxUsesShare.token);
    assert.equal(thirdUse.statusCode, 200);
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
      const recipientEmail = `recipient${index}@example.com`;
      const link = await createSharedReportLink(
        ownerCookie,
        comparison.id,
        recipientEmail,
        {
          canEdit: entry.canEdit,
          canEditConfidential: entry.canEditConfidential,
          maxUses: 20,
        },
      );
      const recipientCookie = makeRecipientCookie(`a4_matrix_${index}`, recipientEmail);

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
      }, recipientCookie);
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
    const recipientCookie = makeRecipientCookie('a5_recipient', 'recipient@example.com');

    const invalidShared = await saveRecipientDraft(link.token, {
      shared_payload: 'not-an-object',
      recipient_confidential_payload: {},
    }, recipientCookie);
    assert.equal(invalidShared.statusCode, 400);
    assert.equal(invalidShared.jsonBody().error.code, 'invalid_input');

    const invalidConfidential = await saveRecipientDraft(link.token, {
      shared_payload: {},
      recipient_confidential_payload: [],
    }, recipientCookie);
    assert.equal(invalidConfidential.statusCode, 400);
    assert.equal(invalidConfidential.jsonBody().error.code, 'invalid_input');

    const hugeValue = 'x'.repeat(205 * 1024);
    const oversized = await saveRecipientDraft(link.token, {
      shared_payload: { text: hugeValue },
      recipient_confidential_payload: {},
    }, recipientCookie);
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.jsonBody().error.code, 'payload_too_large');
  });

  test('Prompt3 draft save requires auth while workspace read-only remains public', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p3_draft_auth');
    const recipientCookie = makeRecipientCookie('p3_draft_auth', 'recipient@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Draft Auth Guard',
      docAText: 'Private baseline',
      docBText: 'Shared baseline',
    });
    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      maxUses: 20,
    });

    const workspaceRes = await getRecipientWorkspace(link.token);
    assert.equal(workspaceRes.statusCode, 200);

    const unauthenticatedSave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Unauthenticated update should fail.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: '' },
    });
    assert.equal(unauthenticatedSave.statusCode, 401);
    assert.equal(unauthenticatedSave.jsonBody().error.code, 'unauthorized');

    const authenticatedSave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Authenticated update should pass.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Private note.' },
    }, recipientCookie);
    assert.equal(authenticatedSave.statusCode, 200);
    assert.equal(authenticatedSave.jsonBody().ok, true);
  });

  test('recipient write endpoints enforce invited email or verified alias authorization', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('recipient_authz_matrix');
    const invitedEmail = 'invited@example.com';
    const invitedCookie = makeRecipientCookie('recipient_authz_invited', invitedEmail);
    const alternateCookie = makeRecipientCookie('recipient_authz_alt', 'alternate@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Authorization Matrix',
      docAText: 'Private baseline text',
      docBText: 'Shared baseline text long enough for evaluation checks.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, invitedEmail, {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 20,
    });

    const invitedSave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Invited recipient can save draft.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Invited note.' },
      workflow_step: 2,
    }, invitedCookie);
    assert.equal(invitedSave.statusCode, 200);
    assert.equal(invitedSave.jsonBody().ok, true);

    const mismatchSave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Alternate account should be blocked.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: '' },
      workflow_step: 2,
    }, alternateCookie);
    assert.equal(mismatchSave.statusCode, 403);
    assert.equal(mismatchSave.jsonBody().error.code, 'recipient_email_mismatch');
    assert.equal(String(mismatchSave.jsonBody().error.invitedEmail || ''), invitedEmail);

    const mismatchEvaluate = await evaluateRecipientDraft(link.token, {}, alternateCookie);
    assert.equal(mismatchEvaluate.statusCode, 403);
    assert.equal(mismatchEvaluate.jsonBody().error.code, 'recipient_email_mismatch');
    assert.equal(String(mismatchEvaluate.jsonBody().error.invitedEmail || ''), invitedEmail);
  });

  test('verify start/confirm authorizes an alternate signed-in email for the specific shared token', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('recipient_verify_flow');
    const invitedEmail = 'invited-verify@example.com';
    const alternateEmail = 'alias-verify@example.com';
    const alternateUserSub = 'recipient_verify_flow_alias_recipient';
    const alternateCookie = makeSessionCookie({
      sub: alternateUserSub,
      email: alternateEmail,
    });
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Verify Flow',
      docAText: 'Private baseline for verification flow.',
      docBText: 'Shared baseline text for verification workflow coverage.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, invitedEmail, {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 20,
    });

    const beforeVerifySave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'blocked before verification' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: '' },
    }, alternateCookie);
    assert.equal(beforeVerifySave.statusCode, 403);
    assert.equal(beforeVerifySave.jsonBody().error.code, 'recipient_email_mismatch');

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
          json: async () => ({ id: 'email_verify_test' }),
        };
      }
      return previousFetch(url, init);
    };

    try {
      const startRes = await startRecipientVerification(link.token, alternateCookie);
      assert.equal(startRes.statusCode, 200);
      assert.equal(startRes.jsonBody().started, true);
      assert.equal(sentPayloads.length, 1);

      const otpText = String(sentPayloads[0]?.text || '');
      const otpMatch = otpText.match(/\b(\d{6})\b/);
      assert.equal(Boolean(otpMatch), true);
      const code = String(otpMatch?.[1] || '');

      const db = getDb();
      const verificationRows = await db.execute(
        sql`select token, invited_email, code_hash, attempt_count
            from shared_link_verifications
            where token = ${link.token}
            limit 1`,
      );
      assert.equal(verificationRows.rows.length, 1);
      assert.equal(String(verificationRows.rows[0].invited_email || ''), invitedEmail);
      assert.equal(String(verificationRows.rows[0].code_hash || '').length > 0, true);
      assert.equal(String(verificationRows.rows[0].code_hash || '') === code, false);
      assert.equal(Number(verificationRows.rows[0].attempt_count || 0), 0);

      const confirmRes = await confirmRecipientVerification(link.token, code, alternateCookie);
      assert.equal(confirmRes.statusCode, 200);
      assert.equal(confirmRes.jsonBody().verified, true);
      assert.equal(String(confirmRes.jsonBody().invited_email || ''), invitedEmail);
      assert.equal(String(confirmRes.jsonBody().authorized_email || ''), alternateEmail);

      const linkRows = await db.execute(
        sql`select authorized_user_id, authorized_email, authorized_at
            from shared_links
            where token = ${link.token}
            limit 1`,
      );
      assert.equal(linkRows.rows.length, 1);
      assert.equal(String(linkRows.rows[0].authorized_user_id || ''), alternateUserSub);
      assert.equal(String(linkRows.rows[0].authorized_email || ''), alternateEmail);
      assert.notEqual(linkRows.rows[0].authorized_at, null);

      const verificationAfterConfirm = await db.execute(
        sql`select count(*)::int as count from shared_link_verifications where token = ${link.token}`,
      );
      assert.equal(Number(verificationAfterConfirm.rows[0]?.count || 0), 0);
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

    const afterVerifySave = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Allowed after verify confirm.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Alias account note.' },
      workflow_step: 2,
    }, alternateCookie);
    assert.equal(afterVerifySave.statusCode, 200);
    assert.equal(afterVerifySave.jsonBody().ok, true);
  });

  test('once alias authorization is set for user A, user B cannot take over authorization or write', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('recipient_verify_lock');
    const invitedEmail = 'verify-lock-invited@example.com';
    const aliasA = {
      sub: 'recipient_verify_lock_alias_a',
      email: 'verify-lock-alias-a@example.com',
      cookie: makeSessionCookie({
        sub: 'recipient_verify_lock_alias_a',
        email: 'verify-lock-alias-a@example.com',
      }),
    };
    const aliasB = {
      sub: 'recipient_verify_lock_alias_b',
      email: 'verify-lock-alias-b@example.com',
      cookie: makeSessionCookie({
        sub: 'recipient_verify_lock_alias_b',
        email: 'verify-lock-alias-b@example.com',
      }),
    };

    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Verify Lock',
      docAText: 'Private baseline text for verify lock coverage.',
      docBText: 'Shared baseline text long enough for save flow coverage after verification.',
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
          json: async () => ({ id: `email_verify_lock_${sentPayloads.length}` }),
        };
      }
      return previousFetch(url, init);
    };

    const extractOtp = (payload) => {
      const text = String(payload?.text || '');
      const match = text.match(/\b(\d{6})\b/);
      assert.equal(Boolean(match), true);
      return String(match?.[1] || '');
    };

    try {
      const startA = await startRecipientVerification(link.token, aliasA.cookie);
      assert.equal(startA.statusCode, 200);
      assert.equal(startA.jsonBody().started, true);
      assert.equal(sentPayloads.length >= 1, true);
      const codeA = extractOtp(sentPayloads[0]);

      const confirmA = await confirmRecipientVerification(link.token, codeA, aliasA.cookie);
      assert.equal(confirmA.statusCode, 200);
      assert.equal(confirmA.jsonBody().verified, true);
      assert.equal(String(confirmA.jsonBody().authorized_email || ''), aliasA.email);

      const startB = await startRecipientVerification(link.token, aliasB.cookie);
      assert.equal(startB.statusCode, 409);
      assert.equal(startB.jsonBody().error.code, 'recipient_authorization_locked');
      assert.equal(sentPayloads.length, 1);

      const confirmB = await confirmRecipientVerification(link.token, codeA, aliasB.cookie);
      assert.equal(confirmB.statusCode, 409);
      assert.equal(confirmB.jsonBody().error.code, 'recipient_authorization_locked');
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
    const linkRows = await db.execute(
      sql`select authorized_user_id, authorized_email
          from shared_links
          where token = ${link.token}
          limit 1`,
    );
    assert.equal(linkRows.rows.length, 1);
    assert.equal(String(linkRows.rows[0].authorized_user_id || ''), aliasA.sub);
    assert.equal(String(linkRows.rows[0].authorized_email || ''), aliasA.email);

    const writeB = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Alias B should be blocked after Alias A is authorized.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: '' },
    }, aliasB.cookie);
    assert.equal(writeB.statusCode, 403);
    assert.equal(writeB.jsonBody().error.code, 'recipient_email_mismatch');

    const writeA = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Alias A remains authorized for writes.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Alias A note.' },
    }, aliasA.cookie);
    assert.equal(writeA.statusCode, 200);
    assert.equal(writeA.jsonBody().ok, true);
  });

  test('Prompt3 recipient sees shared report in proposals received list', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p3_received_owner');
    const recipientEmail = 'recipient@example.com';
    const recipientCookie = makeRecipientCookie('p3_received', recipientEmail);
    const comparison = await createComparison(ownerCookie, {
      title: 'Shared Report In Received',
      docAText: 'Owner confidential baseline',
      docBText: 'Shared baseline for recipient',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
      canEdit: true,
      canEditConfidential: true,
      maxUses: 20,
    });

    const receivedRes = await listProposals(recipientCookie, { tab: 'received', limit: 20 });
    assert.equal(receivedRes.statusCode, 200);
    const receivedBody = receivedRes.jsonBody();
    const matching = (receivedBody.proposals || []).find((row) => String(row.id || '') === String(comparison.proposal_id));
    assert.equal(Boolean(matching), true);
    assert.equal(String(matching.list_type || ''), 'received');
    assert.equal(String(matching.shared_report_token || ''), String(link.token));
    assert.equal(String(matching.directional_status || ''), 'received');
  });

  test('Prompt3 workspace Step 0 latest report falls back to baseline when no evaluation exists', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p3_report_fallback');
    const comparison = await createComparison(ownerCookie, {
      title: 'Workspace Report Fallback',
      docAText: 'Proposer private baseline.',
      docBText: 'Shared baseline for fallback report checks.',
    });
    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canReevaluate: true,
    });

    const workspaceRes = await getRecipientWorkspace(link.token);
    assert.equal(workspaceRes.statusCode, 200);
    const workspace = workspaceRes.jsonBody();

    assert.equal(workspace.latestEvaluation, null);
    const baselineReport = workspace.baseline_ai_report || workspace.baseline?.ai_report || {};
    const latestReport = workspace.latestReport || {};
    assert.equal(typeof latestReport, 'object');
    assert.equal(Array.isArray(latestReport), false);
    assert.deepEqual(latestReport, baselineReport);
  });

  test('Prompt3 workspace Step 0 latest report uses latest evaluation public report when available', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p3_report_latest_eval');
    const comparison = await createComparison(ownerCookie, {
      title: 'Workspace Latest Evaluation',
      docAText: 'Proposer private baseline for evaluation.',
      docBText: 'Shared baseline for evaluation report override checks.',
    });
    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canReevaluate: true,
    });
    const recipientCookie = makeRecipientCookie('p3_report_latest_eval_recipient', 'recipient@example.com');
    const reportMarker = `LATEST_PUBLIC_REPORT_${Date.now()}`;

    const previousEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
      report: {
        recommendation: 'review',
        executive_summary: `Marker ${reportMarker}`,
        sections: [{ heading: 'Summary', bullets: ['Latest evaluated report should be shown on Step 0.'] }],
      },
      evaluation_provider: 'test',
      similarity_score: 70,
    });

    try {
      const evaluateRes = await evaluateRecipientDraft(link.token, {}, recipientCookie);
      assert.equal(evaluateRes.statusCode, 200);

      const workspaceRes = await getRecipientWorkspace(link.token);
      assert.equal(workspaceRes.statusCode, 200);
      const workspace = workspaceRes.jsonBody();
      const latestEvalSummary = String(workspace.latestEvaluation?.public_report?.executive_summary || '');
      const latestReportSummary = String(workspace.latestReport?.executive_summary || '');

      assert.equal(latestEvalSummary.includes(reportMarker), true);
      assert.equal(latestReportSummary.includes(reportMarker), true);
    } finally {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvaluator;
    }
  });

  test('Prompt2 evaluate is auth-protected and permission-gated by can_reevaluate', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_eval');
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Evaluate Permission',
      docAText: 'Proposer private baseline for evaluation',
      docBText: 'Shared baseline long enough for evaluate route coverage with recipient flow.',
    });

    const disallowed = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: false,
    });
    const disallowedRecipientCookie = makeRecipientCookie('p2_eval_disallowed', 'recipient@example.com');

    const disallowedRes = await evaluateRecipientDraft(disallowed.token, {}, disallowedRecipientCookie);
    assert.equal(disallowedRes.statusCode, 403);
    assert.equal(disallowedRes.jsonBody().error.code, 'reevaluation_not_allowed');

    const allowed = await createSharedReportLink(ownerCookie, comparison.id, 'recipient2@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
    });
    const allowedRecipientCookie = makeRecipientCookie('p2_eval_allowed', 'recipient2@example.com');

    // Stub evaluator in-process so test does not depend on external Vertex config.
    // This suite is run serially in CI (`--test-concurrency=1`) and always restores in finally.
    const previousEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
      report: {
        recommendation: 'proceed',
        executive_summary: 'Recipient-safe summary from shared text only.',
        sections: [{ heading: 'Fit', bullets: ['Alignment is moderate based on shared terms.'] }],
      },
      evaluation_provider: 'test',
      similarity_score: 72,
    });

    try {
      const allowedRes = await evaluateRecipientDraft(allowed.token, {}, allowedRecipientCookie);
      assert.equal(allowedRes.statusCode, 200);
      const body = allowedRes.jsonBody();
      assert.equal(body.ok, true);
      assert.equal(Boolean(body.evaluation_id), true);
      assert.equal(typeof body.evaluation.public_report, 'object');
    } finally {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvaluator;
    }
  });

  test('Prompt2 send-back requires draft and marks recipient revision as sent', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_send');
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Send Back',
      docAText: 'Original proposer confidential terms stay server-only.',
      docBText: 'Shared proposer baseline for recipient edits.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
    });
    const recipientCookie = makeRecipientCookie('p2_send_recipient', 'recipient@example.com');

    const noDraftRes = await sendBackRecipientDraft(link.token, {}, recipientCookie);
    assert.equal(noDraftRes.statusCode, 400);
    assert.equal(noDraftRes.jsonBody().error.code, 'draft_required');

    const saveRes = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared revision for proposer.' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Recipient private terms for internal use.',
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(saveRes.statusCode, 200);

    const sendRes = await sendBackRecipientDraft(link.token, {}, recipientCookie);
    assert.equal(sendRes.statusCode, 200);
    assert.equal(sendRes.jsonBody().status, 'sent');

    const db = getDb();
    const sentRows = await db.execute(
      sql`select id, status from shared_report_recipient_revisions where shared_link_id = (
            select id from shared_links where token = ${link.token}
          ) order by created_at desc`,
    );
    assert.equal(Array.isArray(sentRows.rows), true);
    assert.equal(sentRows.rows.length >= 1, true);
    assert.equal(String(sentRows.rows[0].status), 'sent');

    const evaluationRows = await db.execute(
      sql`select source, status from proposal_evaluations where proposal_id = ${comparison.proposal_id} order by created_at desc limit 1`,
    );
    assert.equal(evaluationRows.rows.length >= 1, true);
    assert.equal(String(evaluationRows.rows[0].source), 'shared_report_recipient');
  });

  test('send-back target aligns with computed counterparty across repeated rounds', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerSeed = 'send_direction_rounds';
    const ownerCookie = makeOwnerCookie(ownerSeed);
    const ownerEmail = `${ownerSeed}_owner@example.com`;
    const recipientEmail = 'send-direction-recipient@example.com';
    const recipientCookie = makeRecipientCookie('send_direction_recipient', recipientEmail);
    const comparison = await createComparison(ownerCookie, {
      title: 'Send Direction Roundtrip',
      docAText: 'Owner confidential baseline.',
      docBText: 'Owner shared baseline.',
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const initialWorkspace = await getRecipientWorkspace(initialLink.token, recipientCookie);
    assert.equal(initialWorkspace.statusCode, 200);
    const initialActorRole = String(initialWorkspace.jsonBody().party_context?.draft_author_role || '');
    const initialTurnCopy = buildSharedReportTurnCopy(initialActorRole);
    assert.equal(initialTurnCopy.actorRole, 'recipient');
    assert.equal(initialTurnCopy.sendCtaLabel, 'Send to proposer');

    const round2Save = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient round 2 shared update.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient round 2 private note.' },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round2Save.statusCode, 200);

    const round2Send = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
    assert.equal(round2Send.statusCode, 200);
    const round2ReturnLink = round2Send.jsonBody().return_link || {};
    const round2Token = String(round2ReturnLink.token || '');
    assert.notEqual(round2Token, '');
    assert.equal(
      String(round2ReturnLink.recipient_email || ''),
      initialTurnCopy.counterpartyRole === 'proposer' ? ownerEmail : recipientEmail,
    );

    const round2Workspace = await getRecipientWorkspace(round2Token, ownerCookie);
    assert.equal(round2Workspace.statusCode, 200);
    const round2ActorRole = String(round2Workspace.jsonBody().party_context?.draft_author_role || '');
    const round2TurnCopy = buildSharedReportTurnCopy(round2ActorRole);
    assert.equal(round2TurnCopy.actorRole, 'proposer');
    assert.equal(round2TurnCopy.sendCtaLabel, 'Send to recipient');

    const round3Save = await saveRecipientDraft(round2Token, {
      shared_payload: { label: 'Shared Information', text: 'Owner round 3 shared update.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Owner round 3 private note.' },
      workflow_step: 2,
    }, ownerCookie);
    assert.equal(round3Save.statusCode, 200);

    const round3Send = await sendBackRecipientDraft(round2Token, {}, ownerCookie);
    assert.equal(round3Send.statusCode, 200);
    const round3ReturnLink = round3Send.jsonBody().return_link || {};
    const round3Token = String(round3ReturnLink.token || '');
    assert.notEqual(round3Token, '');
    assert.equal(
      String(round3ReturnLink.recipient_email || ''),
      round2TurnCopy.counterpartyRole === 'proposer' ? ownerEmail : recipientEmail,
    );

    const round3Workspace = await getRecipientWorkspace(round3Token, recipientCookie);
    assert.equal(round3Workspace.statusCode, 200);
    const round3ActorRole = String(round3Workspace.jsonBody().party_context?.draft_author_role || '');
    const round3TurnCopy = buildSharedReportTurnCopy(round3ActorRole);
    assert.equal(round3TurnCopy.actorRole, 'recipient');
    assert.equal(round3TurnCopy.sendCtaLabel, 'Send to proposer');
  });

  test('workspace parent status stays consistent with proposals inbox row status across round ownership flips', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerSeed = 'status_consistency_rounds';
    const ownerCookie = makeOwnerCookie(ownerSeed);
    const ownerEmail = `${ownerSeed}_owner@example.com`;
    const recipientEmail = 'status-consistency-recipient@example.com';
    const recipientCookie = makeRecipientCookie('status_consistency_recipient', recipientEmail);
    const comparison = await createComparison(ownerCookie, {
      title: 'Thread Status Consistency',
      docAText: 'Owner confidential baseline',
      docBText: 'Owner shared baseline',
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, recipientEmail, {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const assertWorkspaceAndInboxStatusMatch = async ({
      token,
      workspaceCookie,
      listCookie,
      expectedKey = '',
      message,
    }) => {
      const workspaceRes = await getRecipientWorkspace(token, workspaceCookie);
      assert.equal(workspaceRes.statusCode, 200);
      const workspaceBody = workspaceRes.jsonBody();
      const workspacePrimaryStatusKey = String(workspaceBody.parent?.primary_status_key || '');
      assert.notEqual(workspacePrimaryStatusKey, '', `${message}: workspace should expose parent.primary_status_key`);
      if (expectedKey) {
        assert.equal(workspacePrimaryStatusKey, expectedKey, `${message}: expected workspace status key`);
      }

      const listRes = await listProposals(listCookie, { tab: 'inbox', limit: '20' });
      assert.equal(listRes.statusCode, 200);
      const listRows = Array.isArray(listRes.jsonBody().proposals) ? listRes.jsonBody().proposals : [];
      const row = listRows.find((entry) => String(entry?.id || '') === comparison.proposal_id);
      if (!row) {
        const allRes = await listProposals(listCookie, { tab: 'all', limit: '20' });
        assert.equal(allRes.statusCode, 200);
        const allRows = Array.isArray(allRes.jsonBody().proposals) ? allRes.jsonBody().proposals : [];
        const allRow = allRows.find((entry) => String(entry?.id || '') === comparison.proposal_id);
        assert.ok(allRow, `${message}: proposal row should exist in list`);
        assert.equal(
          String(allRow?.primary_status_key || ''),
          workspacePrimaryStatusKey,
          `${message}: list row status key must match workspace parent status key`,
        );
        return;
      }

      assert.equal(
        String(row?.primary_status_key || ''),
        workspacePrimaryStatusKey,
        `${message}: list row status key must match workspace parent status key`,
      );
    };

    await assertWorkspaceAndInboxStatusMatch({
      token: initialLink.token,
      workspaceCookie: recipientCookie,
      listCookie: recipientCookie,
      expectedKey: 'needs_reply',
      message: 'Round 1 recipient turn',
    });

    const round2Save = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient round 2 shared response.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient round 2 private note.' },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round2Save.statusCode, 200);

    const round2Send = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
    assert.equal(round2Send.statusCode, 200);
    const round2Token = String(round2Send.jsonBody().return_link?.token || '');
    assert.notEqual(round2Token, '');
    assert.equal(String(round2Send.jsonBody().return_link?.recipient_email || ''), ownerEmail);

    await assertWorkspaceAndInboxStatusMatch({
      token: initialLink.token,
      workspaceCookie: recipientCookie,
      listCookie: recipientCookie,
      expectedKey: 'waiting_on_counterparty',
      message: 'Round 2 recipient waiting state',
    });

    await assertWorkspaceAndInboxStatusMatch({
      token: round2Token,
      workspaceCookie: ownerCookie,
      listCookie: ownerCookie,
      message: 'Round 2 owner turn',
    });

    const round3Save = await saveRecipientDraft(round2Token, {
      shared_payload: { label: 'Shared Information', text: 'Owner round 3 shared response.' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Owner round 3 private note.' },
      workflow_step: 2,
    }, ownerCookie);
    assert.equal(round3Save.statusCode, 200);

    const round3Send = await sendBackRecipientDraft(round2Token, {}, ownerCookie);
    assert.equal(round3Send.statusCode, 200);
    const round3Token = String(round3Send.jsonBody().return_link?.token || '');
    assert.notEqual(round3Token, '');

    await assertWorkspaceAndInboxStatusMatch({
      token: round2Token,
      workspaceCookie: ownerCookie,
      listCookie: ownerCookie,
      message: 'Round 3 owner waiting state',
    });

    await assertWorkspaceAndInboxStatusMatch({
      token: round3Token,
      workspaceCookie: recipientCookie,
      listCookie: recipientCookie,
      expectedKey: 'needs_reply',
      message: 'Round 3 recipient turn',
    });
  });

  test('Prompt2 evaluate public report never leaks proposer/recipient confidential markers', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_leak');
    const proposerSecret = 'PROPOSER_SECRET_MARKER_c2b1f8e4d7a6z9q1n3m5k7';
    const recipientSecret = 'RECIPIENT_SECRET_MARKER_9f3ac7d2e1b4x6w8v0u2t4';
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Leakage Guard',
      docAText: `Keep private: ${proposerSecret} with strict confidentiality.`,
      docBText: 'Shared baseline text for safe report generation and recipient collaboration.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
    });
    const recipientCookie = makeRecipientCookie('p2_leak_recipient', 'recipient@example.com');

    const saveRes = await saveRecipientDraft(link.token, {
      shared_payload: {
        label: 'Shared Information',
        text: 'Shared updated terms with adequate length for evaluate endpoint and no secrets.',
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `Do not leak ${recipientSecret} in any public report.`,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(saveRes.statusCode, 200);

    const previousEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
      report: {
        recommendation: 'review',
        executive_summary: `Mentions ${proposerSecret} and ${recipientSecret}`,
        sections: [
          {
            heading: 'Risk',
            bullets: [
              `Contains ${proposerSecret}`,
              `Contains ${recipientSecret}`,
            ],
          },
        ],
      },
      evaluation_provider: 'test',
      similarity_score: 61,
      confidence_score: 0.4,
    });

    try {
      const evaluateRes = await evaluateRecipientDraft(link.token, {}, recipientCookie);
      assert.equal(evaluateRes.statusCode, 200);

      const body = evaluateRes.jsonBody();
      const serialized = JSON.stringify(body.evaluation?.public_report || {});
      assert.equal(serialized.includes(proposerSecret), false);
      assert.equal(serialized.includes(recipientSecret), false);
      assert.equal(JSON.stringify(body.evaluation || {}).includes(proposerSecret), false);
      assert.equal(JSON.stringify(body.evaluation || {}).includes(recipientSecret), false);
      assert.equal(JSON.stringify(body).includes(proposerSecret), false);
      assert.equal(JSON.stringify(body).includes(recipientSecret), false);
    } finally {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvaluator;
    }
  });

  test('Prompt2 send-back supersedes previous sent revision and links proposer artifact to latest revision', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_send_supersede');
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Send Back Supersede',
      docAText: 'Proposer private baseline terms.',
      docBText: 'Shared baseline that recipient can revise repeatedly.',
    });

    const link = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: false,
      canSendBack: true,
    });
    const recipientCookie = makeRecipientCookie('p2_send_supersede_recipient', 'recipient@example.com');

    const save1 = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared v1' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient private v1' },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(save1.statusCode, 200);

    const send1 = await sendBackRecipientDraft(link.token, {}, recipientCookie);
    assert.equal(send1.statusCode, 200);
    const firstRevisionId = String(send1.jsonBody().revision_id || '');
    assert.notEqual(firstRevisionId, '');
    assert.equal(send1.jsonBody().status, 'sent');

    const save2 = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared v2' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient private v2' },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(save2.statusCode, 200);

    const send2 = await sendBackRecipientDraft(link.token, {}, recipientCookie);
    assert.equal(send2.statusCode, 200);
    const secondRevisionId = String(send2.jsonBody().revision_id || '');
    assert.notEqual(secondRevisionId, '');
    assert.notEqual(secondRevisionId, firstRevisionId);
    assert.equal(send2.jsonBody().status, 'sent');

    const db = getDb();
    const revisions = await db.execute(
      sql`select id, status, previous_revision_id from shared_report_recipient_revisions
          where shared_link_id = (select id from shared_links where token = ${link.token})
          order by created_at asc`,
    );
    assert.equal(revisions.rows.length, 2);

    const firstRow = revisions.rows.find((row) => String(row.id) === firstRevisionId);
    const secondRow = revisions.rows.find((row) => String(row.id) === secondRevisionId);
    assert.equal(String(firstRow?.status || ''), 'superseded');
    assert.equal(String(secondRow?.status || ''), 'sent');
    assert.equal(String(secondRow?.previous_revision_id || ''), firstRevisionId);

    const artifacts = await db.execute(
      sql`select source, proposal_id, result
          from proposal_evaluations
          where proposal_id = ${comparison.proposal_id}
          order by created_at desc`,
    );
    assert.equal(artifacts.rows.length >= 2, true);
    assert.equal(String(artifacts.rows[0].source || ''), 'shared_report_recipient');
    assert.equal(String(artifacts.rows[0].proposal_id || ''), String(comparison.proposal_id));
    assert.equal(String((artifacts.rows[0].result || {}).revision_id || ''), secondRevisionId);
  });

  test('Prompt2 permission matrix view-only token loads workspace but blocks edit/evaluate/send-back', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_perm_matrix');
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Permission Matrix',
      docAText: 'Proposer private baseline for permission checks.',
      docBText: 'Shared baseline for step 0 read-only checks.',
    });

    const viewOnlyLink = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canView: true,
      canEdit: false,
      canEditConfidential: false,
      canReevaluate: false,
      canSendBack: false,
      maxUses: 20,
    });
    const recipientCookie = makeRecipientCookie('p2_perm_matrix_recipient', 'recipient@example.com');

    const workspaceRes = await getRecipientWorkspace(viewOnlyLink.token);
    assert.equal(workspaceRes.statusCode, 200);
    const workspace = workspaceRes.jsonBody();
    assert.equal(workspace.share.permissions.can_view, true);
    assert.equal(workspace.share.permissions.can_edit_shared, false);
    assert.equal(workspace.share.permissions.can_edit_confidential, false);
    assert.equal(workspace.share.permissions.can_reevaluate, false);
    assert.equal(workspace.share.permissions.can_send_back, false);

    const rejectSharedEdit = await saveRecipientDraft(viewOnlyLink.token, {
      shared_payload: { label: 'Shared Information', text: 'mutated shared should fail' },
      recipient_confidential_payload: workspace.defaults?.recipient_confidential_payload || {},
    }, recipientCookie);
    assert.equal(rejectSharedEdit.statusCode, 403);
    assert.equal(rejectSharedEdit.jsonBody().error.code, 'edit_not_allowed');

    const rejectConfidentialEdit = await saveRecipientDraft(viewOnlyLink.token, {
      shared_payload: workspace.defaults?.shared_payload || {},
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'mutated private should fail' },
    }, recipientCookie);
    assert.equal(rejectConfidentialEdit.statusCode, 403);
    assert.equal(rejectConfidentialEdit.jsonBody().error.code, 'confidential_edit_not_allowed');

    const evaluateRes = await evaluateRecipientDraft(viewOnlyLink.token, {}, recipientCookie);
    assert.equal(evaluateRes.statusCode, 403);
    assert.equal(evaluateRes.jsonBody().error.code, 'reevaluation_not_allowed');

    const sendBackRes = await sendBackRecipientDraft(viewOnlyLink.token, {}, recipientCookie);
    assert.equal(sendBackRes.statusCode, 403);
    assert.equal(sendBackRes.jsonBody().error.code, 'send_back_not_allowed');
  });

  test('Prompt2 custom prompt threads include prior history without leaking proposer confidential text', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('p2_threaded_custom_prompt');
    const proposerConfidential = 'PROPOSER_SECRET_4512';
    const comparison = await createComparison(ownerCookie, {
      title: 'Recipient Threaded Custom Prompt',
      docAText: `Never leak ${proposerConfidential}`,
      docBText: 'Shared baseline visible to the recipient.',
    });
    const link = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
      {
        canEdit: true,
        canEditConfidential: true,
        canReevaluate: true,
        canSendBack: true,
        maxUses: 20,
      },
    );
    const recipientCookie = makeRecipientCookie(
      'p2_threaded_custom_prompt_recipient',
      'recipient@example.com',
    );

    const originalVertexMock = process.env.VERTEX_MOCK;
    const originalOverride = globalThis.__PREMARKET_TEST_VERTEX_CUSTOM_COACH_CALL__;
    const capturedCalls = [];
    process.env.VERTEX_MOCK = '0';
    globalThis.__PREMARKET_TEST_VERTEX_CUSTOM_COACH_CALL__ = async (input) => {
      capturedCalls.push(input);
      return {
        provider: 'mock',
        model: 'shared-report-thread-history-test',
        text: 'Thread-aware custom prompt feedback.',
      };
    };

    try {
      const coachRes = await coachRecipientDraft(link.token, {
        action: 'custom_prompt',
        intent: 'custom_prompt',
        mode: 'full',
        promptText: 'Continue our earlier discussion.',
        threadHistory: [
          { role: 'user', content: 'What are the biggest risks?', promptType: 'risks' },
          { role: 'assistant', content: 'Focus on implementation risk and renewal terms.' },
        ],
      }, recipientCookie);

      assert.equal(coachRes.statusCode, 200);
      assert.equal(capturedCalls.length, 1);

      const modelPrompt = String(capturedCalls[0]?.prompt || '');
      assert.equal(modelPrompt.includes('Prior conversation in this session'), true);
      assert.equal(modelPrompt.includes('User [risks]: What are the biggest risks?'), true);
      assert.equal(
        modelPrompt.includes('Assistant: Focus on implementation risk and renewal terms.'),
        true,
      );
      assert.equal(modelPrompt.includes('Shared baseline visible to the recipient.'), true);
      assert.equal(modelPrompt.includes(proposerConfidential), false);
      assert.equal(
        String(coachRes.jsonBody().coach.custom_feedback || '').includes('Thread-aware custom prompt feedback.'),
        true,
      );
    } finally {
      if (originalOverride === undefined) {
        delete globalThis.__PREMARKET_TEST_VERTEX_CUSTOM_COACH_CALL__;
      } else {
        globalThis.__PREMARKET_TEST_VERTEX_CUSTOM_COACH_CALL__ = originalOverride;
      }

      if (originalVertexMock === undefined) {
        delete process.env.VERTEX_MOCK;
      } else {
        process.env.VERTEX_MOCK = originalVertexMock;
      }
    }
  });

  test('bilateral shared history accumulates across rounds and renders back to both sides without overwriting proposer baseline', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('bilateral_history_owner');
    const recipientCookie = makeRecipientCookie('bilateral_history_recipient', 'recipient@example.com');
    const proposerSharedRound1 = 'PROPOSER_SHARED_ROUND_1_MARKER';
    const recipientSharedRound2 = 'RECIPIENT_SHARED_ROUND_2_MARKER';
    const proposerSharedRound3 = 'PROPOSER_SHARED_ROUND_3_MARKER';
    const proposerPrivateRound1 = 'PROPOSER_PRIVATE_ROUND_1_MARKER';
    const proposerPrivateRound3 = 'PROPOSER_PRIVATE_ROUND_3_MARKER';
    const recipientPrivateRound2 = 'RECIPIENT_PRIVATE_ROUND_2_MARKER';

    const comparison = await createComparison(ownerCookie, {
      title: 'Bilateral Shared History',
      docAText: `Owner private baseline ${proposerPrivateRound1}`,
      docBText: `Owner shared baseline ${proposerSharedRound1}`,
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const saveRound2 = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: `Recipient response ${recipientSharedRound2}` },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `Recipient private note ${recipientPrivateRound2}`,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(saveRound2.statusCode, 200);

    const sendRound2 = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
    assert.equal(sendRound2.statusCode, 200);

    const ownerDetailAfterRound2 = await getComparisonDetail(comparison.id, ownerCookie);
    assert.equal(ownerDetailAfterRound2.statusCode, 200);
    const ownerDetailBody = ownerDetailAfterRound2.jsonBody();
    const ownerSharedHistory = ownerDetailBody.shared_history?.entries || [];
    assert.equal(ownerSharedHistory.length >= 2, true);
    assert.equal(ownerSharedHistory.some((entry) => String(entry.text || '').includes(proposerSharedRound1)), true);
    assert.equal(ownerSharedHistory.some((entry) => String(entry.text || '').includes(recipientSharedRound2)), true);
    assert.equal(ownerSharedHistory.some((entry) => String(entry.author_label || '') === 'Proposer'), true);
    assert.equal(ownerSharedHistory.some((entry) => String(entry.author_label || '') === 'Recipient'), true);
    assert.equal(String(ownerDetailBody.comparison?.doc_b_text || '').includes(proposerSharedRound1), true);
    assert.equal(String(ownerDetailBody.comparison?.doc_b_text || '').includes(recipientSharedRound2), false);
    assert.equal(JSON.stringify(ownerDetailBody).includes(recipientPrivateRound2), false);

    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token <> ${initialLink.token}
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    assert.notEqual(round2Token, '');

    const ownerRound3Save = await saveRecipientDraft(round2Token, {
      shared_payload: { label: 'Shared Information', text: `Owner follow-up ${proposerSharedRound3}` },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `Owner private follow-up ${proposerPrivateRound3}`,
      },
      workflow_step: 2,
    }, ownerCookie);
    assert.equal(ownerRound3Save.statusCode, 200);

    const ownerRound3Send = await sendBackRecipientDraft(round2Token, {}, ownerCookie);
    assert.equal(ownerRound3Send.statusCode, 200);

    const round3LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token not in (${initialLink.token}, ${round2Token})
          order by created_at desc
          limit 1`,
    );
    const round3Token = String(round3LinkRows.rows[0]?.token || '');
    assert.notEqual(round3Token, '');

    const publicWorkspaceRound3 = await getRecipientWorkspace(round3Token);
    assert.equal(publicWorkspaceRound3.statusCode, 200);
    const publicWorkspaceBody = publicWorkspaceRound3.jsonBody();
    assert.equal(
      JSON.stringify(publicWorkspaceBody.shared_history?.confidential_entries || []).includes(recipientPrivateRound2),
      false,
    );

    const recipientWorkspaceRound3 = await getRecipientWorkspace(round3Token, recipientCookie);
    assert.equal(recipientWorkspaceRound3.statusCode, 200);
    const recipientWorkspaceBody = recipientWorkspaceRound3.jsonBody();
    const round3History = recipientWorkspaceBody.shared_history?.entries || [];
    const round3OwnConfidentialHistory = recipientWorkspaceBody.shared_history?.confidential_entries || [];
    assert.equal(round3History.length >= 3, true);
    assert.equal(round3History[0].round_number, 1);
    assert.equal(round3History[1].round_number, 2);
    assert.equal(round3History[2].round_number, 3);
    assert.equal(String(round3History[0].author_label || ''), 'Proposer');
    assert.equal(String(round3History[1].author_label || ''), 'Recipient');
    assert.equal(String(round3History[2].author_label || ''), 'Proposer');
    assert.equal(String(round3History[0].text || '').includes(proposerSharedRound1), true);
    assert.equal(String(round3History[1].text || '').includes(recipientSharedRound2), true);
    assert.equal(String(round3History[2].text || '').includes(proposerSharedRound3), true);
    assert.equal(round3OwnConfidentialHistory.length >= 1, true);
    assert.equal(
      round3OwnConfidentialHistory.some((entry) => String(entry.text || '').includes(recipientPrivateRound2)),
      true,
    );
    assert.equal(
      round3OwnConfidentialHistory.some((entry) => String(entry.text || '').includes(proposerPrivateRound1)),
      false,
    );
    assert.equal(
      round3OwnConfidentialHistory.some((entry) => String(entry.text || '').includes(proposerPrivateRound3)),
      false,
    );
    assert.equal(JSON.stringify(recipientWorkspaceBody).includes(proposerPrivateRound1), false);
    assert.equal(JSON.stringify(recipientWorkspaceBody).includes(proposerPrivateRound3), false);
    assert.equal(String(recipientWorkspaceBody.party_context?.draft_author_role || ''), 'recipient');
  });

  test('draft save rejects previous-round document references while allowing current-round edits', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('history_guard_owner');
    const recipientCookie = makeRecipientCookie('history_guard_recipient', 'recipient@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'History Guardrails',
      docAText: 'Owner private baseline marker',
      docBText: 'Owner shared baseline marker',
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const round2Save = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared round 2' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Recipient private round 2',
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round2Save.statusCode, 200);

    const round2Send = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
    assert.equal(round2Send.statusCode, 200);

    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token <> ${initialLink.token}
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    assert.notEqual(round2Token, '');

    const ownerWorkspace = await getRecipientWorkspace(round2Token, ownerCookie);
    assert.equal(ownerWorkspace.statusCode, 200);
    const ownerWorkspaceBody = ownerWorkspace.jsonBody();

    const mutatedHistoricalSave = await saveRecipientDraft(round2Token, {
      shared_payload: ownerWorkspaceBody.defaults?.shared_payload || {},
      recipient_confidential_payload: ownerWorkspaceBody.defaults?.recipient_confidential_payload || {},
      workflow_step: 1,
      editor_state: {
        documents: [
          {
            id: 'shared-history-baseline',
            title: 'Round 1 - Shared by Proposer',
            visibility: 'shared',
            owner: 'proposer',
            source: 'typed',
            text: 'MUTATED_HISTORY_SHOULD_BE_REJECTED',
            html: '<p>MUTATED_HISTORY_SHOULD_BE_REJECTED</p>',
            files: [],
          },
        ],
      },
    }, ownerCookie);
    assert.equal(mutatedHistoricalSave.statusCode, 403);
    assert.equal(mutatedHistoricalSave.jsonBody().error.code, 'historical_round_read_only');

    const allowedCurrentRoundSave = await saveRecipientDraft(round2Token, {
      shared_payload: {
        label: 'Shared Information',
        text: 'Owner current-round shared update is allowed.',
      },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Owner current-round confidential update is allowed.',
      },
      workflow_step: 2,
      editor_state: {
        documents: [
          {
            id: 'owner-current-shared-doc',
            title: 'My New Shared Contribution',
            visibility: 'shared',
            owner: 'proposer',
            source: 'typed',
            text: 'Owner current-round shared update is allowed.',
            html: '<p>Owner current-round shared update is allowed.</p>',
            files: [],
          },
          {
            id: 'owner-current-conf-doc',
            title: 'My Confidential Notes',
            visibility: 'confidential',
            owner: 'proposer',
            source: 'typed',
            text: 'Owner current-round confidential update is allowed.',
            html: '<p>Owner current-round confidential update is allowed.</p>',
            files: [],
          },
        ],
      },
    }, ownerCookie);
    assert.equal(allowedCurrentRoundSave.statusCode, 200);
  });

  test('carrying forward prior confidential text appends a new immutable history record without mutating earlier rounds', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('history_clone_owner');
    const recipientCookie = makeRecipientCookie('history_clone_recipient', 'recipient@example.com');
    const round2PrivateMarker = 'RECIPIENT_PRIVATE_ROUND_2_CLONE_MARKER';
    const round4PrivateAddon = 'ROUND_4_PRIVATE_APPEND_MARKER';

    const comparison = await createComparison(ownerCookie, {
      title: 'History Clone Safety',
      docAText: 'Owner private baseline',
      docBText: 'Owner shared baseline',
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const round2Save = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared round 2' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `Recipient private round 2 ${round2PrivateMarker}`,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round2Save.statusCode, 200);

    const round2Send = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
    assert.equal(round2Send.statusCode, 200);

    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token <> ${initialLink.token}
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    assert.notEqual(round2Token, '');

    const ownerRound3Save = await saveRecipientDraft(round2Token, {
      shared_payload: { label: 'Shared Information', text: 'Owner shared round 3' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Owner private round 3',
      },
      workflow_step: 2,
    }, ownerCookie);
    assert.equal(ownerRound3Save.statusCode, 200);

    const ownerRound3Send = await sendBackRecipientDraft(round2Token, {}, ownerCookie);
    assert.equal(ownerRound3Send.statusCode, 200);

    const round3LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token not in (${initialLink.token}, ${round2Token})
          order by created_at desc
          limit 1`,
    );
    const round3Token = String(round3LinkRows.rows[0]?.token || '');
    assert.notEqual(round3Token, '');

    const recipientWorkspaceRound3 = await getRecipientWorkspace(round3Token, recipientCookie);
    assert.equal(recipientWorkspaceRound3.statusCode, 200);
    const recipientWorkspaceBody = recipientWorkspaceRound3.jsonBody();
    const ownHistory = recipientWorkspaceBody.shared_history?.confidential_entries || [];
    assert.equal(
      ownHistory.some((entry) => String(entry.text || '').includes(round2PrivateMarker)),
      true,
    );

    const confidentialRowsBefore = await db.execute(
      sql`select id, sequence_index, round_number, content_payload
          from shared_report_contributions
          where proposal_id = ${comparison.proposal_id}
            and author_role = 'recipient'
            and visibility = 'confidential'
          order by sequence_index asc`,
    );

    const findPayloadText = (row) => {
      const payloadValue = row?.content_payload ?? row?.contentPayload ?? {};
      const payload = (payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue))
        ? payloadValue
        : {};
      return String(payload.text || payload.notes || '');
    };
    const getRoundNumber = (row) => Number(row?.round_number ?? row?.roundNumber ?? 0);
    const getSequenceIndex = (row) => Number(row?.sequence_index ?? row?.sequenceIndex ?? 0);

    const priorRoundEntry = confidentialRowsBefore.rows.find((row) =>
      findPayloadText(row).includes(round2PrivateMarker),
    );
    assert.ok(priorRoundEntry, 'Expected a prior-round recipient confidential history row');
    const priorRoundEntryId = String(priorRoundEntry.id || '');
    const priorRoundEntryText = findPayloadText(priorRoundEntry);
    assert.notEqual(priorRoundEntryId, '');
    assert.equal(getRoundNumber(priorRoundEntry), 2);

    const round4Save = await saveRecipientDraft(round3Token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared round 4 update' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `${priorRoundEntryText}\n${round4PrivateAddon}`,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(round4Save.statusCode, 200);

    const round4Send = await sendBackRecipientDraft(round3Token, {}, recipientCookie);
    assert.equal(round4Send.statusCode, 200);

    const confidentialRowsAfter = await db.execute(
      sql`select id, sequence_index, round_number, content_payload
          from shared_report_contributions
          where proposal_id = ${comparison.proposal_id}
            and author_role = 'recipient'
            and visibility = 'confidential'
          order by sequence_index asc`,
    );

    const priorRoundEntryAfter = confidentialRowsAfter.rows.find(
      (row) => String(row.id || '') === priorRoundEntryId,
    );
    assert.ok(priorRoundEntryAfter, 'Expected original prior-round row to remain present');
    assert.equal(findPayloadText(priorRoundEntryAfter), priorRoundEntryText);
    assert.equal(getRoundNumber(priorRoundEntryAfter), 2);

    const appendedRound4Entry = confidentialRowsAfter.rows.find((row) => {
      if (String(row.id || '') === priorRoundEntryId) {
        return false;
      }
      return findPayloadText(row).includes(round4PrivateAddon);
    });
    assert.ok(appendedRound4Entry, 'Expected a new round-4 confidential history row');
    assert.equal(getRoundNumber(appendedRound4Entry), 4);
    assert.equal(
      getSequenceIndex(appendedRound4Entry) > getSequenceIndex(priorRoundEntryAfter),
      true,
    );
  });

  test('AI mediation inputs preserve authored proposer/recipient provenance for shared and confidential history', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = makeOwnerCookie('history_ai_owner');
    const recipientCookie = makeRecipientCookie('history_ai_recipient', 'recipient@example.com');
    const proposerShared = 'PROPOSER_SHARED_AI_CONTEXT_MARKER';
    const proposerPrivate = 'PROPOSER_PRIVATE_AI_CONTEXT_MARKER';
    const recipientShared = 'RECIPIENT_SHARED_AI_CONTEXT_MARKER';
    const recipientPrivate = 'RECIPIENT_PRIVATE_AI_CONTEXT_MARKER';

    const comparison = await createComparison(ownerCookie, {
      title: 'AI History Provenance',
      docAText: `Owner private baseline ${proposerPrivate}`,
      docBText: `Owner shared baseline ${proposerShared}`,
    });

    const initialLink = await createSharedReportLink(ownerCookie, comparison.id, 'recipient@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 30,
    });

    const saveRecipientRes = await saveRecipientDraft(initialLink.token, {
      shared_payload: { label: 'Shared Information', text: `Recipient shared update ${recipientShared}` },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: `Recipient private update ${recipientPrivate}`,
      },
      workflow_step: 2,
    }, recipientCookie);
    assert.equal(saveRecipientRes.statusCode, 200);

    const capturedInputs = [];
    const previousEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async (input) => {
      capturedInputs.push(input);
      return {
        report: {
          recommendation: 'review',
          executive_summary: 'Structured authored history was received.',
          sections: [{ heading: 'Summary', bullets: ['History context available.'] }],
        },
        evaluation_provider: 'test',
        similarity_score: 70,
      };
    };

    try {
      const recipientEvaluateRes = await evaluateRecipientDraft(initialLink.token, {}, recipientCookie);
      assert.equal(recipientEvaluateRes.statusCode, 200);
      assert.equal(capturedInputs.length >= 1, true);

      const recipientEvalInput = capturedInputs[0];
      assert.equal(String(recipientEvalInput.docBText || '').includes('Authored by Proposer'), true);
      assert.equal(String(recipientEvalInput.docBText || '').includes(proposerShared), true);
      assert.equal(String(recipientEvalInput.docBText || '').includes('Authored by Recipient'), true);
      assert.equal(String(recipientEvalInput.docBText || '').includes(recipientShared), true);
      assert.equal(String(recipientEvalInput.docAText || '').includes(proposerPrivate), true);
      assert.equal(String(recipientEvalInput.docAText || '').includes(recipientPrivate), true);

      const db = getDb();
      const evalRunRows = await db.execute(
        sql`select result_json
            from shared_report_evaluation_runs
            where proposal_id = ${comparison.proposal_id}
            order by created_at desc
            limit 1`,
      );
      const authoredHistory = evalRunRows.rows[0]?.result_json?.authored_history || {};
      assert.equal(Array.isArray(authoredHistory.shared), true);
      assert.equal(Array.isArray(authoredHistory.confidential), true);
      assert.equal(authoredHistory.shared.some((entry) => String(entry.author_role || '') === 'proposer'), true);
      assert.equal(authoredHistory.shared.some((entry) => String(entry.author_role || '') === 'recipient'), true);
      assert.equal(authoredHistory.confidential.some((entry) => String(entry.author_role || '') === 'proposer'), true);
      assert.equal(authoredHistory.confidential.some((entry) => String(entry.author_role || '') === 'recipient'), true);

      const sendRound2 = await sendBackRecipientDraft(initialLink.token, {}, recipientCookie);
      assert.equal(sendRound2.statusCode, 200);

      capturedInputs.length = 0;
      const ownerEvaluateRes = await evaluateComparison(comparison.id, ownerCookie, {});
      assert.equal(ownerEvaluateRes.statusCode, 200);
      assert.equal(capturedInputs.length >= 1, true);

      const ownerEvalInput = capturedInputs[capturedInputs.length - 1];
      assert.equal(String(ownerEvalInput.docBText || '').includes(proposerShared), true);
      assert.equal(String(ownerEvalInput.docBText || '').includes(recipientShared), true);
      assert.equal(String(ownerEvalInput.docAText || '').includes(proposerPrivate), true);
      assert.equal(String(ownerEvalInput.docAText || '').includes(recipientPrivate), true);

      const ownerInputTrace = ownerEvaluateRes.jsonBody().evaluation_input_trace || {};
      assert.equal(Number(ownerInputTrace.authored_shared_entries || 0) >= 2, true);
      assert.equal(Number(ownerInputTrace.authored_confidential_entries || 0) >= 2, true);
    } finally {
      if (previousEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvaluator;
      }
    }
  });
}
