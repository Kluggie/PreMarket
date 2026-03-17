import { createHash } from 'node:crypto';

const MAX_USER_AGENT_LENGTH = 300;

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the best available client IP for security-sensitive purposes
 * (rate limiting, session fingerprinting, audit logging).
 *
 * Trust order:
 *  1. x-real-ip          — set by Vercel edge / nginx, never forwarded from the
 *                          client, cannot be spoofed.
 *  2. Rightmost x-forwarded-for entry — in a single-proxy topology (Vercel) the
 *                          edge appends the real client IP to the right of any
 *                          caller-supplied header, so rightmost is trustworthy.
 *  3. req.socket.remoteAddress — direct TCP address; correct in local dev when
 *                          no proxy is in front.
 *
 * Why not leftmost XFF?  A caller can craft "X-Forwarded-For: injected-ip" and
 * the proxy appends the real IP to the right, yielding "injected-ip, real-ip".
 * Taking [0] gives the attacker-controlled value and defeats any IP-based
 * enforcement (rate limits, lockouts, fingerprints).
 */
export function clientIpForRateLimit(req: any): string {
  // 1. x-real-ip (Vercel/nginx trusted header — not propagated from the client).
  const realIp = asText(req?.headers?.['x-real-ip']);
  if (realIp) return realIp;

  // 2. Rightmost x-forwarded-for entry (appended by the edge/proxy, not the client).
  const xff = asText(req?.headers?.['x-forwarded-for']);
  if (xff) {
    const parts = xff.split(',');
    const rightmost = asText(parts[parts.length - 1]);
    if (rightmost) return rightmost;
  }

  // 3. Socket address — used in local dev where no proxy is in front.
  const socket = asText(req?.socket?.remoteAddress);
  if (socket) return socket;

  return 'unknown';
}

export function normalizeClientIp(req: any) {
  return clientIpForRateLimit(req);
}

function getIpHashSalt() {
  const explicit = asText(process.env.SESSION_IP_SALT);
  if (explicit) {
    return explicit;
  }
  return asText(process.env.SESSION_SECRET);
}

export function hashIpAddress(ip: string | null | undefined) {
  const normalizedIp = asText(ip);
  if (!normalizedIp) {
    return null;
  }

  const salt = getIpHashSalt();
  if (!salt) {
    return null;
  }

  return createHash('sha256')
    .update(`${salt}:${normalizedIp}`)
    .digest('hex');
}

export function hashRequestIp(req: any) {
  return hashIpAddress(normalizeClientIp(req));
}

export function normalizeUserAgent(value: unknown, maxLength = MAX_USER_AGENT_LENGTH) {
  const ua = asText(value);
  if (!ua) {
    return null;
  }
  return ua.slice(0, Math.max(32, maxLength));
}

export function getRequestUserAgent(req: any) {
  return normalizeUserAgent(req?.headers?.['user-agent']);
}
