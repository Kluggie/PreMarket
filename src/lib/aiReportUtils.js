/**
 * Pure utility functions for AI mediation review display.
 *
 * These are intentionally dependency-free so they can be unit-tested
 * with node:test without needing a DOM or React.
 */

export const MEDIATION_REVIEW_LABEL = 'AI Mediation Review';
export const RUN_AI_MEDIATION_LABEL = 'Run AI Mediation';
export const RERUN_AI_MEDIATION_LABEL = 'Re-run AI Mediation';
export const RUNNING_AI_MEDIATION_LABEL = 'Running AI Mediation...';
export const OPEN_QUESTIONS_LABEL = 'Open Questions';
export const MISSING_OR_REDACTED_INFO_LABEL = 'Missing or Redacted Information';

const PLACEHOLDER_REVIEW_TITLES = new Set([
  'untitled',
  'untitled comparison',
  'untitled proposal',
  'shared report',
]);

export function getRunAiMediationLabel({ isPending = false, hasExisting = false } = {}) {
  if (isPending) {
    return RUNNING_AI_MEDIATION_LABEL;
  }
  return hasExisting ? RERUN_AI_MEDIATION_LABEL : RUN_AI_MEDIATION_LABEL;
}

export function getDecisionStatusInfo(report) {
  const fit = String(report?.fit_level ?? '').trim().toLowerCase();
  const confidence = Number(report?.confidence_0_1);
  const missingCount = Array.isArray(report?.missing) ? report.missing.length : 0;

  if (fit === 'high') {
    return { label: 'Ready to finalize', tone: 'success' };
  }
  if (fit === 'low') {
    return { label: 'Not viable', tone: 'danger' };
  }
  if (fit === 'medium') {
    if (Number.isFinite(confidence) && confidence >= 0.62 && missingCount <= 4) {
      return { label: 'Proceed with conditions', tone: 'warning' };
    }
    return { label: 'Explore further', tone: 'neutral' };
  }
  return { label: 'Explore further', tone: 'neutral' };
}

export function getMediationReviewTitle(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (!text) continue;
    if (PLACEHOLDER_REVIEW_TITLES.has(text.toLowerCase())) continue;
    return text;
  }
  return MEDIATION_REVIEW_LABEL;
}

/**
 * Returns true if the report object contains V2-format data
 * (a non-empty `why` array produced by evaluateWithVertexV2).
 *
 * @param {Record<string, unknown>|null|undefined} report
 * @returns {boolean}
 */
export function hasV2Report(report) {
  return Array.isArray(report?.why) && report.why.length > 0;
}

/**
 * Parses a V2 why-entry string into `{ heading, body }`.
 *
 * V2 why entries follow the heading-prefixed convention:
 *   "Executive Summary: The proposal clearly defines..."
 *   "Key Strengths: Timeline is realistic given..."
 *
 * If the entry doesn't match the pattern, returns heading=null so the
 * caller can render the full text as a plain paragraph.
 *
 * @param {string} text
 * @returns {{ heading: string|null, body: string }}
 */
export function parseV2WhyEntry(text) {
  const str = String(text ?? '').trim();
  // Heading starts with an uppercase letter, runs up to 60 chars before ": "
  // Body is everything after; use `s` flag so `.` matches newlines in body.
  const match = str.match(/^([A-Z][^:\n]{0,60}?):\s+(.+)$/s);
  if (match) {
    return { heading: normalizeV2Heading(match[1].trim()), body: match[2].trim() };
  }
  return { heading: null, body: str };
}

/**
 * Canonical heading display names for V2 report sections.
 * Maps AI-generated heading variants to the single authoritative label
 * shown in every AI mediation review view (proposer, recipient, PDF, shared link).
 *
 * Rules:
 *  - Match is case-insensitive and trims surrounding whitespace.
 *  - First matching alias wins.
 *  - Unrecognised headings are returned as-is so no content is ever lost.
 *
 * @param {string} raw  Heading text extracted by parseV2WhyEntry
 * @returns {string}   Canonical heading or the original raw string
 */
