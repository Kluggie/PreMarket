import { sql } from 'drizzle-orm';
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
    const [row] = await db
      .select({ seatsClaimed: sql<number>`cast(count(*) as integer)` })
      .from(schema.betaSignups);

    const seatsClaimed = Number(row?.seatsClaimed || 0);

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
