import { eq, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { getProposalThreadState } from '../../_lib/proposal-thread-state.js';
import {
  buildProposalVisibilityScopes,
  getRecipientSharedProposalIds,
  listRecipientSharedReportLinks,
} from '../../_lib/proposal-visibility.js';
import { getStarterUsageSnapshot } from '../../_lib/starter-entitlements.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/dashboard/summary', async (context) => {
    ensureMethod(req, ['GET']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

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
      const threadState = getProposalThreadState(row, auth.user, {
        sharedReceivedProposalIds,
      });
      const finalOutcome = String(threadState.outcome.final_status || '').toLowerCase();

      if (threadState.bucket === 'drafts') {
        draftsCount += 1;
      } else if (threadState.bucket === 'archived') {
        archivedCount += 1;
      } else if (threadState.bucket === 'closed') {
        closedCount += 1;
      } else if (threadState.bucket === 'inbox') {
        inboxCount += 1;
      }

      if (threadState.bucket !== 'archived' && threadState.listType === 'received' && !threadState.isDraft) {
        receivedCount += 1;
      } else if (threadState.bucket !== 'archived' && threadState.listType === 'sent' && !threadState.isDraft) {
        sentCount += 1;
      }

      if (threadState.bucket !== 'archived' && finalOutcome === 'won') {
        wonCount += 1;
      }

      if (threadState.bucket !== 'archived' && finalOutcome === 'lost') {
        lostCount += 1;
      }

      if (threadState.bucket !== 'archived' && threadState.isMutualInterest) {
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
