import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { getComparisonId, renderPdfBuffer, sendPdf, slugify, toParagraphs } from '../_pdf.js';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';

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

    const blocks = [
      {
        text: comparison.title || 'Document Comparison',
        bold: true,
        fontSize: 20,
        gapAfter: 8,
      },
      {
        text: CONFIDENTIAL_LABEL,
        bold: true,
        fontSize: 13,
        gapAfter: 4,
      },
    ];

    const docAParagraphs = toParagraphs(comparison.docAText || '');
    if (docAParagraphs.length > 0) {
      docAParagraphs.forEach((paragraph) => {
        blocks.push({
          text: paragraph,
          gapAfter: 2,
        });
      });
    } else {
      blocks.push({
        text: 'No confidential content available.',
        gapAfter: 2,
      });
    }

    blocks.push({
      text: SHARED_LABEL,
      bold: true,
      fontSize: 13,
      gapAfter: 4,
    });

    const docBParagraphs = toParagraphs(comparison.docBText || '');
    if (docBParagraphs.length > 0) {
      docBParagraphs.forEach((paragraph) => {
        blocks.push({
          text: paragraph,
          gapAfter: 2,
        });
      });
    } else {
      blocks.push({
        text: 'No shared content available.',
        gapAfter: 2,
      });
    }

    const filename = `${slugify(comparison.title)}-proposal-details.pdf`;
    const pdfBuffer = await renderPdfBuffer(blocks);
    sendPdf(res, filename, pdfBuffer);
  });
}

