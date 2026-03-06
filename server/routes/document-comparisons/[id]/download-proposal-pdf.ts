import { and, eq } from 'drizzle-orm';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  getComparisonId,
  parseTextIntoSections,
  renderProfessionalPdfBuffer,
  sendPdf,
  slugify,
  type PdfSection,
} from '../_pdf.js';

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

    const sections: PdfSection[] = [];

    // ── HELPERS ───────────────────────────────────────────────────────────
    /**
     * Given a list of parsed subsections and an ordered label priority list,
     * attempt to match each parsed heading against the priority list by a
     * case-insensitive keyword search.  Unmatched sections keep their original
     * heading.  Returns a new section list with display headings applied.
     */
    const normalizeSubsections = (
      subs: { heading: string; paragraphs?: string[]; bullets?: string[] }[],
      priority: { label: string; keywords: string[]; caption?: string }[],
    ): PdfSection[] => {
      const used = new Set<number>();
      const result: PdfSection[] = [];
      subs.forEach((sub) => {
        const hLower = sub.heading.toLowerCase();
        let matched = -1;
        for (let i = 0; i < priority.length; i++) {
          if (used.has(i)) continue;
          if (priority[i].keywords.some((kw) => hLower.includes(kw))) {
            matched = i;
            break;
          }
        }
        const label = matched >= 0 ? priority[matched].label : sub.heading;
        const caption = matched >= 0 ? priority[matched].caption : undefined;
        if (matched >= 0) used.add(matched);
        result.push({ heading: label, level: 2, paragraphs: sub.paragraphs, bullets: sub.bullets, caption });
      });
      return result;
    };

    // ── PROPOSAL BRIEF (shared / public information) ─────────────────────
    sections.push({
      heading: 'Proposal Brief',
      level: 1,
      paragraphs: [],
      caption: 'Shared proposal details — suitable for stakeholder distribution',
    });

    const SHARED_PRIORITY = [
      { label: 'Opportunity Overview', keywords: ['overview', 'summary', 'background', 'context', 'introduction'], caption: 'What this engagement is and why it matters' },
      { label: 'Current Environment', keywords: ['current', 'environment', 'existing', 'state', 'situation', 'problem', 'challenge'], caption: 'The buyer\'s current-state landscape and pain points' },
      { label: 'Scope & Deliverables', keywords: ['scope', 'deliverable', 'work', 'service', 'feature', 'module', 'solution'], caption: 'What is included in the proposed engagement' },
      { label: 'Timeline & Success Criteria', keywords: ['timeline', 'schedule', 'milestone', 'deadline', 'success', 'kpi', 'metric', 'outcome'], caption: 'Delivery schedule and how success will be measured' },
    ];

    const sharedText = String(comparison.docBText || '');
    if (sharedText.trim().length > 0) {
      const sharedSubs = parseTextIntoSections(sharedText, 'Overview');
      const mapped = normalizeSubsections(sharedSubs, SHARED_PRIORITY);
      mapped.forEach((s) => sections.push(s));
    } else {
      sections.push({ heading: 'Opportunity Overview', level: 2, paragraphs: ['No shared proposal content available yet.'] });
    }

    // ── CONFIDENTIAL NEGOTIATION NOTES (private / deal context) ──────────
    sections.push({
      heading: 'Confidential Negotiation Notes',
      level: 1,
      paragraphs: [],
      breakBefore: true,
      caption: 'Internal deal intelligence — do not distribute',
    });

    const CONF_PRIORITY = [
      { label: 'Budget Envelope', keywords: ['budget', 'price', 'cost', 'spend', 'investment', 'fee', 'rate'], caption: 'Known or estimated budget constraints and price sensitivity' },
      { label: 'Vendor Landscape', keywords: ['vendor', 'competitor', 'alternative', 'incumbent', 'other provider', 'shortlist', 'comparison'], caption: 'Competing vendors and evaluation dynamics' },
      { label: 'Internal Pressures', keywords: ['pressure', 'stakeholder', 'political', 'internal', 'champion', 'blocker', 'concern', 'objection'], caption: 'Internal forces and stakeholder dynamics affecting the deal' },
      { label: 'Walk-Away Conditions', keywords: ['walk', 'red line', 'non-negotiable', 'must have', 'deal breaker', 'reject', 'condition'], caption: 'Conditions under which this deal should not proceed' },
    ];

    const confidentialText = String(comparison.docAText || '');
    if (confidentialText.trim().length > 0) {
      const confSubs = parseTextIntoSections(confidentialText, 'Internal Notes');
      const mapped = normalizeSubsections(confSubs, CONF_PRIORITY);
      mapped.forEach((s) => sections.push(s));
    } else {
      sections.push({ heading: 'Internal Notes', level: 2, paragraphs: ['No confidential content available yet.'] });
    }

    const filename = `${slugify(comparison.title)}-proposal-details.pdf`;
    const pdfBuffer = await renderProfessionalPdfBuffer({
      title: comparison.title || 'Document Comparison',
      subtitle: 'Complete Proposal Details',
      comparisonId: comparison.id,
      footerNote: 'Confidential -- For internal use only',
      sections,
    });
    sendPdf(res, filename, pdfBuffer);
  });
}
