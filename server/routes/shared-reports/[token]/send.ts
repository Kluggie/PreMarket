import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { toCanonicalAppUrl } from '../../../_lib/env.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId, newToken } from '../../../_lib/ids.js';
import { getResendConfig } from '../../../_lib/integrations.js';
import { appendProposalHistory } from '../../../_lib/proposal-history.js';
import {
  buildProposalThreadActivityValues,
  PROPOSAL_THREAD_ACTIVITY_SENT,
} from '../../../_lib/proposal-thread-activity.js';
import { assertProposalOpenForNegotiation, buildPendingWonReset } from '../../../_lib/proposal-outcomes.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { buildRecipientSafeEvaluationProjection } from '../../document-comparisons/_helpers.js';

const DEFAULT_SUMMARY_PREVIEW = 'An opportunity has been shared with you for review on PreMarket.';
const SUMMARY_TARGET_MIN = 100;
const SUMMARY_TARGET_PREFERRED = 150;
const SUMMARY_TARGET_MAX = 180;
const SYSTEM_STYLE_TERMS = new Set([
  'workflow',
  'module',
  'template',
  'screen',
  'component',
  'engine',
  'endpoint',
  'feature',
  'pipeline',
  'system',
]);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function normalizeInlineText(value: unknown) {
  return asText(String(value || '').replace(/\s+/g, ' '));
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function buildShareUrl(token: string) {
  const appBaseUrl = asText(process.env.APP_BASE_URL);
  const returnPath = `/shared-report/${encodeURIComponent(String(token || ''))}`;
  if (!appBaseUrl) {
    return returnPath;
  }
  return toCanonicalAppUrl(appBaseUrl, returnPath);
}

function normalizeErrorForStorage(message: unknown) {
  const text = asText(message);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').slice(0, 400);
}

function clipAtWordBoundary(input: string, preferred = SUMMARY_TARGET_PREFERRED, hardLimit = SUMMARY_TARGET_MAX) {
  const text = normalizeInlineText(input);
  if (!text) {
    return '';
  }
  if (text.length <= hardLimit) {
    return text;
  }

  const sliced = text.slice(0, hardLimit + 1);
  let cutoff = sliced.lastIndexOf(' ', preferred);
  if (cutoff < Math.floor(preferred * 0.65)) {
    cutoff = sliced.lastIndexOf(' ');
  }
  if (cutoff <= 0) {
    cutoff = hardLimit;
  }

  const trimmed = sliced.slice(0, cutoff).trim().replace(/[,:;.!?]+$/g, '');
  const fallback = sliced.slice(0, hardLimit).trim();
  return `${trimmed || fallback}...`;
}

function summarizePreviewText(value: unknown) {
  const text = normalizeInlineText(value);
  if (!text) {
    return '';
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => normalizeInlineText(sentence))
    .filter(Boolean);
  if (!sentences.length) {
    return clipAtWordBoundary(text);
  }

  let selected = '';
  for (const sentence of sentences) {
    const candidate = selected ? `${selected} ${sentence}` : sentence;
    if (candidate.length > SUMMARY_TARGET_MAX) {
      if (!selected || selected.length < SUMMARY_TARGET_MIN) {
        return clipAtWordBoundary(candidate);
      }
      break;
    }
    selected = candidate;
    if (selected.length >= SUMMARY_TARGET_MIN) {
      break;
    }
  }

  const result = selected || sentences[0];
  return result.length > SUMMARY_TARGET_MAX ? clipAtWordBoundary(result) : result;
}

function ensureSentenceEnding(value: string) {
  const text = normalizeInlineText(value);
  if (!text) {
    return '';
  }
  if (/[.!?]$/.test(text) || text.endsWith('...')) {
    return text;
  }
  return `${text}.`;
}

function stripSummaryLabelPrefix(value: unknown) {
  const text = normalizeInlineText(value);
  if (!text) {
    return '';
  }

  return text
    .replace(
      /^(proposal\s+preview|proposal\s+summary|summary|overview|snapshot|proposal|document\s+comparison)\s*[:\-]\s*/i,
      '',
    )
    .trim();
}

function isSystemStyleSummary(value: unknown) {
  const normalized = normalizeInlineText(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  const words = normalized.split(' ').filter(Boolean);
  if (!words.length) {
    return true;
  }

  const hasPunctuation = /[.!?]/.test(normalized);
  const systemTermCount = words.filter((word) => SYSTEM_STYLE_TERMS.has(word)).length;
  const labelOnly = /^(document|proposal|comparison|shared|summary|overview|workflow|module|template)(\s+(document|proposal|comparison|shared|summary|overview|workflow|module|template))*$/i.test(
    normalized,
  );

  if (labelOnly) {
    return true;
  }
  if (!hasPunctuation && words.length <= 4) {
    return true;
  }
  if (!hasPunctuation && words.length <= 7 && systemTermCount > 0) {
    return true;
  }
  return false;
}

function toNaturalLanguagePreview(value: unknown) {
  const cleaned = stripSummaryLabelPrefix(value);
  if (!cleaned) {
    return '';
  }

  const summarized = summarizePreviewText(cleaned);
  if (!summarized) {
    return '';
  }

  if (!isSystemStyleSummary(summarized)) {
    return ensureSentenceEnding(summarized);
  }

  const base = cleaned.replace(/[.!?]+$/g, '').trim();
  if (!base || isSystemStyleSummary(base)) {
    return '';
  }

  if (/^(a|an|the|this|that)\b/i.test(base)) {
    return ensureSentenceEnding(summarizePreviewText(base));
  }

  return ensureSentenceEnding(
    summarizePreviewText(`An opportunity outlining ${base.charAt(0).toLowerCase()}${base.slice(1)}`),
  );
}

function extractSectionSummary(report: Record<string, any>) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      continue;
    }

    const heading = normalizeInlineText(section.heading || section.title || section.key).toLowerCase();
    const isSummarySection =
      heading.includes('summary') ||
      heading.includes('overview') ||
      heading.includes('snapshot') ||
      heading.includes('proposal');
    if (!isSummarySection) {
      continue;
    }

    const direct = normalizeInlineText(
      section.summary || section.text || section.description || section.value_summary,
    );
    if (direct) {
      return direct;
    }

    const bullets = Array.isArray(section.bullets)
      ? section.bullets.map((entry: unknown) => normalizeInlineText(entry)).filter(Boolean)
      : [];
    if (bullets.length > 0) {
      return bullets.join(' ');
    }
  }
  return '';
}

