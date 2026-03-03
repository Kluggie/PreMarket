import { eq } from 'drizzle-orm';
import { ok } from '../../../../_lib/api-response.js';
import { requireUser } from '../../../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../../../_lib/audit-events.js';
import { getDb, schema } from '../../../../_lib/db/client.js';
import { ApiError } from '../../../../_lib/errors.js';
import { buildOtpAuthUri, encryptMfaSecret, generateTotpSecret } from '../../../../_lib/mfa.js';
import { ensureMethod, withApiRoute } from '../../../../_lib/route.js';
import { isMfaEnabledRow, isUserVerified } from '../_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/enroll/start', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const verified = await isUserVerified(auth.user.id);
    if (!verified) {
      throw new ApiError(403, 'verification_required', 'Verify your account to enable 2FA');
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.userMfa)
      .where(eq(schema.userMfa.userId, auth.user.id))
      .limit(1);

    if (isMfaEnabledRow(existing)) {
      throw new ApiError(409, 'mfa_already_enabled', 'Two-factor authentication is already enabled');
    }

    const now = new Date();
    const secret = generateTotpSecret();
    const encryptedSecret = encryptMfaSecret(secret);
    const otpauthUri = buildOtpAuthUri({
      secret,
      accountLabel: auth.user.email,
      issuer: 'PreMarket',
    });

    await db
      .insert(schema.userMfa)
      .values({
        userId: auth.user.id,
        totpSecretEncrypted: encryptedSecret,
        enabledAt: null,
        backupCodesHashed: [],
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userMfa.userId,
        set: {
          totpSecretEncrypted: encryptedSecret,
          enabledAt: null,
          backupCodesHashed: [],
          updatedAt: now,
        },
      });

    await logAuditEventBestEffort({
      eventType: 'auth.mfa.enroll.start',
      userId: auth.user.id,
      req,
    });

    ok(res, 200, {
      enrollment: {
        secret,
        otpauth_uri: otpauthUri,
        otpauthUri,
      },
    });
  });
}
