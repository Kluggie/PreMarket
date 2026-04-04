import { ApiError } from '../../_lib/errors.js';
import {
  buildStoredMediationProgress,
  normalizeStoredMediationProgress,
  type MediationRoundContext,
} from '../../_lib/mediation-progress.js';
import {
  getDecisionStatusDetails,
  getPresentationSections,
  getMediationReviewSubtitle,
  getMediationReviewTitle,
  getSentenceSafePreview,
  parseV2WhyEntry,
  splitV2WhyBodyParagraphs,
} from '../../../src/lib/aiReportUtils.js';
import {
  MEDIATION_REVIEW_STAGE,
  PRE_SEND_REVIEW_STAGE,
  resolveOpportunityReviewStage,
} from '../../../src/lib/opportunityReviewStage.js';

export const CONFIDENTIAL_LABEL = 'Confidential Information';
export const SHARED_LABEL = 'Shared Information';
export const MEDIATION_REVIEW_TITLE = 'AI Mediation Review';
export const PRE_SEND_REVIEW_TITLE = 'Pre-send Review';
export const MEDIATION_REVIEW_ARCHETYPES = Object.freeze([
  'balanced_trade_off',
  'risk_dominant',
  'strong_alignment',
  'gap_analysis',
  'strategic_framing',
] as const);

type MediationReviewArchetype = typeof MEDIATION_REVIEW_ARCHETYPES[number];

type MediationPresentationSection = {
  key: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  numbered_bullets?: boolean;
};

type ReportDealbreakerBasis = 'stated' | 'strongly_implied' | 'not_clearly_established';
type ReportCompatibilityAssessment =
  | 'broadly_compatible'
  | 'compatible_with_adjustments'
  | 'uncertain_due_to_missing_information'
  | 'fundamentally_incompatible';

type ReportNegotiationDealbreaker = {
  text: string;
  basis: ReportDealbreakerBasis;
};

type ReportNegotiationPartyAnalysis = {
  demands: string[];
  priorities: string[];
  dealbreakers: ReportNegotiationDealbreaker[];
  flexibility: string[];
};

type ReportNegotiationAnalysis = {
  proposing_party: ReportNegotiationPartyAnalysis;
  counterparty: ReportNegotiationPartyAnalysis;
  compatibility_assessment: ReportCompatibilityAssessment | null;
  compatibility_rationale: string;
  bridgeability_notes: string[];
  critical_incompatibilities: string[];
};

function normalizeComparisonLabel(side: 'a' | 'b') {
  return side === 'a' ? CONFIDENTIAL_LABEL : SHARED_LABEL;
}

export function buildMediationReviewTitle(...candidates: unknown[]) {
  return getMediationReviewTitle(...candidates);
}

export function buildMediationReviewSubtitle(...candidates: unknown[]) {
  return getMediationReviewSubtitle(...candidates);
}

export {
  getDecisionStatusDetails,
  getSentenceSafePreview,
  parseV2WhyEntry,
};

export function buildMediationReviewSections(params: {
  why: string[];
  missing: string[];
  redactions: string[];
}) {
  const sections = [
    { key: 'why', heading: 'Why', bullets: params.why },
    { key: 'missing', heading: 'Missing', bullets: params.missing },
  ];

  if (params.redactions.length > 0) {
    sections.push({ key: 'redactions', heading: 'Redactions', bullets: params.redactions });
  }

  return sections;
}

