import { and, inArray, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { getProposalThreadState, toDateOrNull } from '../../_lib/proposal-thread-state.js';
import {
  buildProposalVisibilityScopes,
  getRecipientSharedProposalIds,
  listRecipientSharedReportLinks,
} from '../../_lib/proposal-visibility.js';
import { getStarterUsageSnapshot } from '../../_lib/starter-entitlements.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

const RANGE_DAYS = {
  '7': 7,
  '30': 30,
  '90': 90,
  '365': 365,
  all: null,
} as const;

const EXCHANGE_EVENT_TYPES = ['proposal.sent', 'proposal.received', 'proposal.send_back'];

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

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/dashboard/summary', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const rangeParamRaw = req.query?.range;
    const normalizedRangeParam = String(rangeParamRaw || '').trim().toLowerCase();
    const shouldApplyRange = normalizedRangeParam.length > 0;
    const rangeKey = shouldApplyRange
      ? (Object.prototype.hasOwnProperty.call(RANGE_DAYS, normalizedRangeParam)
          ? normalizedRangeParam
          : '30')
      : 'all';
    const now = new Date();
    const rangeDays = RANGE_DAYS[rangeKey as keyof typeof RANGE_DAYS];
    const rangeStartAt = rangeDays === null ? null : startOfDay(addDays(now, -(rangeDays - 1)));
    const isDateWithinRange = (input: unknown) => {
      if (!shouldApplyRange || !rangeStartAt) {
        return true;
      }
      const dateValue = toDateOrNull(input);
      if (!dateValue) {
        return false;
      }
      const at = dateValue.getTime();
      return at >= rangeStartAt.getTime() && at <= now.getTime();
    };

    const db = getDb();
    const recipientSharedLinks = await listRecipientSharedReportLinks(db, auth.user);
    const sharedReceivedProposalIds = getRecipientSharedProposalIds(recipientSharedLinks);
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
        userId: schema.proposals.userId,
        partyAEmail: schema.proposals.partyAEmail,
        partyBEmail: schema.proposals.partyBEmail,
        partyAOutcome: schema.proposals.partyAOutcome,
        partyAOutcomeAt: schema.proposals.partyAOutcomeAt,
        partyBOutcome: schema.proposals.partyBOutcome,
        partyBOutcomeAt: schema.proposals.partyBOutcomeAt,
        archivedAt: schema.proposals.archivedAt,
        archivedByPartyAAt: schema.proposals.archivedByPartyAAt,
        archivedByPartyBAt: schema.proposals.archivedByPartyBAt,
        updatedAt: schema.proposals.updatedAt,
      })
      .from(schema.proposals)
      .where(whereClause);

    const visibleProposalIds = rows
      .map((row) => String(row.id || '').trim())
      .filter(Boolean);
    const exchangeEventRows =
      visibleProposalIds.length > 0
        ? await db
            .select({
              proposalId: schema.proposalEvents.proposalId,
              createdAt: schema.proposalEvents.createdAt,
            })
            .from(schema.proposalEvents)
            .where(
              and(
                inArray(schema.proposalEvents.proposalId, visibleProposalIds),
                inArray(schema.proposalEvents.eventType, EXCHANGE_EVENT_TYPES),
              ),
            )
        : [];
    const exchangeTimelineByProposalId = new Map<string, Date[]>();
    exchangeEventRows.forEach((eventRow) => {
      const proposalId = String(eventRow.proposalId || '').trim();
      const eventAt = toDateOrNull(eventRow.createdAt);
      if (!proposalId || !eventAt) {
        return;
      }
      const existing = exchangeTimelineByProposalId.get(proposalId) || [];
      existing.push(eventAt);
      exchangeTimelineByProposalId.set(proposalId, existing);
    });
    exchangeTimelineByProposalId.forEach((timeline, proposalId) => {
      exchangeTimelineByProposalId.set(
        proposalId,
        [...timeline].sort((a, b) => a.getTime() - b.getTime()),
      );
    });

    let sentCount = 0;
    let receivedCount = 0;
    let draftsCount = 0;
    let inboxCount = 0;
    let archivedCount = 0;
    let mutualInterestCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let closedCount = 0;

    rows.forEach((row) => {
      const proposalId = String(row.id || '').trim();
      const exchangeTimeline = exchangeTimelineByProposalId.get(proposalId) || [];
      const explicitExchangeCount = exchangeTimeline.length > 0 ? exchangeTimeline.length : null;
      const threadState = getProposalThreadState(row, auth.user, {
        sharedReceivedProposalIds,
        exchangeCount: explicitExchangeCount,
      });
      const finalOutcome = String(threadState.outcome.final_status || '').toLowerCase();
      const sentAt = toDateOrNull(row.sentAt);
      const receivedAt = toDateOrNull(row.receivedAt);
      const updatedAt = toDateOrNull(row.updatedAt);
      const closedAt = toDateOrNull(row.closedAt);
      const threadActivityAt = toDateOrNull(row.lastThreadActivityAt || threadState.threadActivityAt);
      const mutualQualifiedAt =
        exchangeTimeline.length >= 2
          ? exchangeTimeline[1]
          : threadState.exchangeCount >= 2
            ? receivedAt || threadActivityAt || updatedAt || sentAt
            : null;

      if (threadState.bucket === 'drafts') {
        draftsCount += 1;
      } else if (threadState.bucket === 'archived') {
        archivedCount += 1;
      } else if (threadState.bucket === 'closed') {
        closedCount += 1;
      } else if (threadState.bucket === 'inbox') {
        inboxCount += 1;
      }

      if (
        threadState.bucket !== 'archived' &&
        threadState.listType === 'received' &&
        !threadState.isDraft &&
        isDateWithinRange(sentAt)
      ) {
        receivedCount += 1;
      } else if (
        threadState.bucket !== 'archived' &&
        threadState.listType === 'sent' &&
        !threadState.isDraft &&
        isDateWithinRange(sentAt)
      ) {
        sentCount += 1;
      }

      if (
        threadState.bucket !== 'archived' &&
        finalOutcome === 'won' &&
        isDateWithinRange(closedAt || updatedAt)
      ) {
        wonCount += 1;
      }

      if (
        threadState.bucket !== 'archived' &&
        finalOutcome === 'lost' &&
        isDateWithinRange(closedAt || updatedAt)
      ) {
        lostCount += 1;
      }

      if (
        threadState.bucket !== 'archived' &&
        Number(threadState.exchangeCount || 0) >= 2 &&
        isDateWithinRange(mutualQualifiedAt)
      ) {
        mutualInterestCount += 1;
      }
    });

    const starterUsage = await getStarterUsageSnapshot(db, {
      userId: auth.user.id,
      userEmail: auth.user.email,
    });

    ok(res, 200, {
      summary: {
        inboxCount,
        sentCount,
        receivedCount,
        draftsCount,
        archivedCount,
        mutualInterestCount,
        wonCount,
        lostCount,
        closedCount,
        totalCount: inboxCount + draftsCount + closedCount,
        starterUsage,
      },
    });
  });
}
