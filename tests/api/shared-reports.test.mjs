import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import apiHandler from '../../api/index.ts';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentComparisonsEvaluateHandler from '../../server/routes/document-comparisons/[id]/evaluate.ts';
import resendWebhookHandler from '../../server/routes/resendWebhook.ts';
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

async function sendSharedReportEmail(cookie, token, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/sharedReports/${token}/send`,
    headers: { cookie },
    query: { token },
    body: {
      recipientEmail,
    },
  });
  const res = createMockRes();
  await sharedReportsSendHandler(req, res, token);
  return res;
}

async function listSharedReports(cookie, comparisonId) {
  const req = createMockReq({
    method: 'GET',
    url: '/api/sharedReports',
    headers: { cookie },
    query: {
      comparisonId,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  assert.equal(res.statusCode, 200);
  return res.jsonBody();
}

async function invokeApiIndex({ method, path, headers = {}, body = undefined }) {
  const req = createMockReq({
    method,
    url: `/api/index?path=${encodeURIComponent(path)}`,
    headers,
    body,
  });
  const res = createMockRes();
  await apiHandler(req, res);
  return res;
}

function buildResendWebhookHeaders(payload, secret, timestamp = Math.floor(Date.now() / 1000), svixId = 'msg_shared_report_test') {
  const secretPayload = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const secretBytes = Buffer.from(secretPayload, 'base64');
  const signature = createHmac('sha256', secretBytes)
    .update(`${svixId}.${timestamp}.${payload}`)
    .digest('base64');

  return {
    'svix-id': svixId,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  };
}

async function postResendWebhook(
  event,
  secret,
  {
    timestamp = Math.floor(Date.now() / 1000),
    svixId = 'msg_shared_report_test',
    viaApiIndex = false,
  } = {},
) {
  const payload = JSON.stringify(event);
  const headers = buildResendWebhookHeaders(payload, secret, timestamp, svixId);

  if (viaApiIndex) {
    return invokeApiIndex({
      method: 'POST',
      path: 'resendWebhook',
      headers,
      body: payload,
    });
  }

  const req = createMockReq({
    method: 'POST',
    url: '/api/resendWebhook',
    headers,
    body: payload,
  });
  const res = createMockRes();
  await resendWebhookHandler(req, res);
  return res;
}

test('POST /api/resendWebhook dispatches through api/index and rejects unsigned requests instead of 404', async () => {
  const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;

  try {
    const res = await invokeApiIndex({
      method: 'POST',
      path: 'resendWebhook',
      body: '{}',
    });
    const body = res.jsonBody();

    assert.equal(res.statusCode, 400);
    assert.equal(body.error?.code, 'invalid_signature');
  } finally {
    if (originalWebhookSecret !== undefined) {
      process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
    } else {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }
  }
});

if (!hasDatabaseUrl()) {
  test('shared reports workflow integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('shared report links default recipient-triggered AI mediation to disabled', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_default_guard_owner', 'default.guard.owner@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Default Guard Report',
      docAText: 'Private owner context for billing guardrails.',
      docBText: 'Shared opportunity context for the recipient.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    assert.equal(createdShare.sharedReport?.can_reevaluate, false);
    assert.equal(createdShare.sharedReport?.allow_recipient_ai_review, false);
  });

  test('evaluation uses confidential context while shared token response remains recipient-safe', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_owner', 'owner@example.com');
    const comparisonOwnerCookie = authCookie('shared_report_compare_owner', 'compare.owner@example.com');
    const confidentialMarker = 'zephyr vault trigger ninety seven';

    const lowSimilarity = await createComparison(ownerCookie, {
      title: 'Confidential Context A',
      docAText: `${confidentialMarker} with internal settlement thresholds and private counterparty risk notes.`,
      docBText: 'Shared obligations include payment terms and delivery milestones for both parties.',
    });

    const highSimilarity = await createComparison(comparisonOwnerCookie, {
      title: 'Confidential Context B',
      docAText: 'Shared obligations include payment terms and delivery milestones for both parties.',
      docBText: 'Shared obligations include payment terms and delivery milestones for both parties.',
    });

    const evaluatedLow = await evaluateComparison(ownerCookie, lowSimilarity.id);
    const evaluatedHigh = await evaluateComparison(comparisonOwnerCookie, highSimilarity.id);

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

    const ownerCookie = authCookie('shared_report_sender', 'shared-report-sender@example.com');
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
      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 501);
      assert.equal(sendRes.jsonBody().error.code, 'not_configured');

      const listPayload = await listSharedReports(ownerCookie, comparison.id);
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

  test('shared report send rejects malformed recipient email before calling Resend', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_invalid_email', 'shared-report-invalid@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Invalid Recipient Email',
      docAText: 'Confidential context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    let resendCalls = 0;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com/emails')) {
          resendCalls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_should_not_be_called' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(ownerCookie, createdShare.token, 'not-an-email');

      assert.equal(sendRes.statusCode, 400);
      assert.equal(sendRes.jsonBody().error.code, 'invalid_input');
      assert.equal(
        String(sendRes.jsonBody().error.message || ''),
        'A valid recipientEmail is required',
      );
      assert.equal(resendCalls, 0, 'invalid email should be rejected before provider send');
    } finally {
      globalThis.fetch = originalFetch;
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
    }
  });

  test('shared report send uses proposal-first email template with contextual subject and summary preview', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_template_owner', 'shared-report-template@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: '3',
      docAText: 'Confidential internal details that should never appear in recipient summaries.',
      docBText:
        'A two-phase project to build a unified revenue operations, billing, and usage reporting layer for executive and operations teams. Phase one establishes data governance and pipeline reliability. Phase two delivers stakeholder dashboards and approval workflows.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalFromName = process.env.RESEND_FROM_NAME;
    const originalReplyTo = process.env.RESEND_REPLY_TO;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    let capturedPayload = null;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          capturedPayload = JSON.parse(String(init?.body || '{}'));
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_template_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');
      assert.equal(Boolean(capturedPayload), true);

      const subject = String(capturedPayload?.subject || '');
      assert.equal(subject === '3', false);
      assert.equal(subject.includes('3'), true);
      assert.equal(subject.toLowerCase().includes('opportunity'), true);
      assert.equal(subject.toLowerCase().includes('invited'), true);

      const text = String(capturedPayload?.text || '');
      assert.equal(text.includes('invited you to review an opportunity on PreMarket'), true);
      assert.equal(text.includes('Opportunity\n3'), true);
      assert.equal(text.includes('Summary'), true);
      assert.equal(text.includes('Review Opportunity:'), true);
      assert.equal(text.toLowerCase().includes('shared a report'), false);
      assert.equal(text.includes('Open Shared Report'), false);
      assert.equal(text.includes('Shared by:'), false);

      const summaryMatch = text.match(/Summary\n(.+)\n\nReview Opportunity:/);
      assert.equal(Boolean(summaryMatch && summaryMatch[1]), true);
      assert.equal(String(summaryMatch?.[1] || '').length <= 183, true);

      const html = String(capturedPayload?.html || '');
      assert.equal(html.includes('Review Opportunity'), true);
      assert.equal(html.includes('Summary'), true);
      assert.equal(html.includes('invited you to review an opportunity'), true);
      assert.equal(html.includes('Open Shared Report'), false);
      assert.equal(html.toLowerCase().includes('shared a report'), false);
      assert.equal(html.includes('Shared by:'), false);
    } finally {
      globalThis.fetch = originalFetch;

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

  test('shared report send avoids system-label summaries and falls back to recipient-safe language', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_summary_owner', 'shared-report-summary@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Label Summary Test',
      docAText: 'Confidential details that must never appear in recipient-facing email copy.',
      docBText: 'Document comparison workflow',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalFromName = process.env.RESEND_FROM_NAME;
    const originalReplyTo = process.env.RESEND_REPLY_TO;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    let capturedPayload = null;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          capturedPayload = JSON.parse(String(init?.body || '{}'));
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_summary_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );
      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const text = String(capturedPayload?.text || '');
      const summaryMatch = text.match(/Summary\n(.+)\n\nReview Opportunity:/);
      const preview = String(summaryMatch?.[1] || '').trim();
      assert.equal(preview.toLowerCase().includes('document comparison workflow'), false);
      assert.equal(
        preview,
        'An opportunity has been shared with you for review on PreMarket.',
      );
    } finally {
      globalThis.fetch = originalFetch;

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

  test('shared report delivery stays queued until a verified delivered webhook arrives', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_delivery_queued', 'shared-report-delivery-queued@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Queued Delivery Report',
      docAText: 'Private context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const webhookSecret = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_delivery_queued_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const queuedList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(queuedList.sharedReports[0]?.last_delivery?.status, 'queued');

      const webhookRes = await postResendWebhook(
        {
          type: 'email.delivered',
          created_at: new Date().toISOString(),
          data: {
            email_id: 'resend_delivery_queued_test',
            message_id: '<delivery-queued@example.com>',
            to: ['recipient@example.com'],
            subject: 'Queued Delivery Report',
          },
        },
        webhookSecret,
      );

      assert.equal(webhookRes.statusCode, 200);

      const deliveredList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(deliveredList.sharedReports[0]?.last_delivery?.status, 'delivered');
      assert.equal(deliveredList.sharedReports[0]?.last_delivery?.last_error, null);
    } finally {
      globalThis.fetch = originalFetch;

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

      if (originalWebhookSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
      } else {
        delete process.env.RESEND_WEBHOOK_SECRET;
      }
    }
  });

  test('verified Resend bounce webhook marks the shared report delivery as bounced', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_delivery_bounced', 'shared-report-delivery-bounced@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Bounced Delivery Report',
      docAText: 'Private context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const webhookSecret = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;
    const bounceMessage = 'Mailbox unavailable';

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_delivery_bounce_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const webhookRes = await postResendWebhook(
        {
          type: 'email.bounced',
          created_at: new Date().toISOString(),
          data: {
            email_id: 'resend_delivery_bounce_test',
            message_id: '<delivery-bounced@example.com>',
            to: ['recipient@example.com'],
            subject: 'Bounced Delivery Report',
            bounce: {
              message: bounceMessage,
              subType: 'Suppressed',
              type: 'Permanent',
            },
          },
        },
        webhookSecret,
      );

      assert.equal(webhookRes.statusCode, 200);

      const bouncedList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(bouncedList.sharedReports[0]?.last_delivery?.status, 'bounced');
      assert.equal(bouncedList.sharedReports[0]?.last_delivery?.last_error, bounceMessage);
    } finally {
      globalThis.fetch = originalFetch;

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

      if (originalWebhookSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
      } else {
        delete process.env.RESEND_WEBHOOK_SECRET;
      }
    }
  });

  test('verified Resend failed webhook marks the shared report delivery as failed', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_delivery_failed', 'shared-report-delivery-failed@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Failed Delivery Report',
      docAText: 'Private context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const webhookSecret = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;
    const failureReason = 'Provider suppressed recipient';

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_delivery_failed_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const webhookRes = await postResendWebhook(
        {
          type: 'email.failed',
          created_at: new Date().toISOString(),
          data: {
            email_id: 'resend_delivery_failed_test',
            message_id: '<delivery-failed@example.com>',
            to: ['recipient@example.com'],
            subject: 'Failed Delivery Report',
            failed: {
              reason: failureReason,
            },
          },
        },
        webhookSecret,
      );

      assert.equal(webhookRes.statusCode, 200);

      const failedList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(failedList.sharedReports[0]?.last_delivery?.status, 'failed');
      assert.equal(failedList.sharedReports[0]?.last_delivery?.last_error, failureReason);
    } finally {
      globalThis.fetch = originalFetch;

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

      if (originalWebhookSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
      } else {
        delete process.env.RESEND_WEBHOOK_SECRET;
      }
    }
  });

  test('duplicate Resend webhook retries are ignored after delivery is recorded', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_delivery_duplicate', 'shared-report-delivery-duplicate@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Duplicate Delivery Report',
      docAText: 'Private context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const webhookSecret = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;
    const deliveredAt = new Date().toISOString();

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_delivery_duplicate_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const firstWebhookRes = await postResendWebhook(
        {
          type: 'email.delivered',
          created_at: deliveredAt,
          data: {
            email_id: 'resend_delivery_duplicate_test',
            message_id: '<delivery-duplicate@example.com>',
            to: ['recipient@example.com'],
            subject: 'Duplicate Delivery Report',
          },
        },
        webhookSecret,
        {
          svixId: 'duplicate_delivery_event',
          viaApiIndex: true,
        },
      );

      assert.equal(firstWebhookRes.statusCode, 200);
      assert.equal(firstWebhookRes.jsonBody().ignored, undefined);

      const duplicateWebhookRes = await postResendWebhook(
        {
          type: 'email.delivered',
          created_at: deliveredAt,
          data: {
            email_id: 'resend_delivery_duplicate_test',
            message_id: '<delivery-duplicate@example.com>',
            to: ['recipient@example.com'],
            subject: 'Duplicate Delivery Report',
          },
        },
        webhookSecret,
        {
          svixId: 'duplicate_delivery_event',
          viaApiIndex: true,
        },
      );

      assert.equal(duplicateWebhookRes.statusCode, 200);
      assert.equal(duplicateWebhookRes.jsonBody().ignored, true);

      const deliveredList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(deliveredList.sharedReports[0]?.last_delivery?.status, 'delivered');
    } finally {
      globalThis.fetch = originalFetch;

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

      if (originalWebhookSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
      } else {
        delete process.env.RESEND_WEBHOOK_SECRET;
      }
    }
  });

  test('later terminal webhook events do not overwrite an existing terminal delivery status', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerCookie = authCookie('shared_report_delivery_terminal_lock', 'shared-report-delivery-terminal-lock@example.com');
    const comparison = await createComparison(ownerCookie, {
      title: 'Terminal Delivery Report',
      docAText: 'Private context.',
      docBText: 'Shared report text for recipient consumption.',
    });

    const createdShare = await createSharedReportLink(
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFromEmail = process.env.RESEND_FROM_EMAIL;
    const originalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    const webhookSecret = `whsec_${Buffer.from('shared-report-webhook-secret').toString('base64')}`;
    const bouncedAt = new Date().toISOString();
    const deliveredLaterAt = new Date(Date.now() + 60_000).toISOString();

    process.env.RESEND_API_KEY = 'test_resend_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@mail.getpremarket.com';
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('api.resend.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'resend_delivery_terminal_lock_test' }),
          };
        }
        return originalFetch.call(globalThis, url, init);
      };

      const sendRes = await sendSharedReportEmail(
        ownerCookie,
        createdShare.token,
        'recipient@example.com',
      );

      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.jsonBody().delivery?.status, 'queued');

      const bouncedWebhookRes = await postResendWebhook(
        {
          type: 'email.bounced',
          created_at: bouncedAt,
          data: {
            email_id: 'resend_delivery_terminal_lock_test',
            message_id: '<delivery-terminal-lock@example.com>',
            to: ['recipient@example.com'],
            subject: 'Terminal Delivery Report',
            bounce: {
              message: 'Mailbox unavailable',
              subType: 'General',
              type: 'Permanent',
            },
          },
        },
        webhookSecret,
      );

      assert.equal(bouncedWebhookRes.statusCode, 200);

      const conflictingWebhookRes = await postResendWebhook(
        {
          type: 'email.delivered',
          created_at: deliveredLaterAt,
          data: {
            email_id: 'resend_delivery_terminal_lock_test',
            message_id: '<delivery-terminal-lock@example.com>',
            to: ['recipient@example.com'],
            subject: 'Terminal Delivery Report',
          },
        },
        webhookSecret,
      );

      assert.equal(conflictingWebhookRes.statusCode, 200);
      assert.equal(conflictingWebhookRes.jsonBody().ignored, true);

      const bouncedList = await listSharedReports(ownerCookie, comparison.id);
      assert.equal(bouncedList.sharedReports[0]?.last_delivery?.status, 'bounced');
      assert.equal(bouncedList.sharedReports[0]?.last_delivery?.last_error, 'Mailbox unavailable');
    } finally {
      globalThis.fetch = originalFetch;

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

      if (originalWebhookSecret !== undefined) {
        process.env.RESEND_WEBHOOK_SECRET = originalWebhookSecret;
      } else {
        delete process.env.RESEND_WEBHOOK_SECRET;
      }
    }
  });
}
