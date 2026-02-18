import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function makeSessionCookie({ sub, email, name = 'Test User' }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is required for tests');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    email,
    name,
    iat: issuedAt,
    exp: issuedAt + 60 * 60,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return `pm_session=${encoded}.${signature}`;
}

export function ensureTestEnv() {
  if (!process.env.APP_BASE_URL) {
    process.env.APP_BASE_URL = 'http://localhost:3000';
  }

  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = 'test-session-secret';
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  }
}
