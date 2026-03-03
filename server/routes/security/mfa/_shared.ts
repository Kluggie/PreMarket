import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { consumeBackupCode, decryptMfaSecret, verifyTotpCode } from '../../../_lib/mfa.js';

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toHashedCodeList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export async function isUserVerified(userId: string) {
  const db = getDb();
  const [profile] = await db
    .select({
      emailVerified: schema.userProfiles.emailVerified,
      verificationStatus: schema.userProfiles.verificationStatus,
    })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);

  return Boolean(profile?.emailVerified || profile?.verificationStatus === 'verified');
}

export async function getUserMfaRow(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.userMfa)
    .where(eq(schema.userMfa.userId, userId))
    .limit(1);
  return row || null;
}

export function isMfaEnabledRow(row: any) {
  return Boolean(row?.enabledAt && row?.totpSecretEncrypted);
}

export function evaluateMfaCode(params: {
  userMfaRow: any;
  codeInput: string;
  allowBackup?: boolean;
}) {
  const row = params.userMfaRow;
  if (!isMfaEnabledRow(row)) {
    return {
      valid: false,
      method: null,
      nextBackupCodes: toHashedCodeList(row?.backupCodesHashed),
    };
  }

  const secret = decryptMfaSecret(row.totpSecretEncrypted);
  const codeInput = asText(params.codeInput);
  const allowBackup = params.allowBackup !== false;
  const hashedCodes = toHashedCodeList(row.backupCodesHashed);

  if (verifyTotpCode({ secretBase32: secret, code: codeInput })) {
    return {
      valid: true,
      method: 'totp',
      nextBackupCodes: hashedCodes,
    };
  }

  if (!allowBackup) {
    return {
      valid: false,
      method: null,
      nextBackupCodes: hashedCodes,
    };
  }

  const consumed = consumeBackupCode(hashedCodes, codeInput);
  if (!consumed.matched) {
    return {
      valid: false,
      method: null,
      nextBackupCodes: hashedCodes,
    };
  }

  return {
    valid: true,
    method: 'backup',
    nextBackupCodes: consumed.nextHashedCodes,
  };
}

export function assertMfaEnabled(row: any) {
  if (!isMfaEnabledRow(row)) {
    throw new ApiError(400, 'mfa_not_enabled', 'Two-factor authentication is not enabled');
  }
}
