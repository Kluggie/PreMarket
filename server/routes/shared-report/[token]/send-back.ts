import { and, desc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { getResendConfig } from '../../../_lib/integrations.js';
import { createNotificationEvent } from '../../../_lib/notifications.js';
import { appendProposalHistory } from '../../../_lib/proposal-history.js';
import {
  getLinkRecipientAuthorRole,
  HISTORY_AUTHOR_PROPOSER,
  recordSharedReportContributionGroup,
  resolveSharedReportLinkRound,
} from '../../../_lib/shared-report-history.js';
import {
  buildProposalThreadActivityValues,
  PROPOSAL_THREAD_ACTIVITY_SEND_BACK,
} from '../../../_lib/proposal-thread-activity.js';
import {
  assertProposalOpenForNegotiation,
  buildPendingWonReset,
  PROPOSAL_PARTY_A,
  PROPOSAL_PARTY_B,
} from '../../../_lib/proposal-outcomes.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  htmlToEditorText,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import {
  RECIPIENT_ROLE,
  SENT_STATUS,
  SHARED_REPORT_ROUTE,
  SUPERSEDED_STATUS,
  asText,
  getCurrentRecipientDraft,
  getPayloadText,
  getToken,
  logTokenEvent,
  requireRecipientAuthorization,
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

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildShareUrl(token: string) {
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  const returnPath = `/shared-report/${encodeURIComponent(String(token || ''))}`;
  if (!appBaseUrl) {
    return returnPath;
  }
  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

/**
 * Extracts text from a revision's sharedPayload. Attempts to read `text` directly,
 * then falls back to HTML-to-text conversion.
 */
function extractSharedText(sharedPayload: Record<string, unknown>): string {
  const textValue = getPayloadText(sharedPayload, '');
  if (textValue) {
    return sanitizeEditorText(textValue);
  }
  const htmlValue = asText(sharedPayload?.html);
  if (htmlValue) {
    return sanitizeEditorText(htmlToEditorText(htmlValue));
  }
  return '';
}

/**
 * Resolves the current round number from a link's reportMetadata.
 * Returns 1 if no round info exists (first exchange).
 */
function resolveRoundNumber(reportMetadata: Record<string, unknown>): number {
  const round = Number(reportMetadata?.exchange_round || reportMetadata?.round || 0);
  return Number.isFinite(round) && round >= 1 ? Math.floor(round) : 1;
}

function mapHistoryAuthorRoleToProposalPartyRole(authorRole: string) {
  return authorRole === HISTORY_AUTHOR_PROPOSER ? PROPOSAL_PARTY_A : PROPOSAL_PARTY_B;
}

function buildSendBackEmail(params: {
  senderName: string;
  proposalTitle: string;
  shareUrl: string;
  roundNumber: number;
}) {
  const { senderName, proposalTitle, shareUrl } = params;
  const escapedSenderName = escapeHtml(senderName);
  const escapedTitle = escapeHtml(proposalTitle);
  const escapedShareUrl = escapeHtml(shareUrl);

  const subject = `Updated opportunity ready for review — ${proposalTitle}`;

  const text = [
    `${senderName} returned an updated opportunity.`,
    '',
    `Opportunity: ${proposalTitle}`,
    '',
    `Review the updated opportunity: ${shareUrl}`,
    '',
    'Sign in to PreMarket to review the latest changes.',
    '',
    "If you weren't expecting this email, you can safely ignore it.",
  ].join('\n');

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>',
    '<body style="margin:0;padding:0;background-color:#f5f7fb;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fb;padding:24px 12px;">',
    '<tr>',
    '<td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">',
    '<tr>',
    '<td style="padding:30px 32px 20px;border-bottom:1px solid #eef2f7;">',
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:18px;font-weight:700;line-height:1.2;">PreMarket</div>',
    '<div style="margin-top:6px;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#334155;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:5px 10px;">Updated Opportunity</div>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:28px 32px 0;">',
    `<h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:23px;font-weight:700;line-height:1.32;">${escapedSenderName} returned an updated opportunity</h1>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:24px 32px 0;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">',
    '<tr>',
    '<td style="padding:14px 16px 6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">Opportunity</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:0 16px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:1.5;color:#0f172a;">${escapedTitle}</td>`,
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:20px 32px 0;">',
    `<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;">An updated version is ready for your review. Review the latest changes and continue the discussion.</p>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:28px 32px 24px;text-align:center;">',
    `<a href="${escapedShareUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:196px;background:#0f172a;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:13px 28px;border-radius:10px;">Review Updated Opportunity</a>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:0 32px 30px;">',
    '<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;">If the button doesn&apos;t work, open this link:</p>',
    `<p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#2563eb;word-break:break-all;">${escapedShareUrl}</p>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:18px 32px 26px;border-top:1px solid #eef2f7;">',
    '<p style="margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;">This opportunity was shared with you via PreMarket.</p>',
    '<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;">If you weren&apos;t expecting this email, you can safely ignore it.</p>',
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');

  return { subject, text, html };
}

/**
 * Sends the send-back email directly via Resend API, bypassing the
 * EMAIL_MODE gate. The send-back email is a user-triggered transactional
 * action (like the original proposal share) and must always be delivered.
 *
 * Returns the Resend provider message ID on success, null on failure.
 */
async function sendSendBackEmailDirect(params: {
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ sent: boolean; providerMessageId: string | null; error: string | null }> {
  const resend = getResendConfig();
  if (!resend.ready) {
    return { sent: false, providerMessageId: null, error: 'resend_not_configured' };
  }

  const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
  const payload: Record<string, unknown> = {
    from,
    to: [params.recipientEmail],
    subject: params.subject,
    text: params.text,
    html: params.html,
  };
  if (resend.replyTo) {
    payload.reply_to = resend.replyTo;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        sent: false,
        providerMessageId: null,
        error: asText(body?.message || body?.error || `Provider status ${response.status}`),
      };
    }
    return {
      sent: true,
      providerMessageId: asText(body?.id) || null,
      error: null,
    };
  } catch (err: any) {
    return {
      sent: false,
      providerMessageId: null,
      error: asText(err?.message || 'Email provider unavailable'),
    };
  }
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_SEND_BACK_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

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
    });
    requireRecipientAuthorization(resolved.link, auth.user);
    if (resolved.proposal) {
      assertProposalOpenForNegotiation(resolved.proposal);
    }

    if (!resolved.link.canSendBack) {
      throw new ApiError(403, 'send_back_not_allowed', 'Send back is disabled for this link');
    }

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    if (!currentDraft) {
      throw new ApiError(400, 'draft_required', 'Save a recipient draft before sending back');
    }

    const now = new Date();
    const pendingWonReset = resolved.proposal
      ? buildPendingWonReset(resolved.proposal, now) || {}
      : {};

    // ── 1. Supersede old sent revisions and promote current draft ──────────

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

    // ── 2. Capture latest evaluation for this revision ─────────────────────

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
    const stableAuthorRole =
      getLinkRecipientAuthorRole({
        proposal: resolved.proposal,
        link: resolved.link,
      }) || RECIPIENT_ROLE;
    const proposalActorRole = mapHistoryAuthorRoleToProposalPartyRole(stableAuthorRole);
    const outgoingRoundNumber = resolveSharedReportLinkRound(toObject(resolved.link.reportMetadata)) + 1;

    // ── 3. Update comparison with latest shared text + report ──────────────

    const comparisonId = asText(
      (resolved.link.reportMetadata as any)?.comparison_id ||
      resolved.comparison?.id ||
      resolved.proposal?.documentComparisonId,
    );

    const sentSharedPayload = toObject(sentRevision?.sharedPayload || currentDraft.sharedPayload);
    const sentConfidentialPayload = toObject(
      sentRevision?.recipientConfidentialPayload || currentDraft.recipientConfidentialPayload,
    );
    const updatedSharedText = extractSharedText(sentSharedPayload);
    const updatedConfidentialText = extractSharedText(sentConfidentialPayload);

    await recordSharedReportContributionGroup({
      db: resolved.db,
      proposalId: resolved.proposal.id,
      comparisonId: comparisonId || null,
      sharedLinkId: resolved.link.id,
      authorRole: stableAuthorRole,
      authorUserId: auth.user.id,
      roundNumber: outgoingRoundNumber,
      sourceKind: 'shared_report_send_back',
      sharedPayload: sentSharedPayload,
      confidentialPayload: sentConfidentialPayload,
      newId,
      now,
    });

    if (comparisonId) {
      const comparisonUpdate: Record<string, unknown> = {
        updatedAt: now,
      };
      if (stableAuthorRole === HISTORY_AUTHOR_PROPOSER) {
        if (updatedSharedText) {
          comparisonUpdate.docBText = updatedSharedText;
        }
        if (updatedConfidentialText) {
          comparisonUpdate.docAText = updatedConfidentialText;
        }
      }
      // Update the public report on the comparison so the next round sees
      // the latest evaluation as the baseline report.
      if (latestEvaluation && Object.keys(publicReport).length > 0) {
        comparisonUpdate.publicReport = publicReport;
        comparisonUpdate.evaluationResult = evaluationResult;
        comparisonUpdate.status = 'evaluated';
      }
      await resolved.db
        .update(schema.documentComparisons)
        .set(comparisonUpdate)
        .where(eq(schema.documentComparisons.id, comparisonId));
    }

    // ── 4. Update proposal status ──────────────────────────────────────────

    if (resolved.proposal?.id) {
      const threadActivity = buildProposalThreadActivityValues({
        activityAt: now,
        actorRole: proposalActorRole,
        activityType: PROPOSAL_THREAD_ACTIVITY_SEND_BACK,
      });
      await resolved.db
        .update(schema.proposals)
        .set({
          status: 'received',
          receivedAt: now,
          lastThreadActivityAt: threadActivity.lastThreadActivityAt,
          lastThreadActorRole: threadActivity.lastThreadActorRole,
          lastThreadActivityType: threadActivity.lastThreadActivityType,
          ...pendingWonReset,
          updatedAt: now,
        })
        .where(eq(schema.proposals.id, resolved.proposal.id));

      const evaluationValues = {
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
          shared_payload: sentSharedPayload,
          recipient_confidential_payload: toObject(
            sentRevision?.recipientConfidentialPayload || currentDraft.recipientConfidentialPayload,
          ),
          sent_at: now.toISOString(),
        },
        createdAt: now,
        updatedAt: now,
      };
      await resolved.db.insert(schema.proposalEvaluations).values(evaluationValues);

      await appendProposalHistory(resolved.db, {
        proposal: {
          ...resolved.proposal,
          status: 'received',
          receivedAt: now,
          ...threadActivity,
          ...pendingWonReset,
          updatedAt: now,
        },
        actorUserId: auth.user.id,
        actorRole: proposalActorRole,
        milestone: 'send_back',
        eventType: 'proposal.send_back',
        documentComparison: comparisonId && resolved.comparison
          ? {
              ...resolved.comparison,
              docAText:
                stableAuthorRole === HISTORY_AUTHOR_PROPOSER && updatedConfidentialText
                  ? updatedConfidentialText
                  : resolved.comparison.docAText,
              docBText:
                stableAuthorRole === HISTORY_AUTHOR_PROPOSER && updatedSharedText
                  ? updatedSharedText
                  : resolved.comparison.docBText,
              publicReport: Object.keys(publicReport).length > 0 ? publicReport : resolved.comparison.publicReport,
              evaluationResult: Object.keys(evaluationResult).length > 0
                ? evaluationResult
                : resolved.comparison.evaluationResult,
              updatedAt: now,
            }
          : null,
        recipientRevisions: [sentRevision || currentDraft],
        evaluations: [evaluationValues],
        createdAt: now,
        requestId: context.requestId,
        eventData: {
          shared_link_id: resolved.link.id,
          shared_link_token: resolved.link.token,
          comparison_id: comparisonId || null,
          recipient_email: normalizeEmail(resolved.link.recipientEmail),
          revision_id: sentRevision?.id || currentDraft.id,
          evaluation_run_id: latestEvaluation?.id || null,
        },
      });
    }

    // ── 5. Create a new shared link for the counterparty ───────────────────

    const currentRound = resolveRoundNumber(toObject(resolved.link.reportMetadata));
    const nextRound = currentRound + 1;
    const title = asText(resolved.comparison?.title) || asText(resolved.proposal?.title) || 'Shared Report';

    // The counterparty is the link owner (the person who shared THIS link).
    const counterpartyUserId = resolved.link.userId;
    const counterpartyEmail = normalizeEmail(resolved.owner?.email);
    const senderName = asText(auth.user.name || auth.user.email || 'A PreMarket user');

    let returnLinkToken: string | null = null;
    let returnLinkUrl: string | null = null;

    if (counterpartyEmail && isLikelyEmail(counterpartyEmail) && resolved.proposal?.id) {
      const nextToken = newToken(24);
      returnLinkUrl = buildShareUrl(nextToken);
      returnLinkToken = nextToken;

      await resolved.db.insert(schema.sharedLinks).values({
        id: newId('share'),
        token: nextToken,
        userId: auth.user.id,
        proposalId: resolved.proposal.id,
        recipientEmail: counterpartyEmail,
        status: 'active',
        mode: 'shared_report',
        canView: true,
        canEdit: true,
        canEditConfidential: true,
        canReevaluate: true,
        canSendBack: true,
        maxUses: 0,
        uses: 0,
        lastUsedAt: null,
        expiresAt: null,
        idempotencyKey: null,
        reportMetadata: {
          workflow: 'single_shared_report',
          comparison_id: comparisonId || null,
          exchange_round: nextRound,
          parent_link_id: resolved.link.id,
          parent_token: token,
          sent_by_user_id: auth.user.id,
          sent_by_email: normalizeEmail(auth.user.email),
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    // ── 6. Send email directly via Resend ──────────────────────────────────

    let emailResult: { sent: boolean; providerMessageId: string | null; error: string | null } = {
      sent: false,
      providerMessageId: null,
      error: 'no_counterparty_email',
    };

    if (counterpartyEmail && isLikelyEmail(counterpartyEmail) && returnLinkUrl) {
      const emailContent = buildSendBackEmail({
        senderName,
        proposalTitle: title,
        shareUrl: returnLinkUrl,
        roundNumber: nextRound,
      });

      emailResult = await sendSendBackEmailDirect({
        recipientEmail: counterpartyEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
    }

    // ── 7. Create in-app notification (best-effort) ────────────────────────

    try {
      const notificationUrl = returnLinkUrl
        ? `/shared-report/${encodeURIComponent(returnLinkToken || '')}`
        : `/DocumentComparisonDetail?id=${encodeURIComponent(comparisonId || '')}`;

      await createNotificationEvent({
        db: resolved.db,
        userId: counterpartyUserId,
        eventType: 'evaluation_update',
        emailCategory: 'evaluation_complete',
        dedupeKey: `shared_report_send_back:${resolved.link.id}:${sentRevision?.id || currentDraft.id}`,
        title: 'Updated opportunity ready for review',
        message: `An updated version of "${title}" is ready for your review.`,
        actionUrl: notificationUrl,
        emailSubject: `Updated opportunity ready for review — ${title}`,
        emailText: [
          `An updated version of "${title}" is ready for your review.`,
          '',
          returnLinkUrl
            ? `Review the updated opportunity: ${returnLinkUrl}`
            : 'Sign in to review the latest changes.',
        ].join('\n'),
        // Disable the notification system's own email — we already sent directly
        sendEmail: false,
      });
    } catch {
      // Best-effort notification only.
    }

    // ── 8. Return response ─────────────────────────────────────────────────

    ok(res, 200, {
      ok: true,
      revision_id: sentRevision?.id || currentDraft.id,
      status: SENT_STATUS,
      sent_at: now,
      evaluation_id: latestEvaluation?.id || null,
      return_link: returnLinkToken
        ? {
            token: returnLinkToken,
            url: returnLinkUrl,
            recipient_email: counterpartyEmail,
            exchange_round: nextRound,
          }
        : null,
      email: {
        sent: emailResult.sent,
        provider_message_id: emailResult.providerMessageId,
        error: emailResult.error,
      },
    });

    logTokenEvent(context, 'send_back_success', token, {
      linkId: resolved.link.id,
      revisionId: sentRevision?.id || currentDraft.id,
      evaluationId: latestEvaluation?.id || null,
      returnLinkToken: returnLinkToken || null,
      emailSent: emailResult.sent,
      exchangeRound: nextRound,
    });
  });
}