function isGenericProjectionSummary(value: string) {
  const normalized = normalizeInlineText(value).toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    normalized.includes('recipient-safe evaluation generated from shared information only') ||
    normalized.includes('evaluation generated from shared information only') ||
    normalized.includes('shared information provides the basis for this recipient-safe fit summary') ||
    normalized.includes('shared information was used to generate this recipient-safe report')
  );
}

function buildSummaryPreview(params: { proposal: any; comparison: any }) {
  const comparison = params.comparison || null;
  const sharedTextSummary = normalizeInlineText(comparison?.docBText);

  let safeEvaluationSummary = '';
  let safeExecutiveSummary = '';
  let safeSectionSummary = '';
  if (comparison) {
    const projection = buildRecipientSafeEvaluationProjection({
      evaluationResult: comparison.evaluationResult || {},
      publicReport: comparison.publicReport || {},
      confidentialText: comparison.docAText || '',
      sharedText: comparison.docBText || '',
      title: comparison.title || params.proposal?.title || 'Business Proposal',
    });
    const safeEvaluation = toObject(projection.evaluation_result);
    const safeReport = toObject(projection.public_report);
    safeEvaluationSummary = normalizeInlineText(safeEvaluation.summary);
    safeExecutiveSummary = normalizeInlineText(safeReport.executive_summary);
    safeSectionSummary = extractSectionSummary(safeReport);

    if (isGenericProjectionSummary(safeEvaluationSummary)) {
      safeEvaluationSummary = '';
    }
    if (isGenericProjectionSummary(safeExecutiveSummary)) {
      safeExecutiveSummary = '';
    }
    if (isGenericProjectionSummary(safeSectionSummary)) {
      safeSectionSummary = '';
    }
  }

  const candidates = [safeExecutiveSummary, safeEvaluationSummary, safeSectionSummary, sharedTextSummary];
  for (const candidate of candidates) {
    const preview = toNaturalLanguagePreview(candidate);
    if (preview) {
      return preview;
    }
  }

  return DEFAULT_SUMMARY_PREVIEW;
}