export function normalizeV2Heading(raw) {
  const normalized = String(raw ?? '').trim();
  const lower = normalized.toLowerCase();

  /** @type {[string[], string][]} — [aliases, canonical] */
  const HEADING_MAP = [
    [['executive summary', 'summary', 'overview', 'intro', 'introduction', 'snapshot', 'decision snapshot'], 'Executive Summary'],
    [['decision assessment', 'assessment'], 'Decision Assessment'],
    [
      ['decision snapshot', 'snapshot', 'situation', 'context', 'background'],
      'Decision Snapshot',
    ],
    [
      [
        'key strengths',
        'strengths',
        'top strengths',
        'match reasons',
        'top match reasons',
        'fit reasons',
        'positives',
        'pros',
      ],
      'Key Strengths',
    ],
    [
      [
        'key risks',
        'risks',
        'risk summary',
        'key gaps',
        'gaps',
        'concerns',
        'flags',
        'top blockers',
        'blockers',
        'cons',
        'downsides',
      ],
      'Key Risks',
    ],
    [['negotiation insights', 'negotiation insight'], 'Negotiation Insights'],
    [['leverage signals', 'leverage', 'leverage signal'], 'Leverage Signals'],
    [['potential deal structures', 'deal structures', 'deal structure'], 'Potential Deal Structures'],
    [
      ['decision readiness', 'readiness', 'readiness assessment', 'data completeness'],
      'Decision Readiness',
    ],
    [
      [
        'recommended path',
        'recommendation',
        'recommended next step',
        'next steps',
        'options',
        'path forward',
        'next actions',
        'actions',
      ],
      'Recommended Path',
    ],
    [
      [
        'open questions',
        'follow-up questions',
        'followup questions',
        'clarifying questions',
        'questions',
      ],
      'Open Questions',
    ],
    [
      [
        'redacted / missing info',
        'missing or redacted information',
        'missing or redacted info',
        'redacted',
        'missing info',
        'missing information',
        'suggested additions',
        'information gaps',
      ],
      'Missing or Redacted Information',
    ],
  ];

  for (const [aliases, canonical] of HEADING_MAP) {
    if (aliases.some((alias) => lower === alias || lower.startsWith(alias + ' '))) {
      return canonical;
    }
  }

  return normalized;
}

/**
 * Filters and adjusts legacy section cards for display.
 *
 * Rules applied:
 * - Category Breakdown: strip rows with "score n/a"; hide the entire card
 *   if fewer than 2 rows have a numeric score after stripping.
 * - Risk Flags: hide if there are no bullets.
 * - Top Blockers: hide if there are no bullets.
 * - All other sections: hide if there are no bullets.
 *
 * @param {Array<{ key: string; heading: string; bullets: string[] }>} sections
 * @returns {Array<{ key: string; heading: string; bullets: string[] }>}
 */
export function filterLegacySectionsForDisplay(sections) {
  if (!Array.isArray(sections)) return [];

  return sections
    .map((section) => {
      if (!section || typeof section !== 'object') return null;
      const key = String(section.key ?? '').toLowerCase();
      const heading = String(section.heading ?? '');
      const bullets = Array.isArray(section.bullets) ? section.bullets : [];

      // Strip "score n/a" rows from category_breakdown.
      if (key === 'category_breakdown' || heading === 'Category Breakdown') {
        return {
          ...section,
          bullets: bullets.filter((b) => !/score\s+n\/a/i.test(String(b))),
        };
      }
      return section;
    })
    .filter(Boolean)
    .filter((section) => {
      const key = String(section.key ?? '').toLowerCase();
      const heading = String(section.heading ?? '');
      const bullets = Array.isArray(section.bullets) ? section.bullets : [];

      if (key === 'category_breakdown' || heading === 'Category Breakdown') {
        // Count rows with an actual numeric score (e.g. "score 11").
        const numericCount = bullets.filter((b) => /score\s+\d+/i.test(String(b))).length;
        return numericCount >= 2;
      }

      // Risk Flags / Top Blockers / everything else: hide when empty.
      return bullets.length > 0;
    });
}

/**
 * Returns the overall confidence as an integer percentage (0–100) for
 * display in the progress bar.
 *
 * For V2 reports `report.confidence_0_1` (0–1) is preferred.
 * Falls back to `report.similarity_score` or the legacy `fallbackScore` value.
 *
 * @param {Record<string, unknown>|null|undefined} report
 * @param {number|null|undefined} fallbackScore  0–100 legacy score
 * @returns {number}
 */
export function getConfidencePercent(report, fallbackScore) {
  const c01 = Number(report?.confidence_0_1);
  if (Number.isFinite(c01)) {
    return Math.round(Math.max(0, Math.min(1, c01)) * 100);
  }
  const legacy = Number(report?.similarity_score ?? fallbackScore ?? 0);
  return Number.isFinite(legacy) ? Math.max(0, Math.min(100, Math.round(legacy))) : 0;
}