function asLower(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeadingKey(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueText(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const text = normalizeText(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function joinNatural(parts: string[]) {
  const values = uniqueText(parts);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function normalizeDealbreakerBasis(value: unknown): ReportDealbreakerBasis {
  const normalized = normalizeHeadingKey(value);
  if (normalized === 'stated') return 'stated';
  if (normalized === 'strongly implied') return 'strongly_implied';
  if (normalized === 'not clearly established') return 'not_clearly_established';
  return 'not_clearly_established';
}

function normalizeNegotiationDealbreakers(value: unknown) {
  if (!Array.isArray(value)) return [] as ReportNegotiationDealbreaker[];
  const seen = new Set<string>();
  const result: ReportNegotiationDealbreaker[] = [];
  value.forEach((entry) => {
    const text =
      typeof entry === 'string'
        ? normalizeText(entry)
        : entry && typeof entry === 'object' && !Array.isArray(entry)
          ? normalizeText((entry as any).text || (entry as any).title || (entry as any).description)
          : '';
    if (!text) return;
    const basis =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeDealbreakerBasis((entry as any).basis || (entry as any).status || (entry as any).support)
        : 'not_clearly_established';
    const key = `${text.toLowerCase()}::${basis}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ text, basis });
  });
  return result.slice(0, 6);
}

function normalizeNegotiationParty(value: unknown): ReportNegotiationPartyAnalysis {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    demands: uniqueText(Array.isArray(raw.demands || raw.required_outcomes || raw.key_demands)
      ? (raw.demands || raw.required_outcomes || raw.key_demands) as unknown[]
      : []).slice(0, 8),
    priorities: uniqueText(Array.isArray(raw.priorities) ? raw.priorities as unknown[] : []).slice(0, 8),
    dealbreakers: normalizeNegotiationDealbreakers(raw.dealbreakers || raw.non_negotiables),
    flexibility: uniqueText(Array.isArray(raw.flexibility || raw.possible_movement)
      ? (raw.flexibility || raw.possible_movement) as unknown[]
      : []).slice(0, 8),
  };
}

function hasSupportedFundamentalConflict(params: {
  proposing_party: ReportNegotiationPartyAnalysis;
  counterparty: ReportNegotiationPartyAnalysis;
  compatibility_rationale: string;
  critical_incompatibilities: string[];
}) {
  const supportedDealbreakers = [
    ...params.proposing_party.dealbreakers,
    ...params.counterparty.dealbreakers,
  ].filter((entry) => entry.basis !== 'not_clearly_established');
  if (params.critical_incompatibilities.length > 0) {
    return true;
  }
  if (supportedDealbreakers.length >= 2) {
    return true;
  }
  const conflictText = [params.compatibility_rationale, ...params.critical_incompatibilities].join(' ');
  return supportedDealbreakers.length >= 1 &&
    /\b(fundamental(?:ly)? incompatible|irreconcilable|mutually exclusive|cannot both|cannot be reconciled|no realistic path|won't accept|will not accept|non-negotiable|dealbreaker|direct conflict|critical point)\b/i
      .test(conflictText);
}

function normalizeCompatibilityAssessment(value: unknown): ReportCompatibilityAssessment | null {
  const normalized = normalizeHeadingKey(value);
  if (normalized === 'broadly compatible') return 'broadly_compatible';
  if (normalized === 'compatible with adjustments') return 'compatible_with_adjustments';
  if (
    normalized === 'uncertain due to missing information' ||
    normalized === 'uncertain due to missing info' ||
    normalized === 'uncertain'
  ) {
    return 'uncertain_due_to_missing_information';
  }
  if (normalized === 'fundamentally incompatible') return 'fundamentally_incompatible';
  return null;
}

function normalizeNegotiationAnalysis(value: unknown): ReportNegotiationAnalysis | null {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const proposing_party = normalizeNegotiationParty(raw.proposing_party || raw.party_a || raw.originating_party);
  const counterparty = normalizeNegotiationParty(raw.counterparty || raw.party_b || raw.other_party);
  let compatibility_assessment = normalizeCompatibilityAssessment(raw.compatibility_assessment || raw.compatibility);
  let compatibility_rationale = normalizeText(raw.compatibility_rationale || raw.compatibility_summary);
  const bridgeability_notes = uniqueText(
    Array.isArray(raw.bridgeability_notes || raw.bridgeability || raw.bridgeability_actions)
      ? (raw.bridgeability_notes || raw.bridgeability || raw.bridgeability_actions) as unknown[]
      : [],
  ).slice(0, 8);
  const critical_incompatibilities = uniqueText(
    Array.isArray(raw.critical_incompatibilities || raw.blocking_points)
      ? (raw.critical_incompatibilities || raw.blocking_points) as unknown[]
      : [],
  ).slice(0, 6);

  if (
    compatibility_assessment === 'fundamentally_incompatible' &&
    !hasSupportedFundamentalConflict({
      proposing_party,
      counterparty,
      compatibility_rationale,
      critical_incompatibilities,
    })
  ) {
    compatibility_assessment = 'uncertain_due_to_missing_information';
    if (!/\b(missing|unclear|uncertain|clarif|cannot assess|not yet clear)\b/i.test(compatibility_rationale)) {
      compatibility_rationale =
        'Compatibility is not yet clear from the current materials and likely requires clarification before incompatibility can be assessed confidently.';
    }
  }

  const analysis = {
    proposing_party,
    counterparty,
    compatibility_assessment,
    compatibility_rationale,
    bridgeability_notes,
    critical_incompatibilities,
  };

  const hasAnyContent =
    analysis.compatibility_assessment !== null ||
    Boolean(analysis.compatibility_rationale) ||
    analysis.bridgeability_notes.length > 0 ||
    analysis.critical_incompatibilities.length > 0 ||
    analysis.proposing_party.demands.length > 0 ||
    analysis.proposing_party.priorities.length > 0 ||
    analysis.proposing_party.dealbreakers.length > 0 ||
    analysis.proposing_party.flexibility.length > 0 ||
    analysis.counterparty.demands.length > 0 ||
    analysis.counterparty.priorities.length > 0 ||
    analysis.counterparty.dealbreakers.length > 0 ||
    analysis.counterparty.flexibility.length > 0;

  return hasAnyContent ? analysis : null;
}

function toRecipientSafeNegotiationAnalysis(analysis: ReportNegotiationAnalysis | null) {
  if (!analysis) return null;
  const safeAnalysis: ReportNegotiationAnalysis = {
    proposing_party: {
      demands: [],
      priorities: [],
      dealbreakers: [],
      flexibility: [],
    },
    counterparty: {
      demands: [],
      priorities: [],
      dealbreakers: [],
      flexibility: [],
    },
    compatibility_assessment: analysis.compatibility_assessment,
    compatibility_rationale: analysis.compatibility_rationale,
    bridgeability_notes: analysis.bridgeability_notes,
    critical_incompatibilities: analysis.critical_incompatibilities,
  };
  return (
    safeAnalysis.compatibility_assessment !== null ||
    Boolean(safeAnalysis.compatibility_rationale) ||
    safeAnalysis.bridgeability_notes.length > 0 ||
    safeAnalysis.critical_incompatibilities.length > 0
  )
    ? safeAnalysis
    : null;
}

function clampConfidence01(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

function stripMissingWhyMatters(value: string) {
  const text = normalizeText(value);
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

function buildWhyLookup(why: string[]) {
  const sections = new Map<string, { heading: string; body: string; paragraphs: string[] }>();
  const labeledParagraphs = new Map<string, string[]>();
  const uniqueSignalParagraphs = (paragraphs: string[]) => {
    const seen = new Set<string>();
    const result: string[] = [];
    paragraphs.forEach((paragraph) => {
      const normalized = normalizeText(paragraph);
      if (!normalized) return;
      const match = normalized.match(/^([A-Z][^:\n]{0,80}?):\s+(.+)$/s);
      const comparable = normalizeText(match ? match[2] : normalized).toLowerCase();
      if (!comparable || seen.has(comparable)) return;
      seen.add(comparable);
      result.push(normalized);
    });
    return result;
  };

  (Array.isArray(why) ? why : []).forEach((entry, index) => {
    const raw = normalizeText(entry);
    if (!raw) return;
    const { heading, body } = parseV2WhyEntry(raw);
    const resolvedHeading = heading || (index === 0 ? 'Executive Summary' : `Section ${index + 1}`);
    const paragraphs = splitV2WhyBodyParagraphs(body || raw);
    sections.set(normalizeHeadingKey(resolvedHeading), {
      heading: resolvedHeading,
      body: normalizeText(body || raw),
      paragraphs,
    });

    paragraphs.forEach((paragraph) => {
      const match = normalizeText(paragraph).match(/^([A-Z][^:\n]{0,80}?):\s+(.+)$/s);
      if (!match) return;
      const key = normalizeHeadingKey(match[1]);
      const next = labeledParagraphs.get(key) || [];
      next.push(normalizeText(match[2]));
      labeledParagraphs.set(key, next);
    });
  });

  const getSectionParagraphs = (...keys: string[]) =>
    uniqueText(
      keys.flatMap((key) => {
        const section = sections.get(normalizeHeadingKey(key));
        return section ? section.paragraphs : [];
      }),
    );

  const getLabeledParagraphs = (...keys: string[]) =>
    uniqueText(
      keys.flatMap((key) => labeledParagraphs.get(normalizeHeadingKey(key)) || []),
    );

  const getSignalParagraphs = (...keys: string[]) =>
    uniqueSignalParagraphs(
      keys.flatMap((key) => {
        const normalizedKey = normalizeHeadingKey(key);
        const section = sections.get(normalizedKey);
        return [
          ...(section ? section.paragraphs : []),
          ...(labeledParagraphs.get(normalizedKey) || []),
        ];
      }),
    );

  return {
    sections,
    labeledParagraphs,
    getSectionParagraphs,
    getLabeledParagraphs,
    getSignalParagraphs,
  };
}

const THEME_KEYWORDS: Record<string, string[]> = {
  scope: ['scope', 'deliverable', 'deliverables', 'phase', 'phased', 'boundary', 'workstream'],
  timeline: ['timeline', 'milestone', 'deadline', 'schedule', 'go-live', 'rollout'],
  acceptance: ['acceptance', 'kpi', 'success criteria', 'metric', 'sign-off', 'sign off'],
  dependency: ['dependency', 'dependencies', 'third party', 'integration', 'approval', 'ownership', 'stakeholder'],
  commercial: ['commercial', 'price', 'pricing', 'budget', 'cost', 'payment', 'margin', 'change-order', 'change order'],
  technical: ['technical', 'architecture', 'security', 'data', 'migration', 'platform', 'implementation', 'system', 'compliance'],
  governance: ['governance', 'approval path', 'approval', 'control', 'diligence', 'review', 'decision process'],
  risk: ['risk', 'liability', 'indemnity', 'exposure', 'service level', 'sla', 'warranty'],
};

const THEME_LABELS: Record<string, string> = {
  scope: 'scope definition',
  timeline: 'delivery timing',
  acceptance: 'acceptance criteria',
  dependency: 'dependency ownership',
  commercial: 'commercial structure',
  technical: 'implementation detail',
  governance: 'decision process',
  risk: 'risk allocation',
};

function detectThemes(texts: string[]) {
  const haystack = normalizeText(texts.join(' ')).toLowerCase();
  return Object.entries(THEME_KEYWORDS)
    .map(([theme, keywords]) => ({
      theme,
      score: keywords.reduce((count, keyword) => {
        return haystack.includes(keyword.toLowerCase()) ? count + 1 : count;
      }, 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.theme);
}

function describeThemes(themeIds: string[], fallback: string) {
  const labels = themeIds
    .map((themeId) => THEME_LABELS[themeId])
    .filter(Boolean)
    .slice(0, 2);
  return joinNatural(labels) || fallback;
}

function previewParagraphs(paragraphs: string[], maxItems = 2, maxChars = 200) {
  const result: string[] = [];
  uniqueText(paragraphs).forEach((paragraph) => {
    if (result.length >= maxItems) return;
    const preview = (getSentenceSafePreview(paragraph, maxChars) || normalizeText(paragraph))
      .replace(/^[a-z]/, (char) => char.toUpperCase());
    if (!preview) return;
    if (result.some((existing) => existing.toLowerCase() === preview.toLowerCase())) return;
    result.push(preview);
  });
  return result;
}

function buildNegotiationPriorityParagraphs(analysis: ReportNegotiationAnalysis | null) {
  if (!analysis) return [] as string[];
  const proposingFocus = joinNatural(
    analysis.proposing_party.priorities.length > 0
      ? analysis.proposing_party.priorities.slice(0, 2)
      : analysis.proposing_party.demands.slice(0, 2),
  );
  const counterpartyFocus = joinNatural(
    analysis.counterparty.priorities.length > 0
      ? analysis.counterparty.priorities.slice(0, 2)
      : analysis.counterparty.demands.slice(0, 2),
  );
  const paragraphs: string[] = [];
  if (proposingFocus && counterpartyFocus) {
    paragraphs.push(
      `One side appears to prioritise ${proposingFocus}, while the other appears to prioritise ${counterpartyFocus}.`,
    );
  } else if (proposingFocus || counterpartyFocus) {
    paragraphs.push(`The visible materials suggest the main priorities cluster around ${proposingFocus || counterpartyFocus}.`);
  }
  const dealbreakerPreview = joinNatural(
    [
      ...analysis.proposing_party.dealbreakers,
      ...analysis.counterparty.dealbreakers,
    ]
      .filter((entry) => entry.basis !== 'not_clearly_established')
      .map((entry) => entry.text)
      .slice(0, 2),
  );
  if (dealbreakerPreview) {
    paragraphs.push(`Likely non-negotiables appear to cluster around ${dealbreakerPreview}.`);
  }
  return uniqueText(paragraphs).slice(0, 2);
}

function buildNegotiationTensionParagraphs(analysis: ReportNegotiationAnalysis | null) {
  if (!analysis) return [] as string[];
  return uniqueText([
    analysis.compatibility_rationale,
    ...analysis.critical_incompatibilities,
  ]).slice(0, 3);
}

function buildNegotiationCompatibilityInsight(
  analysis: ReportNegotiationAnalysis | null,
  archetype: MediationReviewArchetype,
) {
  if (!analysis?.compatibility_assessment) return '';

  const compatibilityText = analysis.compatibility_rationale || (
    analysis.compatibility_assessment === 'broadly_compatible'
      ? 'The visible materials suggest the parties are broadly compatible.'
      : analysis.compatibility_assessment === 'compatible_with_adjustments'
        ? 'The visible materials suggest the parties may be compatible with adjustments.'
        : analysis.compatibility_assessment === 'uncertain_due_to_missing_information'
          ? 'Compatibility is not yet clear from the current materials.'
          : 'The visible materials point to a fundamental incompatibility on a critical point.'
  );

  if (analysis.compatibility_assessment === 'broadly_compatible') {
    return archetype === 'risk_dominant' || archetype === 'gap_analysis' ? '' : compatibilityText;
  }
  if (analysis.compatibility_assessment === 'compatible_with_adjustments') {
    return archetype === 'risk_dominant' ? '' : compatibilityText;
  }
  if (analysis.compatibility_assessment === 'uncertain_due_to_missing_information') {
    return archetype === 'gap_analysis' || archetype === 'balanced_trade_off' ? compatibilityText : '';
  }
  return archetype === 'strong_alignment' ? '' : compatibilityText;
}

function createPresentationSection(section: MediationPresentationSection): MediationPresentationSection | null {
  const paragraphs = uniqueText(Array.isArray(section.paragraphs) ? section.paragraphs : []);
  const bullets = uniqueText(Array.isArray(section.bullets) ? section.bullets : []);
  const heading = normalizeText(section.heading);
  if (!heading || (paragraphs.length === 0 && bullets.length === 0)) {
    return null;
  }
  const next: MediationPresentationSection = {
    key: normalizeHeadingKey(section.key || heading).replace(/\s+/g, '_'),
    heading,
  };
  if (paragraphs.length > 0) {
    next.paragraphs = paragraphs;
  }
  if (bullets.length > 0) {
    next.bullets = bullets;
  }
  if (section.numbered_bullets) {
    next.numbered_bullets = true;
  }
  return next;
}

function serializePresentationSections(
  sections: Array<{
    key?: unknown;
    heading?: unknown;
    paragraphs?: unknown;
    bullets?: unknown;
    numberedBullets?: unknown;
  }>,
): MediationPresentationSection[] {
  return sections
    .map((section) =>
      createPresentationSection({
        key: normalizeText(section?.key),
        heading: normalizeText(section?.heading),
        paragraphs: Array.isArray(section?.paragraphs)
          ? section.paragraphs.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
          : [],
        bullets: Array.isArray(section?.bullets)
          ? section.bullets.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
          : [],
        numbered_bullets: Boolean(section?.numberedBullets),
      }),
    )
    .filter(Boolean) as MediationPresentationSection[];
}

const ARCHETYPE_TITLES: Record<MediationReviewArchetype, string> = {
  balanced_trade_off: 'Balanced Trade-Off',
  risk_dominant: 'Risk-Dominant',
  strong_alignment: 'Strong Alignment',
  gap_analysis: 'Gap Analysis',
  strategic_framing: 'Strategic Framing',
};

function buildRecommendationParagraphs(params: {
  decisionStatusLabel: string;
  decisionExplanation: string;
  agreementParagraphs: string[];
  recommendationParagraphs: string[];
}) {
  const paragraphs = uniqueText([
    params.decisionExplanation
      ? `Decision status: ${params.decisionStatusLabel}. ${params.decisionExplanation}`
      : params.decisionStatusLabel
        ? `Decision status: ${params.decisionStatusLabel}.`
        : '',
    ...previewParagraphs(params.agreementParagraphs, 1),
    ...previewParagraphs(params.recommendationParagraphs, 1),
  ]);

  if (paragraphs.length > 0) {
    return paragraphs;
  }
  return ['Use the current open issues as the next mediation agenda before moving to commitment.'];
}

function countTradeoffTerms(text: string) {
  const lower = normalizeText(text).toLowerCase();
  const patterns = [
    /\bpriorit(?:y|ies)\b/,
    /\bconcession(?:s)?\b/,
    /\btension(?:s)?\b/,
    /\btrade[- ]?off(?:s)?\b/,
    /\bbalance\b/,
    /\bversus\b|\bvs\b/,
    /\bdepends on\b/,
  ];
  return patterns.reduce((count, pattern) => count + (pattern.test(lower) ? 1 : 0), 0);
}

export function buildMediationReviewPresentation(params: {
  fit_level: unknown;
  confidence_0_1: unknown;
  why: unknown;
  missing: unknown;
  redactions?: unknown;
  negotiation_analysis?: unknown;
  bilateral_round_number?: unknown;
  prior_bilateral_round_id?: unknown;
  prior_bilateral_round_number?: unknown;
  delta_summary?: unknown;
  resolved_since_last_round?: unknown;
  remaining_deltas?: unknown;
  new_open_issues?: unknown;
  movement_direction?: unknown;
}) {
  const fitLevel = asLower(params.fit_level);
  const confidence = clampConfidence01(params.confidence_0_1);
  const why = Array.isArray(params.why) ? params.why.map((entry) => normalizeText(entry)).filter(Boolean) : [];
  const missing = Array.isArray(params.missing) ? params.missing.map((entry) => normalizeText(entry)).filter(Boolean) : [];
  const redactions = Array.isArray(params.redactions)
    ? params.redactions.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const negotiationAnalysis = normalizeNegotiationAnalysis(params.negotiation_analysis);
  const progress = normalizeStoredMediationProgress(params);
  const hasPriorBilateralRound = Number(progress?.bilateral_round_number || 0) > 1;
  const progressSummary = normalizeText(progress?.delta_summary);
  const resolvedSinceLastRound = uniqueText(progress?.resolved_since_last_round || []).slice(0, 3);
  const remainingDeltas = uniqueText(progress?.remaining_deltas || []).slice(0, 4);
  const newOpenIssues = uniqueText(progress?.new_open_issues || []).slice(0, 3);
  const movementDirection = progress?.movement_direction || null;

  const whyLookup = buildWhyLookup(why);
  const executiveParagraphs = whyLookup.getSectionParagraphs('Executive Summary', 'Decision Snapshot');
  const strengthParagraphs = whyLookup.getSignalParagraphs('Key Strengths');
  const riskParagraphs = whyLookup.getSignalParagraphs('Risk Summary', 'Key Risks');
  const prioritiesParagraphs = whyLookup.getSignalParagraphs('Likely priorities');
  const tensionsParagraphs = whyLookup.getSignalParagraphs('Structural tensions');
  const leverageParagraphs = whyLookup.getSignalParagraphs('Leverage Signals', 'Leverage signal');
  const dealStructureParagraphs = whyLookup.getSectionParagraphs('Potential Deal Structures');
  const decisionReadinessParagraphs = whyLookup.getSectionParagraphs('Decision Readiness');
  const agreementParagraphs = whyLookup.getSignalParagraphs('What must be agreed now vs later', 'What would change the verdict');
  const recommendedPathParagraphs = whyLookup.getSignalParagraphs('Recommended Path', 'Recommended path');

  const concernThemeIds = detectThemes([...riskParagraphs, ...decisionReadinessParagraphs, ...missing]);
  const strengthThemeIds = detectThemes([...strengthParagraphs, ...executiveParagraphs]);
  const allThemeIds = detectThemes([
    ...executiveParagraphs,
    ...strengthParagraphs,
    ...riskParagraphs,
    ...prioritiesParagraphs,
    ...tensionsParagraphs,
    ...leverageParagraphs,
    ...dealStructureParagraphs,
    ...decisionReadinessParagraphs,
    ...missing,
  ]);
  const concernThemes = describeThemes(concernThemeIds, 'material execution detail');
  const strengthThemes = describeThemes(strengthThemeIds, 'the core proposal structure');
  const complexityThemeCount = allThemeIds.length;
  const tradeoffSignalCount = countTradeoffTerms([
    ...prioritiesParagraphs,
    ...tensionsParagraphs,
    ...leverageParagraphs,
    ...dealStructureParagraphs,
  ].join(' '));
  const hasStrongRiskLanguage = /\b(critical|severe|concentrated|material risk|not viable|blocker|exposure|unbounded)\b/i.test(
    [...riskParagraphs, ...decisionReadinessParagraphs].join(' '),
  );

  const decisionStatus = getDecisionStatusDetails({
    fit_level: fitLevel,
    confidence_0_1: confidence,
    why,
    missing,
  });

  let archetype: MediationReviewArchetype;
  if (fitLevel === 'low' || decisionStatus.label === 'Not viable' || hasStrongRiskLanguage) {
    archetype = 'risk_dominant';
  } else if (fitLevel === 'unknown' || missing.length >= 5 || (missing.length >= 4 && confidence < 0.58)) {
    archetype = 'gap_analysis';
  } else if (fitLevel === 'high' && confidence >= 0.72 && missing.length <= 2) {
    archetype = 'strong_alignment';
  } else if (
    fitLevel !== 'unknown' &&
    confidence >= 0.58 &&
    missing.length <= 4 &&
    complexityThemeCount >= 3 &&
    tradeoffSignalCount >= 3
  ) {
    archetype = 'strategic_framing';
  } else {
    archetype = 'balanced_trade_off';
  }

  const shortenedMissing = uniqueText(missing.map((item) => stripMissingWhyMatters(item))).slice(0, 6);
  const strengthPreviews = previewParagraphs(
    strengthParagraphs.length > 0 ? strengthParagraphs : executiveParagraphs,
    2,
  );
  const negotiationTensionParagraphs = buildNegotiationTensionParagraphs(negotiationAnalysis);
  const negotiationPriorityParagraphs = buildNegotiationPriorityParagraphs(negotiationAnalysis);
  const concernPreviews = previewParagraphs(
    riskParagraphs.length > 0 ? riskParagraphs : decisionReadinessParagraphs.concat(negotiationTensionParagraphs).concat(missing),
    2,
  );
  const tradeoffPreviews = previewParagraphs(
    tensionsParagraphs.concat(negotiationTensionParagraphs).concat(leverageParagraphs).concat(dealStructureParagraphs),
    2,
  );
  const tensionSourceParagraphs = tensionsParagraphs.length > 0
    ? tensionsParagraphs
    : prioritiesParagraphs
        .concat(negotiationTensionParagraphs)
        .filter((paragraph) => /\b(tension|trade[- ]?off|balance|versus|vs|incompatible)\b/i.test(paragraph));
  const tensionPreviews = previewParagraphs(
    tensionSourceParagraphs.length > 0 ? tensionSourceParagraphs : leverageParagraphs.concat(dealStructureParagraphs),
    2,
  );
  const bridgeabilityPreviews = previewParagraphs(negotiationAnalysis?.bridgeability_notes || [], 2);
  const priorityPreviews = previewParagraphs(
    prioritiesParagraphs.length > 0
      ? prioritiesParagraphs
      : negotiationPriorityParagraphs.length > 0
        ? negotiationPriorityParagraphs
        : leverageParagraphs,
    2,
  );
  const implicationPreviews = previewParagraphs(
    leverageParagraphs.concat(dealStructureParagraphs).concat(bridgeabilityPreviews),
    2,
  );
  const recommendationParagraphs = buildRecommendationParagraphs({
    decisionStatusLabel: decisionStatus.label,
    decisionExplanation: normalizeText(decisionStatus.explanation),
    agreementParagraphs: agreementParagraphs.concat(bridgeabilityPreviews),
    recommendationParagraphs: recommendedPathParagraphs.concat(bridgeabilityPreviews),
  });
  const executivePreview = previewParagraphs(executiveParagraphs, 1, 180)[0] || '';
  const riskPreview = previewParagraphs(riskParagraphs, 1, 180)[0] || '';
  const strategicPreview = previewParagraphs(
    tensionsParagraphs
      .concat(negotiationTensionParagraphs)
      .concat(prioritiesParagraphs)
      .concat(negotiationPriorityParagraphs)
      .concat(leverageParagraphs)
      .concat(dealStructureParagraphs),
    1,
    180,
  )[0] || '';
  const compatibilityInsight = buildNegotiationCompatibilityInsight(negotiationAnalysis, archetype);

  const baselinePrimaryInsight =
    archetype === 'risk_dominant'
      ? compatibilityInsight || riskPreview || `The current proposal concentrates material risk around ${concernThemes}, which blocks a confident commitment.`
      : archetype === 'gap_analysis'
        ? compatibilityInsight || executivePreview || `The main constraint is incomplete detail around ${concernThemes}, rather than a clearly workable final structure.`
        : archetype === 'strong_alignment'
          ? compatibilityInsight || (missing.length > 0
            ? `The proposal is broadly well-structured, with only limited gaps around ${concernThemes}.`
            : `The proposal is broadly well-structured and only minor issues remain before final agreement.`)
          : archetype === 'strategic_framing'
        ? compatibilityInsight || executivePreview || strategicPreview || `The proposal is workable in principle, but the outcome depends on how the parties balance ${describeThemes(allThemeIds, 'the visible deal priorities')}.`
            : compatibilityInsight || executivePreview || `The proposal shows credible alignment around ${strengthThemes}, but ${concernThemes} still introduces material trade-offs.`;
  const primaryInsight = hasPriorBilateralRound && progressSummary
    ? progressSummary
    : baselinePrimaryInsight;

  const fallbackTradeoffParagraph =
    archetype === 'strategic_framing'
      ? `The most visible tension is how ${strengthThemes} is balanced against ${concernThemes} before the parties treat the draft as final.`
      : `The key trade-off is between preserving ${strengthThemes} and resolving ${concernThemes} before the draft is treated as final.`;

  const progressParagraphs = uniqueText([
    progressSummary,
    movementDirection === 'converging'
      ? 'Overall movement appears to be toward executable agreement, although the remaining deltas still matter.'
      : movementDirection === 'diverging'
        ? 'Overall movement appears to be away from executable agreement because new friction or regressions now matter more than the resolved items.'
        : movementDirection === 'stalled'
          ? 'Overall movement appears limited, so the next round should focus on the most decision-relevant unresolved deltas rather than reopening settled ground.'
          : '',
    resolvedSinceLastRound.length > 0
      ? `Newly resolved or narrowed issues: ${joinNatural(resolvedSinceLastRound)}.`
      : '',
    newOpenIssues.length > 0
      ? `Newly introduced blockers or reopened issues: ${joinNatural(newOpenIssues)}.`
      : '',
  ]);

  const sections = [
    archetype === 'risk_dominant'
      ? createPresentationSection({
          key: 'primary_concern',
          heading: 'Primary Concern',
          paragraphs: [primaryInsight],
        })
      : archetype === 'gap_analysis'
        ? createPresentationSection({
            key: 'what_is_unclear',
            heading: 'What Is Unclear',
            paragraphs: [primaryInsight],
          })
        : archetype === 'strong_alignment'
          ? createPresentationSection({
              key: 'overall_assessment',
              heading: 'Overall Assessment',
              paragraphs: [primaryInsight],
            })
          : archetype === 'strategic_framing'
            ? createPresentationSection({
                key: 'core_deal_dynamic',
                heading: 'Core Deal Dynamic',
                paragraphs: [primaryInsight],
              })
            : createPresentationSection({
                key: 'primary_insight',
                heading: 'Primary Insight',
                paragraphs: [primaryInsight],
              }),
    hasPriorBilateralRound
      ? createPresentationSection({
          key: 'progress_since_prior_review',
          heading: 'Progress Since Prior Review',
          paragraphs: progressParagraphs,
          bullets: remainingDeltas,
          numbered_bullets: remainingDeltas.length > 0,
        })
      : null,
    archetype === 'risk_dominant'
      ? createPresentationSection({
          key: 'critical_risks',
          heading: 'Critical Risks',
          paragraphs: concernPreviews.length > 0
            ? concernPreviews.concat(previewParagraphs(leverageParagraphs, 1))
            : [`The main risk concentration remains around ${concernThemes}.`],
        })
      : archetype === 'gap_analysis'
        ? createPresentationSection({
            key: 'blocking_questions',
            heading: 'Blocking Questions',
            bullets: shortenedMissing.slice(0, 4),
            paragraphs: shortenedMissing.length === 0
              ? [`The immediate questions cluster around ${concernThemes}.`]
              : [],
            numbered_bullets: true,
          })
        : archetype === 'strong_alignment'
          ? createPresentationSection({
              key: 'key_strengths',
              heading: 'Key Strengths',
              paragraphs: strengthPreviews.length > 0
                ? strengthPreviews
                : [`Visible alignment is strongest around ${strengthThemes}.`],
            })
          : archetype === 'strategic_framing'
            ? createPresentationSection({
                key: 'what_appears_to_be_prioritised',
                heading: 'What Appears to Be Prioritised',
                paragraphs: priorityPreviews.length > 0
                  ? priorityPreviews
                  : [`The visible priorities cluster around ${strengthThemes}.`],
              })
            : createPresentationSection({
                key: 'areas_of_strength',
                heading: 'Areas of Strength',
                paragraphs: strengthPreviews.length > 0
                  ? strengthPreviews
                  : [`There is credible alignment around ${strengthThemes}.`],
              }),
    archetype === 'risk_dominant'
      ? createPresentationSection({
          key: 'missing_or_weak_elements',
          heading: 'Missing or Weak Elements',
          bullets: shortenedMissing.slice(0, 4),
          paragraphs: shortenedMissing.length === 0
            ? [`The weaker elements remain concentrated around ${concernThemes}.`]
            : [],
          numbered_bullets: true,
        })
      : archetype === 'gap_analysis'
        ? createPresentationSection({
            key: 'impact_of_missing_information',
            heading: 'Impact of Missing Information',
            paragraphs: concernPreviews.length > 0
              ? concernPreviews
              : [`Confidence remains constrained until ${concernThemes} is specified more concretely.`],
          })
      : archetype === 'strong_alignment'
          ? createPresentationSection({
              key: 'minor_gaps',
              heading: 'Minor Gaps',
              bullets: shortenedMissing.slice(0, 3),
              paragraphs: shortenedMissing.length === 0
                ? ['Remaining gaps are limited and do not currently outweigh the visible strengths.']
                : [],
            })
          : archetype === 'strategic_framing'
            ? createPresentationSection({
                key: 'key_tensions',
                heading: 'Key Tensions',
                paragraphs: tensionPreviews.length > 0
                  ? tensionPreviews
                  : [fallbackTradeoffParagraph],
              })
            : createPresentationSection({
                key: 'areas_of_concern',
                heading: 'Areas of Concern',
                paragraphs: concernPreviews.length > 0
                  ? concernPreviews
                  : [`Material uncertainty remains around ${concernThemes}.`],
              }),
    archetype === 'risk_dominant'
      ? createPresentationSection({
          key: 'what_must_be_resolved',
          heading: 'What Must Be Resolved',
          paragraphs: previewParagraphs(agreementParagraphs, 2).length > 0
            ? previewParagraphs(agreementParagraphs, 2)
            : [`The immediate condition to proceed is resolving ${concernThemes} in explicit terms.`],
        })
      : archetype === 'gap_analysis'
        ? createPresentationSection({
            key: 'what_needs_clarification',
            heading: 'What Needs Clarification',
            bullets: shortenedMissing.slice(4, 8),
            numbered_bullets: true,
            paragraphs: shortenedMissing.length <= 4
              ? [`Clarification should focus first on ${concernThemes} so the parties can test whether the current structure is workable.`]
              : [],
          })
        : archetype === 'strong_alignment'
          ? createPresentationSection({
              key: 'why_it_works',
              heading: 'Why It Works',
              paragraphs: priorityPreviews.length > 0
                ? priorityPreviews
                : [`The draft works best where ${strengthThemes} is already explicit enough for both parties to act on.`],
            })
          : archetype === 'strategic_framing'
            ? createPresentationSection({
                key: 'strategic_implications',
                heading: 'Strategic Implications',
                paragraphs: implicationPreviews.length > 0
                  ? implicationPreviews
                  : [`The visible implications sit in how ${strengthThemes} and ${concernThemes} are sequenced into a bounded agreement path.`],
              })
            : createPresentationSection({
                key: 'key_trade_offs',
                heading: 'Key Trade-Offs',
                paragraphs: tradeoffPreviews.length > 0
                  ? tradeoffPreviews
                  : [fallbackTradeoffParagraph],
              }),
    createPresentationSection({
      key: 'recommendation',
      heading: 'Recommendation',
      paragraphs: recommendationParagraphs,
    }),
  ].filter(Boolean) as MediationPresentationSection[];

  return {
    report_archetype: archetype,
    report_title: ARCHETYPE_TITLES[archetype],
    primary_insight: primaryInsight,
    presentation_sections: sections,
    redactions_count: redactions.length,
  };
}

function normalizeReadinessStatus(value: unknown) {
  const normalized = normalizeHeadingKey(value);
  if (normalized === 'ready to send') return 'ready_to_send';
  if (normalized === 'ready with clarifications') return 'ready_with_clarifications';
  return 'not_ready_to_send';
}

function getReadinessLabel(value: unknown) {
  const readinessStatus = normalizeReadinessStatus(value);
  if (readinessStatus === 'ready_to_send') return 'Ready to Send';
  if (readinessStatus === 'ready_with_clarifications') return 'Ready with Clarifications';
  return 'Not Ready to Send';
}

function mapReadinessScore(value: unknown) {
  const readinessStatus = normalizeReadinessStatus(value);
  if (readinessStatus === 'ready_to_send') return 82;
  if (readinessStatus === 'ready_with_clarifications') return 64;
  return 38;
}

function buildPreSendReviewSections(params: {
  send_readiness_summary: unknown;
  missing_information: unknown;
  ambiguous_terms: unknown;
  likely_recipient_questions: unknown;
  likely_pushback_areas: unknown;
  commercial_risks?: unknown;
  implementation_risks?: unknown;
  suggested_clarifications?: unknown;
}) {
  const sendReadinessSummary = normalizeText(params.send_readiness_summary);
  const missingInformation = uniqueText(
    Array.isArray(params.missing_information) ? params.missing_information as unknown[] : [],
  );
  const ambiguousTerms = uniqueText(
    Array.isArray(params.ambiguous_terms) ? params.ambiguous_terms as unknown[] : [],
  );
  const likelyRecipientQuestions = uniqueText(
    Array.isArray(params.likely_recipient_questions) ? params.likely_recipient_questions as unknown[] : [],
  );
  const likelyPushbackAreas = uniqueText(
    Array.isArray(params.likely_pushback_areas) ? params.likely_pushback_areas as unknown[] : [],
  );
  const commercialRisks = uniqueText(
    Array.isArray(params.commercial_risks) ? params.commercial_risks as unknown[] : [],
  );
  const implementationRisks = uniqueText(
    Array.isArray(params.implementation_risks) ? params.implementation_risks as unknown[] : [],
  );
  const suggestedClarifications = uniqueText(
    Array.isArray(params.suggested_clarifications) ? params.suggested_clarifications as unknown[] : [],
  );

  return [
    createPresentationSection({
      key: 'readiness_to_send',
      heading: 'Readiness to Send',
      paragraphs: sendReadinessSummary ? [sendReadinessSummary] : [],
    }),
    createPresentationSection({
      key: 'missing_information',
      heading: 'Missing Information',
      bullets: missingInformation,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'ambiguous_terms',
      heading: 'Ambiguous Terms',
      bullets: ambiguousTerms,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'likely_recipient_questions',
      heading: 'Likely Recipient Questions',
      bullets: likelyRecipientQuestions,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'likely_pushback_areas',
      heading: 'Likely Pushback Areas',
      bullets: likelyPushbackAreas,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'commercial_risks',
      heading: 'Commercial Risks',
      bullets: commercialRisks,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'implementation_risks',
      heading: 'Implementation Risks',
      bullets: implementationRisks,
      numbered_bullets: true,
    }),
    createPresentationSection({
      key: 'suggested_clarifications',
      heading: 'Suggested Clarifications',
      bullets: suggestedClarifications,
      numbered_bullets: true,
    }),
  ].filter(Boolean) as MediationPresentationSection[];
}

function buildPreSendReviewPresentation(params: {
  readiness_status: unknown;
  send_readiness_summary: unknown;
  missing_information: unknown;
  ambiguous_terms: unknown;
  likely_recipient_questions: unknown;
  likely_pushback_areas: unknown;
  commercial_risks?: unknown;
  implementation_risks?: unknown;
  suggested_clarifications?: unknown;
}) {
  const readinessStatus = normalizeReadinessStatus(params.readiness_status);
  const sendReadinessSummary = normalizeText(params.send_readiness_summary);
  const sections = buildPreSendReviewSections(params);
  const primaryInsight =
    sendReadinessSummary ||
    (readinessStatus === 'ready_to_send'
      ? 'The sender draft appears ready to share, but a few clarifications would still strengthen it.'
      : readinessStatus === 'ready_with_clarifications'
        ? 'The sender draft is workable, but the remaining gaps should be tightened before sharing.'
        : 'The sender draft still needs clarification before it is ready to share confidently.');

  return {
    report_title: PRE_SEND_REVIEW_TITLE,
    readiness_status: readinessStatus,
    readiness_label: getReadinessLabel(readinessStatus),
    primary_insight: primaryInsight,
    presentation_sections: sections,
  };
}

export function buildStoredV2Evaluation(
  v2Result: any,
  options: {
    mediationRoundContext?: MediationRoundContext;
    sharedProgressContext?: {
      currentSharedText?: string;
      priorSharedText?: string;
    };
  } = {},
): Record<string, unknown> {
  const data = v2Result?.data && typeof v2Result.data === 'object' && !Array.isArray(v2Result.data)
    ? v2Result.data
    : {};
  const analysisStage = resolveOpportunityReviewStage(data, {
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });
  const generatedAt = new Date().toISOString();
  const generationModel =
    normalizeText(v2Result?.generation_model) ||
    normalizeText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) ||
    normalizeText(process.env.VERTEX_MODEL) ||
    'gemini-2.5-pro';
  const providerModel = normalizeText(v2Result?.model) || generationModel;

  if (analysisStage === PRE_SEND_REVIEW_STAGE) {
    const readinessStatus = normalizeReadinessStatus(data?.readiness_status);
    const missingInformation = Array.isArray(data?.missing_information)
      ? data.missing_information.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const ambiguousTerms = Array.isArray(data?.ambiguous_terms)
      ? data.ambiguous_terms.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const likelyRecipientQuestions = Array.isArray(data?.likely_recipient_questions)
      ? data.likely_recipient_questions.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const likelyPushbackAreas = Array.isArray(data?.likely_pushback_areas)
      ? data.likely_pushback_areas.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const commercialRisks = Array.isArray(data?.commercial_risks)
      ? data.commercial_risks.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const implementationRisks = Array.isArray(data?.implementation_risks)
      ? data.implementation_risks.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const suggestedClarifications = Array.isArray(data?.suggested_clarifications)
      ? data.suggested_clarifications.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const sendReadinessSummary = normalizeText(data?.send_readiness_summary);
    const presentation = buildPreSendReviewPresentation({
      readiness_status: readinessStatus,
      send_readiness_summary: sendReadinessSummary,
      missing_information: missingInformation,
      ambiguous_terms: ambiguousTerms,
      likely_recipient_questions: likelyRecipientQuestions,
      likely_pushback_areas: likelyPushbackAreas,
      commercial_risks: commercialRisks,
      implementation_risks: implementationRisks,
      suggested_clarifications: suggestedClarifications,
    });
    const score = mapReadinessScore(readinessStatus);
    const report = {
      report_format: 'v2' as const,
      analysis_stage: PRE_SEND_REVIEW_STAGE,
      readiness_status: readinessStatus,
      readiness_label: presentation.readiness_label,
      send_readiness_summary: sendReadinessSummary,
      missing_information: missingInformation,
      ambiguous_terms: ambiguousTerms,
      likely_recipient_questions: likelyRecipientQuestions,
      likely_pushback_areas: likelyPushbackAreas,
      commercial_risks: commercialRisks,
      implementation_risks: implementationRisks,
      suggested_clarifications: suggestedClarifications,
      generated_at_iso: generatedAt,
      summary: {
        readiness_status: readinessStatus,
        next_actions: suggestedClarifications,
      },
      sections: buildPreSendReviewSections({
        send_readiness_summary: sendReadinessSummary,
        missing_information: missingInformation,
        ambiguous_terms: ambiguousTerms,
        likely_recipient_questions: likelyRecipientQuestions,
        likely_pushback_areas: likelyPushbackAreas,
        commercial_risks: commercialRisks,
        implementation_risks: implementationRisks,
        suggested_clarifications: suggestedClarifications,
      }),
      report_title: presentation.report_title,
      primary_insight: presentation.primary_insight,
      presentation_sections: presentation.presentation_sections,
    };

    return {
      provider: 'vertex',
      model: providerModel,
      generatedAt,
      score,
      confidence: null,
      recommendation: null,
      summary: presentation.primary_insight || sendReadinessSummary || PRE_SEND_REVIEW_TITLE,
      report,
      evaluation_provider: 'vertex',
      evaluation_model: generationModel,
      evaluation_provider_model: providerModel,
      evaluation_provider_reason: null,
    };
  }

  const confidence = clampConfidence01(data?.confidence_0_1);
  const fitLevel = asLower(data?.fit_level);
  const normalizedFitLevel =
    fitLevel === 'high' || fitLevel === 'medium' || fitLevel === 'low' ? fitLevel : 'unknown';
  const recommendation = normalizedFitLevel === 'high'
    ? 'High'
    : normalizedFitLevel === 'medium'
      ? 'Medium'
      : 'Low';
  const why = Array.isArray(data?.why) ? data.why.map((entry: unknown) => normalizeText(entry)).filter(Boolean) : [];
  const missing = Array.isArray(data?.missing)
    ? data.missing.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
    : [];
  const redactions = Array.isArray(data?.redactions)
    ? data.redactions.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
    : [];
  const negotiationAnalysis = normalizeNegotiationAnalysis(data?.negotiation_analysis);
  const progress = buildStoredMediationProgress({
    currentMissing: data?.remaining_deltas ?? missing,
    currentNarrative: why,
    currentSharedText: options.sharedProgressContext?.currentSharedText,
    priorSharedText: options.sharedProgressContext?.priorSharedText,
    generatedProgress: {
      bilateral_round_number: data?.bilateral_round_number,
      prior_bilateral_round_id: data?.prior_bilateral_round_id,
      prior_bilateral_round_number: data?.prior_bilateral_round_number,
      delta_summary: data?.delta_summary,
      resolved_since_last_round: data?.resolved_since_last_round,
      remaining_deltas: data?.remaining_deltas,
      new_open_issues: data?.new_open_issues,
      movement_direction: data?.movement_direction,
    },
    mediationRoundContext: options.mediationRoundContext,
  });
  const presentation = buildMediationReviewPresentation({
    fit_level: normalizedFitLevel,
    confidence_0_1: confidence,
    why,
    missing,
    redactions,
    negotiation_analysis: negotiationAnalysis,
    ...progress,
  });
  const report = {
    report_format: 'v2' as const,
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: normalizedFitLevel,
    confidence_0_1: confidence,
    why,
    missing,
    redactions,
    ...(negotiationAnalysis ? { negotiation_analysis: negotiationAnalysis } : {}),
    ...progress,
    generated_at_iso: generatedAt,
    summary: {
      fit_level: normalizedFitLevel,
      top_fit_reasons: why.map((text: string) => ({ text })),
      top_blockers: missing.map((text: string) => ({ text })),
      next_actions: missing.length > 0 ? ['Resolve the open questions and re-run AI mediation.'] : [],
    },
    sections: buildMediationReviewSections({ why, missing, redactions }),
    recommendation,
    report_archetype: presentation.report_archetype,
    report_title: presentation.report_title,
    primary_insight: presentation.primary_insight,
    presentation_sections: presentation.presentation_sections,
  };

  return {
    provider: 'vertex',
    model: providerModel,
    generatedAt,
    score: Math.round(confidence * 100),
    confidence,
    recommendation,
    summary: presentation.primary_insight || why[0] || 'AI mediation review complete',
    report,
    evaluation_provider: 'vertex',
    evaluation_model: generationModel,
    evaluation_provider_model: providerModel,
    evaluation_provider_reason: null,
  };
}

function asHtml(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const type = String((value as any).type || '').trim().toLowerCase();
  const content = (value as any).content;
  if (type !== 'doc' || !Array.isArray(content)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text: string) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '<p></p>';
  }

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function mapComparisonRow(row: any) {
  const inputs =
    row?.inputs && typeof row.inputs === 'object' && !Array.isArray(row.inputs)
      ? row.inputs
      : {};
  const docASource =
    typeof inputs.doc_a_source === 'string' && inputs.doc_a_source.trim().length > 0
      ? inputs.doc_a_source.trim()
      : 'typed';
  const docBSource =
    typeof inputs.doc_b_source === 'string' && inputs.doc_b_source.trim().length > 0
      ? inputs.doc_b_source.trim()
      : 'typed';
  const docAText = row.docAText || '';
  const docBText = row.docBText || '';
  const docAHtml = asHtml(inputs.doc_a_html) || textToHtml(docAText);
  const docBHtml = asHtml(inputs.doc_b_html) || textToHtml(docBText);
  const docAJson = asJsonObject(inputs.doc_a_json);
  const docBJson = asJsonObject(inputs.doc_b_json);

  return {
    id: row.id,
    user_id: row.userId,
    proposal_id: row.proposalId || null,
    title: row.title,
    status: row.status,
    draft_step: Number(row.draftStep || 1),
    party_a_label: normalizeComparisonLabel('a'),
    party_b_label: normalizeComparisonLabel('b'),
    company_name: row.companyName || null,
    company_website: row.companyWebsite || null,
    recipient_name: row.recipientName || null,
    recipient_email: row.recipientEmail || null,
    doc_a_title: typeof inputs.doc_a_title === 'string' && inputs.doc_a_title.trim() ? inputs.doc_a_title.trim() : null,
    doc_b_title: typeof inputs.doc_b_title === 'string' && inputs.doc_b_title.trim() ? inputs.doc_b_title.trim() : null,
    doc_a_text: docAText,
    doc_b_text: docBText,
    doc_a_html: docAHtml,
    doc_b_html: docBHtml,
    doc_a_json: docAJson,
    doc_b_json: docBJson,
    doc_a_source: docASource,
    doc_b_source: docBSource,
    doc_a_files: Array.isArray(inputs.doc_a_files) ? inputs.doc_a_files : [],
    doc_b_files: Array.isArray(inputs.doc_b_files) ? inputs.doc_b_files : [],
    doc_a_url:
      typeof inputs.doc_a_url === 'string' && inputs.doc_a_url.trim().length > 0
        ? inputs.doc_a_url.trim()
        : null,
    doc_b_url:
      typeof inputs.doc_b_url === 'string' && inputs.doc_b_url.trim().length > 0
        ? inputs.doc_b_url.trim()
        : null,
    doc_a_spans: toSpanArray(row.docASpans),
    doc_b_spans: toSpanArray(row.docBSpans),
    // Canonical documents[] session — full-fidelity multi-document structure.
    // Null for legacy comparisons created before canonical storage was added.
    documents_session: Array.isArray(inputs.documents_session) && inputs.documents_session.length > 0
      ? inputs.documents_session
      : null,
    evaluation_result: row.evaluationResult || {},
    public_report: row.publicReport || {},
    inputs: row.inputs || {},
    metadata: row.metadata || {},
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

function toSafeObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return value as Record<string, any>;
}

function toSafeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function clampScore(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, fallback))));
}

function clampConfidence(value: unknown, fallback = 0.35) {
  return Math.max(0, Math.min(1, toNumber(value, fallback)));
}

function clampRatio(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(1, toNumber(value, fallback)));
}

function normalizeLeakText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectConfidentialMarkers(confidentialText: string) {
  const normalized = normalizeLeakText(confidentialText);
  if (!normalized) {
    return [] as string[];
  }

  const markers = new Set<string>();
  const words = normalized.split(' ').filter((word) => word.length >= 3);
  for (let index = 0; index < words.length - 2 && markers.size < 120; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]} ${words[index + 2]}`.trim();
    if (phrase.length >= 14) {
      markers.add(phrase);
    }
  }

  const sentenceLike = normalized
    .split(/\s{2,}/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 18)
    .slice(0, 40);
  sentenceLike.forEach((entry) => {
    markers.add(entry.slice(0, 64));
  });

  return [...markers];
}

function containsConfidentialMarker(value: unknown, markers: string[]) {
  if (!markers.length) {
    return false;
  }

  const normalized = normalizeLeakText(value);
  if (!normalized) {
    return false;
  }

  return markers.some((marker) => marker.length >= 8 && normalized.includes(marker));
}

function scrubString(value: unknown, markers: string[], fallback = '') {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }
  if (containsConfidentialMarker(text, markers)) {
    return fallback;
  }
  return text;
}

function scrubStringArray(value: unknown, markers: string[]) {
  return toSafeArray(value)
    .map((entry) => scrubString(entry, markers, ''))
    .filter(Boolean);
}

function hasDocAIdentifier(value: unknown) {
  const normalized = normalizeLeakText(value);
  if (!normalized) {
    return false;
  }
  if (normalized === 'a' || normalized === 'party a' || normalized === 'party_a') {
    return true;
  }
  if (normalized.includes('doc a') || normalized.includes('doc_a')) {
    return true;
  }
  return normalized.includes('doc a visible') || normalized.includes('doc_a_visible');
}

function sanitizeEvidenceQuestionIds(value: unknown) {
  const unique = new Set<string>();
  toSafeArray(value).forEach((entry) => {
    const id = String(entry || '').trim();
    if (!id || hasDocAIdentifier(id)) {
      return;
    }
    unique.add(id);
  });
  return [...unique];
}

function sanitizeEvidenceAnchors(value: unknown) {
  return toSafeArray(value)
    .map((anchor) => {
      const doc = String(anchor?.doc || '').trim().toUpperCase();
      const start = Math.max(0, Math.floor(toNumber(anchor?.start, -1)));
      const end = Math.max(0, Math.floor(toNumber(anchor?.end, -1)));
      if (doc !== 'B' || end <= start) {
        return null;
      }
      return {
        doc: 'B',
        start,
        end,
      };
    })
    .filter(Boolean);
}

function entryMentionsDocA(entry: Record<string, any>) {
  if (hasDocAIdentifier(entry?.party) || hasDocAIdentifier(entry?.to_party)) {
    return true;
  }

  const idFields = ['evidence_question_ids', 'related_question_ids', 'question_ids'];
  if (
    idFields.some((field) =>
      toSafeArray(entry?.[field]).some((id) => hasDocAIdentifier(id)),
    )
  ) {
    return true;
  }

  const anchors = toSafeArray(entry?.evidence_anchors);
  if (anchors.some((anchor) => String(anchor?.doc || '').trim().toUpperCase() === 'A')) {
    return true;
  }

  const targets = toSafeObject(entry?.targets);
  if (
    toSafeArray(targets.question_ids).some((id) => hasDocAIdentifier(id)) ||
    toSafeArray(targets.evidence_anchors).some((anchor) => String(anchor?.doc || '').trim().toUpperCase() === 'A')
  ) {
    return true;
  }

  return false;
}

function sanitizeEvidenceEntry(entry: unknown, markers: string[]) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const source = { ...(entry as Record<string, any>) };
  if (entryMentionsDocA(source)) {
    return null;
  }

  const next: Record<string, any> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'evidence_question_ids' || key === 'related_question_ids' || key === 'question_ids') {
      next[key] = sanitizeEvidenceQuestionIds(value);
      return;
    }

    if (key === 'evidence_anchors') {
      const anchors = sanitizeEvidenceAnchors(value);
      const hadAnchors = Array.isArray(value) && value.length > 0;
      if (hadAnchors && anchors.length === 0) {
        next.__drop = true;
        return;
      }
      next[key] = anchors;
      return;
    }

    if (key === 'targets' && value && typeof value === 'object' && !Array.isArray(value)) {
      const targetsSource = value as Record<string, any>;
      const questionIds = sanitizeEvidenceQuestionIds(targetsSource.question_ids);
      const targetAnchors = sanitizeEvidenceAnchors(targetsSource.evidence_anchors);
      const hadTargetAnchors =
        Array.isArray(targetsSource.evidence_anchors) && targetsSource.evidence_anchors.length > 0;
      if (
        toSafeArray(targetsSource.question_ids).some((id) => hasDocAIdentifier(id)) ||
        (hadTargetAnchors && targetAnchors.length === 0)
      ) {
        next.__drop = true;
        return;
      }
      next[key] = {
        ...targetsSource,
        question_ids: questionIds,
        evidence_anchors: targetAnchors,
      };
      return;
    }

    if (typeof value === 'string') {
      const scrubbed = scrubString(value, markers, '');
      next[key] = scrubbed;
      return;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      next[key] = scrubStringArray(value, markers);
      return;
    }

    next[key] = value;
  });

  if (next.__drop) {
    return null;
  }
  delete next.__drop;

  if (containsConfidentialMarker(JSON.stringify(next), markers)) {
    return null;
  }

  return next;
}

function sanitizeEvidenceEntryArray(value: unknown, markers: string[]) {
  return toSafeArray(value)
    .map((entry) => sanitizeEvidenceEntry(entry, markers))
    .filter(Boolean);
}

function sanitizeFieldDigest(value: unknown, markers: string[]) {
  const digest = toSafeArray(value)
    .map((entry) => sanitizeEvidenceEntry(entry, markers))
    .filter(Boolean)
    .filter((entry) => {
      const party = String(entry?.party || '').trim().toLowerCase();
      return party !== 'a';
    })
    .map((entry) => ({
      question_id: scrubString(entry.question_id, markers, 'doc_b_visible'),
      label: scrubString(entry.label, markers, SHARED_LABEL),
      party: 'b',
      value_summary: scrubString(entry.value_summary, markers, ''),
      visibility: scrubString(entry.visibility, markers, 'full') || 'full',
      verified_status: scrubString(entry.verified_status, markers, 'unknown') || 'unknown',
      last_updated_by: scrubString(entry.last_updated_by, markers, 'recipient') || 'recipient',
    }))
    .filter((entry) => Boolean(entry.value_summary));

  if (digest.length > 0) {
    return digest;
  }

  return [
    {
      question_id: 'doc_b_visible',
      label: SHARED_LABEL,
      party: 'b',
      value_summary: 'Shared information was used to generate this recipient-safe report.',
      visibility: 'full',
      verified_status: 'self_declared',
      last_updated_by: 'system',
    },
  ];
}

function sanitizeLegacySections(value: unknown, markers: string[]) {
  const sections = toSafeArray(value)
    .map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        return null;
      }
      const key = scrubString((section as any).key, markers, '');
      const heading = scrubString((section as any).heading, markers, '');
      const bullets = scrubStringArray((section as any).bullets, markers).filter(
        (bullet) => !hasDocAIdentifier(bullet) && !/confidential information/i.test(bullet),
      );

      if (!heading && bullets.length === 0) {
        return null;
      }

      return {
        key: key || 'summary',
        heading: heading || 'Recipient-Safe Summary',
        bullets,
      };
    })
    .filter(Boolean);

  if (sections.length > 0) {
    return sections;
  }

  return [
    {
      key: 'summary',
      heading: 'Recipient-Safe Summary',
      bullets: ['Evaluation generated from Shared Information only.'],
    },
  ];
}

