import { sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { getDb } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const BETA_LIMIT = 50;

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/beta/count', async () => {
    ensureMethod(req, ['GET']);

    const db = getDb();
    const result = await db.execute(sql`
      select count(distinct email_normalized)::int as claimed
      from (
        select lower(trim(email_normalized)) as email_normalized
        from beta_signups
        where trim(coalesce(email_normalized, '')) <> ''
        union
        select lower(trim(email)) as email_normalized
        from beta_applications
        where status in ('applied', 'approved')
          and trim(coalesce(email, '')) <> ''
      ) seats
    `);
    const rows = Array.isArray(result)
      ? result
      : Array.isArray((result as any)?.rows)
        ? (result as any).rows
        : [];

    ok(res, 200, {
      claimed: Number(rows[0]?.claimed || 0),
      limit: BETA_LIMIT,
    });
  });
}
