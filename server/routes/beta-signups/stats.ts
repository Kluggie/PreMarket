import { inArray } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const BETA_SEATS_TOTAL = 50;

function shouldLog() {
  return process.env.NODE_ENV !== 'production';
}

function logEvent(event: string, payload: Record<string, unknown>) {
  if (!shouldLog()) {
    return;
  }

  console.info(
    JSON.stringify({
      level: 'info',
      route: 'beta_signups_stats',
      event,
      ...payload,
    }),
  );
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/beta-signups/stats', async () => {
    ensureMethod(req, ['GET']);

    const db = getDb();
    const currentRows = await db
      .select({
        emailNormalized: schema.betaSignups.emailNormalized,
      })
      .from(schema.betaSignups);

    const legacyRows = await db
      .select({
        email: schema.betaApplications.email,
      })
      .from(schema.betaApplications)
      .where(inArray(schema.betaApplications.status, ['applied', 'approved']));

    const uniqueEmails = new Set<string>();

    for (const row of currentRows) {
      const normalized = String(row?.emailNormalized || '')
        .trim()
        .toLowerCase();
      if (normalized) {
        uniqueEmails.add(normalized);
      }
    }

    for (const row of legacyRows) {
      const normalized = String(row?.email || '')
        .trim()
        .toLowerCase();
      if (normalized) {
        uniqueEmails.add(normalized);
      }
    }

    const seatsClaimed = uniqueEmails.size;

    logEvent('stats', {
      seatsClaimed,
      seatsTotal: BETA_SEATS_TOTAL,
    });

    ok(res, 200, {
      seatsClaimed,
      seatsTotal: BETA_SEATS_TOTAL,
    });
  });
}