function redactConfidentialStrings(value: any, markers: string[]): any {
  if (typeof value === 'string') {
    if (!containsConfidentialMarker(value, markers)) {
      return value;
    }
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => redactConfidentialStrings(entry, markers))
      .filter((entry) => {
        if (typeof entry === 'string') {
          return entry.trim().length > 0;
        }
        return entry !== null && entry !== undefined;
      });
  }

  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, entry]) => {
      next[key] = redactConfidentialStrings(entry, markers);
    });
    return next;
  }

  return value;
}

function hasLeakAfterProjection(payload: any, markers: string[]) {
  if (!markers.length) {
    return false;
  }
  return containsConfidentialMarker(JSON.stringify(payload || {}), markers);
}

function toRecommendation(value: unknown, scoreFallback = 0): 'High' | 'Medium' | 'Low' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'low') return 'Low';

  const score = clampScore(scoreFallback, 0);
  if (score >= 75) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

function buildFallbackRecipientReport(params: {
  title: string;
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
}) {
  const confidenceRatio = clampConfidence(params.confidence, 0.35);
  const summaryScore = clampScore(params.score, 0);
  return {
    template_id: 'document_comparison_template',
    template_name: params.title || 'Document Comparison',
    generated_at_iso: params.generatedAt,
    parties: {
      a_label: CONFIDENTIAL_LABEL,
      b_label: SHARED_LABEL,
    },
    quality: {
      completeness_a: 0,
      completeness_b: 0,
      confidence_overall: confidenceRatio,
      confidence_reasoning: ['Recipient-safe projection excludes confidential evidence.'],
      missing_high_impact_question_ids: [],
      disputed_question_ids: [],
    },
    summary: {
      overall_score_0_100: summaryScore,
      fit_level: params.recommendation.toLowerCase(),
      top_fit_reasons: [
        {
          text: 'Shared Information provided enough visible context for a limited recipient-safe summary.',
          evidence_question_ids: ['doc_b_visible'],
          evidence_anchors: [],
        },
      ],
      top_blockers: [],
      next_actions: ['Review Shared Information details and request clarification where needed.'],
    },
    category_breakdown: [],
    gates: [],
    overlaps_and_constraints: [],
    contradictions: [],
    flags: [],
    verification: {
      summary: {
        self_declared_count: 0,
        evidence_attached_count: 0,
        tier1_verified_count: 0,
        disputed_count: 0,
      },
      evidence_requested: [],
    },
    followup_questions: [],
    appendix: {
      field_digest: [
        {
          question_id: 'doc_b_visible',
          label: SHARED_LABEL,
          party: 'b',
          value_summary: 'Shared information reviewed for recipient-safe reporting.',
          visibility: 'full',
          verified_status: 'self_declared',
          last_updated_by: 'system',
        },
      ],
    },
    generated_at: params.generatedAt,
    recommendation: params.recommendation,
    confidence_score: Math.round(confidenceRatio * 100),
    similarity_score: summaryScore,
    delta_characters: 0,
    confidentiality_spans: 0,
    executive_summary: 'Recipient-safe evaluation generated from Shared Information only.',
    sections: [
      {
        key: 'summary',
        heading: 'Recipient-Safe Summary',
        bullets: ['Confidential Information is excluded from recipient-facing report payloads.'],
      },
    ],
    provider: 'projection',
    model: 'recipient-safe',
  };
}

