import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  buildDefaultSharedPayload,
  getPayloadText,
  getToken,
  resolveSharedReportToken,
  SHARED_REPORT_ROUTE,
} from '../_shared.js';
import {
  parseTextIntoSections,
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
  type PdfSection,
} from '../../document-comparisons/_pdf.js';

const SHARED_REPORT_DOWNLOAD_PROPOSAL_PDF_ROUTE = `${SHARED_REPORT_ROUTE}/download/proposal-pdf`;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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

    const sharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const sharedText = getPayloadText(sharedPayload, asText(resolved.comparison?.docBText || ''));

    const sections: PdfSection[] = [
      {
        heading: 'Proposal Brief',
        level: 1,
        paragraphs: [],
        caption: 'Recipient-safe shared proposal details',
      },
    ];

    const SHARED_PRIORITY = [
      {
        label: 'Opportunity Overview',
        keywords: ['overview', 'summary', 'background', 'context', 'introduction'],
        caption: 'What this engagement is and why it matters',
      },
      {
        label: 'Current Environment',
        keywords: ['current', 'environment', 'existing', 'state', 'situation', 'problem', 'challenge'],
        caption: 'The buyer current-state landscape and pain points',
      },
      {
        label: 'Scope & Deliverables',
        keywords: ['scope', 'deliverable', 'work', 'service', 'feature', 'module', 'solution'],
        caption: 'What is included in the proposed engagement',
      },
      {
        label: 'Timeline & Success Criteria',
        keywords: ['timeline', 'schedule', 'milestone', 'deadline', 'success', 'kpi', 'metric', 'outcome'],
        caption: 'Delivery schedule and how success will be measured',
      },
    ];

    const normalizeSubsections = (
      subs: { heading: string; paragraphs?: string[]; bullets?: string[] }[],
      priority: { label: string; keywords: string[]; caption?: string }[],
    ): PdfSection[] => {
      const used = new Set<number>();
      const result: PdfSection[] = [];
      subs.forEach((sub) => {
        const headingLower = asText(sub.heading).toLowerCase();
        let matched = -1;
        for (let i = 0; i < priority.length; i += 1) {
          if (used.has(i)) continue;
          if (priority[i].keywords.some((keyword) => headingLower.includes(keyword))) {
            matched = i;
            break;
          }
        }
        const label = matched >= 0 ? priority[matched].label : sub.heading;
        const caption = matched >= 0 ? priority[matched].caption : undefined;
        if (matched >= 0) used.add(matched);
        result.push({
          heading: label,
          level: 2,
          paragraphs: sub.paragraphs,
          bullets: sub.bullets,
          caption,
        });
      });
      return result;
    };

    if (sharedText.trim().length > 0) {
      const sharedSections = parseTextIntoSections(sharedText, 'Overview');
      normalizeSubsections(sharedSections, SHARED_PRIORITY).forEach((section) => sections.push(section));
    } else {
      sections.push({
        heading: 'Opportunity Overview',
        level: 2,
        paragraphs: ['No shared proposal content available yet.'],
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
    const filename = `${slugify(title)}-proposal.pdf`;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title,
      subtitle: 'Proposal',
      comparisonId,
      footerNote: 'Shared report -- recipient-safe content only',
      sections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
