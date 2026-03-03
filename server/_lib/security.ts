import { createHash } from 'node:crypto';

const MAX_USER_AGENT_LENGTH = 300;

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeClientIp(req: any) {
  const forwarded = asText(req?.headers?.['x-forwarded-for']);
  if (forwarded) {
    return asText(forwarded.split(',')[0]);
  }
  return asText(req?.socket?.remoteAddress);
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
