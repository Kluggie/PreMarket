import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import stripeWebhookHandler from '../../server/routes/stripeWebhook.ts';
import emailSendHandler from '../../server/routes/email/send.ts';
import vertexSmokeHandler from '../../server/routes/vertex/smoke.ts';
import healthHandler from '../../server/routes/health.ts';
import healthVertexHandler from '../../server/routes/health/vertex.ts';
import { parseVertexServiceAccountEnv } from '../../server/_lib/integrations.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, getDb, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
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

test('vertex config parser supports base64 payloads and escaped private-key newlines', () => {
  const original = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const originalGoogle = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const originalVertex = process.env.VERTEX_SERVICE_ACCOUNT_JSON;

  try {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.VERTEX_SERVICE_ACCOUNT_JSON;

    const serviceAccount = {
      type: 'service_account',
      project_id: 'test-project',
      private_key: '-----BEGIN PRIVATE KEY-----\\\\nline-1\\\\n-----END PRIVATE KEY-----\\\\n',
      client_email: 'svc@test-project.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
    };

    process.env.GCP_SERVICE_ACCOUNT_JSON = Buffer.from(
      JSON.stringify(serviceAccount),
      'utf8',
    ).toString('base64');

    const parsed = parseVertexServiceAccountEnv();
    assert.equal(parsed.ok, true);
    assert.equal(parsed.serviceAccountJsonPresent, true);
    assert.equal(parsed.sourceEnvKey, 'GCP_SERVICE_ACCOUNT_JSON');
    assert.equal(parsed.credentials.private_key.includes('\\n'), false);
    assert.equal(parsed.credentials.private_key.includes('\n'), true);
  } finally {
    if (original === undefined) {
      delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GCP_SERVICE_ACCOUNT_JSON = original;
    }

    if (originalGoogle === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalGoogle;
    }

    if (originalVertex === undefined) {
      delete process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.VERTEX_SERVICE_ACCOUNT_JSON = originalVertex;
    }
  }
});

test('health vertex endpoint exposes safe readiness snapshot', async () => {
  const req = createMockReq({
    method: 'GET',
    url: '/api/health/vertex',
  });
  const res = createMockRes();
  await healthVertexHandler(req, res);

  assert.equal(res.statusCode, 200);
  const payload = res.jsonBody();
  assert.equal(typeof payload.vertexConfigured, 'boolean');
  assert.equal(typeof payload.serviceAccountJsonPresent, 'boolean');
  assert.equal(typeof payload.parsedServiceAccountOk, 'boolean');
  assert.equal(typeof payload.projectIdPresent, 'boolean');
  assert.equal(typeof payload.vertexRegionPresent, 'boolean');
  assert.equal('private_key' in payload, false);
});

if (!hasDatabaseUrl()) {
  test('phase3 integration routes (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('email and vertex routes pass authenticated smoke tests', async () => {
    await ensureMigrated();
    await resetTables();

    const healthReq = createMockReq({
      method: 'GET',
      url: '/api/health',
    });
    const healthRes = createMockRes();
    await healthHandler(healthReq, healthRes);

    assert.equal([200, 500].includes(healthRes.statusCode), true);
    const healthPayload = healthRes.jsonBody();
    const integrations = healthPayload?.integrations || {};
    const resendReady = Boolean(integrations.resendEnvPresent);
    const vertexReady = Boolean(integrations.vertexCredsPresentAndParsable);

    const authCookie = makeSessionCookie({
      sub: 'integration_user',
      email: 'integration@example.com',
    });
    const db = getDb();
    const previousEmailMode = process.env.EMAIL_MODE;
    process.env.EMAIL_MODE = 'transactional';

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

      return originalFetch(url, options);
    };

    try {
      const emailReq = createMockReq({
        method: 'POST',
        url: '/api/email/send',
        headers: { cookie: authCookie },
        body: {
          category: 'shared_link_activity',
          dedupeKey: 'shared_link_activity:integration_smoke:v1',
          to: 'recipient@example.com',
          subject: 'Phase 3 email test',
          text: 'hello world',
        },
      });
      const emailRes = createMockRes();

      const usersBeforeEmail = await db.execute(sql`select count(*)::int as count from users`);
      const countBeforeEmail = Number(usersBeforeEmail.rows?.[0]?.count || 0);

      await emailSendHandler(emailReq, emailRes);

      if (resendReady) {
        assert.equal(emailRes.statusCode, 200);
        assert.equal(emailRes.jsonBody().ok, true);
      } else {
        assert.equal(emailRes.statusCode, 501);
        const body = emailRes.jsonBody();
        assert.equal(body.ok, false);
        assert.equal(body.error.code, 'not_configured');

        const usersAfterEmail = await db.execute(sql`select count(*)::int as count from users`);
        assert.equal(Number(usersAfterEmail.rows?.[0]?.count || 0), countBeforeEmail);
      }

      const vertexReq = createMockReq({
        method: 'POST',
        url: '/api/vertex/smoke',
        headers: { cookie: authCookie },
        body: {
          prompt: 'Respond with: ok',
        },
      });
      const vertexRes = createMockRes();
      const usersBeforeVertex = await db.execute(sql`select count(*)::int as count from users`);
      const countBeforeVertex = Number(usersBeforeVertex.rows?.[0]?.count || 0);

      await vertexSmokeHandler(vertexReq, vertexRes);

      if (vertexReady) {
        assert.equal(vertexRes.statusCode, 200);
        const vertexPayload = vertexRes.jsonBody();
        assert.equal(vertexPayload.ok, true);
        assert.equal(vertexPayload.result.text, 'vertex smoke test ok');
      } else {
        assert.equal(vertexRes.statusCode, 501);
        const body = vertexRes.jsonBody();
        assert.equal(body.ok, false);
        assert.equal(body.error.code, 'not_configured');

        const usersAfterVertex = await db.execute(sql`select count(*)::int as count from users`);
        assert.equal(Number(usersAfterVertex.rows?.[0]?.count || 0), countBeforeVertex);
      }

      if (resendReady || vertexReady) {
        assert.equal(fetchCalls.length >= 1, true);
      }
    } finally {
      if (previousEmailMode === undefined) {
        delete process.env.EMAIL_MODE;
      } else {
        process.env.EMAIL_MODE = previousEmailMode;
      }
      global.fetch = originalFetch;
    }
  });
}
