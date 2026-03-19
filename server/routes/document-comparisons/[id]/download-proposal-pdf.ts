import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { loadSharedReportHistory } from '../../../_lib/shared-report-history.js';
import {
  getComparisonId,
  renderOpportunityHistoryPdfBuffer,
  sendPdf,
  slugify,
} from '../_pdf.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/download/proposal-pdf', async (context) => {
    ensureMethod(req, ['GET']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const db = getDb();
    const [comparison] = await db
      .select()
      .from(schema.documentComparisons)
      .where(
        and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.userId, auth.user.id),
        ),
      )
      .limit(1);

    if (!comparison) {
      throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
    }

    const proposal = comparison.proposalId
      ? await db
          .select()
          .from(schema.proposals)
          .where(eq(schema.proposals.id, comparison.proposalId))
          .limit(1)
          .then((rows) => rows[0] || null)
      : null;

    const sharedHistory = proposal
      ? await loadSharedReportHistory({
          db,
          proposal,
          comparison,
        })
      : {
          sharedEntries: [],
        };
    const sharedEntries = Array.isArray((sharedHistory as any)?.sharedEntries)
      ? (sharedHistory as any).sharedEntries
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
        const html = asText(entry?.html);
        const text = asText(entry?.text);
        if (!html && !text && files.length === 0) {
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

    const fallbackDocBFiles = Array.isArray((comparison.inputs || {}).doc_b_files)
      ? (comparison.inputs || {}).doc_b_files
          .map((file: any) => asText(file?.filename || file?.name))
          .filter(Boolean)
      : [];
    const fallbackText = asText(comparison.docBText || '');
    const fallbackHtml = asText((comparison.inputs || {}).doc_b_html || '');
    if (roundEntries.length === 0 && (fallbackText || fallbackHtml || fallbackDocBFiles.length > 0)) {
      roundEntries.push({
        id: 'shared-round-1',
        roundLabel: 'Round 1 \u2014 Shared by Proposer',
        authorLabel: 'Proposer',
        sourceLabel: asText((comparison.inputs || {}).doc_b_source) || 'typed',
        timestampLabel: formatDateTime(comparison.updatedAt || comparison.createdAt),
        html: fallbackHtml,
        text: fallbackText,
        files: fallbackDocBFiles,
      });
    }

    if (roundEntries.length === 0) {
      roundEntries.push({
        id: 'shared-round-empty',
        roundLabel: 'Round 1 \u2014 Shared by Proposer',
        authorLabel: 'Proposer',
        sourceLabel: 'typed',
        timestampLabel: formatDateTime(comparison.updatedAt || comparison.createdAt),
        text: 'No shared history is available yet.',
      });
    }

    const filename = `${slugify(comparison.title)}-opportunity-shared-history.pdf`;
    const pdfBuffer = await renderOpportunityHistoryPdfBuffer({
      title: comparison.title || 'Opportunity',
      comparisonId: comparison.id,
      historyHeading: 'Shared History',
      metadataItems: [
        {
          label: 'Opportunity Created',
          value: formatDateTime(comparison.createdAt),
        },
        {
          label: 'Last Updated',
          value: formatDateTime(comparison.updatedAt),
        },
      ].filter((item) => item.value),
      footerNote: 'Recipient-safe shared history export',
      entries: roundEntries as any,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
