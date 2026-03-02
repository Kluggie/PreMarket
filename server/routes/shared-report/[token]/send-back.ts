import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  RECIPIENT_ROLE,
  SENT_STATUS,
  SHARED_REPORT_ROUTE,
  SUPERSEDED_STATUS,
  asText,
  getCurrentRecipientDraft,
  getToken,
  logTokenEvent,
  resolveSharedReportToken,
  toObject,
} from '../_shared.js';

const SHARED_REPORT_SEND_BACK_ROUTE = `${SHARED_REPORT_ROUTE}/send-back`;

function toScoreFromPublicReport(report: Record<string, unknown>) {
  const summary = report.summary && typeof report.summary === 'object' && !Array.isArray(report.summary)
    ? (report.summary as Record<string, unknown>)
    : {};
  const candidates = [
    Number(summary.overall_score_0_100),
    Number((report as any).similarity_score),
    Number((report as any).confidence_score),
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) {
      return Math.min(100, Math.max(0, Math.floor(candidate)));
    }
  }
  return null;
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_SEND_BACK_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    logTokenEvent(context, 'send_back_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: false,
    });

    if (!resolved.link.canSendBack) {
      throw new ApiError(403, 'send_back_not_allowed', 'Send back is disabled for this link');
    }

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    if (!currentDraft) {
      throw new ApiError(400, 'draft_required', 'Save a recipient draft before sending back');
    }

    const now = new Date();
    const [latestPreviouslySent] = await resolved.db
      .select()
      .from(schema.sharedReportRecipientRevisions)
      .where(
        and(
          eq(schema.sharedReportRecipientRevisions.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportRecipientRevisions.actorRole, RECIPIENT_ROLE),
          eq(schema.sharedReportRecipientRevisions.status, SENT_STATUS),
        ),
      )
      .orderBy(desc(schema.sharedReportRecipientRevisions.updatedAt))
      .limit(1);

    await resolved.db
      .update(schema.sharedReportRecipientRevisions)
      .set({
        status: SUPERSEDED_STATUS,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sharedReportRecipientRevisions.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportRecipientRevisions.actorRole, RECIPIENT_ROLE),
          eq(schema.sharedReportRecipientRevisions.status, SENT_STATUS),
        ),
      );

    const [sentRevision] = await resolved.db
      .update(schema.sharedReportRecipientRevisions)
      .set({
        status: SENT_STATUS,
        previousRevisionId: latestPreviouslySent?.id || currentDraft.previousRevisionId || null,
        workflowStep: 3,
        updatedAt: now,
      })
      .where(eq(schema.sharedReportRecipientRevisions.id, currentDraft.id))
      .returning();

    const [latestEvaluation] = await resolved.db
      .select()
      .from(schema.sharedReportEvaluationRuns)
      .where(
        and(
          eq(schema.sharedReportEvaluationRuns.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportEvaluationRuns.revisionId, currentDraft.id),
          eq(schema.sharedReportEvaluationRuns.actorRole, RECIPIENT_ROLE),
          eq(schema.sharedReportEvaluationRuns.status, 'success'),
        ),
      )
      .orderBy(desc(schema.sharedReportEvaluationRuns.updatedAt))
      .limit(1);

    const publicReport = toObject(latestEvaluation?.resultPublicReport);
    const evaluationResult = toObject((latestEvaluation?.resultJson as any)?.evaluation_result);
    const evaluationScore = toScoreFromPublicReport(publicReport);

    if (resolved.proposal?.id) {
      await resolved.db
        .update(schema.proposals)
        .set({
          status: 'received',
          receivedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, resolved.proposal.id));

      await resolved.db.insert(schema.proposalEvaluations).values({
        id: newId('eval'),
        proposalId: resolved.proposal.id,
        userId: resolved.link.userId,
        source: 'shared_report_recipient',
        status: latestEvaluation ? 'completed' : 'received',
        score: evaluationScore,
        summary: latestEvaluation
          ? 'Recipient sent an updated shared report and evaluation.'
          : 'Recipient sent an updated shared report.',
        result: {
          source: 'shared_report_recipient',
          revision_id: sentRevision?.id || currentDraft.id,
          evaluation_run_id: latestEvaluation?.id || null,
          public_report: publicReport,
          evaluation_result: evaluationResult,
          shared_payload: toObject(sentRevision?.sharedPayload || currentDraft.sharedPayload),
          recipient_confidential_payload: toObject(
            sentRevision?.recipientConfidentialPayload || currentDraft.recipientConfidentialPayload,
          ),
          sent_at: now.toISOString(),
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    try {
      await createNotificationEvent({
        db: resolved.db,
        userId: resolved.link.userId,
        eventType: 'evaluation_update',
        emailCategory: 'evaluation_update',
        dedupeKey: `shared_report_send_back:${resolved.link.id}:${sentRevision?.id || currentDraft.id}`,
        title: 'Recipient sent updated report',
        message: `Recipient sent updates for "${asText(resolved.proposal?.title) || 'Shared Report'}".`,
        actionUrl: `/DocumentComparisonDetail?id=${encodeURIComponent(asText(resolved.comparison?.id || ''))}`,
        emailSubject: 'Recipient sent updated report',
        emailText: [
          `Recipient sent updates for "${asText(resolved.proposal?.title) || 'Shared Report'}".`,
          '',
          'Sign in to review the updated comparison details.',
        ].join('\n'),
      });
    } catch {
      // Best-effort notification only.
    }

    ok(res, 200, {
      ok: true,
      revision_id: sentRevision?.id || currentDraft.id,
      status: SENT_STATUS,
      sent_at: now,
      evaluation_id: latestEvaluation?.id || null,
    });

    logTokenEvent(context, 'send_back_success', token, {
      linkId: resolved.link.id,
      revisionId: sentRevision?.id || currentDraft.id,
      evaluationId: latestEvaluation?.id || null,
    });
  });
}
