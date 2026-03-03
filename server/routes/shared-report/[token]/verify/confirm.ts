import { createHash } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { ok } from '../../../../_lib/api-response.js';
import { requireUser } from '../../../../_lib/auth.js';
import { schema } from '../../../../_lib/db/client.js';
import { ApiError } from '../../../../_lib/errors.js';
import { readJsonBody } from '../../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../../_lib/route.js';
import {
  SHARED_REPORT_ROUTE,
  assertSharedReportVerifyRateLimit,
  getRecipientAuthorizationState,
  getToken,
  normalizeEmail,
  resolveSharedReportToken,
} from '../../_shared.js';

const SHARED_REPORT_VERIFY_CONFIRM_ROUTE = `${SHARED_REPORT_ROUTE}/verify/confirm`;
const VERIFY_CONFIRM_RATE_LIMIT = {
  limit: 12,
  windowMs: 10 * 60 * 1000,
};
const MAX_CONFIRM_ATTEMPTS = 5;

function asOtpCode(value: unknown) {
  const normalized = String(value || '').trim();
  return /^\d{6}$/.test(normalized) ? normalized : '';
}

function hashOtp(token: string, code: string) {
  return createHash('sha256').update(`${token}:${code}`).digest('hex');
}

function getCurrentUserId(user: any) {
  return String(user?.id || user?.sub || '').trim();
}

function getAuthorizedUserId(link: any) {
  return String(link?.authorizedUserId || '').trim();
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_VERIFY_CONFIRM_ROUTE, async (context) => {
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
      action: 'confirm',
      limit: VERIFY_CONFIRM_RATE_LIMIT.limit,
      windowMs: VERIFY_CONFIRM_RATE_LIMIT.windowMs,
    });

    const body = await readJsonBody(req);
    const code = asOtpCode(body.code);
    if (!code) {
      throw new ApiError(400, 'invalid_input', 'A 6-digit verification code is required');
    }

    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: false,
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
    if (!recipientState.invitedEmail || recipientState.authorized) {
      ok(res, 200, {
        verified: true,
        invited_email: recipientState.invitedEmail,
        authorized_email: normalizeEmail(auth.user.email) || null,
        authorized_at: resolved.link.authorizedAt || new Date(),
      });
      return;
    }

    const [verification] = await resolved.db
      .select()
      .from(schema.sharedLinkVerifications)
      .where(
        and(
          eq(schema.sharedLinkVerifications.token, token),
          eq(schema.sharedLinkVerifications.invitedEmail, recipientState.invitedEmail),
        ),
      )
      .limit(1);

    if (!verification) {
      throw new ApiError(400, 'invalid_verification_code', 'Invalid verification code');
    }

    if (Number(verification.attemptCount || 0) >= MAX_CONFIRM_ATTEMPTS) {
      throw new ApiError(429, 'verification_attempts_exceeded', 'Verification attempts exceeded. Request a new code.');
    }

    const now = new Date();
    if (new Date(verification.expiresAt).getTime() <= now.getTime()) {
      await resolved.db
        .delete(schema.sharedLinkVerifications)
        .where(eq(schema.sharedLinkVerifications.id, verification.id));
      throw new ApiError(410, 'verification_code_expired', 'Verification code expired. Request a new code.');
    }

    const expectedHash = hashOtp(token, code);
    if (expectedHash !== String(verification.codeHash || '')) {
      const nextAttempts = Number(verification.attemptCount || 0) + 1;
      await resolved.db
        .update(schema.sharedLinkVerifications)
        .set({ attemptCount: nextAttempts })
        .where(eq(schema.sharedLinkVerifications.id, verification.id));

      if (nextAttempts >= MAX_CONFIRM_ATTEMPTS) {
        throw new ApiError(429, 'verification_attempts_exceeded', 'Verification attempts exceeded. Request a new code.');
      }
      throw new ApiError(400, 'invalid_verification_code', 'Invalid verification code');
    }

    const authorizedEmail = normalizeEmail(auth.user.email) || null;
    const [updatedLink] = await resolved.db
      .update(schema.sharedLinks)
      .set({
        authorizedUserId: currentUserId,
        authorizedEmail,
        authorizedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sharedLinks.id, resolved.link.id),
          or(isNull(schema.sharedLinks.authorizedUserId), eq(schema.sharedLinks.authorizedUserId, currentUserId)),
        ),
      )
      .returning({ id: schema.sharedLinks.id });

    if (!updatedLink) {
      throw new ApiError(
        409,
        'recipient_authorization_locked',
        'Recipient authorization is locked to a different account',
      );
    }

    await resolved.db
      .delete(schema.sharedLinkVerifications)
      .where(eq(schema.sharedLinkVerifications.id, verification.id));

    ok(res, 200, {
      verified: true,
      invited_email: recipientState.invitedEmail,
      authorized_email: authorizedEmail,
      authorized_at: now,
    });
  });
}
