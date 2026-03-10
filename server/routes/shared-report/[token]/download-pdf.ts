import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { buildRecipientSafeEvaluationProjection } from '../../document-comparisons/_helpers.js';
import {
  asText,
  getToken,
  resolveSharedReportToken,
  SHARED_REPORT_ROUTE,
} from '../_shared.js';
import {
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
  splitIntoBullets,
  toParagraphs,
  type PdfDecisionPanel,
  type PdfSection,
} from '../../document-comparisons/_pdf.js';

const SHARED_REPORT_DOWNLOAD_PDF_ROUTE = `${SHARED_REPORT_ROUTE}/download/pdf`;

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

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_DOWNLOAD_PDF_ROUTE, async (context) => {
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

    const projection = buildRecipientSafeEvaluationProjection({
      evaluationResult: resolved.comparison?.evaluationResult || {},
      publicReport: resolved.comparison?.publicReport || {},
      confidentialText: resolved.comparison?.docAText || '',
      sharedText: resolved.comparison?.docBText || '',
      title: asText(resolved.comparison?.title) || asText(resolved.proposal?.title) || 'Shared Report',
    });

    const evaluationResult = asObject(projection.evaluation_result);
    const report = asObject(
      projection.public_report && Object.keys(asObject(projection.public_report)).length > 0
        ? projection.public_report
        : evaluationResult.report,
    );

    const isV2 = Array.isArray(report.why) && (report.why as unknown[]).length > 0;
    const legacySections = Array.isArray(report.sections)
      ? report.sections
      : Array.isArray(evaluationResult.sections)
        ? evaluationResult.sections
        : [];

    const recommendation =
      asText(report.recommendation) ||
      asText(evaluationResult.recommendation) ||
      'unknown fit';
    const confidenceRaw =
      typeof report.confidence_0_1 === 'number'
        ? report.confidence_0_1 * 100
        : (evaluationResult.score ?? report.similarity_score ?? report.score ?? 0);
    const confidence = toScore(confidenceRaw);
    const fitLevel = asText(report.fit_level).toLowerCase() || 'unknown';
    const fitLevelDisplay =
      fitLevel && fitLevel !== 'unknown'
        ? fitLevel.charAt(0).toUpperCase() + fitLevel.slice(1)
        : 'Unknown';
    const recommendationDisplay =
      recommendation && recommendation !== 'unknown fit'
        ? recommendation.charAt(0).toUpperCase() + recommendation.slice(1)
        : 'N/A';

    const FIT_STATUS: Record<string, { status: string; color: [number, number, number] }> = {
      high: { status: 'READY TO PROCEED', color: [22, 163, 74] },
      medium: { status: 'PROCEED WITH CONDITIONS', color: [180, 83, 9] },
      low: { status: 'NOT RECOMMENDED', color: [220, 38, 38] },
    };
    const fitStatusInfo = FIT_STATUS[fitLevel] ?? {
      status: 'ASSESSMENT INCOMPLETE',
      color: [100, 116, 139],
    };

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

    const firstSentence = (key: string): string => {
      const body = whyBodyMap.get(key) ?? '';
      const match = body.match(/^(.+?[.!?])\s/);
      return match ? match[1].trim() : (body.length > 100 ? `${body.slice(0, 97)}...` : body);
    };

    const primaryDrivers: string[] = [];
    const strengthsSentence = firstSentence('key strengths');
    if (strengthsSentence) primaryDrivers.push(strengthsSentence);
    const risksSentence = firstSentence('key risks');
    if (risksSentence) primaryDrivers.push(risksSentence);
    const readinessSentence = firstSentence('decision readiness');
    if (readinessSentence && primaryDrivers.length < 3) primaryDrivers.push(readinessSentence);

    const decisionPanel: PdfDecisionPanel = {
      fitLevelDisplay,
      confidence,
      recommendation: recommendationDisplay,
      decisionStatus: fitStatusInfo.status,
      fitColor: fitStatusInfo.color,
      decisionContext: readinessSentence || undefined,
      primaryDrivers: primaryDrivers.length > 0 ? primaryDrivers : undefined,
    };

    type SectionSpec = {
      level: 1 | 2;
      displayHeading: string;
      group?: string;
      useBullets?: boolean;
      splitOptions?: boolean;
      numberedBullets?: boolean;
      splitQuestions?: boolean;
      callout?: boolean;
    };

    const normalize = (heading: string) =>
      heading
        .toLowerCase()
        .replace(/[^a-z0-9 /&:?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const SECTION_MAP: Record<string, SectionSpec> = {
      snapshot: { level: 1, displayHeading: 'Executive Summary' },
      'executive summary': { level: 1, displayHeading: 'Executive Summary' },
      // ─ Decision Assessment (analysis group) ─
      'key strengths': { level: 2, displayHeading: 'Key Strengths',            group: 'Decision Assessment', useBullets: true },
      'key risks':     { level: 2, displayHeading: 'Risk Summary',             group: 'Decision Assessment', useBullets: true },
      'risk summary':  { level: 2, displayHeading: 'Risk Summary',             group: 'Decision Assessment', useBullets: true },
      'key risks  assumptions': { level: 2, displayHeading: 'Risk Summary',    group: 'Decision Assessment', useBullets: true },
      'commercial notes':          { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      'commercial considerations': { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      'commercial posture':        { level: 2, displayHeading: 'Commercial Considerations', group: 'Decision Assessment' },
      'vendor fit notes': { level: 2, displayHeading: 'Vendor Fit Notes',      group: 'Decision Assessment' },
      // ─ Decision Readiness — standalone L1 ─
      'decision readiness': { level: 1, displayHeading: 'Decision Readiness' },
      // ─ Recommended Path (action group) ─
      'assumptions / dependencies': { level: 2, displayHeading: 'Key Dependencies', group: 'Recommended Path' },
      'assumptions  dependencies':  { level: 2, displayHeading: 'Key Dependencies', group: 'Recommended Path' },
      options:      { level: 2, displayHeading: 'Strategic Options',       group: 'Recommended Path', splitOptions: true, numberedBullets: true },
      recommendations: { level: 2, displayHeading: 'Contract Guidance',    group: 'Recommended Path', callout: true },
      'first 2 weeks plan': { level: 2, displayHeading: 'Discovery & Execution Plan', group: 'Recommended Path', useBullets: true },
      'next call: what i d ask for': {
        level: 2,
        displayHeading: 'Questions for Next Discussion',
        group: 'Recommended Path',
        splitQuestions: true,
        numberedBullets: true,
      },
      'next call': {
        level: 2,
        displayHeading: 'Questions for Next Discussion',
        group: 'Recommended Path',
        splitQuestions: true,
        numberedBullets: true,
      },
      'likely pushback & response': { level: 2, displayHeading: 'Negotiation Posture', group: 'Recommended Path' },
      'likely pushback  response':  { level: 2, displayHeading: 'Negotiation Posture', group: 'Recommended Path' },
      'implementation notes':  { level: 2, displayHeading: 'Implementation Notes',  group: 'Recommended Path' },
      'data & security notes': { level: 2, displayHeading: 'Data & Security Notes', group: 'Recommended Path' },
    };

    const lookupSection = (rawHeading: string): SectionSpec | undefined => {
      const key = normalize(rawHeading);
      if (SECTION_MAP[key]) return SECTION_MAP[key];
      for (const [candidate, spec] of Object.entries(SECTION_MAP)) {
        if (key.startsWith(candidate) || candidate.startsWith(key.substring(0, Math.max(8, key.indexOf(' ', 8))))) {
          return spec;
        }
      }
      return undefined;
    };

    const parseOptionsBullets = (text: string): string[] => {
      const parts = text.split(/\s*\d+[).]\s+(?=[A-Z])/);
      return parts.map((entry) => entry.replace(/\.$/, '').trim()).filter((entry) => entry.length > 5);
    };

    const parseQuestionsBullets = (text: string): string[] => {
      const byNumber = text.split(/\s*\d+\.\s+(?=[A-Z])/);
      if (byNumber.length > 2) {
        return byNumber.map((entry) => entry.replace(/\.$/, '').trim()).filter((entry) => entry.length > 5);
      }
      return splitIntoBullets(text);
    };

    const reportSections: PdfSection[] = [];
    const injectedL1Groups = new Set<string>();
    const maybeInjectGroupL1 = (group: string | undefined) => {
      if (!group || injectedL1Groups.has(group)) return;
      injectedL1Groups.add(group);
      reportSections.push({
        heading: group,
        level: 1,
        paragraphs: [],
        breakBefore: group === 'Recommended Path',
      });
    };

    /**
     * Light deduplication: removes paragraphs/bullets that have already appeared
     * verbatim (normalised) in an earlier section. Short phrases are left intact.
     */
    const deduplicateSections = (sections: PdfSection[]): PdfSection[] => {
      const seen = new Set<string>();
      const normKey = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const isSeen = (text: string): boolean => {
        const k = normKey(text);
        if (k.length < 40) return false;
        if (seen.has(k)) return true;
        seen.add(k);
        return false;
      };
      return sections.map((s) => {
        if (s.callout) return s;
        return {
          ...s,
          paragraphs: s.paragraphs?.filter((p) => !isSeen(p)) ?? s.paragraphs,
          bullets: s.bullets?.filter((b) => !isSeen(b)) ?? s.bullets,
        };
      });
    };

    if (isV2) {
      (report.why as unknown[]).forEach((entryRaw) => {
        const entry = asText(entryRaw);
        if (!entry) return;
        const colonIdx = entry.indexOf(': ');
        const rawHeading = colonIdx > 0 ? entry.slice(0, colonIdx).trim() : 'Analysis';
        const body = colonIdx > 0 ? entry.slice(colonIdx + 2).trim() : entry;
        const spec = lookupSection(rawHeading) || {
          level: 2,
          displayHeading: rawHeading || 'Analysis',
          group: 'Decision Assessment',
        };

        maybeInjectGroupL1(spec.group);

        const section: PdfSection = {
          heading: spec.displayHeading,
          level: spec.level,
          breakBefore: false,
        };
        if (spec.callout) {
          // Callout box: store body in paragraphs; callout flag triggers box rendering
          section.paragraphs = body ? [body] : [];
          section.callout = true;
        } else if (spec.splitOptions) {
          const opts = parseOptionsBullets(body);
          if (opts.length > 1) {
            section.bullets = opts;
            section.numberedBullets = spec.numberedBullets;
          } else {
            section.paragraphs = toParagraphs(body);
          }
        } else if (spec.splitQuestions) {
          const qs = parseQuestionsBullets(body);
          if (qs.length > 1) {
            section.bullets = qs;
            section.numberedBullets = spec.numberedBullets;
          } else {
            section.paragraphs = toParagraphs(body);
          }
        } else if (spec.useBullets) {
          const buls = splitIntoBullets(body);
          section.bullets = buls.length > 1 ? buls : undefined;
          if (!section.bullets) section.paragraphs = toParagraphs(body);
        } else {
          section.paragraphs = toParagraphs(body);
        }
        reportSections.push(section);
      });
    } else {
      reportSections.push({
        heading: 'Executive Summary',
        level: 1,
        paragraphs: [asText(evaluationResult.summary) || 'No AI summary is available yet.'],
      });

      legacySections.forEach((section: any, index: number) => {
        const heading = asText(section?.heading || section?.key) || `Section ${index + 1}`;
        const bullets = Array.isArray(section?.bullets)
          ? section.bullets.map((entry: unknown) => asText(entry)).filter(Boolean)
          : [];
        if (bullets.length === 0) return;
        reportSections.push({
          heading,
          level: 2,
          bullets,
        });
      });
    }

    if (reportSections.length === 0) {
      reportSections.push({
        heading: 'Executive Summary',
        level: 1,
        paragraphs: ['No AI report content is available yet.'],
      });
    }

    const title = asText(resolved.comparison?.title) || asText(resolved.proposal?.title) || 'Shared Report';
    const comparisonId = asText(resolved.comparison?.id) || asText(resolved.proposal?.documentComparisonId) || 'shared-report';
    const filename = `${slugify(title)}-ai-report.pdf`;
    const finalSections = isV2 ? deduplicateSections(reportSections) : reportSections;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      // Report type is the primary heading; comparison name is the secondary subtitle
      title: 'AI Evaluation Report',
      subtitle: title !== 'Shared Report' ? title : 'Shared Report',
      comparisonId,
      footerNote: 'Shared report -- recipient-safe content only',
      decisionPanel,
      sections: finalSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
