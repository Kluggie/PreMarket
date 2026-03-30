import { createHash, randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ok } from '../../../../_lib/api-response.js';
import { requireUser } from '../../../../_lib/auth.js';
import { schema } from '../../../../_lib/db/client.js';
import { sendCategorizedEmail } from '../../../../_lib/email-delivery.js';
import { ApiError } from '../../../../_lib/errors.js';
import { newId } from '../../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../../_lib/route.js';
import {
  SHARED_REPORT_ROUTE,
  assertSharedReportVerifyRateLimit,
  getRecipientAuthorizationState,
  getToken,
  normalizeEmail,
  resolveSharedReportToken,
} from '../../_shared.js';

const SHARED_REPORT_VERIFY_START_ROUTE = `${SHARED_REPORT_ROUTE}/verify/start`;
const OTP_TTL_MS = 10 * 60 * 1000;
const VERIFY_START_RATE_LIMIT = {
  limit: 5,
  windowMs: 10 * 60 * 1000,
};

function hashOtp(token: string, code: string) {
  return createHash('sha256').update(`${token}:${code}`).digest('hex');
}

function buildGenericResponse() {
  return {
    started: true,
    message: 'If permitted, a verification code was sent.',
  };
}

function createOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function getCurrentUserId(user: any) {
  return String(user?.id || user?.sub || '').trim();
}

function getAuthorizedUserId(link: any) {
  return String(link?.authorizedUserId || '').trim();
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_VERIFY_START_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    await assertSharedReportVerifyRateLimit({
      req,
      token,
      action: 'start',
      limit: VERIFY_START_RATE_LIMIT.limit,
      windowMs: VERIFY_START_RATE_LIMIT.windowMs,
    });

    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
    });
    const currentUserId = getCurrentUserId(auth.user);
    const authorizedUserId = getAuthorizedUserId(resolved.link);
    if (authorizedUserId && authorizedUserId !== currentUserId) {
      throw new ApiError(
        409,
        'recipient_authorization_locked',
        'Recipient authorization is locked to a different account',
      );
    }

    const recipientState = getRecipientAuthorizationState(resolved.link, auth.user);
    const invitedEmail = recipientState.invitedEmail;

    if (!invitedEmail || recipientState.authorized) {
      ok(res, 200, buildGenericResponse());
      return;
    }

    const now = new Date();
    const code = createOtpCode();
    const codeHash = hashOtp(token, code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await resolved.db
      .delete(schema.sharedLinkVerifications)
      .where(eq(schema.sharedLinkVerifications.token, token));

    await resolved.db.insert(schema.sharedLinkVerifications).values({
      id: newId('share_verify'),
      token,
      invitedEmail,
      codeHash,
      expiresAt,
      attemptCount: 0,
      createdAt: now,
    });

    await sendCategorizedEmail({
      db: resolved.db,
      category: 'shared_link_activity',
      to: invitedEmail,
      dedupeKey: `shared_report_verify_start:${resolved.link.id}:${codeHash}`,
      subject: 'Your PreMarket access verification code',
      text: [
        'Use this code to verify access to your shared report link:',
        '',
        code,
        '',
        'This code expires in 10 minutes.',
        '',
        `Signed-in account requesting access: ${normalizeEmail(auth.user.email) || 'unknown'}`,
      ].join('\n'),
    }).catch(() => null);

    ok(res, 200, buildGenericResponse());
  });
}