function buildFallbackRecipientV2Report(params: {
  stage?: string;
  title: string;
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
}) {
  if (resolveOpportunityReviewStage({ analysis_stage: params.stage }, { fallbackStage: MEDIATION_REVIEW_STAGE }) === PRE_SEND_REVIEW_STAGE) {
    const presentation = buildPreSendReviewPresentation({
      readiness_status: 'ready_with_clarifications',
      send_readiness_summary:
        'Sender-side review generated from Shared Information only. Some private draft context was excluded for confidentiality.',
      missing_information: ['Review the shared draft for any missing scope, timeline, or ownership detail.'],
      ambiguous_terms: [],
      likely_recipient_questions: ['What assumptions remain unclear in the shared draft?'],
      likely_pushback_areas: [],
      commercial_risks: [],
      implementation_risks: [],
      suggested_clarifications: ['Clarify the remaining open points before treating the sender draft as final.'],
    });
    return {
      report_format: 'v2' as const,
      analysis_stage: PRE_SEND_REVIEW_STAGE,
      readiness_status: 'ready_with_clarifications',
      readiness_label: presentation.readiness_label,
      send_readiness_summary: presentation.primary_insight,
      missing_information: ['Review the shared draft for any missing scope, timeline, or ownership detail.'],
      ambiguous_terms: [] as string[],
      likely_recipient_questions: ['What assumptions remain unclear in the shared draft?'],
      likely_pushback_areas: [] as string[],
      commercial_risks: [] as string[],
      implementation_risks: [] as string[],
      suggested_clarifications: ['Clarify the remaining open points before treating the sender draft as final.'],
      generated_at_iso: params.generatedAt,
      summary: {
        readiness_status: 'ready_with_clarifications',
        next_actions: ['Clarify the remaining open points before treating the sender draft as final.'],
      },
      sections: buildPreSendReviewSections({
        send_readiness_summary: presentation.primary_insight,
        missing_information: ['Review the shared draft for any missing scope, timeline, or ownership detail.'],
        ambiguous_terms: [],
        likely_recipient_questions: ['What assumptions remain unclear in the shared draft?'],
        likely_pushback_areas: [],
        commercial_risks: [],
        implementation_risks: [],
        suggested_clarifications: ['Clarify the remaining open points before treating the sender draft as final.'],
      }),
      report_title: presentation.report_title,
      primary_insight: presentation.primary_insight,
      presentation_sections: presentation.presentation_sections,
    };
  }
  const fitLevel = params.recommendation.toLowerCase() as 'high' | 'medium' | 'low';
  const normalizedConfidence = clampConfidence(params.confidence, 0.35);
  const why = [
    'Decision Snapshot: Recipient-safe evaluation generated from Shared Information only. Some content was excluded for confidentiality.',
    'Key Strengths: Shared Information provides the basis for this recipient-safe fit summary.',
    'Key Risks: Some risk details are excluded from the recipient-facing report due to confidentiality.',
    'Decision Readiness: Review Shared Information and request clarification for unresolved areas.',
    'Recommendations: Review Shared Information details and request clarification where needed.',
  ];
  const missing = [
    'Review Shared Information details and request clarification where needed.',
  ];
  const presentation = buildMediationReviewPresentation({
    fit_level: fitLevel,
    confidence_0_1: normalizedConfidence,
    why,
    missing,
    redactions: [],
  });
  return {
    report_format: 'v2' as const,
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: fitLevel,
    confidence_0_1: normalizedConfidence,
    why,
    missing,
    redactions: [] as string[],
    generated_at_iso: params.generatedAt,
    summary: {
      fit_level: fitLevel,
      top_fit_reasons: [
        { text: 'Shared Information provides the basis for this recipient-safe fit summary.' },
      ],
      top_blockers: [] as { text: string }[],
      next_actions: ['Review Shared Information details and request clarification where needed.'],
    },
    sections: buildMediationReviewSections({
      why,
      missing,
      redactions: [],
    }),
    recommendation: params.recommendation,
    report_archetype: presentation.report_archetype,
    report_title: presentation.report_title,
    primary_insight: presentation.primary_insight,
    presentation_sections: presentation.presentation_sections,
  };
}

