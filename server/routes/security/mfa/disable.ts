import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { shouldUseSecureCookies } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { readJsonBody } from '../../../_lib/http.js';
import { createSessionToken, setSessionCookie } from '../../../_lib/session.js';
import { asText, evaluateMfaCode, getUserMfaRow, isMfaEnabledRow } from './_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/disable', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const userMfa = await getUserMfaRow(auth.user.id);
    if (!isMfaEnabledRow(userMfa)) {
      throw new ApiError(400, 'mfa_not_enabled', 'Two-factor authentication is not enabled');
    }

    const body = await readJsonBody(req);
    const codeOrBackup = asText(body.codeOrBackup || body.code_or_backup || body.code);
    if (!codeOrBackup) {
      throw new ApiError(400, 'invalid_input', 'Authentication code is required');
    }

    const evaluated = evaluateMfaCode({
      userMfaRow: userMfa,
      codeInput: codeOrBackup,
      allowBackup: true,
    });

    if (!evaluated.valid) {
      await logAuditEventBestEffort({
        eventType: 'auth.mfa.challenge.fail',
        userId: auth.user.id,
        req,
        metadata: {
          action: 'disable',
          session_id: auth.sessionId || null,
        },
      });
      throw new ApiError(401, 'invalid_mfa_code', 'Invalid authentication code');
    }

    const now = new Date();
    const db = getDb();
    await db
      .update(schema.userMfa)
      .set({
        totpSecretEncrypted: null,
        enabledAt: null,
        backupCodesHashed: [],
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userMfa.userId, auth.user.id));

    if (auth.sessionId) {
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
          mfaRequired: false,
          mfaPassed: true,
        },
      );
      setSessionCookie(res, rotatedToken, secure);
    }

    await logAuditEventBestEffort({
      eventType: 'auth.mfa.disabled',
      userId: auth.user.id,
      req,
      metadata: {
        method: evaluated.method,
        session_id: auth.sessionId || null,
      },
    });

    ok(res, 200, {
      disabled: true,
    });
  });
}
