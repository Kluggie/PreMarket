import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { sendCategorizedEmail } from '../../../_lib/email-delivery.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

const TOKEN_TTL_HOURS = 24;

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildVerificationUrl(appBaseUrl: string, token: string) {
  const returnPath = `/verify?token=${encodeURIComponent(token)}`;
  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/verification/send', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const now = new Date();
    const [existingProfile] = await db
      .select({
        id: schema.userProfiles.id,
        emailVerified: schema.userProfiles.emailVerified,
        verificationStatus: schema.userProfiles.verificationStatus,
      })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, auth.user.id))
      .limit(1);

    if (existingProfile?.emailVerified || existingProfile?.verificationStatus === 'verified') {
      ok(res, 200, {
        already_verified: true,
      });
      return;
    }

    await db
      .update(schema.emailVerificationTokens)
      .set({
        status: 'expired',
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailVerificationTokens.userId, auth.user.id),
          eq(schema.emailVerificationTokens.status, 'pending'),
          lt(schema.emailVerificationTokens.expiresAt, now),
        ),
      );

    await db
      .update(schema.emailVerificationTokens)
      .set({
        status: 'revoked',
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailVerificationTokens.userId, auth.user.id),
          eq(schema.emailVerificationTokens.status, 'pending'),
        ),
      );

    const token = newToken(32);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
    const verificationUrl = buildVerificationUrl(auth.config.appBaseUrl, token);

    await db.insert(schema.emailVerificationTokens).values({
      id: newId('email_verify'),
      userId: auth.user.id,
      userEmail: normalizeEmail(auth.user.email),
      tokenHash,
      status: 'pending',
      expiresAt,
      usedAt: null,
      metadata: {
        flow: 'email_verification',
      },
      createdAt: now,
      updatedAt: now,
    });

    await db
      .insert(schema.userProfiles)
      .values({
        id: existingProfile?.id || newId('profile'),
        userId: auth.user.id,
        userEmail: normalizeEmail(auth.user.email),
        verificationStatus: 'pending',
        emailVerified: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: {
          userEmail: normalizeEmail(auth.user.email),
          verificationStatus: 'pending',
          updatedAt: now,
        },
      });

    const text = [
      'Verify your email address for PreMarket',
      '',
      `Hello ${auth.user.full_name || auth.user.name || ''}`.trim(),
      '',
      'Click the secure link below to verify your email address:',
      verificationUrl,
      '',
      `This link expires in ${TOKEN_TTL_HOURS} hours and can only be used once.`,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n');

    const delivery = await sendCategorizedEmail({
      category: 'account_verification',
      purpose: 'security',
      to: normalizeEmail(auth.user.email),
      dedupeKey: `account_verification:${auth.user.id}:${tokenHash}`,
      subject: 'Verify your email for PreMarket',
      text,
    });

    if (delivery.status === 'not_configured') {
      throw new ApiError(501, 'not_configured', 'Email service not configured');
    }

    if (delivery.status === 'failed') {
      throw new ApiError(502, 'email_send_failed', 'Unable to send verification email right now');
    }

    if (delivery.status === 'invalid_input') {
      throw new ApiError(400, 'invalid_input', 'Email payload is invalid');
    }

    if (delivery.status === 'blocked') {
      throw new ApiError(502, 'email_send_failed', 'Unable to send verification email right now');
    }

    ok(res, 200, {
      sent: delivery.status === 'sent',
      blocked: delivery.blocked,
      expires_at: expiresAt,
      verification_status: 'pending',
    });
  });
}
