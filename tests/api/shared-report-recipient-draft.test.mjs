import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedLinksHandler from '../../server/routes/shared-links/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportRecipientTokenHandler from '../../server/routes/shared-report/[token].ts';
import sharedReportRecipientDraftHandler from '../../server/routes/shared-report/[token]/draft.ts';
import sharedReportRecipientEvaluateHandler from '../../server/routes/shared-report/[token]/evaluate.ts';
import sharedReportRecipientSendBackHandler from '../../server/routes/shared-report/[token]/send-back.ts';
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

async function evaluateRecipientDraft(token, body = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/evaluate`,
    query: { token },
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientEvaluateHandler(req, res, token);
  return res;
}

async function sendBackRecipientDraft(token, body = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/shared-report/${token}/send-back`,
    query: { token },
    body,
  });
  const res = createMockRes();
  await sharedReportRecipientSendBackHandler(req, res, token);
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

    // max uses reached: GET workspace intentionally consumes a view (consumeView: true).
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

  test('Prompt2 evaluate is public and permission-gated by can_reevaluate', async () => {
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

    const disallowedRes = await evaluateRecipientDraft(disallowed.token);
    assert.equal(disallowedRes.statusCode, 403);
    assert.equal(disallowedRes.jsonBody().error.code, 'reevaluation_not_allowed');

    const allowed = await createSharedReportLink(ownerCookie, comparison.id, 'recipient2@example.com', {
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
    });

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
      const allowedRes = await evaluateRecipientDraft(allowed.token);
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

    const noDraftRes = await sendBackRecipientDraft(link.token);
    assert.equal(noDraftRes.statusCode, 400);
    assert.equal(noDraftRes.jsonBody().error.code, 'draft_required');

    const saveRes = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared revision for proposer.' },
      recipient_confidential_payload: {
        label: 'Confidential Information',
        notes: 'Recipient private terms for internal use.',
      },
      workflow_step: 2,
    });
    assert.equal(saveRes.statusCode, 200);

    const sendRes = await sendBackRecipientDraft(link.token);
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
    });
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
      const evaluateRes = await evaluateRecipientDraft(link.token);
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

    const save1 = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared v1' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient private v1' },
      workflow_step: 2,
    });
    assert.equal(save1.statusCode, 200);

    const send1 = await sendBackRecipientDraft(link.token);
    assert.equal(send1.statusCode, 200);
    const firstRevisionId = String(send1.jsonBody().revision_id || '');
    assert.notEqual(firstRevisionId, '');
    assert.equal(send1.jsonBody().status, 'sent');

    const save2 = await saveRecipientDraft(link.token, {
      shared_payload: { label: 'Shared Information', text: 'Recipient shared v2' },
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'Recipient private v2' },
      workflow_step: 2,
    });
    assert.equal(save2.statusCode, 200);

    const send2 = await sendBackRecipientDraft(link.token);
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
    });
    assert.equal(rejectSharedEdit.statusCode, 403);
    assert.equal(rejectSharedEdit.jsonBody().error.code, 'edit_not_allowed');

    const rejectConfidentialEdit = await saveRecipientDraft(viewOnlyLink.token, {
      shared_payload: workspace.defaults?.shared_payload || {},
      recipient_confidential_payload: { label: 'Confidential Information', notes: 'mutated private should fail' },
    });
    assert.equal(rejectConfidentialEdit.statusCode, 403);
    assert.equal(rejectConfidentialEdit.jsonBody().error.code, 'confidential_edit_not_allowed');

    const evaluateRes = await evaluateRecipientDraft(viewOnlyLink.token);
    assert.equal(evaluateRes.statusCode, 403);
    assert.equal(evaluateRes.jsonBody().error.code, 'reevaluation_not_allowed');

    const sendBackRes = await sendBackRecipientDraft(viewOnlyLink.token);
    assert.equal(sendBackRes.statusCode, 403);
    assert.equal(sendBackRes.jsonBody().error.code, 'send_back_not_allowed');
  });
}