function buildSharedProposalEmail(params: {
  senderName: string;
  proposalTitle: string;
  shareUrl: string;
  summaryPreview: string;
}) {
  const senderName = normalizeInlineText(params.senderName) || 'A PreMarket user';
  const proposalTitle = normalizeInlineText(params.proposalTitle) || 'Untitled opportunity';
  const shareUrl = asText(params.shareUrl);
  const summaryPreview = toNaturalLanguagePreview(params.summaryPreview) || DEFAULT_SUMMARY_PREVIEW;

  const subject = `${senderName} invited you to review an opportunity — ${proposalTitle}`;
  const text = [
    'PreMarket | Opportunity Invite',
    '',
    `${senderName} invited you to review an opportunity on PreMarket.`,
    '',
    'Opportunity',
    proposalTitle,
    '',
    'Summary',
    summaryPreview,
    '',
    `Review Opportunity: ${shareUrl}`,
    '',
    `If the button doesn't work, open this link: ${shareUrl}`,
    '',
    'This opportunity was shared with you via PreMarket.',
    "If you weren't expecting this email, you can safely ignore it.",
  ].join('\n');

  const escapedSenderName = escapeHtml(senderName);
  const escapedTitle = escapeHtml(proposalTitle);
  const escapedSummary = escapeHtml(summaryPreview);
  const escapedShareUrl = escapeHtml(shareUrl);
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<body style="margin:0;padding:0;background-color:#f5f7fb;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fb;padding:24px 12px;">',
    '<tr>',
    '<td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">',
    '<tr>',
    '<td style="padding:30px 32px 20px;border-bottom:1px solid #eef2f7;">',
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:18px;font-weight:700;line-height:1.2;">PreMarket</div>',
    '<div style="margin-top:6px;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#334155;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:5px 10px;">Opportunity Invite</div>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:28px 32px 0;">',
    `<h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:23px;font-weight:700;line-height:1.32;">${escapedSenderName} invited you to review an opportunity</h1>`,
    '<p style="margin:12px 0 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;">Review the shared materials and, if relevant, add your information to support a more complete assessment.</p>',
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
    '<p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">Summary</p>',
    `<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;">${escapedSummary}</p>`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:28px 32px 24px;text-align:center;">',
    `<a href="${escapedShareUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:196px;background:#0f172a;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:13px 28px;border-radius:10px;">Review Opportunity</a>`,
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

  return {
    subject,
    text,
    html,
  };
}

function isExpired(expiresAt: Date | string | null) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

