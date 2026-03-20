import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { loadSharedReportHistory } from '../../../_lib/shared-report-history.js';
import {
  buildDefaultSharedPayload,
  getToken,
  resolveSharedReportToken,
  SHARED_REPORT_ROUTE,
} from '../_shared.js';
import {
  renderOpportunityHistoryPdfBuffer,
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
} from '../../document-comparisons/_pdf.js';

const SHARED_REPORT_DOWNLOAD_PROPOSAL_PDF_ROUTE = `${SHARED_REPORT_ROUTE}/download/proposal-pdf`;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRawText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r/g, '') : '';
}

function toFallbackHeading(value: unknown) {
  return asText(value)
    .replace(/\s--\s/g, ' - ')
    .replace(/[—–]/g, '-')
    .replace(/\s{2,}/g, ' ');
}

function formatDateTime(value: unknown) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function htmlToText(value: unknown) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildFallbackSections(entries: any[]) {
  return [
    {
      heading: 'Shared History',
      level: 1 as const,
      paragraphs: [],
    },
    ...entries.map((entry: any) => {
      const captionBits = [
        asText(entry?.authorLabel) ? `Author: ${asText(entry.authorLabel)}` : '',
        asText(entry?.sourceLabel) ? `Source: ${asText(entry.sourceLabel)}` : '',
        asText(entry?.timestampLabel) ? `Shared: ${asText(entry.timestampLabel)}` : '',
      ].filter(Boolean);
      const files = Array.isArray(entry?.files) ? entry.files.map((file: any) => asText(file)).filter(Boolean) : [];
      const bodyText =
        asText(entry?.text) ||
        htmlToText(entry?.html) ||
        '(No shared content provided)';
      return {
        heading: toFallbackHeading(entry?.roundLabel) || 'Shared Round',
        level: 2 as const,
        caption: captionBits.join(' | '),
        paragraphs: files.length > 0
          ? [bodyText, `Files: ${files.join(', ')}`]
          : [bodyText],
      };
    }),
  ];
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_DOWNLOAD_PROPOSAL_PDF_ROUTE, async (context) => {
    ensureMethod(req, ['GET']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: true,
    });

    const sharedHistory = await loadSharedReportHistory({
      db: resolved.db,
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const sharedEntries = Array.isArray(sharedHistory?.sharedEntries)
      ? sharedHistory.sharedEntries
      : [];

    const roundEntries = sharedEntries
      .map((entry: any, index: number) => {
        const roundNumber = Number(entry?.round_number || 0) > 0
          ? Math.floor(Number(entry.round_number))
          : index + 1;
        const authorLabel = asText(entry?.author_label) || 'Unknown';
        const visibilityLabel = asText(entry?.visibility_label) || `Shared by ${authorLabel}`;
        const sourceLabel = asText(entry?.source) || 'typed';
        const timestampLabel = formatDateTime(entry?.updated_at || entry?.created_at);
        const files = Array.isArray(entry?.files)
          ? entry.files
              .map((file: any) => asText(file?.filename || file?.name))
              .filter(Boolean)
          : [];
        const html = asRawText(entry?.html);
        const text = asRawText(entry?.text);
        if (!asText(html) && !asText(text) && files.length === 0) {
          return null;
        }
        return {
          id: asText(entry?.id) || `shared-round-${index + 1}`,
          roundLabel: `Round ${roundNumber} \u2014 ${visibilityLabel}`,
          authorLabel,
          sourceLabel,
          timestampLabel,
          html,
          text,
          files,
        };
      })
      .filter(Boolean);

    const defaultSharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    if (
      roundEntries.length === 0 &&
      (
        asText(defaultSharedPayload?.text) ||
        asText(defaultSharedPayload?.html) ||
        (Array.isArray(defaultSharedPayload?.files) && defaultSharedPayload.files.length > 0)
      )
    ) {
      roundEntries.push({
        id: 'shared-round-1',
        roundLabel: 'Round 1 \u2014 Shared by Proposer',
        authorLabel: 'Proposer',
        sourceLabel: asText(defaultSharedPayload?.source) || 'typed',
        timestampLabel: formatDateTime(resolved.comparison?.updatedAt || resolved.proposal?.updatedAt),
        html: asRawText(defaultSharedPayload?.html),
        text: asRawText(defaultSharedPayload?.text),
        files: Array.isArray(defaultSharedPayload?.files)
          ? defaultSharedPayload.files
              .map((file: any) => asText(file?.filename || file?.name))
              .filter(Boolean)
          : [],
      });
    }

    if (roundEntries.length === 0) {
      roundEntries.push({
        id: 'shared-round-empty',
        roundLabel: 'Round 1 \u2014 Shared by Proposer',
        authorLabel: 'Proposer',
        sourceLabel: 'typed',
        timestampLabel: formatDateTime(resolved.comparison?.updatedAt || resolved.proposal?.updatedAt),
        text: 'No shared history is available yet.',
      });
    }

    const title =
      asText(resolved.comparison?.title) ||
      asText(resolved.proposal?.title) ||
      'Shared Report';
    const comparisonId =
      asText(resolved.comparison?.id) ||
      asText(resolved.proposal?.documentComparisonId) ||
      'shared-report';
    const filename = `${slugify(title)}-opportunity-shared-history.pdf`;
    const pdfInput = {
      title,
      comparisonId,
      historyHeading: 'Shared History',
      metadataItems: [
        {
          label: 'Opportunity Created',
          value: formatDateTime(resolved.comparison?.createdAt || resolved.proposal?.createdAt),
        },
        {
          label: 'Last Updated',
          value: formatDateTime(resolved.comparison?.updatedAt || resolved.proposal?.updatedAt),
        },
      ].filter((item) => item.value),
      footerNote: 'Shared report | recipient-safe shared history',
      entries: roundEntries as any,
    };
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderOpportunityHistoryPdfBuffer(pdfInput);
    } catch (error: any) {
      console.error(
        JSON.stringify({
          level: 'error',
          route: SHARED_REPORT_DOWNLOAD_PROPOSAL_PDF_ROUTE,
          action: 'opportunity_pdf_render_failed',
          comparisonId,
          message: asText(error?.message) || 'unknown_error',
        }),
      );
      pdfBuffer = await renderProfessionalPdfBuffer({
        title,
        subtitle: '',
        comparisonId,
        footerNote: pdfInput.footerNote,
        sections: buildFallbackSections(roundEntries as any[]),
      });
    }
    sendPdf(res, filename, pdfBuffer);
  });
}
