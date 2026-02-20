import assert from 'node:assert/strict';

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').trim();

if (!baseUrl.startsWith('http://localhost:3000')) {
  throw new Error(`API_BASE_URL must point to localhost:3000, got: ${baseUrl}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    body,
  };
}

function assertStatus(actual, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];

  assert.equal(
    allowed.includes(actual),
    true,
    `${label}: expected ${allowed.join(' or ')}, got ${actual}`,
  );
}

async function run() {
  const health = await request('/api/health');
  assertStatus(health.status, 200, 'GET /api/health');

  const stripeInvalid = await request('/api/stripeWebhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1700000000,v1=invalid',
    },
    body: JSON.stringify({ id: 'evt_test', type: 'test.event', data: { object: {} } }),
  });
  assertStatus(stripeInvalid.status, 400, 'POST /api/stripeWebhook invalid signature');

  const emailUnauthed = await request('/api/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: 'recipient@example.com',
      subject: 'Smoke',
      text: 'Smoke test',
    }),
  });
  assertStatus(emailUnauthed.status, [401, 500, 501], 'POST /api/email/send unauthenticated');

  const vertexUnauthed = await request('/api/vertex/smoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: 'Reply: ok' }),
  });
  assertStatus(vertexUnauthed.status, [401, 500, 501], 'POST /api/vertex/smoke unauthenticated');

  const proposalsUnauthed = await request('/api/proposals');
  assertStatus(proposalsUnauthed.status, [401, 500], 'GET /api/proposals unauthenticated');

  console.log('Local API smoke tests passed (localhost-only, no external provider calls).');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
