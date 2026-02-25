import assert from 'node:assert/strict';
import test from 'node:test';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportsTokenHandler from '../../server/routes/shared-reports/[token].ts';
import sharedReportsSendHandler from '../../server/routes/shared-reports/[token]/send.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();
if (!process.env.VERTEX_MOCK) {
  process.env.VERTEX_MOCK = '1';
}

function authCookie(sub, email) {
  return makeSessionCookie({ sub, email });
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

async function evaluateComparison(cookie, comparisonId) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/document-comparisons/${comparisonId}/evaluate`,
    headers: { cookie },
    query: { id: comparisonId },
    body: {},
  });
  const res = createMockRes();
  await documentComparisonsEvaluateHandler(req, res, comparisonId);
  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

async function createSharedReportLink(cookie, comparisonId, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 201);
  return res.jsonBody();
}

if (!hasDatabaseUrl()) {
  test('shared reports workflow integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('evaluation uses confidential context while shared token response remains recipient-safe', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_owner', 'owner@example.com');
    const confidentialMarker = 'zephyr vault trigger ninety seven';

    const lowSimilarity = await createComparison(ownerCookie, {
      title: 'Confidential Context A',
      docAText: `${confidentialMarker} with internal settlement thresholds and private counterparty risk notes.`,
      docBText: 'Shared obligations include payment terms and delivery milestones for both parties.',
    });

    const highSimilarity = await createComparison(ownerCookie, {
      title: 'Confidential Context B',
      docAText: 'Shared obligations include payment terms and delivery milestones for both parties.',
      docBText: 'Shared obligations include payment terms and delivery milestones for both parties.',
    });

    const evaluatedLow = await evaluateComparison(ownerCookie, lowSimilarity.id);
    const evaluatedHigh = await evaluateComparison(ownerCookie, highSimilarity.id);

    const lowSimilarityScore = Number(evaluatedLow.evaluation?.similarity_score || 0);
    const highSimilarityScore = Number(evaluatedHigh.evaluation?.similarity_score || 0);
    assert.equal(highSimilarityScore >= lowSimilarityScore, true);

    const createdShare = await createSharedReportLink(
      ownerCookie,
      lowSimilarity.id,
      'recipient@example.com',
    );

    const readReq = createMockReq({
      method: 'GET',
      url: `/api/sharedReports/${createdShare.token}`,
      query: { token: createdShare.token },
    });
    const readRes = createMockRes();
    await sharedReportsTokenHandler(readReq, readRes, createdShare.token);

    assert.equal(readRes.statusCode, 200);
    const readBody = readRes.jsonBody();
    const sharedReport = readBody.sharedReport;

    assert.equal(
      String(sharedReport.shared_content?.text || '').includes('Shared obligations include payment terms'),
      true,
    );
    assert.equal(Object.prototype.hasOwnProperty.call(sharedReport, 'confidential_content'), false);

    const serializedPayload = JSON.stringify(readBody).toLowerCase();
    assert.equal(serializedPayload.includes(confidentialMarker), false);
    assert.equal(serializedPayload.includes('internal settlement thresholds'), false);
  });

  test('shared report send returns 501 when Resend is not configured and persists delivery log', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_sender', 'sender@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Delivery Log Report',
      docAText: 'Private context that should stay server side only.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalFromName = process.env.RESEND_FROM_NAME;
    const originalReplyTo = process.env.RESEND_REPLY_TO;

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_NAME;
    delete process.env.RESEND_REPLY_TO;

    try {
      const sendReq = createMockReq({
        method: 'POST',
        url: `/api/sharedReports/${createdShare.token}/send`,
        headers: { cookie: ownerCookie },
        query: { token: createdShare.token },
        body: {
          recipientEmail: 'recipient@example.com',
        },
      });
      const sendRes = createMockRes();
      await sharedReportsSendHandler(sendReq, sendRes, createdShare.token);

      assert.equal(sendRes.statusCode, 501);
      assert.equal(sendRes.jsonBody().error.code, 'not_configured');

      const listReq = createMockReq({
        method: 'GET',
        url: '/api/sharedReports',
        headers: { cookie: ownerCookie },
        query: {
          comparisonId: comparison.id,
        },
      });
      const listRes = createMockRes();
      await sharedReportsHandler(listReq, listRes);

      assert.equal(listRes.statusCode, 200);
      const listPayload = listRes.jsonBody();
      const latest = Array.isArray(listPayload.sharedReports) ? listPayload.sharedReports[0] : null;
      assert.equal(Boolean(latest), true);
      assert.equal(Array.isArray(latest.deliveries), true);
      assert.equal(latest.deliveries.length >= 1, true);
      assert.equal(latest.deliveries[0].status, 'failed');
    } finally {
      if (originalApiKey !== undefined) {
        process.env.RESEND_API_KEY = originalApiKey;
      } else {
        delete process.env.RESEND_API_KEY;
      }

      if (originalFromEmail !== undefined) {
        process.env.RESEND_FROM_EMAIL = originalFromEmail;
      } else {
        delete process.env.RESEND_FROM_EMAIL;
      }

      if (originalFromName !== undefined) {
        process.env.RESEND_FROM_NAME = originalFromName;
      } else {
        delete process.env.RESEND_FROM_NAME;
      }

      if (originalReplyTo !== undefined) {
        process.env.RESEND_REPLY_TO = originalReplyTo;
      } else {
        delete process.env.RESEND_REPLY_TO;
      }
    }
  });
}
