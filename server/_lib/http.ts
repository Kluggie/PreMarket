import { timingSafeEqual } from 'node:crypto';

export function json(res: any, statusCode: number, body: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res: any, allowed: string[]) {
  res.statusCode = 405;
  res.setHeader('Allow', allowed.join(', '));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'method_not_allowed' }));
}

export async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  if (!req?.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }

  if (typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }

  return {};
}

export function parseCookies(req: any): Record<string, string> {
  const cookieHeader = req?.headers?.cookie;

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  return cookieHeader.split(';').reduce((cookies, part) => {
    const [rawKey, ...rawValueParts] = part.trim().split('=');

    if (!rawKey) {
      return cookies;
    }

    cookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawValueParts.join('=') || '');
    return cookies;
  }, {} as Record<string, string>);
}

export function appendSetCookie(res: any, cookieValue: string) {
  const current = res.getHeader('Set-Cookie');

  if (!current) {
    res.setHeader('Set-Cookie', [cookieValue]);
    return;
  }

  const next = Array.isArray(current) ? [...current, cookieValue] : [String(current), cookieValue];
  res.setHeader('Set-Cookie', next);
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    maxAgeSeconds?: number;
    expires?: Date;
  } = {},
) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (typeof options.maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  parts.push(`Path=${options.path || '/'}`);

  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  parts.push(`SameSite=${options.sameSite || 'Lax'}`);

  return parts.join('; ');
}

export function constantTimeEquals(a: string, b: string) {
  const aBuffer = Buffer.from(a || '');
  const bBuffer = Buffer.from(b || '');

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function getRequestHost(req: any) {
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const hostHeader = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req?.headers?.host || '';

  return String(hostHeader).split(',')[0].trim().toLowerCase();
}

export function getRequestProtocol(req: any) {
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const protoHeader = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || '';

  const normalized = String(protoHeader).split(',')[0].trim().toLowerCase();

  if (normalized === 'http' || normalized === 'https') {
    return normalized;
  }

  return 'https';
}
