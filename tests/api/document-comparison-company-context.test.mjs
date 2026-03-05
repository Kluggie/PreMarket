import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonIdHandler from '../../server/routes/document-comparisons/[id].ts';
import documentComparisonCompanyContextHandler from '../../server/routes/document-comparisons/[id]/company-context.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
}

async function createComparison(ownerCookie, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie: ownerCookie },
    body: {
      title: 'Company Context Persistence Test',
      doc_a_text: 'Confidential baseline.',
      doc_b_text: 'Shared baseline.',
      ...overrides,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody().comparison.id;
}

if (!hasDatabaseUrl()) {
  test(
    'document comparison company context tests (skipped: DATABASE_URL missing)',
    { skip: true },
    () => {},
  );
} else {
  test('PATCH company-context persists fields and returns updated context', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('company_context_owner', 'company-context-owner@example.com');
    const comparisonId = await createComparison(ownerCookie);

    const patchReq = createMockReq({
      method: 'PATCH',
      url: `/api/document-comparisons/${comparisonId}/company-context`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
      body: {
        companyName: 'Acme Holdings',
        website: 'acme.example.com',
      },
    });
    const patchRes = createMockRes();
    await documentComparisonCompanyContextHandler(patchReq, patchRes, comparisonId);

    assert.equal(patchRes.statusCode, 200);
    const patchBody = patchRes.jsonBody();
    assert.equal(patchBody?.company_context?.company_name, 'Acme Holdings');
    assert.equal(patchBody?.company_context?.company_website, 'https://acme.example.com');

    const getReq = createMockReq({
      method: 'GET',
      url: `/api/document-comparisons/${comparisonId}`,
      headers: { cookie: ownerCookie },
      query: { id: comparisonId },
    });
    const getRes = createMockRes();
    await documentComparisonIdHandler(getReq, getRes, comparisonId);

    assert.equal(getRes.statusCode, 200);
    const comparison = getRes.jsonBody().comparison;
    assert.equal(comparison.company_name, 'Acme Holdings');
    assert.equal(comparison.company_website, 'https://acme.example.com');
  });
}
