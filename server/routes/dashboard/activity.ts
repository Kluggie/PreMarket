import { and, eq, gte, ilike, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const RANGE_DAYS = {
  '7': 7,
  '30': 30,
  '90': 90,
  '365': 365,
  all: null,
};

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function startOfDay(input: Date) {
  const value = new Date(input);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(input: Date, days: number) {
  const value = new Date(input);
  value.setDate(value.getDate() + days);
  return value;
}

function formatDateLabel(input: Date) {
  return input.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/dashboard/activity', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const rangeParam = String(req.query?.range || '30').trim().toLowerCase();
    const days = Object.prototype.hasOwnProperty.call(RANGE_DAYS, rangeParam)
      ? RANGE_DAYS[rangeParam]
      : RANGE_DAYS['30'];

    const db = getDb();
    const now = new Date();
    const currentEmail = normalizeEmail(auth.user.email);

    const scopeClause = currentEmail
      ? or(
          eq(schema.proposals.userId, auth.user.id),
          ilike(schema.proposals.partyAEmail, currentEmail),
          ilike(schema.proposals.partyBEmail, currentEmail),
        )
      : eq(schema.proposals.userId, auth.user.id);

    const rangeStart = days === null ? null : startOfDay(addDays(now, -(days - 1)));
    const whereClause =
      rangeStart == null ? scopeClause : and(scopeClause, gte(schema.proposals.createdAt, rangeStart));

    const rows = await db
      .select({
        createdAt: schema.proposals.createdAt,
        status: schema.proposals.status,
        sentAt: schema.proposals.sentAt,
        userId: schema.proposals.userId,
        partyBEmail: schema.proposals.partyBEmail,
      })
      .from(schema.proposals)
      .where(whereClause);

    let startDate = rangeStart;
    if (!startDate) {
      const oldest = rows.reduce((minDate, row) => {
        if (!row.createdAt) return minDate;
        if (!minDate) return row.createdAt;
        return new Date(row.createdAt).getTime() < new Date(minDate).getTime() ? row.createdAt : minDate;
      }, null as Date | null);
      startDate = oldest ? startOfDay(oldest) : startOfDay(addDays(now, -29));
    }

    const endDate = startOfDay(now);
    const pointsByDay = new Map<string, any>();
    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      const key = cursor.toISOString().slice(0, 10);
      pointsByDay.set(key, {
        date: key,
        label: formatDateLabel(cursor),
        sent: 0,
        received: 0,
        mutual: 0,
        won: 0,
        lost: 0,
      });
    }

    rows.forEach((row) => {
      if (!row.createdAt) return;

      const dateKey = startOfDay(new Date(row.createdAt)).toISOString().slice(0, 10);
      const point = pointsByDay.get(dateKey);
      if (!point) return;

      const status = String(row.status || '').trim().toLowerCase();
      const isSent = Boolean(row.sentAt);
      const isReceived = Boolean(
        isSent &&
        currentEmail &&
        normalizeEmail(row.partyBEmail) === currentEmail &&
        row.userId !== auth.user.id,
      );

      if (isSent) {
        if (isReceived) {
          point.received += 1;
        } else {
          point.sent += 1;
        }
      }

      if (status === 'won') {
        point.won += 1;
      }

      if (status === 'lost') {
        point.lost += 1;
      }

      if (status === 'mutual_interest' || (status === 'received' && !isReceived)) {
        point.mutual += 1;
      }
    });

    const points = Array.from(pointsByDay.values());

    ok(res, 200, {
      range: days === null ? 'all' : String(days),
      points,
    });
  });
}