async function createDeliveryLog(params: {
  db: any;
  sharedLinkId: string;
  proposalId: string;
  userId: string;
  sentToEmail: string;
  status: 'queued' | 'sent' | 'failed';
  providerMessageId?: string | null;
  lastError?: string | null;
}) {
  const now = new Date();
  const [created] = await params.db
    .insert(schema.sharedReportDeliveries)
    .values({
      id: newId('share_delivery'),
      sharedLinkId: params.sharedLinkId,
      proposalId: params.proposalId,
      userId: params.userId,
      sentToEmail: params.sentToEmail,
      status: params.status,
      providerMessageId: params.providerMessageId || null,
      lastError: params.lastError || null,
      sentAt: params.status === 'sent' ? now : null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/sharedReports/[token]/send', async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [joined] = await db
      .select({
        link: schema.sharedLinks,
        proposal: schema.proposals,
      })
      .from(schema.sharedLinks)
      .leftJoin(schema.proposals, eq(schema.proposals.id, schema.sharedLinks.proposalId))
      .where(
        and(eq(schema.sharedLinks.token, token), eq(schema.sharedLinks.userId, auth.user.id)),
      )
      .limit(1);

    const link = joined?.link || null;
    const proposal = joined?.proposal || null;
    if (!link || !proposal) {
      throw new ApiError(404, 'shared_report_not_found', 'Shared report link not found');
    }
    if (link.mode !== 'shared_report') {
      throw new ApiError(404, 'shared_report_not_found', 'Shared report link not found');
    }
    if (link.status !== 'active' || !link.canView) {
      throw new ApiError(409, 'token_inactive', 'Shared report link is not active');
    }
    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared report link has expired');
    }
    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared report link reached its usage limit');
    }

    const body = await readJsonBody(req);
    const recipientEmail = normalizeEmail(
      body.recipientEmail || body.recipient_email || link.recipientEmail || proposal.partyBEmail,
    );
    if (!recipientEmail || !isLikelyEmail(recipientEmail)) {
      throw new ApiError(400, 'invalid_input', 'A valid recipientEmail is required');
    }

    const reportMetadata = toObject(link.reportMetadata);
    const comparisonId = asText(reportMetadata.comparison_id) || asText(proposal.documentComparisonId);

    // ── Multi-recipient independence: fork when sending to a different person ──
    const existingLinkRecipient = normalizeEmail(link.recipientEmail);
    const existingProposalRecipient = normalizeEmail(proposal.partyBEmail);
    const needsFork = Boolean(
      proposal.sentAt &&
        (existingLinkRecipient || existingProposalRecipient) &&
        (existingLinkRecipient ? existingLinkRecipient !== recipientEmail : existingProposalRecipient !== recipientEmail),
    );

    let targetProposal = proposal;
    let targetLink = link;
    let targetComparisonId = comparisonId;

    if (needsFork) {
      const forkedProposalId = newId('proposal');
      let forkedComparisonId: string | null = null;

      // Create forked proposal first (before comparison, to satisfy FK)
      const [forkedRow] = await db
        .insert(schema.proposals)
        .values({
          id: forkedProposalId,
          userId: proposal.userId,
          title: proposal.title,
          status: 'draft',
          statusReason: proposal.statusReason,
          templateId: proposal.templateId,
          templateName: proposal.templateName,
          proposalType: proposal.proposalType,
          draftStep: proposal.draftStep,
          sourceProposalId: proposal.id,
          documentComparisonId: null,
          partyAEmail: proposal.partyAEmail,
          partyBEmail: recipientEmail,
          partyBName: null,
          summary: proposal.summary,
          isPrivateMode: proposal.isPrivateMode,
          payload: proposal.payload,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Clone document comparison if one exists
      if (comparisonId) {
        const [sourceComparison] = await db
          .select()
          .from(schema.documentComparisons)
          .where(eq(schema.documentComparisons.id, comparisonId))
          .limit(1);

        if (sourceComparison) {
          const newCompId = newId('comparison');
          await db.insert(schema.documentComparisons).values({
            id: newCompId,
            userId: sourceComparison.userId,
            proposalId: forkedProposalId,
            title: sourceComparison.title,
            status: sourceComparison.status,
            draftStep: sourceComparison.draftStep,
            partyALabel: sourceComparison.partyALabel,
            partyBLabel: sourceComparison.partyBLabel,
            companyName: sourceComparison.companyName,
            companyWebsite: sourceComparison.companyWebsite,
            recipientName: sourceComparison.recipientName,
            recipientEmail: recipientEmail,
            docAText: sourceComparison.docAText,
            docBText: sourceComparison.docBText,
            docASpans: sourceComparison.docASpans,
            docBSpans: sourceComparison.docBSpans,
            evaluationResult: sourceComparison.evaluationResult,
            publicReport: sourceComparison.publicReport,
            inputs: sourceComparison.inputs,
            metadata: sourceComparison.metadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          forkedComparisonId = newCompId;
          targetComparisonId = newCompId;

          // Link the forked proposal to its comparison
          await db
            .update(schema.proposals)
            .set({ documentComparisonId: forkedComparisonId, updatedAt: new Date() })
            .where(eq(schema.proposals.id, forkedProposalId));
          forkedRow.documentComparisonId = forkedComparisonId;
        }
      }

      targetProposal = forkedRow;

      // Create a new shared link for the forked proposal
      const forkedToken = newToken(24);
      const [forkedLink] = await db
        .insert(schema.sharedLinks)
        .values({
          id: newId('share'),
          token: forkedToken,
          userId: auth.user.id,
          proposalId: forkedProposalId,
          recipientEmail,
          status: 'active',
          mode: 'shared_report',
          canView: link.canView,
          canEdit: link.canEdit,
          canEditConfidential: link.canEditConfidential,
          canReevaluate: link.canReevaluate,
          canSendBack: link.canSendBack,
          maxUses: link.maxUses,
          uses: 0,
          expiresAt: link.expiresAt,
          idempotencyKey: null,
          reportMetadata: {
            ...reportMetadata,
            comparison_id: forkedComparisonId || null,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      targetLink = forkedLink;
    }

    const [comparison] = targetComparisonId
      ? await db
          .select()
          .from(schema.documentComparisons)
          .where(
            and(
              eq(schema.documentComparisons.id, targetComparisonId),
              eq(schema.documentComparisons.proposalId, targetProposal.id),
            ),
          )
          .limit(1)
      : [null];

    const senderName = normalizeInlineText((auth.user as any)?.name) || asText(auth.user.email) || 'A PreMarket user';
    const title = normalizeInlineText(targetProposal.title) || 'Untitled opportunity';
    const shareUrl = buildShareUrl(targetLink.token);
    const summaryPreview = buildSummaryPreview({ proposal: targetProposal, comparison });
    assertProposalOpenForNegotiation(targetProposal);
    const emailContent = buildSharedProposalEmail({
      senderName,
      proposalTitle: title,
      shareUrl,
      summaryPreview,
    });

    const resend = getResendConfig();
    if (!resend.ready) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: targetLink.id,
        proposalId: targetProposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: 'Resend is not configured',
      });
      throw new ApiError(
        501,
        'not_configured',
        'Resend email delivery is not configured',
        { deliveryId: delivery.id },
      );
    }

    const from = resend.fromName ? `${resend.fromName} <${resend.fromEmail}>` : resend.fromEmail;
    const payload: Record<string, unknown> = {
      from,
      to: [recipientEmail],
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    };

    if (resend.replyTo) {
      payload.reply_to = resend.replyTo;
    }

    let response: Response;
    let responseBody: any = {};
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      responseBody = await response.json().catch(() => ({}));
    } catch (error: any) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: targetLink.id,
        proposalId: targetProposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: normalizeErrorForStorage(error?.message || 'Email provider unavailable'),
      });
      throw new ApiError(502, 'email_send_failed', 'Failed to send email', { deliveryId: delivery.id });
    }

    if (!response.ok) {
      const delivery = await createDeliveryLog({
        db,
        sharedLinkId: targetLink.id,
        proposalId: targetProposal.id,
        userId: auth.user.id,
        sentToEmail: recipientEmail,
        status: 'failed',
        lastError: normalizeErrorForStorage(
          responseBody?.message || responseBody?.error || `Provider status ${response.status}`,
        ),
      });
      throw new ApiError(502, 'email_send_failed', 'Failed to send email', {
        deliveryId: delivery.id,
        providerStatus: response.status,
      });
    }

    const providerMessageId = asText(responseBody?.id) || null;
    const delivery = await createDeliveryLog({
      db,
      sharedLinkId: targetLink.id,
      proposalId: targetProposal.id,
      userId: auth.user.id,
      sentToEmail: recipientEmail,
      status: 'sent',
      providerMessageId,
      lastError: null,
    });

    // Only update recipientEmail on the link if NOT forked (same recipient resend)
    if (!needsFork) {
      await db
        .update(schema.sharedLinks)
        .set({
          recipientEmail,
          updatedAt: new Date(),
        })
        .where(eq(schema.sharedLinks.id, targetLink.id));
    }

    const proposalSentAt = new Date();
    const proposalPendingWonReset = buildPendingWonReset(targetProposal, proposalSentAt) || {};
    const threadActivity = buildProposalThreadActivityValues({
      activityAt: proposalSentAt,
      actorRole: 'party_a',
      activityType: PROPOSAL_THREAD_ACTIVITY_SENT,
    });

    await db
      .update(schema.proposals)
      .set({
        status: 'sent',
        sentAt: proposalSentAt,
        partyBEmail: recipientEmail,
        lastSharedAt: proposalSentAt,
        lastThreadActivityAt: threadActivity.lastThreadActivityAt,
        lastThreadActorRole: threadActivity.lastThreadActorRole,
        lastThreadActivityType: threadActivity.lastThreadActivityType,
        ...proposalPendingWonReset,
        updatedAt: proposalSentAt,
      })
      .where(eq(schema.proposals.id, targetProposal.id));

    await appendProposalHistory(db, {
      proposal: {
        ...targetProposal,
        status: 'sent',
        sentAt: proposalSentAt,
        partyBEmail: recipientEmail,
        lastSharedAt: proposalSentAt,
        ...threadActivity,
        ...proposalPendingWonReset,
        updatedAt: proposalSentAt,
      },
      actorUserId: auth.user.id,
      actorRole: 'party_a',
      milestone: 'send',
      eventType: 'proposal.sent',
      sharedLinks: [
        {
          ...targetLink,
          recipientEmail,
        },
      ],
      createdAt: proposalSentAt,
      requestId: context.requestId,
      eventData: {
        shared_link_id: targetLink.id,
        shared_link_token: targetLink.token,
        comparison_id: targetComparisonId || null,
        recipient_email: recipientEmail,
        source: 'shared_report_email',
        forked_from_proposal_id: needsFork ? proposal.id : undefined,
      },
    });

    ok(res, 200, {
      sent: true,
      token: targetLink.token,
      url: shareUrl,
      delivery: {
        id: delivery.id,
        status: delivery.status,
        sent_to_email: delivery.sentToEmail,
        provider_message_id: delivery.providerMessageId || null,
        last_error: delivery.lastError || null,
        sent_at: delivery.sentAt || null,
      },
    });
  });
}
