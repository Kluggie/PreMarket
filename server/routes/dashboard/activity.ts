import { and, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { getProposalOutcomeState } from '../../_lib/proposal-outcomes.js';
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

function toDateOrNull(value: unknown) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

    const recipientSharedLinks = currentEmail
      ? await db
          .select({
            proposalId: schema.sharedLinks.proposalId,
          })
          .from(schema.sharedLinks)
          .where(
            and(
              eq(schema.sharedLinks.mode, 'shared_report'),
              ilike(schema.sharedLinks.recipientEmail, currentEmail),
              ne(schema.sharedLinks.userId, auth.user.id),
            ),
          )
      : [];
    const sharedReceivedProposalIds = Array.from(
      new Set(
        recipientSharedLinks
          .map((row) => String(row.proposalId || '').trim())
          .filter(Boolean),
      ),
    );
    const sharedReceivedProposalIdSet = new Set(sharedReceivedProposalIds);
    const sharedRecipientScope = sharedReceivedProposalIds.length > 0
      ? inArray(schema.proposals.id, sharedReceivedProposalIds)
      : null;

    const ownerScope = currentEmail
      ? or(
          eq(schema.proposals.userId, auth.user.id),
          ilike(schema.proposals.partyAEmail, currentEmail),
        )
      : eq(schema.proposals.userId, auth.user.id);
    const ownerVisibleScope = and(ownerScope, isNull(schema.proposals.deletedByPartyAAt));
    const ownerActiveScope = and(ownerVisibleScope, isNull(schema.proposals.archivedByPartyAAt));
    const recipientScope = currentEmail
      ? sharedRecipientScope
        ? or(
            ilike(schema.proposals.partyBEmail, currentEmail),
            sharedRecipientScope,
          )
        : ilike(schema.proposals.partyBEmail, currentEmail)
      : eq(schema.proposals.userId, '__no_recipient_scope__');
    const recipientVisibleScope = and(recipientScope, isNull(schema.proposals.deletedByPartyBAt));
    const recipientActiveScope = and(
      recipientVisibleScope,
      isNull(schema.proposals.archivedByPartyBAt),
    );

    const whereClause = currentEmail
      ? or(ownerActiveScope, recipientActiveScope)
      : ownerActiveScope;

    const rows = await db
      .select({
        id: schema.proposals.id,
        status: schema.proposals.status,
        sentAt: schema.proposals.sentAt,
        receivedAt: schema.proposals.receivedAt,
        closedAt: schema.proposals.closedAt,
        updatedAt: schema.proposals.updatedAt,
        userId: schema.proposals.userId,
        partyAEmail: schema.proposals.partyAEmail,
        partyBEmail: schema.proposals.partyBEmail,
        partyAOutcome: schema.proposals.partyAOutcome,
        partyAOutcomeAt: schema.proposals.partyAOutcomeAt,
        partyBOutcome: schema.proposals.partyBOutcome,
        partyBOutcomeAt: schema.proposals.partyBOutcomeAt,
      })
      .from(schema.proposals)
      .where(whereClause);

    const relevantDates = rows.flatMap((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      const finalOutcome = getProposalOutcomeState(row).finalStatus;
      const sentAt = toDateOrNull(row.sentAt);
      const receivedAt = toDateOrNull(row.receivedAt);
      const closedAt = toDateOrNull(row.closedAt);
      const updatedAt = toDateOrNull(row.updatedAt);
      const dates = [] as Date[];

      if (sentAt) {
        dates.push(sentAt);
      }
      if (status === 'mutual_interest' || status === 'received') {
        if (receivedAt) {
          dates.push(receivedAt);
        } else if (updatedAt) {
          dates.push(updatedAt);
        }
      }
      if ((finalOutcome === 'won' || finalOutcome === 'lost') && closedAt) {
        dates.push(closedAt);
      }

      return dates;
    });

    let startDate = days === null ? null : startOfDay(addDays(now, -(days - 1)));
    if (!startDate) {
      const oldest = relevantDates.reduce((minDate, date) => {
        if (!minDate) return date;
        return date.getTime() < minDate.getTime() ? date : minDate;
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

    const incrementPoint = (dateValue: Date | null, metric: 'sent' | 'received' | 'mutual' | 'won' | 'lost') => {
      if (!dateValue) {
        return;
      }
      const point = pointsByDay.get(startOfDay(dateValue).toISOString().slice(0, 10));
      if (!point) {
        return;
      }
      point[metric] += 1;
    };

    rows.forEach((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      const finalOutcome = getProposalOutcomeState(row).finalStatus;
      const sentAt = toDateOrNull(row.sentAt);
      const receivedAt = toDateOrNull(row.receivedAt);
      const closedAt = toDateOrNull(row.closedAt);
      const updatedAt = toDateOrNull(row.updatedAt);

      if (!sentAt) {
        return;
      }

      const isOwner =
        row.userId === auth.user.id ||
        Boolean(currentEmail && normalizeEmail(row.partyAEmail) === currentEmail);
      const isRecipient = Boolean(
        !isOwner &&
        (
          (currentEmail && normalizeEmail(row.partyBEmail) === currentEmail) ||
          sharedReceivedProposalIdSet.has(String(row.id || '').trim())
        ),
      );

      if (isRecipient) {
        incrementPoint(sentAt, 'received');
      } else {
        incrementPoint(sentAt, 'sent');
      }

      if (status === 'mutual_interest' || (status === 'received' && !isRecipient)) {
        incrementPoint(receivedAt || updatedAt || sentAt, 'mutual');
      }

      if (finalOutcome === 'won') {
        incrementPoint(closedAt || updatedAt, 'won');
      } else if (finalOutcome === 'lost') {
        incrementPoint(closedAt || updatedAt, 'lost');
      }
    });

    const points = Array.from(pointsByDay.values());

    ok(res, 200, {
      range: days === null ? 'all' : String(days),
      points,
    });
  });
}