function buildV2RecipientProjection(params: {
  evaluation: Record<string, any>;
  sourceReport: Record<string, any>;
  markers: string[];
  generatedAt: string;
  score: number;
  confidence: number;
  recommendation: 'High' | 'Medium' | 'Low';
  topFitReasons: any[];
  topBlockers: any[];
  nextActions: string[];
  title: string;
}) {
  const {
    evaluation,
    sourceReport,
    markers,
    generatedAt,
    score,
    confidence,
    recommendation,
    topFitReasons,
    topBlockers,
    nextActions,
    title,
  } = params;

  const analysisStage = resolveOpportunityReviewStage(sourceReport, {
    source: evaluation.source,
    fallbackStage: MEDIATION_REVIEW_STAGE,
  });

  if (analysisStage === PRE_SEND_REVIEW_STAGE) {
    const readinessStatus = normalizeReadinessStatus(sourceReport.readiness_status);
    const sendReadinessSummary = scrubString(sourceReport.send_readiness_summary, markers, '');
    const missingInformation = scrubStringArray(sourceReport.missing_information, markers);
    const ambiguousTerms = scrubStringArray(sourceReport.ambiguous_terms, markers);
    const likelyRecipientQuestions = scrubStringArray(sourceReport.likely_recipient_questions, markers);
    const likelyPushbackAreas = scrubStringArray(sourceReport.likely_pushback_areas, markers);
    const commercialRisks = scrubStringArray(sourceReport.commercial_risks, markers);
    const implementationRisks = scrubStringArray(sourceReport.implementation_risks, markers);
    const suggestedClarifications = scrubStringArray(sourceReport.suggested_clarifications, markers);
    const rebuiltPresentation = buildPreSendReviewPresentation({
      readiness_status: readinessStatus,
      send_readiness_summary: sendReadinessSummary,
      missing_information: missingInformation,
      ambiguous_terms: ambiguousTerms,
      likely_recipient_questions: likelyRecipientQuestions,
      likely_pushback_areas: likelyPushbackAreas,
      commercial_risks: commercialRisks,
      implementation_risks: implementationRisks,
      suggested_clarifications: suggestedClarifications,
    });
    const projectedPresentationSections = Array.isArray(sourceReport.presentation_sections)
      ? (redactConfidentialStrings(sourceReport.presentation_sections, markers) as unknown[])
      : [];
    const normalizedProjectedPresentationSections = serializePresentationSections(
      getPresentationSections({ presentation_sections: projectedPresentationSections }),
    );
    const safeReport = {
      report_format: 'v2' as const,
      analysis_stage: PRE_SEND_REVIEW_STAGE,
      readiness_status: readinessStatus,
      readiness_label: getReadinessLabel(readinessStatus),
      send_readiness_summary: sendReadinessSummary,
      missing_information: missingInformation,
      ambiguous_terms: ambiguousTerms,
      likely_recipient_questions: likelyRecipientQuestions,
      likely_pushback_areas: likelyPushbackAreas,
      commercial_risks: commercialRisks,
      implementation_risks: implementationRisks,
      suggested_clarifications: suggestedClarifications,
      generated_at_iso: generatedAt,
      summary: {
        readiness_status: readinessStatus,
        next_actions:
          nextActions.length > 0
            ? nextActions
            : suggestedClarifications,
      },
      sections: buildPreSendReviewSections({
        send_readiness_summary: sendReadinessSummary,
        missing_information: missingInformation,
        ambiguous_terms: ambiguousTerms,
        likely_recipient_questions: likelyRecipientQuestions,
        likely_pushback_areas: likelyPushbackAreas,
        commercial_risks: commercialRisks,
        implementation_risks: implementationRisks,
        suggested_clarifications: suggestedClarifications,
      }),
      report_title:
        scrubString(sourceReport.report_title, markers, '') ||
        rebuiltPresentation.report_title,
      primary_insight:
        scrubString(sourceReport.primary_insight, markers, '') ||
        rebuiltPresentation.primary_insight,
      presentation_sections:
        normalizedProjectedPresentationSections.length > 0
          ? normalizedProjectedPresentationSections
          : rebuiltPresentation.presentation_sections,
    } as Record<string, any>;

    const projectedReport = redactConfidentialStrings(safeReport, markers);
    const projectionHasLeak = hasLeakAfterProjection(projectedReport, markers);
    const fallbackReport = buildFallbackRecipientV2Report({
      stage: PRE_SEND_REVIEW_STAGE,
      title,
      generatedAt,
      score,
      confidence: confidence / 100,
      recommendation,
    });
    const finalReport = projectionHasLeak ? fallbackReport : projectedReport;
    const summary =
      scrubString(evaluation.summary, markers, '') ||
      scrubString(finalReport.primary_insight, markers, '') ||
      scrubString(finalReport.send_readiness_summary, markers, '') ||
      'Sender-side review generated from Shared Information only.';

    return {
      evaluation_result: {
        provider: scrubString(evaluation.provider, markers, 'projection'),
        model: scrubString(evaluation.model, markers, 'recipient-safe'),
        generatedAt,
        score,
        confidence: null,
        recommendation: null,
        summary,
        report: finalReport,
      },
      public_report: finalReport,
    };
  }

  const why = scrubStringArray(sourceReport.why, markers);
  const missing = scrubStringArray(sourceReport.missing, markers);
  const redactions = scrubStringArray(sourceReport.redactions, markers);
  const progress = normalizeStoredMediationProgress({
    bilateral_round_number: sourceReport.bilateral_round_number,
    prior_bilateral_round_id: sourceReport.prior_bilateral_round_id,
    prior_bilateral_round_number: sourceReport.prior_bilateral_round_number,
    delta_summary: scrubString(sourceReport.delta_summary, markers, ''),
    resolved_since_last_round: scrubStringArray(sourceReport.resolved_since_last_round, markers),
    remaining_deltas: scrubStringArray(sourceReport.remaining_deltas, markers),
    new_open_issues: scrubStringArray(sourceReport.new_open_issues, markers),
    movement_direction: sourceReport.movement_direction,
  });
  const negotiationAnalysis = toRecipientSafeNegotiationAnalysis(normalizeNegotiationAnalysis(
    redactConfidentialStrings(sourceReport.negotiation_analysis, markers),
  ));
  const fitLevel = scrubString(
    sourceReport.fit_level,
    markers,
    recommendation.toLowerCase(),
  );
  const rebuiltPresentation = buildMediationReviewPresentation({
    fit_level: fitLevel,
    confidence_0_1: clampConfidence(sourceReport.confidence_0_1, confidence / 100),
    why,
    missing,
    redactions,
    negotiation_analysis: negotiationAnalysis,
    ...(progress || {}),
  });
  const projectedPresentationSections = Array.isArray(sourceReport.presentation_sections)
    ? (redactConfidentialStrings(sourceReport.presentation_sections, markers) as unknown[])
    : [];
  const normalizedProjectedPresentationSections = serializePresentationSections(
    getPresentationSections({ presentation_sections: projectedPresentationSections }),
  );

  const safeReport = {
    report_format: 'v2' as const,
    analysis_stage: MEDIATION_REVIEW_STAGE,
    fit_level: fitLevel,
    confidence_0_1: clampConfidence(sourceReport.confidence_0_1, confidence / 100),
    why,
    missing,
    redactions,
    ...(negotiationAnalysis ? { negotiation_analysis: negotiationAnalysis } : {}),
    ...(progress || {}),
    generated_at_iso: generatedAt,
    summary: {
      fit_level: fitLevel,
      top_fit_reasons:
        topFitReasons.length > 0
          ? topFitReasons
          : why.map((text: string) => ({ text })),
      top_blockers:
        topBlockers.length > 0
          ? topBlockers
          : missing.map((text: string) => ({ text })),
      next_actions:
        nextActions.length > 0
          ? nextActions
          : missing.length > 0
            ? ['Resolve the open questions and re-run AI mediation.']
            : [],
    },
    sections: buildMediationReviewSections({
      why,
      missing,
      redactions,
    }),
    recommendation,
    report_archetype:
      scrubString(sourceReport.report_archetype, markers, '') ||
      rebuiltPresentation.report_archetype,
    report_title:
      scrubString(sourceReport.report_title, markers, '') ||
      rebuiltPresentation.report_title,
    primary_insight:
      scrubString(sourceReport.primary_insight, markers, '') ||
      rebuiltPresentation.primary_insight,
    presentation_sections:
      normalizedProjectedPresentationSections.length > 0
        ? normalizedProjectedPresentationSections
        : rebuiltPresentation.presentation_sections,
  } as Record<string, any>;

  const projectedReport = redactConfidentialStrings(safeReport, markers);
  const projectionHasLeak = hasLeakAfterProjection(projectedReport, markers);
  const fallbackReport = buildFallbackRecipientV2Report({
    stage: analysisStage,
    title,
    generatedAt,
    score,
    confidence: confidence / 100,
    recommendation,
  });
  const finalReport = projectionHasLeak ? fallbackReport : projectedReport;
  const summary =
    scrubString(evaluation.summary, markers, '') ||
    scrubString(finalReport.primary_insight, markers, '') ||
    scrubString(Array.isArray(finalReport.why) && finalReport.why[0], markers, '') ||
    'Recipient-safe evaluation generated from Shared Information only.';

  const recipientEvaluation = {
    provider: scrubString(evaluation.provider, markers, 'projection'),
    model: scrubString(evaluation.model, markers, 'recipient-safe'),
    generatedAt,
    score,
    confidence,
    recommendation,
    summary,
    report: finalReport,
  };

  if (hasLeakAfterProjection(recipientEvaluation, markers)) {
    return {
      evaluation_result: {
        provider: 'projection',
        model: 'recipient-safe',
        generatedAt,
        score,
        confidence,
        recommendation,
        summary: 'Recipient-safe evaluation generated from Shared Information only.',
        report: fallbackReport,
      },
      public_report: fallbackReport,
    };
  }

  return {
    evaluation_result: recipientEvaluation,
    public_report: finalReport,
  };
}

