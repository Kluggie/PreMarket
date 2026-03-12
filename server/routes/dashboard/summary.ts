import { and, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { getProposalOutcomeState } from '../../_lib/proposal-outcomes.js';
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

    let sentCount = 0;
    let receivedCount = 0;
    let draftsCount = 0;
    let mutualInterestCount = 0;
    let wonCount = 0;
    let lostCount = 0;

    rows.forEach((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      const finalOutcome = getProposalOutcomeState(row).finalStatus;
      const isSent = Boolean(row.sentAt);
      const isOwner =
        row.userId === auth.user.id ||
        Boolean(currentEmail && normalizeEmail(row.partyAEmail) === currentEmail);
      const partyBEmail = normalizeEmail(row.partyBEmail);
      const isReceived = Boolean(
        !isOwner &&
        (
          (isSent && currentEmail && partyBEmail && partyBEmail === currentEmail) ||
          sharedReceivedProposalIdSet.has(String(row.id || '').trim())
        ),
      );
      // sent_at is the authoritative signal for "sent". Any unsent proposal you
      // own stays in Drafts regardless of status (including under_verification,
      // needs_changes, etc.) until an actual email is sent and sent_at is set.
      const isDraft = Boolean(isOwner && !isSent);

      if (isDraft) {
        draftsCount += 1;
      } else if (isReceived) {
        receivedCount += 1;
      } else if (isOwner && isSent) {
        sentCount += 1;
      }

      if (isSent && finalOutcome === 'won') {
        wonCount += 1;
      }

      if (isSent && finalOutcome === 'lost') {
        lostCount += 1;
      }

      if (isSent && (status === 'mutual_interest' || (status === 'received' && !isReceived))) {
        mutualInterestCount += 1;
      }
    });

    ok(res, 200, {
      summary: {
        sentCount,
        receivedCount,
        draftsCount,
        mutualInterestCount,
        wonCount,
        lostCount,
        closedCount: wonCount + lostCount,
        totalCount: rows.length,
      },
    });
  });
}
