import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  getComparisonId,
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
  toParagraphs,
} from '../_pdf.js';

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

    const docAParagraphs = toParagraphs(comparison.docAText || '');
    const docBParagraphs = toParagraphs(comparison.docBText || '');

    const filename = `${slugify(comparison.title)}-proposal-details.pdf`;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: comparison.title || 'Document Comparison',
      subtitle: 'Complete Proposal Details',
      comparisonId: comparison.id,
      sections: [
        {
          heading: CONFIDENTIAL_LABEL,
          paragraphs:
            docAParagraphs.length > 0 ? docAParagraphs : ['No confidential content available yet.'],
        },
        {
          heading: SHARED_LABEL,
          paragraphs: docBParagraphs.length > 0 ? docBParagraphs : ['No shared content available yet.'],
        },
      ],
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
