import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/verification/confirm', async () => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const token = asText(body.token || req.query?.token);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Verification token is required');
    }

    const db = getDb();
    const now = new Date();
    const tokenHash = hashToken(token);
    const [verificationToken] = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!verificationToken) {
      throw new ApiError(400, 'token_invalid', 'Verification token is invalid');
    }

    if (verificationToken.status !== 'pending' || verificationToken.usedAt) {
      throw new ApiError(410, 'token_used', 'Verification token has already been used');
    }

    if (new Date(verificationToken.expiresAt).getTime() <= now.getTime()) {
      await db
        .update(schema.emailVerificationTokens)
        .set({
          status: 'expired',
          updatedAt: now,
        })
        .where(eq(schema.emailVerificationTokens.id, verificationToken.id));
      throw new ApiError(410, 'token_expired', 'Verification token has expired');
    }

    await db
      .update(schema.emailVerificationTokens)
      .set({
        status: 'used',
        usedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.emailVerificationTokens.id, verificationToken.id));

    await db
      .update(schema.emailVerificationTokens)
      .set({
        status: 'revoked',
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailVerificationTokens.userId, verificationToken.userId),
          eq(schema.emailVerificationTokens.status, 'pending'),
          ne(schema.emailVerificationTokens.id, verificationToken.id),
        ),
      );

    await db
      .insert(schema.userProfiles)
      .values({
        id: newId('profile'),
        userId: verificationToken.userId,
        userEmail: verificationToken.userEmail,
        emailVerified: true,
        verificationStatus: 'verified',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: {
          userEmail: verificationToken.userEmail,
          emailVerified: true,
          verificationStatus: 'verified',
          updatedAt: now,
        },
      });

    ok(res, 200, {
      verified: true,
      verification: {
        email: verificationToken.userEmail,
        email_verified: true,
        verification_status: 'verified',
      },
    });
  });
}
