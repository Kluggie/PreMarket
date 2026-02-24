import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  asText,
  getComparisonId,
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
  toParagraphs,
} from '../_pdf.js';

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return value as Record<string, any>;
}

function toScore(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/download/pdf', async (context) => {
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

    const evaluationResult = asObject(comparison.evaluationResult);
    const publicReport = asObject(comparison.publicReport);
    const report = asObject(publicReport && Object.keys(publicReport).length > 0 ? publicReport : evaluationResult.report);
    const sections = Array.isArray(report.sections)
      ? report.sections
      : Array.isArray(evaluationResult.sections)
        ? evaluationResult.sections
        : [];
    const summary =
      asText(report.summary) || asText(evaluationResult.summary) || 'No AI summary is available yet.';
    const recommendation =
      asText(report.recommendation) || asText(evaluationResult.recommendation) || 'unknown fit';
    const confidence = toScore(
      evaluationResult.score ?? report.similarity_score ?? report.score ?? 0,
    );

    const reportSections = [];
    reportSections.push({
      heading: 'Summary',
      paragraphs: [summary, `Recommendation: ${recommendation}`, `Confidence Score: ${confidence}%`],
    });

    if (sections.length > 0) {
      sections.forEach((section: any, sectionIndex: number) => {
        const heading =
          asText(section?.heading) ||
          asText(section?.title) ||
          asText(section?.key) ||
          `Finding ${sectionIndex + 1}`;
        const bullets = (Array.isArray(section?.bullets) ? section.bullets : [])
          .map((bullet) => asText(bullet))
          .filter(Boolean);
        const paragraphs = toParagraphs(section?.summary || section?.text);

        reportSections.push({
          heading,
          bullets,
          paragraphs,
        });
      });
    } else {
      reportSections.push({
        heading: 'Findings',
        paragraphs: ['Report sections are not available yet.'],
      });
    }

    const filename = `${slugify(comparison.title)}-ai-report.pdf`;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: comparison.title || 'Document Comparison',
      subtitle: 'AI Report',
      comparisonId: comparison.id,
      sections: reportSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
