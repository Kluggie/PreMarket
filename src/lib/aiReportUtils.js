/**
 * Pure utility functions for AI review display.
 *
 * These are intentionally dependency-free so they can be unit-tested
 * with node:test without needing a DOM or React.
 */

import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
  STAGE1_SHARED_INTAKE_STAGE,
  isLegacyPreSendReviewStage,
  isPreSendReviewStage,
  isSharedIntakeReviewStage,
  resolveOpportunityReviewStage,
} from './opportunityReviewStage.js';

export const MEDIATION_REVIEW_LABEL = 'AI Mediation Review';
export const STAGE1_SHARED_INTAKE_LABEL = 'Initial Review';
export const PRE_SEND_REVIEW_LABEL = STAGE1_SHARED_INTAKE_LABEL;
export const RUN_AI_MEDIATION_LABEL = 'Run AI Mediation';
export const RERUN_AI_MEDIATION_LABEL = 'Re-run AI Mediation';
export const RUNNING_AI_MEDIATION_LABEL = 'Running AI Mediation...';
export const RUN_PRE_SEND_REVIEW_LABEL = 'Run Initial Review';
export const RERUN_PRE_SEND_REVIEW_LABEL = 'Re-run Initial Review';
export const RUNNING_PRE_SEND_REVIEW_LABEL = 'Running Initial Review...';
export const OPEN_QUESTIONS_LABEL = 'Open Questions';
export const MISSING_OR_REDACTED_INFO_LABEL = 'Missing or Redacted Information';
export const STAGE1_PRELIMINARY_SUMMARY_NOTE =
  'This summary is based solely on the materials submitted by one party. It is a preliminary summary intended to help structure the next exchange. A more complete understanding will be possible once the other side has had an opportunity to review and respond.';
export const STAGE1_INITIAL_REVIEW_LABEL = 'Status';
export const DECISION_STATUS_LABELS = Object.freeze([
  'Not viable',
  'Explore further',
  'Proceed with conditions',
  'Ready to finalize',
]);

const PLACEHOLDER_REVIEW_TITLES = new Set([
  'untitled',
  'untitled comparison',
  'untitled proposal',
  'untitled opportunity',
  'shared report',
]);

const DECISION_STATUS_TONE_MAP = {
  'Not viable': 'danger',
  'Explore further': 'neutral',
  'Proceed with conditions': 'warning',
  'Ready to finalize': 'success',
};

const TRAILING_FRAGMENT_PATTERN =
  /\b(and|or|but|because|if|then|with|for|to|of|in|on|by|versus|vs|than|around|about|under|over|through|including|depending|based)\b$/i;

const COMMON_ABBREVIATION_PATTERN =
  /\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e|no|fig|eq|dept)\.$/i;

function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparableTitle(value) {
  return normalizeSpaces(value).toLowerCase();
}

function normalizeDecisionStatusLabel(value) {
  const normalized = normalizeSpaces(value).toLowerCase();
  if (normalized === 'not viable') return 'Not viable';
  if (normalized === 'explore further') return 'Explore further';
  if (normalized === 'proceed with conditions') return 'Proceed with conditions';
  if (normalized === 'ready to finalize') return 'Ready to finalize';
  return '';
}

function stripTrailingFragment(value) {
  return normalizeSpaces(value)
    .replace(/[,:;—-]+\s*$/g, '')
    .replace(TRAILING_FRAGMENT_PATTERN, '')
    .trim();
}

function isSentenceBoundaryAt(text, index) {
  const char = text[index];
  if (!/[.!?]/.test(char)) return false;

  const next = text[index + 1] || '';
  if (next && !/[\s"'”)\]]/.test(next)) return false;

  if (char === '.') {
    const snippet = text.slice(Math.max(0, index - 14), index + 1);
    if (COMMON_ABBREVIATION_PATTERN.test(snippet)) return false;
    if (/\b[A-Z]\.$/.test(snippet)) return false;
    if (/\d\.\d$/.test(text.slice(Math.max(0, index - 1), index + 2))) return false;
  }

  return true;
}

function lastSentenceBoundaryBefore(text, maxChars) {
  const limit = Math.min(text.length, Math.max(0, maxChars));
  let boundary = -1;
  for (let index = 0; index < limit; index += 1) {
    if (isSentenceBoundaryAt(text, index)) {
      boundary = index + 1;
    }
  }
  return boundary;
}

function lastClauseBoundaryBefore(text, maxChars) {
  const candidate = text.slice(0, Math.max(0, maxChars));
  let boundary = -1;
  const patterns = [
    /[;:](?=\s|$)/g,
    /,\s+(?=(?:and|but|or|while|because|if|when|before|after|although|though|which|who|that)\b)/gi,
    /,(?=\s)/g,
    /\s(?:--|-|—)\s/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of candidate.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (index > boundary) {
        boundary = index + (match[0].endsWith(' ') ? match[0].length : 1);
      }
    }
  });

  return boundary;
}

