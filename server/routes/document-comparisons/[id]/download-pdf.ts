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
  splitIntoBullets,
  toParagraphs,
  type PdfDecisionPanel,
  type PdfSection,
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
      'No AI summary is available yet.';
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
        const colonIdx = raw.indexOf(': ');
        if (colonIdx > 0) {
          whyBodyMap.set(raw.slice(0, colonIdx).trim().toLowerCase(), raw.slice(colonIdx + 2).trim());
        }
      });
    }

    /** Return the first sentence of a why[] body by normalized heading key. */
    const firstSentence = (key: string): string => {
      const body = whyBodyMap.get(key) ?? '';
      const match = body.match(/^(.+?[.!?])\s/);
      return match ? match[1].trim() : (body.length > 100 ? body.slice(0, 97) + '...' : body);
    };

    // ── Decision panel ──────────────────────────────────────────────────────
    const FIT_STATUS: Record<string, { status: string; color: [number, number, number] }> = {
      high: { status: 'READY TO PROCEED', color: [22, 163, 74] },
      medium: { status: 'PROCEED WITH CONDITIONS', color: [180, 83, 9] },
      low: { status: 'NOT RECOMMENDED', color: [220, 38, 38] },
    };
    const fitStatusInfo = FIT_STATUS[fitLevel] ?? { status: 'ASSESSMENT INCOMPLETE', color: [100, 116, 139] };

    const missingItems = Array.isArray(report.missing)
      ? (report.missing as unknown[]).map((e) => asText(e)).filter(Boolean)
      : [];

    // Primary drivers: synthesise from Key Strengths (positive) + Key Risks (risks),
    // NOT from missing[] (which are open questions, not decision rationale).
    const primaryDrivers: string[] = [];
    const strengthsSentence = firstSentence('key strengths');
    if (strengthsSentence) primaryDrivers.push(strengthsSentence);
    const risksSentence = firstSentence('key risks');
    if (risksSentence) primaryDrivers.push(risksSentence);
    // Add a third driver from Decision Readiness if available
    const readinessSentence = firstSentence('decision readiness');
    if (readinessSentence && primaryDrivers.length < 3) primaryDrivers.push(readinessSentence);

    // Decision context: first sentence of Decision Readiness explains why we landed here
    const decisionContext = readinessSentence || '';

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
      snapshot:          { level: 1, displayHeading: 'Executive Summary' },
      'executive summary': { level: 1, displayHeading: 'Executive Summary' },
      // ─ Executive Assessment (analysis group) ─
      'key strengths':   { level: 2, displayHeading: 'Key Strengths',            group: 'Executive Assessment', useBullets: true },
      'key risks':       { level: 2, displayHeading: 'Risk Summary',             group: 'Executive Assessment', useBullets: true },
      'commercial notes':        { level: 2, displayHeading: 'Commercial Considerations', group: 'Executive Assessment' },
      'commercial considerations': { level: 2, displayHeading: 'Commercial Considerations', group: 'Executive Assessment' },
      'decision readiness': { level: 2, displayHeading: 'Decision Readiness',   group: 'Executive Assessment' },
      // ─ Recommended Path (action group) ─
      'assumptions / dependencies': { level: 2, displayHeading: 'Key Dependencies',            group: 'Recommended Path' },
      'assumptions  dependencies':  { level: 2, displayHeading: 'Key Dependencies',            group: 'Recommended Path' },
      options:           { level: 2, displayHeading: 'Strategic Options',        group: 'Recommended Path', splitOptions: true },
      recommendations:   { level: 2, displayHeading: 'Contract Guidance',        group: 'Recommended Path', callout: true },
      'first 2 weeks plan':         { level: 2, displayHeading: 'Discovery & Execution Plan',  group: 'Recommended Path' },
      'next call: what i d ask for': { level: 2, displayHeading: 'Questions for Next Discussion', group: 'Recommended Path', splitQuestions: true },
      'next call':       { level: 2, displayHeading: 'Questions for Next Discussion', group: 'Recommended Path', splitQuestions: true },
      'likely pushback & response': { level: 2, displayHeading: 'Negotiation Posture', group: 'Recommended Path' },
      'likely pushback  response':  { level: 2, displayHeading: 'Negotiation Posture', group: 'Recommended Path' },
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
      if (group === 'Executive Assessment' || group === 'Recommended Path') {
        injectedL1Groups.add(group);
        const breakBefore = group === 'Recommended Path';
        reportSections.push({ heading: group, level: 1, paragraphs: [], breakBefore });
      }
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

        if (spec?.callout && body) {
          // Callout box — first compact paragraph (trim to a manageable length)
          const trimmed = body.length > 400 ? body.slice(0, 397) + '...' : body;
          paragraphs = [trimmed];
          callout = true;
        } else if (spec?.splitOptions && body) {
          const opts = parseOptionsBullets(body);
          bullets = opts.length > 1 ? opts : undefined;
          if (!bullets) paragraphs = [body];
        } else if (spec?.splitQuestions && body) {
          const qs = parseQuestionsBullets(body);
          bullets = qs.length > 1 ? qs : undefined;
          if (!bullets) paragraphs = [body];
        } else if (spec?.useBullets && body) {
          const buls = splitIntoBullets(body);
          bullets = buls.length > 1 ? buls : undefined;
          if (!bullets) paragraphs = [body];
        } else if (body) {
          paragraphs = [body];
        }

        reportSections.push({ heading: displayHeading, level, paragraphs, bullets, callout });
      });

      // Open Questions — formatted as short questions, one per bullet
      if (missingItems.length > 0) {
        reportSections.push({
          heading: 'Open Questions',
          level: 1,
          bullets: missingItems.map(shortenMissingItem),
        });
      }

      // Redacted / Not Provided
      const redactions = Array.isArray(report.redactions)
        ? (report.redactions as unknown[]).map((e) => asText(e)).filter(Boolean)
        : [];
      if (redactions.length > 0) {
        reportSections.push({
          heading: 'Redacted / Not Provided',
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

    const filename = `${slugify(comparison.title)}-ai-report.pdf`;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: comparison.title || 'Document Comparison',
      subtitle: 'AI Evaluation Report',
      comparisonId: comparison.id,
      decisionPanel: isV2 ? decisionPanel : undefined,
      footerNote: 'Confidential -- Generated by PreMarket AI',
      sections: reportSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
