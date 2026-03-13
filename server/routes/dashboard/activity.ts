import { and, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { getProposalOutcomeState } from '../../_lib/proposal-outcomes.js';
import { getProposalThreadState, toDateOrNull } from '../../_lib/proposal-thread-state.js';
import {
  buildProposalVisibilityScopes,
  getProposalActorRoleFromVisibility,
  getRecipientSharedProposalIds,
  isProposalOwnedByCurrentUser,
  isProposalReceivedByCurrentUser,
  listRecipientSharedReportLinks,
} from '../../_lib/proposal-visibility.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const RANGE_DAYS = {
  '7': 7,
  '30': 30,
  '90': 90,
  '365': 365,
  all: null,
};

const NEW_THREAD_EVENT_TYPES = new Set(['proposal.created']);
const ACTIVE_ROUND_EVENT_TYPES = new Set(['proposal.sent', 'proposal.received', 'proposal.send_back']);
const CLOSED_THREAD_EVENT_TYPES = new Set(['proposal.outcome.won_confirmed', 'proposal.outcome.lost']);
const ARCHIVED_THREAD_EVENT_TYPES = new Set(['proposal.archived']);
const DASHBOARD_ACTIVITY_EVENT_TYPES = [
  ...NEW_THREAD_EVENT_TYPES,
  ...ACTIVE_ROUND_EVENT_TYPES,
  ...CLOSED_THREAD_EVENT_TYPES,
  ...ARCHIVED_THREAD_EVENT_TYPES,
];

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

    const recipientSharedLinks = await listRecipientSharedReportLinks(db, auth.user);
    const sharedReceivedProposalIds = getRecipientSharedProposalIds(recipientSharedLinks);
    const sharedReceivedProposalIdSet = new Set(sharedReceivedProposalIds);
    const { hasUserEmail, ownerVisibleScope, recipientVisibleScope } = buildProposalVisibilityScopes(
      auth.user,
      sharedReceivedProposalIds,
      { isArchivedTab: false },
    );

    const whereClause = hasUserEmail ? or(ownerVisibleScope, recipientVisibleScope) : ownerVisibleScope;

    const rows = await db
      .select({
        id: schema.proposals.id,
        status: schema.proposals.status,
        sentAt: schema.proposals.sentAt,
        receivedAt: schema.proposals.receivedAt,
        lastThreadActivityAt: schema.proposals.lastThreadActivityAt,
        lastThreadActorRole: schema.proposals.lastThreadActorRole,
        lastThreadActivityType: schema.proposals.lastThreadActivityType,
        closedAt: schema.proposals.closedAt,
        archivedAt: schema.proposals.archivedAt,
        archivedByPartyAAt: schema.proposals.archivedByPartyAAt,
        archivedByPartyBAt: schema.proposals.archivedByPartyBAt,
        createdAt: schema.proposals.createdAt,
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

    const threadRows = rows.map((row) => ({
      row,
      threadState: getProposalThreadState(row, auth.user, {
        sharedReceivedProposalIds,
      }),
    }));
    const threadByProposalId = new Map(
      threadRows.map(({ row, threadState }) => [String(row.id || '').trim(), { row, threadState }]),
    );
    const visibleProposalIds = Array.from(threadByProposalId.keys()).filter(Boolean);
    const eventRows =
      visibleProposalIds.length > 0
        ? await db
            .select({
              proposalId: schema.proposalEvents.proposalId,
              eventType: schema.proposalEvents.eventType,
              actorRole: schema.proposalEvents.actorRole,
              createdAt: schema.proposalEvents.createdAt,
            })
            .from(schema.proposalEvents)
            .where(
              and(
                inArray(schema.proposalEvents.proposalId, visibleProposalIds),
                inArray(schema.proposalEvents.eventType, DASHBOARD_ACTIVITY_EVENT_TYPES),
              ),
            )
        : [];

    const relevantDates = threadRows
      .flatMap(({ row, threadState }) => {
        const status = String(row.status || '').trim().toLowerCase();
        const finalOutcome = getProposalOutcomeState(row).finalStatus;
        const sentAt = toDateOrNull(row.sentAt);
        const receivedAt = toDateOrNull(row.receivedAt);
        const closedAt = toDateOrNull(row.closedAt);
        const updatedAt = toDateOrNull(row.updatedAt);
        const createdAt = toDateOrNull(row.createdAt);
        const threadActivityAt = toDateOrNull(row.lastThreadActivityAt || threadState.threadActivityAt);
        const archivedAt = toDateOrNull(threadState.archivedAt);
        const dates = [] as Date[];

        if (createdAt) {
          dates.push(createdAt);
        }
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
        if (threadActivityAt) {
          dates.push(threadActivityAt);
        }
        if (archivedAt) {
          dates.push(archivedAt);
        }

        return dates;
      })
      .concat(
        eventRows
          .map((row) => toDateOrNull(row.createdAt))
          .filter((value): value is Date => Boolean(value)),
      );

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
        new_threads: 0,
        active_rounds: 0,
        closed_threads: 0,
        archived_threads: 0,
      });
    }

    const incrementPoint = (
      dateValue: Date | null,
      metric:
        | 'sent'
        | 'received'
        | 'mutual'
        | 'won'
        | 'lost'
        | 'new_threads'
        | 'active_rounds'
        | 'closed_threads'
        | 'archived_threads',
    ) => {
      if (!dateValue) {
        return;
      }
      const point = pointsByDay.get(startOfDay(dateValue).toISOString().slice(0, 10));
      if (!point) {
        return;
      }
      point[metric] += 1;
    };

    threadRows.forEach(({ row, threadState }) => {
      if (threadState.bucket === 'archived') {
        return;
      }

      const status = String(row.status || '').trim().toLowerCase();
      const finalOutcome = getProposalOutcomeState(row).finalStatus;
      const sentAt = toDateOrNull(row.sentAt);
      const receivedAt = toDateOrNull(row.receivedAt);
      const closedAt = toDateOrNull(row.closedAt);
      const updatedAt = toDateOrNull(row.updatedAt);

      if (!sentAt) {
        return;
      }

      const isRecipient = isProposalReceivedByCurrentUser(row, auth.user, sharedReceivedProposalIdSet);
      const isOwner = isProposalOwnedByCurrentUser(row, auth.user);
      if (!isOwner && !isRecipient) {
        return;
      }

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

    const proposalsWithCreatedEvent = new Set<string>();
    const proposalsWithActiveEvent = new Set<string>();
    const proposalsWithClosedEvent = new Set<string>();
    const proposalsWithArchivedEvent = new Set<string>();

    eventRows.forEach((eventRow) => {
      const proposalId = String(eventRow.proposalId || '').trim();
      const eventType = String(eventRow.eventType || '').trim().toLowerCase();
      const eventAt = toDateOrNull(eventRow.createdAt);
      const threadEntry = threadByProposalId.get(proposalId);
      const currentActorRole = threadEntry
        ? getProposalActorRoleFromVisibility(threadEntry.row, auth.user, sharedReceivedProposalIdSet)
        : null;

      if (NEW_THREAD_EVENT_TYPES.has(eventType)) {
        proposalsWithCreatedEvent.add(proposalId);
        incrementPoint(eventAt, 'new_threads');
      }

      if (ACTIVE_ROUND_EVENT_TYPES.has(eventType)) {
        proposalsWithActiveEvent.add(proposalId);
        incrementPoint(eventAt, 'active_rounds');
      }

      if (CLOSED_THREAD_EVENT_TYPES.has(eventType)) {
        proposalsWithClosedEvent.add(proposalId);
        incrementPoint(eventAt, 'closed_threads');
      }

      if (
        ARCHIVED_THREAD_EVENT_TYPES.has(eventType) &&
        currentActorRole &&
        String(eventRow.actorRole || '').trim().toLowerCase() === currentActorRole
      ) {
        proposalsWithArchivedEvent.add(proposalId);
        incrementPoint(eventAt, 'archived_threads');
      }
    });

    threadRows.forEach(({ row, threadState }) => {
      const proposalId = String(row.id || '').trim();
      const createdAt = toDateOrNull(row.createdAt);
      const threadActivityAt = toDateOrNull(row.lastThreadActivityAt || threadState.threadActivityAt);
      const closedAt = toDateOrNull(row.closedAt);
      const archivedAt = toDateOrNull(threadState.archivedAt);
      const finalOutcome = String(threadState.outcome.final_status || '').toLowerCase();

      if (proposalId && !proposalsWithCreatedEvent.has(proposalId) && createdAt) {
        incrementPoint(createdAt, 'new_threads');
      }

      if (proposalId && !proposalsWithActiveEvent.has(proposalId) && threadActivityAt) {
        incrementPoint(threadActivityAt, 'active_rounds');
      }

      if (
        proposalId &&
        !proposalsWithClosedEvent.has(proposalId) &&
        (finalOutcome === 'won' || finalOutcome === 'lost') &&
        closedAt
      ) {
        incrementPoint(closedAt, 'closed_threads');
      }

      if (proposalId && !proposalsWithArchivedEvent.has(proposalId) && archivedAt) {
        incrementPoint(archivedAt, 'archived_threads');
      }
    });

    const points = Array.from(pointsByDay.values());

    ok(res, 200, {
      range: days === null ? 'all' : String(days),
      points,
    });
  });
}
