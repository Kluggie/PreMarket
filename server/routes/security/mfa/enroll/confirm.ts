import { eq } from 'drizzle-orm';
import { ok } from '../../../../_lib/api-response.js';
import { requireUser } from '../../../../_lib/auth.js';
import { markAuthSessionMfaPassed } from '../../../../_lib/auth-sessions.js';
import { logAuditEventBestEffort } from '../../../../_lib/audit-events.js';
import { getDb, schema } from '../../../../_lib/db/client.js';
import { shouldUseSecureCookies } from '../../../../_lib/env.js';
import { ApiError } from '../../../../_lib/errors.js';
import { decryptMfaSecret, generateBackupCodes, hashBackupCodes, verifyTotpCode } from '../../../../_lib/mfa.js';
import { ensureMethod, withApiRoute } from '../../../../_lib/route.js';
import { readJsonBody } from '../../../../_lib/http.js';
import { createSessionToken, setSessionCookie } from '../../../../_lib/session.js';
import { asText, getUserMfaRow } from '../_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/enroll/confirm', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const code = asText(body.code);
    if (!code) {
      throw new ApiError(400, 'invalid_input', 'Verification code is required');
    }

    const userMfa = await getUserMfaRow(auth.user.id);
    if (!userMfa?.totpSecretEncrypted) {
      throw new ApiError(400, 'mfa_enroll_missing', 'Start 2FA enrollment before confirming');
    }

    const secret = decryptMfaSecret(userMfa.totpSecretEncrypted);
    const isValid = verifyTotpCode({
      secretBase32: secret,
      code,
    });
    if (!isValid) {
      throw new ApiError(401, 'invalid_mfa_code', 'Invalid authentication code');
    }

    const backupCodes = generateBackupCodes(10);
    const now = new Date();
    const db = getDb();
    await db
      .update(schema.userMfa)
      .set({
        enabledAt: now,
        backupCodesHashed: hashBackupCodes(backupCodes),
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userMfa.userId, auth.user.id));

    if (auth.sessionId) {
      await markAuthSessionMfaPassed({
        userId: auth.user.id,
        sessionId: auth.sessionId,
        now,
      });

      const secure = shouldUseSecureCookies(req, auth.config.appBaseUrl);
      const rotatedToken = createSessionToken(
        {
          sub: auth.session.sub,
          email: auth.session.email,
          name: auth.session.name,
          picture: auth.session.picture,
          hd: auth.session.hd,
        },
        auth.config.sessionSecret,
        undefined,
        {
          sessionId: auth.sessionId,
          mfaRequired: true,
          mfaPassed: true,
        },
      );
      setSessionCookie(res, rotatedToken, secure);
    }

    await logAuditEventBestEffort({
      eventType: 'auth.mfa.enabled',
      userId: auth.user.id,
      req,
      metadata: {
        session_id: auth.sessionId || null,
      },
    });

    ok(res, 200, {
      enabled: true,
      backup_codes: backupCodes,
      backupCodes,
    });
  });
}
