import { createHmac, randomBytes } from 'node:crypto';
import { appendSetCookie, constantTimeEquals, parseCookies, serializeCookie } from './http.js';

export const CSRF_COOKIE_NAME = 'pm_csrf';
const CSRF_MAX_AGE_SECONDS = 60 * 15;

type CsrfPayload = {
  nonce: string;
  exp: number;
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

export function mintCsrfToken(secret: string) {
  const payload: CsrfPayload = {
    nonce: randomBytes(32).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + CSRF_MAX_AGE_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function isValidCsrfToken(token: string, secret: string) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = sign(encodedPayload, secret);

  if (!constantTimeEquals(expectedSignature, signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as CsrfPayload;
    return Boolean(payload?.exp && payload.exp >= Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}

export function setCsrfCookie(res: any, token: string, secure: boolean) {
  appendSetCookie(
    res,
    serializeCookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: CSRF_MAX_AGE_SECONDS,
    }),
  );
}

export function clearCsrfCookie(res: any, secure: boolean) {
  appendSetCookie(
    res,
    serializeCookie(CSRF_COOKIE_NAME, '', {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(0),
      maxAgeSeconds: 0,
    }),
  );
}

export function validateCsrf(req: any, providedToken: unknown, secret: string) {
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }

  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME];

  if (!cookieToken) {
    return false;
  }

  if (!constantTimeEquals(cookieToken, providedToken)) {
    return false;
  }

  return isValidCsrfToken(cookieToken, secret);
}
