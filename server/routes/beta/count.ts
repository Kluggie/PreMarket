import { inArray, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const BETA_LIMIT = 50;

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/beta/count', async () => {
    ensureMethod(req, ['GET']);

    const db = getDb();
    const [row] = await db
      .select({
        claimed: sql<number>`cast(count(*) as integer)`,
      })
      .from(schema.betaApplications)
      .where(inArray(schema.betaApplications.status, ['applied', 'approved']));

    ok(res, 200, {
      claimed: Number(row?.claimed || 0),
      limit: BETA_LIMIT,
    });
  });
}
