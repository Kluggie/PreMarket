import assert from 'node:assert/strict';
import test from 'node:test';
import apiHandler from '../../api/index.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
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

function invokeApiIndex({ method, path, headers = {}, body = undefined }) {
  const req = createMockReq({
    method,
    url: `/api/index?path=${encodeURIComponent(path)}`,
    headers,
    body,
  });
  const res = createMockRes();
  return apiHandler(req, res).then(() => res);
}

test('GET /api/shared-report/:token/evaluate reaches route registration and returns method_not_allowed', async () => {
  const res = await invokeApiIndex({
    method: 'GET',
    path: 'shared-report/test-token/evaluate',
  });
  const body = res.jsonBody();

  assert.equal(res.statusCode, 405);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'method_not_allowed');
  assert.deepEqual(body.error?.allow, ['POST']);
});

test('POST /api/shared-report/:token/evaluate dispatches to the evaluate route instead of falling through as not_found', async () => {
  const res = await invokeApiIndex({
    method: 'POST',
    path: 'shared-report/test-token/evaluate',
  });
  const body = res.jsonBody();

  assert.notEqual(res.statusCode, 404);
  assert.notEqual(body.error?.code, 'not_found');
  assert.notEqual(body.error?.message, 'Route not found');
});

if (!hasDatabaseUrl()) {
  test('POST /api/shared-report/:token/evaluate reaches evaluator path (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('POST /api/shared-report/:token/evaluate reaches evaluator path', async () => {
    await ensureMigrated();
    await resetTables();

    const seed = 'shared_report_evaluate_router_post';
    const ownerCookie = makeOwnerCookie(seed);
    const recipientEmail = `${seed}_recipient@example.com`;
    const recipientCookie = makeRecipientCookie(seed, recipientEmail);

    const createComparisonRes = await invokeApiIndex({
      method: 'POST',
      path: 'document-comparisons',
      headers: { cookie: ownerCookie },
      body: {
        title: 'Shared Report Evaluate Router Test',
        createProposal: true,
        docAText: 'Private proposer notes for route coverage.',
        docBText: 'Shared proposer draft long enough for route coverage and mediation evaluation setup.',
      },
    });
    assert.equal(createComparisonRes.statusCode, 201);
    const comparison = createComparisonRes.jsonBody().comparison;
    assert.ok(comparison?.id);

    const createLinkRes = await invokeApiIndex({
      method: 'POST',
      path: 'sharedReports',
      headers: { cookie: ownerCookie },
      body: {
        comparisonId: comparison.id,
        recipientEmail,
        canView: true,
        canEdit: true,
        canEditConfidential: true,
        canReevaluate: true,
      },
    });
    assert.equal(createLinkRes.statusCode, 201);
    const link = createLinkRes.jsonBody();
    assert.ok(link?.token);

    const saveDraftRes = await invokeApiIndex({
      method: 'POST',
      path: `shared-report/${link.token}/draft`,
      headers: { cookie: recipientCookie },
      body: {
        shared_payload: {
          label: 'Shared Information',
          text: 'Recipient adds meaningful shared terms for bilateral mediation, including responsibilities, timing, and commercial points.',
        },
        recipient_confidential_payload: {
          label: 'Confidential Information',
          notes: 'Recipient confidential notes stay private.',
        },
        workflow_step: 2,
      },
    });
    assert.equal(saveDraftRes.statusCode, 200);

    const previousEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    let evaluatorCalls = 0;
    globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => {
      evaluatorCalls += 1;
      return {
        report: {
          recommendation: 'review',
          executive_summary: 'Recipient contribution received through API router.',
          sections: [{ heading: 'Summary', bullets: ['Recipient contribution received.'] }],
        },
        evaluation_provider: 'test',
        similarity_score: 68,
      };
    };

    try {
      const evaluateRes = await invokeApiIndex({
        method: 'POST',
        path: `shared-report/${link.token}/evaluate`,
        headers: { cookie: recipientCookie },
        body: {},
      });
      assert.equal(evaluateRes.statusCode, 200);
      assert.equal(evaluatorCalls, 1);
      assert.equal(evaluateRes.jsonBody()?.evaluation?.status, 'success');
    } finally {
      if (previousEvaluator === undefined) {
        delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
      } else {
        globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = previousEvaluator;
      }
    }
  });
}
