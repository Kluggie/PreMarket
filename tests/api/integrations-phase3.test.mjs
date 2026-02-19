import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import stripeWebhookHandler from '../../server/routes/stripeWebhook.ts';
import emailSendHandler from '../../server/routes/email/send.ts';
import vertexSmokeHandler from '../../server/routes/vertex/smoke.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

test('stripe webhook rejects invalid signatures', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'test_whsec';

  const req = createMockReq({
    method: 'POST',
    url: '/api/stripeWebhook',
    headers: {
      'stripe-signature': 't=1700000000,v1=invalid',
      'x-request-id': 'test_req_invalid',
    },
    body: JSON.stringify({
      id: 'evt_invalid',
      type: 'test.event',
      data: { object: {} },
    }),
  });

  const res = createMockRes();
  await stripeWebhookHandler(req, res);

  assert.equal(res.statusCode, 400);
  const payload = res.jsonBody();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'invalid_signature');
});

test('stripe webhook accepts valid signatures', async () => {
  const secret = 'test_whsec_valid';
  process.env.STRIPE_WEBHOOK_SECRET = secret;

  const body = JSON.stringify({
    id: 'evt_valid',
    type: 'test.event',
    data: { object: {} },
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const req = createMockReq({
    method: 'POST',
    url: '/api/stripeWebhook',
    headers: {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
      'x-request-id': 'test_req_valid',
    },
    body,
  });

  const res = createMockRes();
  await stripeWebhookHandler(req, res);

  assert.equal(res.statusCode, 200);
  const payload = res.jsonBody();
  assert.equal(payload.ok, true);
});

if (!hasDatabaseUrl()) {
  test('phase3 integration routes (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('email and vertex routes pass authenticated smoke tests', async () => {
    await ensureMigrated();
    await resetTables();

    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'no-reply@getpremarket.com';
    process.env.RESEND_FROM_NAME = 'PreMarket';
    process.env.RESEND_REPLY_TO = 'support@getpremarket.com';

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

    process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: 'service_account',
      project_id: 'premarket-test',
      private_key: privateKeyPem,
      client_email: 'vertex-test@premarket-test.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    process.env.VERTEX_LOCATION = 'us-central1';
    process.env.VERTEX_MODEL = 'gemini-1.5-flash-002';

    const authCookie = makeSessionCookie({
      sub: 'integration_user',
      email: 'integration@example.com',
    });

    const originalFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = async (url, options) => {
      const normalizedUrl = String(url || '');
      fetchCalls.push({ url: normalizedUrl, options });

      if (normalizedUrl === 'https://api.resend.com/emails') {
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 'email_123' };
          },
        };
      }

      if (normalizedUrl === 'https://oauth2.googleapis.com/token') {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: 'ya29.test-token' };
          },
        };
      }

      if (normalizedUrl.includes('-aiplatform.googleapis.com/')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'vertex smoke test ok' }],
                  },
                },
              ],
            };
          },
        };
      }

      return {
        ok: false,
        status: 404,
        async json() {
          return {};
        },
      };
    };

    try {
      const emailReq = createMockReq({
        method: 'POST',
        url: '/api/email/send',
        headers: { cookie: authCookie },
        body: {
          to: 'recipient@example.com',
          subject: 'Phase 3 email test',
          text: 'hello world',
        },
      });
      const emailRes = createMockRes();

      await emailSendHandler(emailReq, emailRes);

      assert.equal(emailRes.statusCode, 200);
      assert.equal(emailRes.jsonBody().ok, true);

      const vertexReq = createMockReq({
        method: 'POST',
        url: '/api/vertex/smoke',
        headers: { cookie: authCookie },
        body: {
          prompt: 'Respond with: ok',
        },
      });
      const vertexRes = createMockRes();

      await vertexSmokeHandler(vertexReq, vertexRes);

      assert.equal(vertexRes.statusCode, 200);
      const vertexPayload = vertexRes.jsonBody();
      assert.equal(vertexPayload.ok, true);
      assert.equal(vertexPayload.result.text, 'vertex smoke test ok');
      assert.equal(fetchCalls.length >= 3, true);
    } finally {
      global.fetch = originalFetch;
    }
  });
}
