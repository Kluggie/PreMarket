import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { getResendConfig } from '../../../_lib/integrations.js';
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

async function sendVerificationEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  text: string;
}) {
  const payload: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
  };

  if (input.replyTo) {
    payload.reply_to = input.replyTo;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return;
  }

  if (response.status >= 400 && response.status < 500) {
    throw new ApiError(400, 'email_send_failed', 'Email provider rejected the request');
  }

  throw new ApiError(502, 'email_send_failed', 'Email provider is unavailable');
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/verification/send', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const resend = getResendConfig();
    if (!resend.ready) {
      throw new ApiError(501, 'not_configured', 'Email integration is not configured');
    }

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

    const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
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

    await sendVerificationEmail({
      apiKey: resend.apiKey,
      from,
      to: normalizeEmail(auth.user.email),
      replyTo: resend.replyTo,
      subject: 'Verify your email for PreMarket',
      text,
    });

    ok(res, 200, {
      sent: true,
      expires_at: expiresAt,
      verification_status: 'pending',
    });
  });
}
