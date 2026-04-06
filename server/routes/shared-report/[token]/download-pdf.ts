import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  buildMediationReviewSubtitle,
  buildMediationReviewTitle,
  getDecisionStatusDetails,
  getSentenceSafePreview,
  parseV2WhyEntry,
  buildRecipientSafeEvaluationProjection,
  MEDIATION_REVIEW_TITLE,
  PRE_SEND_REVIEW_TITLE,
} from '../../document-comparisons/_helpers.js';
import {
  asText,
  getToken,
  resolveSharedReportToken,
  SHARED_REPORT_ROUTE,
} from '../_shared.js';
import {
  renderProfessionalPdfBuffer,
  renderWebParityPdfBuffer,
  sendPdf,
  slugify,
  splitIntoBullets,
  toParagraphs,
  type PdfDecisionPanel,
  type PdfSection,
  type PdfWebParitySection,
} from '../../document-comparisons/_pdf.js';
import {
  filterLegacySectionsForDisplay,
  getAppendixOpenQuestions,
  getPresentationSections,
  MISSING_OR_REDACTED_INFO_LABEL,
  OPEN_QUESTIONS_LABEL,
  splitV2WhyBodyParagraphs,
} from '../../../../src/lib/aiReportUtils.js';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
  resolveOpportunityReviewStage,
} from '../../../../src/lib/opportunityReviewStage.js';

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

function getPdfFormat(req: any): 'legacy' | 'web-parity' {
  const raw = Array.isArray(req.query?.format) ? req.query.format[0] : req.query?.format;
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'web-parity' || normalized === 'web_parity') {
    return 'web-parity';
  }
  // Backward-compatible default path used by the legacy AI mediation PDF renderer.
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

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function getPreSendScopeSection() {
  return {
    heading: 'Review Scope',
    paragraphs: [
      'Based only on the current materials provided by one side. This review does not yet assess alignment, compatibility, or deal feasibility.',
    ],
  };
}

