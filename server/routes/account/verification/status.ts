import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/account/verification/status', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [profile] = await db
      .select({
        emailVerified: schema.userProfiles.emailVerified,
        verificationStatus: schema.userProfiles.verificationStatus,
        updatedAt: schema.userProfiles.updatedAt,
      })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, auth.user.id))
      .limit(1);

    const emailVerified = Boolean(profile?.emailVerified);
    const verificationStatus =
      String(profile?.verificationStatus || '').trim().toLowerCase() || (emailVerified ? 'verified' : 'unverified');

    ok(res, 200, {
      verification: {
        email: auth.user.email,
        email_verified: emailVerified,
        verification_status: verificationStatus,
        updated_date: profile?.updatedAt || null,
      },
    });
  });
}
