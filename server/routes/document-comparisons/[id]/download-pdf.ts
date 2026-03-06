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

    // Detect V2 report: has a non-empty `why[]` array of narrative strings.
    const isV2 = Array.isArray(report.why) && (report.why as unknown[]).length > 0;

    const sections = Array.isArray(report.sections)
      ? report.sections
      : Array.isArray(evaluationResult.sections)
        ? evaluationResult.sections
        : [];
    const summary =
      asText(report.summary) || asText(evaluationResult.summary) || 'No AI summary is available yet.';
    const recommendation =
      asText(report.recommendation) || asText(evaluationResult.recommendation) || 'unknown fit';

    // Prefer V2 confidence_0_1 (0–1 float) over legacy score (0–100 integer).
    const confidenceRaw =
      typeof report.confidence_0_1 === 'number'
        ? report.confidence_0_1 * 100
        : (evaluationResult.score ?? report.similarity_score ?? report.score ?? 0);
    const confidence = toScore(confidenceRaw);

    // V2 fit_level: 'high' | 'medium' | 'low' | 'unknown'
    const fitLevel = asText(report.fit_level) || '';
    const fitLevelDisplay = fitLevel && fitLevel !== 'unknown'
      ? fitLevel.charAt(0).toUpperCase() + fitLevel.slice(1)
      : null;

    // Build metadata row (shown beneath the title rule in the PDF header).
    const pdfMetadata: Array<{ label: string; value: string }> = [];
    if (fitLevelDisplay) {
      pdfMetadata.push({ label: 'Fit Level', value: fitLevelDisplay });
    }
    if (confidence > 0) {
      pdfMetadata.push({ label: 'Confidence', value: `${confidence}%` });
    }
    if (recommendation && recommendation !== 'unknown fit') {
      pdfMetadata.push({ label: 'Recommendation', value: recommendation.charAt(0).toUpperCase() + recommendation.slice(1) });
    }

    const reportSections: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }> = [];

    if (isV2) {
      // V2: each why[] entry has the form "Heading: body text". Parse into individual named sections.
      // Do NOT add a legacy "Summary" block — it would duplicate "Executive Summary" from why[].
      (report.why as unknown[]).forEach((entry) => {
        const raw = asText(entry);
        if (!raw) return;
        // Pattern: "Heading text: body text" (heading up to first ": ")
        const colonIdx = raw.indexOf(': ');
        const heading = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : 'Analysis';
        const body = colonIdx > 0 ? raw.slice(colonIdx + 2).trim() : raw;
        reportSections.push({ heading, paragraphs: body ? [body] : [] });
      });

      // missing[] → bullet-list section.
      const missing = Array.isArray(report.missing)
        ? (report.missing as unknown[]).map((e) => asText(e)).filter(Boolean)
        : [];
      if (missing.length > 0) {
        reportSections.push({ heading: 'Key Missing Information', bullets: missing });
      }

      // redactions[] → bullet-list section (if non-empty).
      const redactions = Array.isArray(report.redactions)
        ? (report.redactions as unknown[]).map((e) => asText(e)).filter(Boolean)
        : [];
      if (redactions.length > 0) {
        reportSections.push({ heading: 'Redacted / Not Provided', bullets: redactions });
      }

      // Any additional legacy-compat sections (skip 'why' / 'missing' already rendered above).
      sections.forEach((section: any, sectionIndex: number) => {
        const key = asText(section?.key) || '';
        if (key === 'why' || key === 'missing') return;
        const heading =
          asText(section?.heading) || asText(section?.title) || key || `Finding ${sectionIndex + 1}`;
        const bullets = (Array.isArray(section?.bullets) ? section.bullets : [])
          .map((b: unknown) => asText(b))
          .filter(Boolean);
        const paragraphs = toParagraphs(section?.summary || section?.text);
        reportSections.push({ heading, bullets, paragraphs });
      });
    } else if (sections.length > 0) {
      // Legacy: add a summary header block.
      const fitLevelLine =
        fitLevelDisplay ? `Fit Level: ${fitLevelDisplay}` : null;
      const summaryLines = (
        [summary, fitLevelLine, `Recommendation: ${recommendation}`, `Confidence Score: ${confidence}%`] as (string | null)[]
      ).filter((l): l is string => Boolean(l));
      reportSections.push({ heading: 'Summary', paragraphs: summaryLines });

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
        reportSections.push({ heading, bullets, paragraphs });
      });
    } else {
      reportSections.push({
        heading: 'Summary',
        paragraphs: [summary, `Recommendation: ${recommendation}`, `Confidence Score: ${confidence}%`],
      });
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
      metadata: pdfMetadata.length > 0 ? pdfMetadata : undefined,
      footerNote: 'Confidential — Generated by PreMarket AI',
      sections: reportSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
