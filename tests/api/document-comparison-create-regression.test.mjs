import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import apiHandler from '../../api/index.ts';
import { getDb, schema } from '../../server/_lib/db/client.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

function createApiRequest({ method = 'GET', path = '', body = undefined, cookie = '', query = {} } = {}) {
  const queryRecord = {
    path,
    ...query,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryRecord)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.set(key, String(value));
  }

  return createMockReq({
    method,
    url: `/api${params.toString() ? `?${params.toString()}` : ''}`,
    query: queryRecord,
    headers: cookie ? { cookie } : {},
    body,
  });
}

if (!hasDatabaseUrl()) {
  test('document comparison create regression (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('POST /api/document-comparisons returns 401 unauthenticated (not 500)', async () => {
    await ensureMigrated();
    await resetTables();

    const req = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      body: { title: 'Should fail without auth' },
    });
    const res = createMockRes();

    await apiHandler(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody().ok, false);
    assert.equal(res.jsonBody().error?.code, 'unauthorized');
  });

  test('Continue-to-editor create path persists draft payload and sanitizes html safely', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('doc_create_owner', 'owner@example.com');

    const createReq = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      cookie,
      body: {
        title: 'Continue Regression',
        draft_step: 2,
        createProposal: true,
        doc_a_text: 'Confidential draft text',
        doc_b_text: 'Shared draft text',
        doc_a_html: '<p>Confidential draft text</p><script>alert("x")</script>',
        doc_b_html: '<a href="javascript:alert(1)">bad</a><p>Shared draft text</p>',
      },
    });
    const createRes = createMockRes();
    await apiHandler(createReq, createRes);

    assert.equal(createRes.statusCode, 201);
    const created = createRes.jsonBody().comparison;
    assert.equal(Boolean(created?.id), true);
    assert.equal(created.title, 'Continue Regression');
    assert.equal(created.draft_step, 2);
    assert.equal(String(created.doc_a_html || '').includes('<script'), false);
    assert.equal(String(created.doc_b_html || '').includes('javascript:'), false);

    const comparisonId = created.id;
    const loadReq = createApiRequest({
      method: 'GET',
      path: `document-comparisons/${comparisonId}`,
      cookie,
      query: { id: comparisonId },
    });
    const loadRes = createMockRes();
    await apiHandler(loadReq, loadRes);

    assert.equal(loadRes.statusCode, 200);
    assert.equal(loadRes.jsonBody().comparison.id, comparisonId);
    assert.equal(loadRes.jsonBody().comparison.draft_step, 2);
    assert.equal(loadRes.jsonBody().comparison.title, 'Continue Regression');
  });

  test('POST /api/document-comparisons returns structured 404 for invalid linked proposal', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('doc_create_owner_2', 'owner2@example.com');
    const req = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      cookie,
      body: {
        title: 'Invalid linked proposal',
        proposalId: 'proposal_does_not_exist',
      },
    });
    const res = createMockRes();
    await apiHandler(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.jsonBody().ok, false);
    assert.equal(res.jsonBody().error?.code, 'proposal_not_found');
  });

  test('Step 2 save payload persists through Step 3 failure and reloads after refresh', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('doc_step2_owner', 'step2-owner@example.com');

    const createReq = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      cookie,
      body: {
        title: 'Step 2 Persistence',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await apiHandler(createReq, createRes);
    assert.equal(createRes.statusCode, 201);
    const comparisonId = String(createRes.jsonBody().comparison?.id || '');
    const createdUpdatedAtMs = Date.parse(String(createRes.jsonBody().comparison?.updated_date || ''));
    assert.equal(Boolean(comparisonId), true);
    assert.equal(Number.isFinite(createdUpdatedAtMs), true);

    const latestDocAJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Latest confidential clause text.' }],
        },
      ],
    };
    const latestDocBJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Latest shared clause text.' }],
        },
      ],
    };

    const step2PatchReq = createApiRequest({
      method: 'PATCH',
      path: `document-comparisons/${comparisonId}`,
      cookie,
      query: { id: comparisonId },
      body: {
        title: 'Step 2 Persistence Updated',
        draft_step: 2,
        doc_a_text: 'Latest confidential clause text.',
        doc_b_text: 'Latest shared clause text.',
        doc_a_html: '<p>Latest confidential clause text.</p>',
        doc_b_html: '<p>Latest shared clause text.</p>',
        doc_a_json: latestDocAJson,
        doc_b_json: latestDocBJson,
        doc_a_source: 'typed',
        doc_b_source: 'typed',
        doc_a_files: [{ filename: 'confidential.docx', mimeType: 'application/docx', sizeBytes: 123 }],
        doc_b_files: [{ filename: 'shared.docx', mimeType: 'application/docx', sizeBytes: 456 }],
      },
    });
    const step2PatchRes = createMockRes();
    await apiHandler(step2PatchReq, step2PatchRes);
    assert.equal(step2PatchRes.statusCode, 200);
    assert.equal(step2PatchRes.jsonBody().comparison.doc_a_text, 'Latest confidential clause text.');
    assert.equal(step2PatchRes.jsonBody().comparison.doc_b_text, 'Latest shared clause text.');
    assert.equal(step2PatchRes.jsonBody().comparison.draft_step, 2);
    const savedUpdatedAtMs = Date.parse(String(step2PatchRes.jsonBody().comparison.updated_date || ''));
    assert.equal(Number.isFinite(savedUpdatedAtMs), true);
    assert.equal(savedUpdatedAtMs >= createdUpdatedAtMs, true);

    const failEvalReq = createApiRequest({
      method: 'POST',
      path: `document-comparisons/${comparisonId}/evaluate`,
      cookie,
      query: { id: comparisonId },
      body: {
        // Force deterministic validation failure to emulate Step 3 failure.
        doc_a_text: 'a',
        doc_b_text: 'b',
      },
    });
    const failEvalRes = createMockRes();
    await apiHandler(failEvalReq, failEvalRes);
    assert.equal(failEvalRes.statusCode, 400);
    assert.equal(failEvalRes.jsonBody().error?.code, 'invalid_input');

    const backToStep2Req = createApiRequest({
      method: 'GET',
      path: `document-comparisons/${comparisonId}`,
      cookie,
      query: { id: comparisonId },
    });
    const backToStep2Res = createMockRes();
    await apiHandler(backToStep2Req, backToStep2Res);
    assert.equal(backToStep2Res.statusCode, 200);
    assert.equal(backToStep2Res.jsonBody().comparison.doc_a_text, 'Latest confidential clause text.');
    assert.equal(backToStep2Res.jsonBody().comparison.doc_b_text, 'Latest shared clause text.');
    assert.equal(backToStep2Res.jsonBody().comparison.doc_a_html, '<p>Latest confidential clause text.</p>');
    assert.equal(backToStep2Res.jsonBody().comparison.doc_b_html, '<p>Latest shared clause text.</p>');
    assert.deepEqual(backToStep2Res.jsonBody().comparison.doc_a_json, latestDocAJson);
    assert.deepEqual(backToStep2Res.jsonBody().comparison.doc_b_json, latestDocBJson);

    const refreshReq = createApiRequest({
      method: 'GET',
      path: `document-comparisons/${comparisonId}`,
      cookie,
      query: { id: comparisonId },
    });
    const refreshRes = createMockRes();
    await apiHandler(refreshReq, refreshRes);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshRes.jsonBody().comparison.doc_a_text, 'Latest confidential clause text.');
    assert.equal(refreshRes.jsonBody().comparison.doc_b_text, 'Latest shared clause text.');
  });

  test('Opportunities list prefers the saved comparison title over a stale Untitled placeholder and keeps row metadata', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('doc_title_sync_owner', 'title-sync-owner@example.com');

    const createReq = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      cookie,
      body: {
        title: '',
        createProposal: true,
        draft_step: 1,
        recipient_email: 'vendor@example.com',
      },
    });
    const createRes = createMockRes();
    await apiHandler(createReq, createRes);

    assert.equal(createRes.statusCode, 201);
    const comparison = createRes.jsonBody().comparison;
    const comparisonId = String(comparison?.id || '');
    const proposalId = String(comparison?.proposal_id || '');
    assert.equal(Boolean(comparisonId), true);
    assert.equal(Boolean(proposalId), true);
    assert.equal(comparison.title, 'Untitled');

    const patchReq = createApiRequest({
      method: 'PATCH',
      path: `document-comparisons/${comparisonId}`,
      cookie,
      query: { id: comparisonId },
      body: {
        title: 'AI Customer Support Automation Proposal',
        draft_step: 2,
        recipient_email: 'vendor@example.com',
      },
    });
    const patchRes = createMockRes();
    await apiHandler(patchReq, patchRes);
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.jsonBody().comparison.title, 'AI Customer Support Automation Proposal');

    const db = getDb();
    await db
      .update(schema.proposals)
      .set({ title: 'Untitled' })
      .where(eq(schema.proposals.id, proposalId));

    const listReq = createApiRequest({
      method: 'GET',
      path: 'proposals',
      cookie,
    });
    const listRes = createMockRes();
    await apiHandler(listReq, listRes);

    assert.equal(listRes.statusCode, 200);
    const listRow = listRes.jsonBody().proposals.find((entry) => entry.id === proposalId);
    assert.ok(listRow, 'expected linked proposal row in /api/proposals');
    assert.equal(listRow.title, 'AI Customer Support Automation Proposal');
    assert.notEqual(listRow.title, 'Untitled');
    assert.equal(listRow.document_comparison_id, comparisonId);
    assert.equal(listRow.draft_step, 2);
    assert.equal(listRow.recipient_email, 'vendor@example.com');
  });

  test('Opportunities list keeps Untitled fallback when the saved title is still blank', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = authCookie('doc_title_blank_owner', 'title-blank-owner@example.com');

    const createReq = createApiRequest({
      method: 'POST',
      path: 'document-comparisons',
      cookie,
      body: {
        title: '',
        createProposal: true,
      },
    });
    const createRes = createMockRes();
    await apiHandler(createReq, createRes);

    assert.equal(createRes.statusCode, 201);
    const comparison = createRes.jsonBody().comparison;
    const proposalId = String(comparison?.proposal_id || '');
    assert.equal(Boolean(proposalId), true);
    assert.equal(comparison.title, 'Untitled');

    const listReq = createApiRequest({
      method: 'GET',
      path: 'proposals',
      cookie,
    });
    const listRes = createMockRes();
    await apiHandler(listReq, listRes);

    assert.equal(listRes.statusCode, 200);
    const listRow = listRes.jsonBody().proposals.find((entry) => entry.id === proposalId);
    assert.ok(listRow, 'expected linked proposal row in /api/proposals');
    assert.equal(listRow.title, 'Untitled');
    assert.equal(listRow.document_comparison_id, comparison.id);
  });

  test('Template list/use routes return auth errors and success states without 500s', async () => {
    await ensureMigrated();
    await resetTables();

    const unauthListReq = createApiRequest({
      method: 'GET',
      path: 'templates',
    });
    const unauthListRes = createMockRes();
    await apiHandler(unauthListReq, unauthListRes);
    assert.equal(unauthListRes.statusCode, 401);
    assert.equal(unauthListRes.jsonBody().error?.code, 'unauthorized');

    const cookie = authCookie('template_owner_regression', 'template-owner@example.com');
    const listReq = createApiRequest({
      method: 'GET',
      path: 'templates',
      cookie,
    });
    const listRes = createMockRes();
    await apiHandler(listReq, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(Array.isArray(listRes.jsonBody().templates), true);
    assert.equal(listRes.jsonBody().templates.length > 0, true);

    const templateId = listRes.jsonBody().templates[0].id;
    const unauthUseReq = createApiRequest({
      method: 'POST',
      path: `templates/${templateId}/use`,
      body: { title: 'Unauthorized template use' },
      query: { id: templateId },
    });
    const unauthUseRes = createMockRes();
    await apiHandler(unauthUseReq, unauthUseRes);
    assert.equal(unauthUseRes.statusCode, 401);
    assert.equal(unauthUseRes.jsonBody().error?.code, 'unauthorized');

    const useReq = createApiRequest({
      method: 'POST',
      path: `templates/${templateId}/use`,
      cookie,
      body: {
        title: 'Template Regression Draft',
      },
      query: { id: templateId },
    });
    const useRes = createMockRes();
    await apiHandler(useReq, useRes);
    assert.equal([200, 201].includes(useRes.statusCode), true);
    assert.equal(Boolean(useRes.jsonBody().proposal?.id), true);
  });
}
