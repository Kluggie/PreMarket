import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { createAuthSession, revokeAuthSessionForUser } from '../../../_lib/auth-sessions.js';
import { logAuditEventBestEffort } from '../../../_lib/audit-events.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { shouldUseSecureCookies } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { assertMfaChallengeRateLimit } from '../../../_lib/mfa.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { readJsonBody } from '../../../_lib/http.js';
import { createSessionToken, setSessionCookie } from '../../../_lib/session.js';
import { asText, evaluateMfaCode, getUserMfaRow, isMfaEnabledRow } from './_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/challenge', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res, { allowPendingMfa: true });
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    if (!auth.sessionId) {
      throw new ApiError(500, 'session_missing', 'Session is missing');
    }

    const mfaRequired = Boolean(auth.session?.mfa_required);
    const mfaPassed = Boolean(auth.session?.mfa_passed);
    if (!mfaRequired || mfaPassed) {
      ok(res, 200, {
        verified: true,
        mfa_passed: true,
        user: auth.user,
      });
      return;
    }

    const body = await readJsonBody(req);
    const codeOrBackup = asText(body.codeOrBackup || body.code_or_backup || body.code);
    if (!codeOrBackup) {
      throw new ApiError(400, 'invalid_input', 'Authentication code is required');
    }

    const userMfa = await getUserMfaRow(auth.user.id);
    if (!isMfaEnabledRow(userMfa)) {
      throw new ApiError(400, 'mfa_not_enabled', 'Two-factor authentication is not enabled');
    }

    await assertMfaChallengeRateLimit({
      userId: auth.user.id,
      sessionId: auth.sessionId,
    });

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
          session_id: auth.sessionId,
        },
      });
      throw new ApiError(401, 'invalid_mfa_code', 'Invalid authentication code');
    }

    const now = new Date();
    const db = getDb();
    await db
      .update(schema.userMfa)
      .set({
        backupCodesHashed: evaluated.nextBackupCodes,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userMfa.userId, auth.user.id));

    const nextSession = await createAuthSession({
      userId: auth.user.id,
      req,
      mfaPassed: true,
      now,
    });
    if (!nextSession?.id) {
      throw new ApiError(500, 'session_persist_failed', 'Unable to initialize session');
    }

    await revokeAuthSessionForUser({
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
        sessionId: nextSession.id,
        mfaRequired: true,
        mfaPassed: true,
      },
    );
    setSessionCookie(res, rotatedToken, secure);

    await logAuditEventBestEffort({
      eventType: 'auth.mfa.challenge.success',
      userId: auth.user.id,
      req,
      metadata: {
        session_id: nextSession.id,
        previous_session_id: auth.sessionId,
        method: evaluated.method,
      },
    });
    await logAuditEventBestEffort({
      eventType: 'auth.login.success',
      userId: auth.user.id,
      req,
      metadata: {
        session_id: nextSession.id,
        provider: 'google',
        via_mfa: true,
      },
    });

    ok(res, 200, {
      verified: true,
      mfa_passed: true,
      user: auth.user,
    });
  });
}