function buildWebParitySections(params: {
  report: Record<string, any>;
  legacySections: any[];
  missingItems: string[];
  fallbackSummary: string;
  emptyStateHeading?: string;
  prependScopeNote?: boolean;
}): PdfWebParitySection[] {
  const sections: PdfWebParitySection[] = [];
  const {
    report,
    legacySections,
    missingItems,
    fallbackSummary,
    emptyStateHeading = 'Executive Summary',
    prependScopeNote = false,
  } = params;
  const isV2 = Array.isArray(report.why) && report.why.length > 0;
  const dynamicSections = getPresentationSections(report);

  if (prependScopeNote) {
    sections.push(getPreSendScopeSection());
  }

  if (dynamicSections.length > 0) {
    dynamicSections.forEach((section) => {
      sections.push({
        heading: section.heading,
        paragraphs: section.paragraphs,
        bullets: section.bullets,
        numberedBullets: section.numberedBullets,
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
  } else if (isV2) {
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
      heading: emptyStateHeading,
      paragraphs: [fallbackSummary || 'No review content is available yet.'],
    });
  }

  return sections;
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
    const reviewStage = resolveOpportunityReviewStage(report, {
      source: asText(evaluationResult?.source),
      fallbackStage: MEDIATION_REVIEW_STAGE,
    });
    const isPreSendReview = reviewStage === PRE_SEND_REVIEW_STAGE;
    const defaultFilenameBase = isPreSendReview ? 'initial-review' : 'ai-mediation-review';
    const fallbackSummaryText = isPreSendReview
      ? 'No Initial Review content is available yet.'
      : 'No AI mediation summary is available yet.';
    const recipientSafeFooterNote = isPreSendReview
      ? 'Shared report -- based only on current materials from one side'
      : 'Shared report -- recipient-safe content only';

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
    const dynamicPresentationSections = getPresentationSections(report);
    const appendixOpenQuestions = getAppendixOpenQuestions(report);
    const ambiguousTerms = toStringArray(report.ambiguous_terms);
    const suggestedClarifications = toStringArray(report.suggested_clarifications);
    const missingInformation = toStringArray(report.missing_information);
    const preSendTightenCount = Array.from(
      new Set(
        [...missingInformation, ...ambiguousTerms, ...suggestedClarifications]
          .map((entry) => asText(entry))
          .filter(Boolean),
      ),
    ).length;
    const readinessLabel =
      asText(report.readiness_label) ||
      asText(report.readiness_status).replace(/_/g, ' ').trim() ||
      'Not Ready to Send';

    const decisionStatus = getDecisionStatusDetails(report);
    const pdfFormat = getPdfFormat(req);
    if (pdfFormat === 'web-parity') {
      const title = isPreSendReview
        ? PRE_SEND_REVIEW_TITLE
        : buildMediationReviewTitle(
            resolved.comparison?.title,
            resolved.proposal?.title,
            report.title,
            evaluationResult.title,
          );
      const subtitle = isPreSendReview
        ? asText(resolved.comparison?.title) || asText(resolved.proposal?.title)
        : buildMediationReviewSubtitle(
            resolved.comparison?.title,
            resolved.proposal?.title,
            report.title,
            evaluationResult.title,
          );
      const resolvedWebParityTitle = (() => {
        if (isPreSendReview) {
          return PRE_SEND_REVIEW_TITLE;
        }
        const preferred = asText(subtitle) || asText(title);
        if (preferred && preferred.toLowerCase() !== MEDIATION_REVIEW_TITLE.toLowerCase()) {
          return preferred;
        }
        return 'Opportunity';
      })();
      const comparisonId =
        asText(resolved.comparison?.id) ||
        asText(resolved.proposal?.documentComparisonId) ||
        'shared-report';
      const filenameBase = slugify(title) || defaultFilenameBase;
      const filename =
        filenameBase === defaultFilenameBase
          ? `${defaultFilenameBase}-web-parity.pdf`
          : `${filenameBase}-${defaultFilenameBase}-web-parity.pdf`;
      const recommendationRaw =
        asText(report.recommendation) ||
        asText(evaluationResult.recommendation) ||
        asText(report.fit_level) ||
        'pending';
      const recommendationMetric = recommendationRaw ? toTitleCase(recommendationRaw) : 'Pending';
      const sections = buildWebParitySections({
        report,
        legacySections: legacySections as any[],
        missingItems: appendixOpenQuestions,
        fallbackSummary:
          asText(report.summary) ||
          asText(evaluationResult.summary) ||
          fallbackSummaryText,
        emptyStateHeading: isPreSendReview ? 'Readiness to Send' : 'Executive Summary',
        prependScopeNote: isPreSendReview,
      });
      const decisionExplanation = asText(decisionStatus.explanation);
      const webParitySections = !isPreSendReview && decisionExplanation && dynamicPresentationSections.length === 0
        ? [
            ...sections,
            {
              heading: 'Decision Explanation',
              paragraphs: [decisionExplanation],
            },
          ]
        : sections;

      const pdfBuffer = await renderWebParityPdfBuffer({
        title: resolvedWebParityTitle,
        subtitle: isPreSendReview ? subtitle : '',
        comparisonId,
        metrics: isPreSendReview
          ? [
              { label: 'Readiness', value: readinessLabel },
              { label: 'Review Type', value: PRE_SEND_REVIEW_TITLE },
              { label: 'Input Basis', value: 'One side\'s materials' },
              {
                label: 'Points to Tighten',
                value: `${preSendTightenCount} item${preSendTightenCount === 1 ? '' : 's'}`,
              },
            ]
          : [
              { label: 'Recommendation', value: recommendationMetric },
              { label: 'Confidence', value: `${confidence}%` },
              { label: 'Status', value: decisionStatus.label || 'Unknown' },
              {
                label: OPEN_QUESTIONS_LABEL,
                value: `${missingItems.length} item${missingItems.length === 1 ? '' : 's'}`,
              },
            ],
        timelineItems: [
          { label: 'Opportunity Created', value: formatDateTime(resolved.comparison?.createdAt) },
          { label: 'Last Updated', value: formatDateTime(resolved.comparison?.updatedAt) },
        ],
        footerNote: recipientSafeFooterNote,
        sections: webParitySections,
      });
      sendPdf(res, filename, pdfBuffer);
      return;
    }

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

    const decisionPanel: PdfDecisionPanel = {
      fitLevelDisplay,
      confidence,
      recommendation: recommendationDisplay,
      decisionStatus: fitStatusInfo.status,
      fitColor: fitStatusInfo.color,
      decisionContext: decisionStatus.explanation || undefined,
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
      'executive summary': { level: 1, displayHeading: 'Executive Summary' },
      snapshot: { level: 1, displayHeading: 'Executive Summary' },
      'decision assessment': { level: 1, displayHeading: 'Decision Assessment' },
      'negotiation insights': { level: 1, displayHeading: 'Negotiation Insights' },
      'leverage signals': { level: 1, displayHeading: 'Leverage Signals' },
      'potential deal structures': { level: 1, displayHeading: 'Potential Deal Structures', splitOptions: true, numberedBullets: true },
      'recommended path': { level: 1, displayHeading: 'Recommended Path', callout: true },
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
      const byLetter = text.split(/\s*(?=Option [A-Z]\s*[—:-])/);
      if (byLetter.length > 1) {
        return byLetter.map((entry) => entry.replace(/\.$/, '').trim()).filter((entry) => entry.length > 5);
      }
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

    if (dynamicPresentationSections.length > 0) {
      if (isPreSendReview) {
        reportSections.push({
          heading: 'Review Scope',
          level: 1,
          paragraphs: getPreSendScopeSection().paragraphs,
        });
      }
      dynamicPresentationSections.forEach((section, sectionIndex) => {
        reportSections.push({
          heading: section.heading,
          level: 1,
          paragraphs: section.paragraphs,
          bullets: section.bullets,
          numberedBullets: section.numberedBullets,
          callout: sectionIndex === 0 && Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && (!section.bullets || section.bullets.length === 0),
        });
      });

      if (appendixOpenQuestions.length > 0) {
        reportSections.push({
          heading: 'Open Questions',
          level: 1,
          bullets: appendixOpenQuestions,
          numberedBullets: true,
        });
      }

      const redactions = Array.isArray(report.redactions)
        ? (report.redactions as unknown[]).map((entry) => asText(entry)).filter(Boolean)
        : [];
      if (redactions.length > 0) {
        reportSections.push({
          heading: 'Missing or Redacted Information',
          level: 1,
          bullets: redactions,
        });
      }
    } else if (isV2) {
      (report.why as unknown[]).forEach((entryRaw) => {
        const entry = asText(entryRaw);
        if (!entry) return;
        const { heading: parsedHeading, body: parsedBody } = parseV2WhyEntry(entry);
        const rawHeading = parsedHeading || 'Analysis';
        const body = parsedBody || entry;
        const spec: SectionSpec = lookupSection(rawHeading) || {
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

      if (appendixOpenQuestions.length > 0) {
        reportSections.push({
          heading: 'Open Questions',
          level: 1,
          bullets: appendixOpenQuestions,
          numberedBullets: true,
        });
      }

      const redactions = Array.isArray(report.redactions)
        ? (report.redactions as unknown[]).map((entry) => asText(entry)).filter(Boolean)
        : [];
      if (redactions.length > 0) {
        reportSections.push({
          heading: 'Missing or Redacted Information',
          level: 1,
          bullets: redactions,
        });
      }
    } else {
      if (isPreSendReview) {
        reportSections.push({
          heading: 'Review Scope',
          level: 1,
          paragraphs: getPreSendScopeSection().paragraphs,
        });
        reportSections.push({
          heading: 'Readiness Summary',
          level: 1,
          paragraphs: [
            asText(report.send_readiness_summary) || asText(evaluationResult.summary) || fallbackSummaryText,
            `Review type: ${PRE_SEND_REVIEW_TITLE}. Based only on the current materials from one side. Readiness: ${readinessLabel}.`,
          ].filter(Boolean),
        });
        if (suggestedClarifications.length > 0) {
          reportSections.push({
            heading: 'Points to Tighten',
            level: 1,
            bullets: suggestedClarifications,
          });
        }
      } else {
        reportSections.push({
          heading: 'Executive Summary',
          level: 1,
          paragraphs: [asText(evaluationResult.summary) || fallbackSummaryText],
        });
      }

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
        heading: isPreSendReview ? 'Readiness to Send' : 'Executive Summary',
        level: 1,
        paragraphs: [fallbackSummaryText],
      });
    }

    const title = isPreSendReview
      ? PRE_SEND_REVIEW_TITLE
      : buildMediationReviewTitle(
          resolved.comparison?.title,
          resolved.proposal?.title,
          report.title,
          evaluationResult.title,
        );
    const subtitle = isPreSendReview
      ? asText(resolved.comparison?.title) || asText(resolved.proposal?.title)
      : buildMediationReviewSubtitle(
          resolved.comparison?.title,
          resolved.proposal?.title,
          report.title,
          evaluationResult.title,
        );
    const comparisonId = asText(resolved.comparison?.id) || asText(resolved.proposal?.documentComparisonId) || 'shared-report';
    const filenameBase = slugify(title) || defaultFilenameBase;
    const filename =
      filenameBase === defaultFilenameBase
        ? `${defaultFilenameBase}.pdf`
        : `${filenameBase}-${defaultFilenameBase}.pdf`;
    const finalSections = isV2 ? deduplicateSections(reportSections) : reportSections;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: isPreSendReview ? PRE_SEND_REVIEW_TITLE : MEDIATION_REVIEW_TITLE,
      subtitle,
      comparisonId,
      footerNote: recipientSafeFooterNote,
      decisionPanel: isPreSendReview ? undefined : decisionPanel,
      sections: finalSections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
