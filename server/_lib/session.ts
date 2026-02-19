import { createHmac } from 'node:crypto';
import { appendSetCookie, parseCookies, serializeCookie } from './http.js';

export const SESSION_COOKIE_NAME = 'pm_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  hd?: string;
  iat: number;
  exp: number;
};

type SessionUser = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  hd?: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(input: string, secret: string) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function createSessionToken(user: SessionUser, secret: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
    hd: user.hd,
    iat: issuedAt,
    exp: issuedAt + maxAgeSeconds,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);

  if (expectedSignature !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;

    if (!payload?.sub || !payload?.email || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: any, secret: string) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  return verifySessionToken(token, secret);
}

export function setSessionCookie(res: any, sessionToken: string, secure: boolean) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    }),
  );
}

export function clearSessionCookie(res: any, secure: boolean) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(0),
      maxAgeSeconds: 0,
    }),
  );
}
