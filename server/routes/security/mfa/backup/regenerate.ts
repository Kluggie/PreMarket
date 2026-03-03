import { eq } from 'drizzle-orm';
import { ok } from '../../../../_lib/api-response.js';
import { requireUser } from '../../../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../../../_lib/audit-events.js';
import { getDb, schema } from '../../../../_lib/db/client.js';
import { ApiError } from '../../../../_lib/errors.js';
import { generateBackupCodes, hashBackupCodes } from '../../../../_lib/mfa.js';
import { ensureMethod, withApiRoute } from '../../../../_lib/route.js';
import { readJsonBody } from '../../../../_lib/http.js';
import { asText, evaluateMfaCode, getUserMfaRow, isMfaEnabledRow } from '../_shared.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/security/mfa/backup/regenerate', async (context) => {
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
    const code = asText(body.code);
    if (!code) {
      throw new ApiError(400, 'invalid_input', 'Authentication code is required');
    }

    const evaluated = evaluateMfaCode({
      userMfaRow: userMfa,
      codeInput: code,
      allowBackup: false,
    });
    if (!evaluated.valid || evaluated.method !== 'totp') {
      await logAuditEventBestEffort({
        eventType: 'auth.mfa.challenge.fail',
        userId: auth.user.id,
        req,
        metadata: {
          action: 'backup_regenerate',
          session_id: auth.sessionId || null,
        },
      });
      throw new ApiError(401, 'invalid_mfa_code', 'Invalid authentication code');
    }

    const backupCodes = generateBackupCodes(10);
    const now = new Date();
    const db = getDb();
    await db
      .update(schema.userMfa)
      .set({
        backupCodesHashed: hashBackupCodes(backupCodes),
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.userMfa.userId, auth.user.id));

    await logAuditEventBestEffort({
      eventType: 'auth.mfa.backup.regenerated',
      userId: auth.user.id,
      req,
      metadata: {
        session_id: auth.sessionId || null,
      },
    });

    ok(res, 200, {
      regenerated: true,
      backup_codes: backupCodes,
      backupCodes,
    });
  });
}
