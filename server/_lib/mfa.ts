import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb, schema } from './db/client.js';
import { ApiError } from './errors.js';
import { asText } from './security.js';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MFA_RATE_LIMIT_USER_MAX_FAILS = 10;
const MFA_RATE_LIMIT_SESSION_MAX_FAILS = 5;

function getMfaEncryptionKey() {
  const raw = asText(process.env.MFA_ENCRYPTION_KEY);
  if (!raw) {
    throw new ApiError(503, 'not_configured', 'MFA encryption key is not configured');
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  return createHash('sha256').update(raw).digest();
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < input.length; i += 1) {
    value = (value << 8) | input[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string) {
  const normalized = asText(input).toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const index = BASE32_ALPHABET.indexOf(normalized[i]);
    if (index < 0) {
      continue;
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

function normalizeTotpCode(value: unknown) {
  return asText(value).replace(/\s+/g, '');
}

function toCounterBuffer(counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

function computeTotp(secretBase32: string, unixTimeSeconds: number) {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(unixTimeSeconds / TOTP_STEP_SECONDS);
  const digest = createHmac('sha1', secret).update(toCounterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const codeInt =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(codeInt % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function buildOtpAuthUri(params: {
  secret: string;
  accountLabel: string;
  issuer?: string;
}) {
  const issuer = asText(params.issuer) || 'PreMarket';
  const accountLabel = asText(params.accountLabel) || 'user';
  const encodedLabel = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${encodedLabel}?secret=${encodeURIComponent(params.secret)}&issuer=${encodeURIComponent(
    issuer,
  )}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

export function generateCurrentTotpCode(secretBase32: string, date = new Date()) {
  return computeTotp(secretBase32, Math.floor(date.getTime() / 1000));
}

export function verifyTotpCode(params: {
  secretBase32: string;
  code: string;
  date?: Date;
  window?: number;
}) {
  const normalizedCode = normalizeTotpCode(params.code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const nowSeconds = Math.floor((params.date || new Date()).getTime() / 1000);
  const window = Number.isFinite(Number(params.window)) ? Math.max(0, Number(params.window)) : 1;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = computeTotp(params.secretBase32, nowSeconds + offset * TOTP_STEP_SECONDS);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(normalizedCode))) {
      return true;
    }
  }

  return false;
}

export function encryptMfaSecret(secretBase32: string) {
  const key = getMfaEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptMfaSecret(payload: string) {
  const key = getMfaEncryptionKey();
  const parts = asText(payload).split('.');
  if (parts.length !== 3) {
    throw new ApiError(500, 'mfa_secret_invalid', 'Stored MFA secret is invalid');
  }

  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new ApiError(500, 'mfa_secret_invalid', 'Stored MFA secret is invalid');
  }
}

function normalizeBackupCode(value: unknown) {
  return asText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashBackupCodeNormalized(codeNormalized: string, saltHex: string) {
  return scryptSync(codeNormalized, Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

export function hashBackupCode(code: string) {
  const normalized = normalizeBackupCode(code);
  if (!normalized) {
    throw new ApiError(400, 'invalid_input', 'Backup code is required');
  }
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = hashBackupCodeNormalized(normalized, saltHex);
  return `scrypt$${saltHex}$${hashHex}`;
}

function verifyHashedBackupCode(candidate: string, hashed: string) {
  const parts = asText(hashed).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const [_, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actualHex = hashBackupCodeNormalized(normalizeBackupCode(candidate), saltHex);
  const actual = Buffer.from(actualHex, 'hex');

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function generateBackupCodes(count = 10) {
  const size = Math.min(Math.max(Math.floor(Number(count || 10)), 1), 20);
  const codes: string[] = [];
  for (let i = 0; i < size; i += 1) {
    const raw = randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function hashBackupCodes(codes: string[]) {
  return (Array.isArray(codes) ? codes : []).map((code) => hashBackupCode(code));
}

export function consumeBackupCode(hashedCodesInput: unknown, codeInput: string) {
  const hashedCodes = Array.isArray(hashedCodesInput)
    ? hashedCodesInput.map((entry) => asText(entry)).filter(Boolean)
    : [];
  const normalizedInput = normalizeBackupCode(codeInput);
  if (!normalizedInput) {
    return {
      matched: false,
      nextHashedCodes: hashedCodes,
    };
  }

  for (let index = 0; index < hashedCodes.length; index += 1) {
    if (!verifyHashedBackupCode(normalizedInput, hashedCodes[index])) {
      continue;
    }
    return {
      matched: true,
      nextHashedCodes: [...hashedCodes.slice(0, index), ...hashedCodes.slice(index + 1)],
    };
  }

  return {
    matched: false,
    nextHashedCodes: hashedCodes,
  };
}

export async function assertMfaChallengeRateLimit(params: {
  userId: string;
  sessionId: string;
  now?: Date;
}) {
  const db = getDb();
  const now = params.now || new Date();
  const windowStart = new Date(now.getTime() - MFA_RATE_LIMIT_WINDOW_MS);
  const userId = asText(params.userId);
  const sessionId = asText(params.sessionId);

  const [userCounter] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.userId, userId),
        eq(schema.auditEvents.eventType, 'auth.mfa.challenge.fail'),
        gt(schema.auditEvents.createdAt, windowStart),
      ),
    );

  const sessionCounterResult = await db.execute(sql`
    select count(*)::int as count
    from audit_events
    where user_id = ${userId}
      and event_type = 'auth.mfa.challenge.fail'
      and created_at > ${windowStart}
      and coalesce(metadata->>'session_id', '') = ${sessionId}
  `);

  const userFails = Number(userCounter?.count || 0);
  const sessionFails = Number((sessionCounterResult as any)?.rows?.[0]?.count || 0);

  if (userFails >= MFA_RATE_LIMIT_USER_MAX_FAILS || sessionFails >= MFA_RATE_LIMIT_SESSION_MAX_FAILS) {
    throw new ApiError(429, 'rate_limited', 'Too many MFA attempts. Please try again shortly.');
  }
}
