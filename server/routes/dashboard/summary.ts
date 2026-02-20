import { eq, ilike, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/dashboard/summary', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const currentEmail = normalizeEmail(auth.user.email);

    const whereClause = currentEmail
      ? or(
          eq(schema.proposals.userId, auth.user.id),
          ilike(schema.proposals.partyAEmail, currentEmail),
          ilike(schema.proposals.partyBEmail, currentEmail),
        )
      : eq(schema.proposals.userId, auth.user.id);

    const rows = await db
      .select({
        id: schema.proposals.id,
        status: schema.proposals.status,
        userId: schema.proposals.userId,
        partyAEmail: schema.proposals.partyAEmail,
        partyBEmail: schema.proposals.partyBEmail,
      })
      .from(schema.proposals)
      .where(whereClause);

    let sentCount = 0;
    let receivedCount = 0;
    let draftsCount = 0;
    let activeReviewsCount = 0;
    let mutualInterestCount = 0;

    rows.forEach((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      const partyBEmail = normalizeEmail(row.partyBEmail);
      const isReceived = Boolean(
        status !== 'draft' &&
          currentEmail &&
          partyBEmail &&
          partyBEmail === currentEmail &&
          row.userId !== auth.user.id,
      );

      if (status === 'draft') {
        draftsCount += 1;
      } else if (isReceived) {
        receivedCount += 1;
      } else {
        sentCount += 1;
      }

      if (['sent', 'received', 'under_verification', 're_evaluated'].includes(status)) {
        activeReviewsCount += 1;
      }

      if (['mutual_interest', 'revealed'].includes(status)) {
        mutualInterestCount += 1;
      }
    });

    ok(res, 200, {
      summary: {
        sentCount,
        receivedCount,
        draftsCount,
        activeReviewsCount,
        mutualInterestCount,
        totalCount: rows.length,
      },
    });
  });
}
