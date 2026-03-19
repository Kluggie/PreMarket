import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  asText,
  getComparisonId,
  renderProfessionalPdfBuffer,
  renderWebParityPdfBuffer,
  sendPdf,
  slugify,
  splitIntoBullets,
  toParagraphs,
  type PdfDecisionPanel,
  type PdfSection,
  type PdfWebParitySection,
} from '../_pdf.js';
import {
  buildMediationReviewSubtitle,
  buildMediationReviewTitle,
  getDecisionStatusDetails,
  getSentenceSafePreview,
  MEDIATION_REVIEW_TITLE,
  parseV2WhyEntry,
} from '../_helpers.js';
import {
  filterLegacySectionsForDisplay,
  MISSING_OR_REDACTED_INFO_LABEL,
  OPEN_QUESTIONS_LABEL,
  splitV2WhyBodyParagraphs,
} from '../../../../src/lib/aiReportUtils.js';

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

function getPdfFormat(req: any): 'legacy' | 'web-parity' {
  const raw = Array.isArray(req.query?.format) ? req.query.format[0] : req.query?.format;
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'web-parity' || normalized === 'web_parity') {
    return 'web-parity';
  }
  return 'legacy';
}

function formatDateTime(value: unknown) {
  if (!value) return '-';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function buildWebParitySections(params: {
  report: Record<string, any>;
  legacySections: any[];
  missingItems: string[];
  summary: string;
}): PdfWebParitySection[] {
  const sections: PdfWebParitySection[] = [];
  const { report, legacySections, missingItems, summary } = params;
  const isV2 = Array.isArray(report.why) && report.why.length > 0;

  if (isV2) {
    (report.why as unknown[]).forEach((entryRaw) => {
      const entry = asText(entryRaw);
      if (!entry) return;
      const { heading, body } = parseV2WhyEntry(entry);
      const paragraphs = splitV2WhyBodyParagraphs(body);
      const safeParagraphs = (paragraphs.length > 0 ? paragraphs : [body]).map((item) => asText(item)).filter(Boolean);
      if (!safeParagraphs.length) return;
      sections.push({
        heading: heading || 'Analysis',
        paragraphs: safeParagraphs,
      });
    });

    if (missingItems.length > 0) {
      sections.push({
        heading: OPEN_QUESTIONS_LABEL,
        bullets: missingItems,
      });
    }

    const redactions = Array.isArray(report.redactions)
      ? (report.redactions as unknown[]).map((entry) => asText(entry)).filter(Boolean)
      : [];
    if (redactions.length > 0) {
      sections.push({
        heading: MISSING_OR_REDACTED_INFO_LABEL,
        bullets: redactions,
      });
    }
  } else {
    const filteredLegacy = filterLegacySectionsForDisplay(legacySections as any[]);
    filteredLegacy.forEach((section: any, index: number) => {
      const heading =
        asText(section?.heading) ||
        asText(section?.key) ||
        `Section ${index + 1}`;
      const bullets = (Array.isArray(section?.bullets) ? section.bullets : [])
        .map((bullet: unknown) => asText(bullet))
        .filter(Boolean);
      if (!bullets.length) return;
      sections.push({ heading, bullets });
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: 'Executive Summary',
      paragraphs: [summary || 'No AI mediation review content is available yet.'],
    });
  }

  return sections;
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
    const report = asObject(
      publicReport && Object.keys(publicReport).length > 0
        ? publicReport
        : evaluationResult.report,
    );

    // ── Core report fields ──────────────────────────────────────────────────
    const isV2 = Array.isArray(report.why) && (report.why as unknown[]).length > 0;

    const legacySections = Array.isArray(report.sections)
      ? report.sections
      : Array.isArray(evaluationResult.sections)
        ? evaluationResult.sections
        : [];

    const summary =
      asText(report.summary) ||
      asText(evaluationResult.summary) ||
      'No AI mediation summary is available yet.';
    const recommendation =
      asText(report.recommendation) ||
      asText(evaluationResult.recommendation) ||
      'unknown fit';

    const confidenceRaw =
      typeof report.confidence_0_1 === 'number'
        ? report.confidence_0_1 * 100
        : (evaluationResult.score ?? report.similarity_score ?? report.score ?? 0);
    const confidence = toScore(confidenceRaw);

    const fitLevel = asText(report.fit_level) || '';
    const fitLevelDisplay =
      fitLevel && fitLevel !== 'unknown'
        ? fitLevel.charAt(0).toUpperCase() + fitLevel.slice(1)
        : 'Unknown';
    const recommendationDisplay =
      recommendation && recommendation !== 'unknown fit'
        ? recommendation.charAt(0).toUpperCase() + recommendation.slice(1)
        : 'N/A';

    // ── Pre-scan why[] into a heading→body map for decision panel synthesis ──
    const whyBodyMap = new Map<string, string>();
    if (isV2) {
      (report.why as unknown[]).forEach((entry) => {
        const raw = asText(entry);
        if (!raw) return;
        const { heading, body } = parseV2WhyEntry(raw);
        if (!heading || !body) return;
        whyBodyMap.set(heading.trim().toLowerCase(), body.trim());
      });
    }

    const firstSentence = (key: string): string => getSentenceSafePreview(whyBodyMap.get(key) ?? '', 180);

    const missingItems = Array.isArray(report.missing)
      ? (report.missing as unknown[]).map((e) => asText(e)).filter(Boolean)
      : [];

    const decisionStatus = getDecisionStatusDetails(report);
    const pdfFormat = getPdfFormat(req);
    if (pdfFormat === 'web-parity') {
      const reviewTitle = buildMediationReviewTitle(comparison.title, report.title, evaluationResult.title);
      const reviewSubtitle = buildMediationReviewSubtitle(comparison.title, report.title, evaluationResult.title);
      const filenameBase = slugify(reviewTitle) || 'ai-mediation-review';
      const filename =
        filenameBase === 'ai-mediation-review'
          ? 'ai-mediation-review-web-parity.pdf'
          : `${filenameBase}-ai-mediation-review-web-parity.pdf`;

      const recommendationRaw =
        asText(report.recommendation) ||
        asText(evaluationResult.recommendation) ||
        asText(report.fit_level) ||
        'pending';
      const recommendationMetric = recommendationRaw ? toTitleCase(recommendationRaw) : 'Pending';
      const sections = buildWebParitySections({
        report,
        legacySections: legacySections as any[],
        missingItems,
        summary,
      });
      const decisionExplanation = asText(decisionStatus.explanation);
      const webParitySections = decisionExplanation
        ? [
            ...sections,
            {
              heading: 'Decision Explanation',
              paragraphs: [decisionExplanation],
            },
          ]
        : sections;

      const pdfBuffer = await renderWebParityPdfBuffer({
        title: MEDIATION_REVIEW_TITLE,
        subtitle: reviewSubtitle,
        comparisonId: comparison.id,
        metrics: [
          { label: 'Recommendation', value: recommendationMetric },
          { label: 'Confidence', value: `${confidence}%` },
          { label: 'Status', value: decisionStatus.label || 'Unknown' },
          {
            label: OPEN_QUESTIONS_LABEL,
            value: `${missingItems.length} item${missingItems.length === 1 ? '' : 's'}`,
          },
        ],
        timelineItems: [
          { label: 'Opportunity Created', value: formatDateTime(comparison.createdAt) },
          { label: 'Last Updated', value: formatDateTime(comparison.updatedAt) },
        ],
        footerNote: 'Confidential -- Generated by PreMarket AI',
        sections: webParitySections,
      });
      sendPdf(res, filename, pdfBuffer);
      return;
    }

    // ── Decision panel ──────────────────────────────────────────────────────
    const fitStatusInfo =
      decisionStatus.tone === 'success'
        ? { status: decisionStatus.label, color: [22, 163, 74] as [number, number, number] }
        : decisionStatus.tone === 'danger'
        ? { status: decisionStatus.label, color: [220, 38, 38] as [number, number, number] }
        : decisionStatus.tone === 'warning'
        ? { status: decisionStatus.label, color: [180, 83, 9] as [number, number, number] }
        : { status: decisionStatus.label, color: [100, 116, 139] as [number, number, number] };

    const primaryDrivers: string[] = [];
    const assessmentSentence = firstSentence('decision assessment') || firstSentence('key risks');
    if (assessmentSentence) primaryDrivers.push(assessmentSentence);
    const leverageSentence = firstSentence('leverage signals') || firstSentence('key strengths');
    if (leverageSentence) primaryDrivers.push(leverageSentence);
    const readinessSentence = decisionStatus.explanation || firstSentence('decision readiness');
    if (readinessSentence && primaryDrivers.length < 3) primaryDrivers.push(readinessSentence);

    const decisionContext = decisionStatus.explanation || '';

    const decisionPanel: PdfDecisionPanel = {
      fitLevelDisplay,
      confidence,
      recommendation: recommendationDisplay,
      decisionStatus: fitStatusInfo.status,
      fitColor: fitStatusInfo.color,
      decisionContext: decisionContext || undefined,
      primaryDrivers: primaryDrivers.length > 0 ? primaryDrivers : undefined,
    };

    // ── Section type & grouping helpers ─────────────────────────────────────
    type SectionSpec = {
      level: 1 | 2;
      displayHeading: string;
      /** L1 group label — inject a synthetic L1 header before the first sub-section */
      group?: string;
      /** Convert body sentences into individual bullet points */
      useBullets?: boolean;
      /** Parse "1) ... 2) ..." into option bullets */
      splitOptions?: boolean;
      /** Render bullets as a numbered list (1. 2. 3.) */
      numberedBullets?: boolean;
      /** Parse numbered questions "1. Question 2. Question" into bullet questions */
      splitQuestions?: boolean;
      /** Render the body as a highlight callout box */
      callout?: boolean;
    };

    const normalize = (h: string) =>
      h
        .toLowerCase()
        .replace(/[^a-z0-9 /&:?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const SECTION_MAP: Record<string, SectionSpec> = {
      // ─ Level 1 standalone sections ─
      'executive summary': { level: 1, displayHeading: 'Executive Summary' },
      snapshot:            { level: 1, displayHeading: 'Executive Summary' },
      'decision assessment': { level: 1, displayHeading: 'Decision Assessment' },
      'negotiation insights': { level: 1, displayHeading: 'Negotiation Insights' },
      'leverage signals': { level: 1, displayHeading: 'Leverage Signals' },
      'potential deal structures': { level: 1, displayHeading: 'Potential Deal Structures', splitOptions: true, numberedBullets: true },
      'recommended path': { level: 1, displayHeading: 'Recommended Path', callout: true },
      // ─ Decision Assessment (analysis group: strengths + risks + commercial) ─
      'key strengths':   { level: 2, displayHeading: 'Key Strengths',            group: 'Decision Assessment', useBullets: true },
      'key risks':       { level: 2, displayHeading: 'Risk Summary',             group: 'Decision Assessment', useBullets: true },
      'risk summary':    { level: 2, displayHeading: 'Risk Summary',             group: 'Decision Assessment', useBullets: true },
      'key risks  assumptions': { level: 2, displayHeading: 'Risk Summary',      group: 'Decision Assessment', useBullets: true },
      'commercial notes':          { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      'commercial considerations': { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      'commercial posture':        { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      // ─ Decision Readiness — standalone L1 section (not grouped) ─
      'decision readiness': { level: 1, displayHeading: 'Decision Readiness' },
      // ─ Recommended Path (action group) ─
      'assumptions / dependencies': { level: 2, displayHeading: 'Key Dependencies',               group: 'Recommended Path' },
      'assumptions  dependencies':  { level: 2, displayHeading: 'Key Dependencies',               group: 'Recommended Path' },
      options:             { level: 2, displayHeading: 'Strategic Options',       group: 'Recommended Path', splitOptions: true, numberedBullets: true },
      recommendations:     { level: 2, displayHeading: 'Contract Guidance',       group: 'Recommended Path', callout: true },
      'first 2 weeks plan':          { level: 2, displayHeading: 'Discovery & Execution Plan',   group: 'Recommended Path', useBullets: true },
      'next call: what i d ask for': { level: 2, displayHeading: 'Questions for Next Discussion', group: 'Recommended Path', splitQuestions: true, numberedBullets: true },
      'next call':         { level: 2, displayHeading: 'Questions for Next Discussion', group: 'Recommended Path', splitQuestions: true, numberedBullets: true },
      'likely pushback & response': { level: 2, displayHeading: 'Negotiation Posture',             group: 'Recommended Path' },
      'likely pushback  response':  { level: 2, displayHeading: 'Negotiation Posture',             group: 'Recommended Path' },
      // ─ Optional / conditional headings ─
      'implementation notes':  { level: 2, displayHeading: 'Implementation Notes',   group: 'Recommended Path' },
      'data & security notes': { level: 2, displayHeading: 'Data & Security Notes',  group: 'Recommended Path' },
      'vendor fit notes':      { level: 2, displayHeading: 'Vendor Fit Notes',        group: 'Decision Assessment' },
    };

    const lookupSection = (rawHeading: string): SectionSpec | undefined => {
      const key = normalize(rawHeading);
      if (SECTION_MAP[key]) return SECTION_MAP[key];
      for (const [k, v] of Object.entries(SECTION_MAP)) {
        if (key.startsWith(k) || k.startsWith(key.substring(0, Math.max(8, key.indexOf(' ', 8))))) {
          return v;
        }
      }
      return undefined;
    };

    /** Parse "1) Option A. 2) Option B." or "1. Option A. 2. Option B." into bullet strings. */
    const parseOptionsBullets = (text: string): string[] => {
      const byLetter = text.split(/\s*(?=Option [A-Z]\s*[—:-])/);
      if (byLetter.length > 1) {
        return byLetter.map((p) => p.replace(/\.$/, '').trim()).filter((p) => p.length > 5);
      }
      const parts = text.split(/\s*\d+[).]\s+(?=[A-Z])/);
      return parts.map((p) => p.replace(/\.$/, '').trim()).filter((p) => p.length > 5);
    };

    /**
     * Parse numbered questions "1. Question 2. Question" into individual bullet items.
     * Also handles the "If/then" negotiation patterns.
     */
    const parseQuestionsBullets = (text: string): string[] => {
      // Split on numbered items OR on "If the ... then ..." sentence boundaries
      const byNumber = text.split(/\s*\d+\.\s+(?=[A-Z])/);
      if (byNumber.length > 2) {
        return byNumber.map((p) => p.replace(/\.$/, '').trim()).filter((p) => p.length > 5);
      }
      // Fall back to sentence split
      return splitIntoBullets(text);
    };

    /**
     * Converts a raw missing[] entry to a shorter question format.
     * Many entries follow the pattern: "Long question -- explanation of why."
     * We keep only the question part (before " -- ").
     */
    const shortenMissingItem = (raw: string): string => {
      const ddash = raw.indexOf(' -- ');
      const q = ddash > 0 ? raw.slice(0, ddash).trim() : raw;
      // If it doesn't end with "?", convert declarative to question form
      return q.endsWith('?') ? q : q;
    };

    // ── Build report sections ─────────────────────────────────────────────
    const reportSections: PdfSection[] = [];
    const injectedL1Groups = new Set<string>();

    const maybeInjectGroupL1 = (group: string | undefined) => {
      if (!group) return;
      if (injectedL1Groups.has(group)) return;
      if (group === 'Decision Assessment' || group === 'Recommended Path') {
        injectedL1Groups.add(group);
        const breakBefore = group === 'Recommended Path';
        reportSections.push({ heading: group, level: 1, paragraphs: [], breakBefore });
      }
    };

    /**
     * Light deduplication pass: removes paragraphs and bullets that are identical
     * (after normalisation) to content already seen in earlier sections.
     * Short phrases (<40 chars) and callout sections are left intact.
     */
    const deduplicateSections = (sections: PdfSection[]): PdfSection[] => {
      const seen = new Set<string>();
      const normKey = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const isSeen = (text: string): boolean => {
        const k = normKey(text);
        if (k.length < 40) return false;  // too short to deduplicate reliably
        if (seen.has(k)) return true;
        seen.add(k);
        return false;
      };
      return sections.map((s) => {
        if (s.callout) return s;  // preserve callout bodies
        return {
          ...s,
          paragraphs: s.paragraphs?.filter((p) => !isSeen(p)) ?? s.paragraphs,
          bullets: s.bullets?.filter((b) => !isSeen(b)) ?? s.bullets,
        };
      });
    };

    if (isV2) {
      (report.why as unknown[]).forEach((entry) => {
        const raw = asText(entry);
        if (!raw) return;

        const colonIdx = raw.indexOf(': ');
        const rawHeading = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : 'Analysis';
        const body = colonIdx > 0 ? raw.slice(colonIdx + 2).trim() : raw;

        const spec = lookupSection(rawHeading);
        const level: 1 | 2 = spec?.level ?? 2;
        const displayHeading = spec?.displayHeading ?? rawHeading;

        if (spec?.group) {
          maybeInjectGroupL1(spec.group);
        }
        if (level === 1) {
          injectedL1Groups.add(displayHeading);
        }

        let bullets: string[] | undefined;
        let paragraphs: string[] | undefined;
        let callout: boolean | undefined;
        let numberedBullets: boolean | undefined;

        if (spec?.callout && body) {
          // Callout box — render the full body without any truncation
          paragraphs = [body];
          callout = true;
        } else if (spec?.splitOptions && body) {
          const opts = parseOptionsBullets(body);
          bullets = opts.length > 1 ? opts : undefined;
          if (!bullets) paragraphs = [body];
          else numberedBullets = spec.numberedBullets;
        } else if (spec?.splitQuestions && body) {
          const qs = parseQuestionsBullets(body);
          bullets = qs.length > 1 ? qs : undefined;
          if (!bullets) paragraphs = [body];
          else numberedBullets = spec.numberedBullets;
        } else if (spec?.useBullets && body) {
          const buls = splitIntoBullets(body);
          bullets = buls.length > 1 ? buls : undefined;
          if (!bullets) paragraphs = [body];
        } else if (body) {
          paragraphs = [body];
        }

        reportSections.push({ heading: displayHeading, level, paragraphs, bullets, callout, numberedBullets });
      });

      // Open Questions — formatted as short numbered questions, one per bullet
      if (missingItems.length > 0) {
        reportSections.push({
          heading: 'Open Questions',
          level: 1,
          bullets: missingItems.map(shortenMissingItem),
          numberedBullets: true,
        });
      }

      // Missing or Redacted Information
      const redactions = Array.isArray(report.redactions)
        ? (report.redactions as unknown[]).map((e) => asText(e)).filter(Boolean)
        : [];
      if (redactions.length > 0) {
        reportSections.push({
          heading: 'Missing or Redacted Information',
          level: 1,
          bullets: redactions,
        });
      }

      // Legacy-compat additional sections
      legacySections.forEach((section: any, sectionIndex: number) => {
        const key = asText(section?.key) || '';
        if (key === 'why' || key === 'missing') return;
        const heading =
          asText(section?.heading) ||
          asText(section?.title) ||
          key ||
          `Finding ${sectionIndex + 1}`;
        const bullets = (Array.isArray(section?.bullets) ? section.bullets : [])
          .map((b: unknown) => asText(b))
          .filter(Boolean);
        const paragraphs = toParagraphs(section?.summary || section?.text);
        if (bullets.length === 0 && paragraphs.length === 0) {
          return;
        }
        reportSections.push({ heading, level: 2, bullets, paragraphs });
      });

      // No Final Decision Overview — it was redundant with the Decision Panel
    } else if (legacySections.length > 0) {
      const fitLevelLine = fitLevel && fitLevel !== 'unknown' ? `Fit Level: ${fitLevelDisplay}` : null;
      const summaryLines = (
        [
          summary,
          fitLevelLine,
          `Recommendation: ${recommendationDisplay}`,
          `Confidence Score: ${confidence}%`,
        ] as (string | null)[]
      ).filter((l): l is string => Boolean(l));
      reportSections.push({ heading: 'Summary', level: 1, paragraphs: summaryLines });

      legacySections.forEach((section: any, sectionIndex: number) => {
        const heading =
          asText(section?.heading) ||
          asText(section?.title) ||
          asText(section?.key) ||
          `Finding ${sectionIndex + 1}`;
        const bullets = (Array.isArray(section?.bullets) ? section.bullets : [])
          .map((bullet: unknown) => asText(bullet))
          .filter(Boolean);
        const paragraphs = toParagraphs(section?.summary || section?.text);
        reportSections.push({ heading, level: 2, bullets, paragraphs });
      });
    } else {
      reportSections.push({
        heading: 'Summary',
        level: 1,
        paragraphs: [summary, `Recommendation: ${recommendationDisplay}`, `Confidence Score: ${confidence}%`],
      });
      reportSections.push({
        heading: 'Findings',
        level: 2,
        paragraphs: ['Report sections are not available yet.'],
      });
    }

    const reviewTitle = buildMediationReviewTitle(comparison.title, report.title, evaluationResult.title);
    const reviewSubtitle = buildMediationReviewSubtitle(comparison.title, report.title, evaluationResult.title);
    const filenameBase = slugify(reviewTitle) || 'ai-mediation-review';
    const filename =
      filenameBase === 'ai-mediation-review'
        ? 'ai-mediation-review.pdf'
        : `${filenameBase}-ai-mediation-review.pdf`;
    const finalSections = isV2 ? deduplicateSections(reportSections) : reportSections;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: MEDIATION_REVIEW_TITLE,
      subtitle: reviewSubtitle,
      comparisonId: comparison.id,
      decisionPanel: isV2 ? decisionPanel : undefined,
      footerNote: 'Confidential -- Generated by PreMarket AI',
      sections: finalSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