export function buildRecipientSafeEvaluationProjection(params: {
  evaluationResult: unknown;
  publicReport?: unknown;
  confidentialText?: string;
  sharedText?: string;
  title?: string;
}) {
  const evaluation = toSafeObject(params?.evaluationResult);
  const sourceReport = toSafeObject(params?.publicReport || evaluation.report);
  const generatedAt =
    scrubString(evaluation.generatedAt, [], '') ||
    scrubString(sourceReport.generated_at_iso, [], '') ||
    new Date().toISOString();
  const markers = collectConfidentialMarkers(String(params?.confidentialText || ''));

  const score = clampScore(
    evaluation.score,
    clampScore(sourceReport.similarity_score, clampScore(sourceReport.summary?.overall_score_0_100, 0)),
  );
  const confidence = clampScore(
    evaluation.confidence,
    clampScore(toNumber(sourceReport.confidence_score, toNumber(sourceReport.quality?.confidence_overall, 0.35) * 100), 35),
  );
  const recommendation = toRecommendation(evaluation.recommendation || sourceReport.recommendation, score);

  const topFitReasons = sanitizeEvidenceEntryArray(sourceReport.summary?.top_fit_reasons, markers);
  const topBlockers = sanitizeEvidenceEntryArray(sourceReport.summary?.top_blockers, markers);
  const nextActions = scrubStringArray(sourceReport.summary?.next_actions, markers);

  // V2-format source report: preserve why/missing/redactions structure so the
  // renderer's hasV2Report() check succeeds and headings display correctly.
  if (sourceReport.report_format === 'v2' || (Array.isArray(sourceReport.why) && sourceReport.why.length > 0)) {
    return buildV2RecipientProjection({
      evaluation,
      sourceReport,
      markers,
      generatedAt,
      score,
      confidence,
      recommendation,
      topFitReasons,
      topBlockers,
      nextActions,
      title: scrubString(params?.title, markers, 'Document Comparison'),
    });
  }

  const safeReport = {
    template_id: scrubString(sourceReport.template_id, markers, 'document_comparison_template'),
    template_name: scrubString(
      sourceReport.template_name || params?.title,
      markers,
      scrubString(params?.title, markers, 'Document Comparison'),
    ),
    generated_at_iso: generatedAt,
    parties: {
      a_label: CONFIDENTIAL_LABEL,
      b_label: SHARED_LABEL,
    },
    quality: {
      completeness_a: clampRatio(sourceReport.quality?.completeness_a, 0),
      completeness_b: clampRatio(sourceReport.quality?.completeness_b, 0),
      confidence_overall: clampConfidence(sourceReport.quality?.confidence_overall, confidence / 100),
      confidence_reasoning: scrubStringArray(sourceReport.quality?.confidence_reasoning, markers),
      missing_high_impact_question_ids: sanitizeEvidenceQuestionIds(
        sourceReport.quality?.missing_high_impact_question_ids,
      ),
      disputed_question_ids: sanitizeEvidenceQuestionIds(sourceReport.quality?.disputed_question_ids),
    },
    summary: {
      overall_score_0_100: clampScore(
        sourceReport.summary?.overall_score_0_100,
        score,
      ),
      fit_level: scrubString(
        sourceReport.summary?.fit_level,
        markers,
        recommendation.toLowerCase(),
      ),
      top_fit_reasons:
        topFitReasons.length > 0
          ? topFitReasons
          : [
              {
                text: 'Shared Information provides the basis for this recipient-safe fit summary.',
                evidence_question_ids: ['doc_b_visible'],
                evidence_anchors: [],
              },
            ],
      top_blockers: topBlockers,
      next_actions:
        nextActions.length > 0
          ? nextActions
          : ['Review Shared Information and request clarification for unresolved risk areas.'],
    },
    category_breakdown: sanitizeEvidenceEntryArray(sourceReport.category_breakdown, markers),
    gates: sanitizeEvidenceEntryArray(sourceReport.gates, markers),
    overlaps_and_constraints: sanitizeEvidenceEntryArray(sourceReport.overlaps_and_constraints, markers),
    contradictions: sanitizeEvidenceEntryArray(sourceReport.contradictions, markers),
    flags: sanitizeEvidenceEntryArray(sourceReport.flags, markers),
    verification: {
      summary: {
        self_declared_count: Math.max(0, Math.floor(toNumber(sourceReport.verification?.summary?.self_declared_count, 0))),
        evidence_attached_count: Math.max(
          0,
          Math.floor(toNumber(sourceReport.verification?.summary?.evidence_attached_count, 0)),
        ),
        tier1_verified_count: Math.max(
          0,
          Math.floor(toNumber(sourceReport.verification?.summary?.tier1_verified_count, 0)),
        ),
        disputed_count: Math.max(0, Math.floor(toNumber(sourceReport.verification?.summary?.disputed_count, 0))),
      },
      evidence_requested: sanitizeEvidenceEntryArray(sourceReport.verification?.evidence_requested, markers),
    },
    followup_questions: sanitizeEvidenceEntryArray(sourceReport.followup_questions, markers),
    appendix: {
      field_digest: sanitizeFieldDigest(sourceReport.appendix?.field_digest, markers),
    },
    generated_at: generatedAt,
    recommendation,
    confidence_score: confidence,
    similarity_score: clampScore(sourceReport.similarity_score, score),
    delta_characters: Math.max(0, Math.floor(toNumber(sourceReport.delta_characters, 0))),
    confidentiality_spans: 0,
    executive_summary:
      scrubString(
        sourceReport.executive_summary || evaluation.summary,
        markers,
        '',
      ) || 'Recipient-safe evaluation generated from Shared Information only.',
    sections: sanitizeLegacySections(sourceReport.sections, markers),
    provider: scrubString(sourceReport.provider || evaluation.provider, markers, 'projection'),
    model: scrubString(sourceReport.model || evaluation.model, markers, 'recipient-safe'),
  } as Record<string, any>;

  const projectedReport = redactConfidentialStrings(safeReport, markers);
  const projectionHasLeak = hasLeakAfterProjection(projectedReport, markers);
  const fallbackReport = buildFallbackRecipientReport({
    title: scrubString(params?.title, markers, 'Document Comparison'),
    generatedAt,
    score,
    confidence: confidence / 100,
    recommendation,
  });
  const finalReport = projectionHasLeak ? fallbackReport : projectedReport;
  const summary =
    scrubString(
      evaluation.summary || finalReport.executive_summary,
      markers,
      '',
    ) || 'Recipient-safe evaluation generated from Shared Information only.';

  const recipientEvaluation = {
    provider: scrubString(evaluation.provider, markers, 'projection'),
    model: scrubString(evaluation.model, markers, 'recipient-safe'),
    generatedAt,
    score,
    confidence,
    recommendation,
    summary,
    report: finalReport,
  };

  if (hasLeakAfterProjection(recipientEvaluation, markers)) {
    return {
      evaluation_result: {
        provider: 'projection',
        model: 'recipient-safe',
        generatedAt,
        score,
        confidence,
        recommendation,
        summary: 'Recipient-safe evaluation generated from Shared Information only.',
        report: fallbackReport,
      },
      public_report: fallbackReport,
    };
  }

  return {
    evaluation_result: recipientEvaluation,
    public_report: finalReport,
  };
}