function finalizeBoundaryCut(value) {
  let next = stripTrailingFragment(value);
  if (!next) return '';
  if (!/[.!?]$/.test(next)) {
    next = `${next}.`;
  }
  return next;
}

export function truncateTextAtNaturalBoundary(text, maxChars) {
  const safe = normalizeSpaces(text);
  if (!safe) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (safe.length <= maxChars) return safe;

  const sentenceBoundary = lastSentenceBoundaryBefore(safe, maxChars);
  if (sentenceBoundary > 0) {
    return safe.slice(0, sentenceBoundary).trim();
  }

  const clauseBoundary = lastClauseBoundaryBefore(safe, maxChars);
  if (clauseBoundary > 0) {
    return finalizeBoundaryCut(safe.slice(0, clauseBoundary));
  }

  return '';
}

export function splitV2WhyBodyParagraphs(value) {
  return String(value ?? '')
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function extractDecisionStatusFromParagraph(paragraph) {
  const match = normalizeSpaces(paragraph).match(
    /^Decision status:\s*(Not viable|Explore further|Proceed with conditions|Ready to finalize)\b\.?\s*(.*)$/i,
  );
  if (!match) return null;

  const label = normalizeDecisionStatusLabel(match[1]);
  if (!label) return null;

  let explanation = normalizeSpaces(match[2]).replace(/^[-:;., ]+/, '').trim();
  if (explanation) {
    explanation = finalizeBoundaryCut(explanation);
  }

  return {
    label,
    tone: DECISION_STATUS_TONE_MAP[label] || 'neutral',
    explanation: explanation || '',
  };
}

export function getRunAiMediationLabel({ isPending = false, hasExisting = false } = {}) {
  if (isPending) {
    return RUNNING_AI_MEDIATION_LABEL;
  }
  return hasExisting ? RERUN_AI_MEDIATION_LABEL : RUN_AI_MEDIATION_LABEL;
}

export function getRunOpportunityReviewLabel({
  stage = MEDIATION_REVIEW_STAGE,
  isPending = false,
  hasExisting = false,
} = {}) {
  if (isPreSendReviewStage(stage)) {
    if (isPending) {
      return RUNNING_PRE_SEND_REVIEW_LABEL;
    }
    return hasExisting ? RERUN_PRE_SEND_REVIEW_LABEL : RUN_PRE_SEND_REVIEW_LABEL;
  }
  if (isPending) {
    return RUNNING_AI_MEDIATION_LABEL;
  }
  return hasExisting ? RERUN_AI_MEDIATION_LABEL : RUN_AI_MEDIATION_LABEL;
}

function normalizeReadinessStatusLabel(value) {
  const normalized = normalizeSpaces(value).toLowerCase();
  if (normalized === 'ready to send' || normalized === 'ready_to_send') return 'Ready to Send';
  if (
    normalized === 'ready with clarifications' ||
    normalized === 'ready_with_clarifications'
  ) {
    return 'Ready with Clarifications';
  }
  return 'Not Ready to Send';
}

function normalizeIntakeStatusLabel(value) {
  const normalized = normalizeSpaces(value).toLowerCase().replace(/_/g, ' ');
  if (normalized.includes('awaiting other side input') || normalized.includes('awaiting other side')) {
    return 'Awaiting response';
  }
  return 'Awaiting response';
}

function stripTrailingTerminalPunctuation(value) {
  return normalizeSpaces(value).replace(/[.?!]+$/g, '').trim();
}

export function normalizeStage1ClarificationBullet(value) {
  const raw = stripTrailingTerminalPunctuation(value);
  if (!raw) return '';

  let next = raw
    .replace(/^The responding side should confirm\s+/i, 'Clarification on ')
    .replace(/^The responding side should provide\s+/i, 'Initial detail on ')
    .replace(/^The responding side should share\s+/i, 'Initial detail on ')
    .replace(/^The responding side should outline\s+/i, 'Initial detail on ')
    .replace(/^The responding side(?:'s|’s)?\s+/i, '')
    .replace(/^A clear response on\s+/i, 'Clarification on ')
    .replace(/^Enough detail on\s+/i, 'Further context on ')
    .replace(/^Its own\s+/i, 'Any ')
    .replace(/\bmaterially affect\b/gi, 'may affect')
    .replace(/\bmaterially change\b/gi, 'may change');

  if (/^[a-z]/.test(next)) {
    next = `Further context on ${next}`;
  }

  return normalizeSpaces(next)
    .replace(/^Clarification on (the )/i, 'Clarification on ')
    .replace(/^Initial detail on (the )/i, 'Initial detail on ')
    .replace(/^Further context on (the )/i, 'Further context on ')
    .trim();
}

function ensureStage1Sentence(value) {
  const text = normalizeSpaces(value);
  if (!text) return '';
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function buildStage1CompactParagraphs(values, itemsPerParagraph = 2) {
  const sentences = (Array.isArray(values) ? values : [])
    .map((value) => ensureStage1Sentence(value))
    .filter(Boolean);
  const paragraphs = [];
  for (let index = 0; index < sentences.length; index += itemsPerParagraph) {
    paragraphs.push(sentences.slice(index, index + itemsPerParagraph).join(' '));
  }
  return paragraphs;
}

function buildStage1ProseParagraph(values) {
  const fragments = (Array.isArray(values) ? values : [])
    .map((value) => stripTrailingTerminalPunctuation(normalizeSpaces(value)))
    .filter(Boolean);
  if (fragments.length === 0) return [];
  if (fragments.length === 1) return [`${fragments[0]}.`];
  const lowered = fragments.map((f, i) => (i === 0 ? f : f.replace(/^[A-Z]/, (ch) => ch.toLowerCase())));
  return [`Useful clarifications at this stage would include ${lowered.join(', ')}.`];
}

function buildStage1PresentationSectionsFromReport(report) {
  const submissionSummary = normalizeSpaces(report?.submission_summary);
  const scopeSnapshot = Array.isArray(report?.scope_snapshot) ? report.scope_snapshot : [];
  const unansweredQuestions = Array.isArray(report?.unanswered_questions) ? report.unanswered_questions : [];
  const otherSideNeeded = Array.isArray(report?.other_side_needed) ? report.other_side_needed : [];
  const discussionStartingPoints = Array.isArray(report?.discussion_starting_points)
    ? report.discussion_starting_points
    : [];
  const intakeStatus = normalizeIntakeStatusLabel(report?.intake_status);

  return [
    {
      key: 'submission_summary',
      heading: 'Submission Summary',
      paragraphs: submissionSummary ? [submissionSummary] : [],
      bullets: [],
      numberedBullets: false,
    },
    {
      key: 'scope_snapshot',
      heading: 'Scope Snapshot',
      paragraphs: buildStage1CompactParagraphs(scopeSnapshot),
      bullets: [],
      numberedBullets: false,
    },
    {
      key: 'still_unanswered',
      heading: OPEN_QUESTIONS_LABEL,
      paragraphs: buildStage1CompactParagraphs(unansweredQuestions, 1),
      bullets: [],
      numberedBullets: false,
    },
    {
      key: 'what_the_other_side_still_needs_to_provide',
      heading: 'Suggested Clarifications',
      paragraphs: buildStage1ProseParagraph(
        otherSideNeeded.map((entry) => normalizeStage1ClarificationBullet(entry)),
      ),
      bullets: [],
      numberedBullets: false,
    },
    {
      key: 'discussion_starting_points',
      heading: 'Discussion Starting Points',
      paragraphs: buildStage1CompactParagraphs(discussionStartingPoints),
      bullets: [],
      numberedBullets: false,
    },
    {
      key: 'shared_intake_status',
      heading: STAGE1_INITIAL_REVIEW_LABEL,
      paragraphs: intakeStatus ? [`${intakeStatus}.`] : [],
      bullets: [],
      numberedBullets: false,
    },
  ].filter((section) => section.paragraphs.length > 0 || section.bullets.length > 0);
}

export function getReviewStageLabel(stageOrReport) {
  const stage =
    typeof stageOrReport === 'string'
      ? stageOrReport
      : resolveOpportunityReviewStage(stageOrReport, { fallbackStage: MEDIATION_REVIEW_STAGE });
  return isPreSendReviewStage(stage) ? STAGE1_SHARED_INTAKE_LABEL : MEDIATION_REVIEW_LABEL;
}

export function getReviewStatusDetails(report) {
  const stage = resolveOpportunityReviewStage(report, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  if (isSharedIntakeReviewStage(stage)) {
    return {
      label: normalizeIntakeStatusLabel(report?.intake_status),
      tone: 'neutral',
      explanation: normalizeSpaces(report?.basis_note || STAGE1_PRELIMINARY_SUMMARY_NOTE),
    };
  }
  if (isLegacyPreSendReviewStage(stage)) {
    const label = normalizeReadinessStatusLabel(report?.readiness_status);
    return {
      label,
      tone:
        label === 'Ready to Send'
          ? 'success'
          : label === 'Ready with Clarifications'
            ? 'warning'
            : 'danger',
      explanation: normalizeSpaces(report?.send_readiness_summary || ''),
    };
  }
  return getDecisionStatusDetails(report);
}

export function getDecisionStatusDetails(report) {
  const whyEntries = Array.isArray(report?.why) ? report.why : [];

  for (const entry of whyEntries) {
    const { heading, body } = parseV2WhyEntry(entry);
    if (normalizeSpaces(heading).toLowerCase() !== 'decision readiness') continue;
    for (const paragraph of splitV2WhyBodyParagraphs(body)) {
      const details = extractDecisionStatusFromParagraph(paragraph);
      if (details) return details;
    }
  }

  for (const entry of whyEntries) {
    const { body } = parseV2WhyEntry(entry);
    for (const paragraph of splitV2WhyBodyParagraphs(body)) {
      const details = extractDecisionStatusFromParagraph(paragraph);
      if (details) return details;
    }
  }

  const fit = String(report?.fit_level ?? '').trim().toLowerCase();
  const confidence = Number(report?.confidence_0_1);
  const missingCount = Array.isArray(report?.missing) ? report.missing.length : 0;
  const label =
    fit === 'high'
      ? 'Ready to finalize'
      : fit === 'low'
      ? 'Not viable'
      : fit === 'medium' && Number.isFinite(confidence) && confidence >= 0.62 && missingCount <= 4
      ? 'Proceed with conditions'
      : 'Explore further';

  return {
    label,
    tone: DECISION_STATUS_TONE_MAP[label] || 'neutral',
    explanation: '',
  };
}

export function getDecisionStatusInfo(report) {
  const { label, tone } = getDecisionStatusDetails(report);
  return { label, tone };
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

export function getMediationReviewSubtitle(...candidates) {
  const title = getMediationReviewTitle(...candidates);
  return normalizeComparableTitle(title) === normalizeComparableTitle(MEDIATION_REVIEW_LABEL) ? '' : title;
}

export function getSentenceSafePreview(text, maxChars = 180) {
  const safe = normalizeSpaces(text);
  if (!safe) return '';

  const firstSentenceBoundary = lastSentenceBoundaryBefore(safe, safe.length);
  if (firstSentenceBoundary > 0) {
    const firstSentence = safe.slice(0, firstSentenceBoundary).trim();
    if (firstSentence.length <= maxChars) {
      return firstSentence;
    }
  }

  return truncateTextAtNaturalBoundary(safe, maxChars) || '';
}

/**
 * Returns true if the report object contains V2-format data
 * (a non-empty `why` array produced by evaluateWithVertexV2).
 *
 * @param {Record<string, unknown>|null|undefined} report
 * @returns {boolean}
 */
export function hasV2Report(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return false;
  }
  if (Array.isArray(report?.why) && report.why.length > 0) {
    return true;
  }
  if (Array.isArray(report?.presentation_sections) && report.presentation_sections.length > 0) {
    return true;
  }
  const stage = resolveOpportunityReviewStage(report, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  if (isSharedIntakeReviewStage(stage)) {
    return Boolean(
      normalizeSpaces(report?.submission_summary) ||
        normalizeSpaces(report?.intake_status) ||
        normalizeSpaces(report?.basis_note),
    );
  }
  return isLegacyPreSendReviewStage(stage) && (
    normalizeSpaces(report?.send_readiness_summary) ||
    normalizeSpaces(report?.readiness_status)
  );
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

function normalizePresentationSection(section, index = 0) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const heading = normalizeSpaces(section.heading || section.title || section.key || `Section ${index + 1}`);
  const paragraphs = Array.isArray(section.paragraphs)
    ? section.paragraphs.map((entry) => normalizeSpaces(entry)).filter(Boolean)
    : [];
  const bullets = Array.isArray(section.bullets)
    ? section.bullets.map((entry) => normalizeSpaces(entry)).filter(Boolean)
    : [];
  if (!heading || (paragraphs.length === 0 && bullets.length === 0)) {
    return null;
  }
  return {
    key: normalizeSpaces(section.key || heading).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    heading,
    paragraphs,
    bullets,
    numberedBullets: Boolean(section.numberedBullets || section.numbered_bullets),
  };
}

export function getPresentationSections(report) {
  const stage = resolveOpportunityReviewStage(report, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  if (!Array.isArray(report?.presentation_sections)) {
    return isSharedIntakeReviewStage(stage)
      ? buildStage1PresentationSectionsFromReport(report)
      : [];
  }
  const sections = report.presentation_sections
    .map((section, index) => normalizePresentationSection(section, index))
    .filter(Boolean);
  if (!isSharedIntakeReviewStage(stage)) {
    return sections;
  }
  return sections.map((section) => {
    const heading = normalizeSpaces(section.heading).toLowerCase();
    if (heading === 'scope snapshot' || heading === 'discussion starting points') {
      if (section.paragraphs.length > 0 && section.bullets.length === 0) {
        return section;
      }
      return {
        ...section,
        paragraphs: buildStage1CompactParagraphs(section.bullets),
        bullets: [],
        numberedBullets: false,
      };
    }
    if (heading === 'open questions') {
      if (section.paragraphs.length > 0 && section.bullets.length === 0) {
        return section;
      }
      return {
        ...section,
        paragraphs: buildStage1CompactParagraphs(section.bullets, 1),
        bullets: [],
        numberedBullets: false,
      };
    }
    if (heading === 'suggested clarifications') {
      if (section.paragraphs.length > 0 && section.bullets.length === 0) {
        return section;
      }
      return {
        ...section,
        paragraphs: buildStage1ProseParagraph(
          (Array.isArray(section.bullets) ? section.bullets : [])
            .map((entry) => normalizeStage1ClarificationBullet(entry))
            .filter(Boolean),
        ),
        bullets: [],
        numberedBullets: false,
      };
    }
    if (heading === 'intake status' || heading === 'initial review' || heading === 'status') {
      return {
        key: section.key,
        heading: STAGE1_INITIAL_REVIEW_LABEL,
        paragraphs: [`${normalizeIntakeStatusLabel(report?.intake_status || (section.paragraphs || []).join(' '))}.`],
        bullets: [],
        numberedBullets: false,
      };
    }
    return section;
  });
}

function stripOpenQuestionWhyMatters(value) {
  const text = normalizeSpaces(value);
  if (!text) return '';
  const emDashIndex = text.indexOf('—');
  if (emDashIndex >= 0) {
    return text.slice(0, emDashIndex).trim();
  }
  const hyphenIndex = text.indexOf(' - ');
  if (hyphenIndex >= 0) {
    return text.slice(0, hyphenIndex).trim();
  }
  return text;
}

function normalizeOpenQuestionComparableText(value) {
  return stripOpenQuestionWhyMatters(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAppendixOpenQuestions(report) {
  const stage = resolveOpportunityReviewStage(report, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  if (isPreSendReviewStage(stage)) {
    return [];
  }
  const missingItems = Array.isArray(report?.missing)
    ? report.missing.map((entry) => normalizeSpaces(entry)).filter(Boolean)
    : [];
  const presentationSections = getPresentationSections(report);
  if (missingItems.length === 0 || presentationSections.length === 0) {
    return missingItems;
  }

  const renderedContent = presentationSections.flatMap((section) => [
    ...(Array.isArray(section.paragraphs) ? section.paragraphs : []),
    ...(Array.isArray(section.bullets) ? section.bullets : []),
  ]);
  const comparableSectionTexts = renderedContent
    .map((entry) => normalizeOpenQuestionComparableText(entry))
    .filter(Boolean);

  return missingItems.filter((item) => {
    const comparableItem = normalizeOpenQuestionComparableText(item);
    if (!comparableItem) return false;
    return !comparableSectionTexts.some(
      (sectionText) =>
        sectionText === comparableItem ||
        sectionText.includes(comparableItem),
    );
  });
}

export function getPrimaryInsight(report) {
  const direct = normalizeSpaces(report?.primary_insight || '');
  if (direct) {
    return direct;
  }

  const stage = resolveOpportunityReviewStage(report, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  if (isSharedIntakeReviewStage(stage)) {
    const submissionSummary = normalizeSpaces(report?.submission_summary || '');
    if (submissionSummary) {
      return submissionSummary;
    }
  }

  const firstSection = getPresentationSections(report)[0];
  if (firstSection?.paragraphs?.length > 0) {
    return firstSection.paragraphs[0];
  }

  return '';
}

export function getPresentationReportTitle(report) {
  return normalizeSpaces(report?.report_title || '');
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