function clampSpanBoundary(raw: unknown, textLength: number) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(Math.floor(numeric), textLength));
}

function normalizeSpanLevel(level: unknown) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden' || normalized === 'partial') {
    return 'confidential';
  }
  return null;
}

export function normalizeSpans(spans: unknown, text: string) {
  if (!Array.isArray(spans)) {
    return [];
  }

  const textLength = String(text || '').length;
  const normalized = spans
    .map((span) => {
      const start = clampSpanBoundary(span?.start, textLength);
      const end = clampSpanBoundary(span?.end, textLength);
      const level = normalizeSpanLevel(span?.level);

      if (start === null || end === null || end <= start || !level) {
        return null;
      }

      return { start, end, level };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  const merged = [];
  normalized.forEach((span) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      return;
    }

    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      return;
    }

    merged.push({ ...span });
  });

  return merged;
}

export function parseStep(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(numeric), 1), 3);
}

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function toSpanArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const start = Number((entry as any)?.start);
      const end = Number((entry as any)?.end);
      const level = String((entry as any)?.level || 'confidential').trim() || 'confidential';
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        start: Math.floor(start),
        end: Math.floor(end),
        level,
      };
    })
    .filter(Boolean);
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

export function resolveEditableSide(params: { proposal?: any; user?: any; comparison?: any }) {
  const proposal = params?.proposal || null;
  const user = params?.user || null;
  const comparison = params?.comparison || null;
  const userId = String(user?.id || '').trim();
  const userEmail = normalizeEmail(user?.email);

  if (proposal) {
    const partyAUserId = String(proposal?.partyAUserId || proposal?.userId || '').trim();
    const partyAEmail = normalizeEmail(proposal?.partyAEmail);
    if ((userId && partyAUserId && userId === partyAUserId) || (userEmail && partyAEmail === userEmail)) {
      return 'a';
    }

    const partyBUserId = String(proposal?.partyBUserId || '').trim();
    const partyBEmail = normalizeEmail(proposal?.partyBEmail);
    if ((userId && partyBUserId && userId === partyBUserId) || (userEmail && partyBEmail === userEmail)) {
      return 'b';
    }
  }

  if (comparison && userId && String(comparison?.userId || '').trim() === userId) {
    return 'a';
  }

  return 'a';
}

export function isPastDate(dateValue: unknown) {
  if (!dateValue) {
    return false;
  }

  const timestamp = new Date(dateValue as any).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp < Date.now();
}

export function buildComparisonEvaluation(payload: {
  title: string;
  docAText: string;
  docBText: string;
  docASpans: Array<{ start: number; end: number; level: string }>;
  docBSpans: Array<{ start: number; end: number; level: string }>;
  partyALabel: string;
  partyBLabel: string;
}) {
  const docAText = String(payload.docAText || '');
  const docBText = String(payload.docBText || '');
  const tokenize = (input: string) =>
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((entry) => entry.length >= 3),
    );

  const tokensA = tokenize(docAText);
  const tokensB = tokenize(docBText);
  const intersection = new Set([...tokensA].filter((token) => tokensB.has(token)));
  const union = new Set([...tokensA, ...tokensB]);
  const similarity = union.size > 0 ? Math.round((intersection.size / union.size) * 100) : 0;
  const deltaChars = Math.abs(docAText.length - docBText.length);
  const confidentialityCount = 0;

  let fit = 'Low';
  if (similarity >= 80) fit = 'High';
  else if (similarity >= 55) fit = 'Medium';

  const nowIso = new Date().toISOString();
  const report = {
    generated_at: nowIso,
    title: payload.title,
    recommendation: fit,
    similarity_score: similarity,
    delta_characters: deltaChars,
    confidentiality_spans: confidentialityCount,
    sections: [
      {
        key: 'summary',
        heading: 'Comparison Summary',
        bullets: [
          `${payload.partyALabel} length: ${docAText.length} chars`,
          `${payload.partyBLabel} length: ${docBText.length} chars`,
          `Shared vocabulary: ${intersection.size} tokens`,
        ],
      },
      {
        key: 'information_scope',
        heading: 'Information Scope',
        bullets: [
          `${CONFIDENTIAL_LABEL} is private and kept out of recipient-facing payloads.`,
          `${SHARED_LABEL} is the only recipient-facing document.`,
          `Confidential span model: disabled`,
        ],
      },
    ],
  };

  return {
    score: similarity,
    recommendation: fit,
    report,
  };
}

export function ensureComparisonFound(row: any) {
  if (!row) {
    throw new ApiError(404, 'document_comparison_not_found', 'Document comparison not found');
  }
}
