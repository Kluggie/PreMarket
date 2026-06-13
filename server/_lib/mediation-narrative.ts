import type {
  FitLevel,
  MediationDecisionStatus,
  NarrativeMemo,
  ProposalFactSheet,
  RetrievedMediationEvidencePacket,
} from './vertex-evaluation-v2-types.js';

export const NARRATIVE_MIN_SECTIONS = 2;
export const NARRATIVE_MAX_SECTIONS = 5;
export const NARRATIVE_MIN_PARAGRAPHS = 3;
export const NARRATIVE_MIN_BODY_CHARS = 500;
export const NARRATIVE_MIN_SECTION_CHARS = 120;
export const NARRATIVE_MIN_CLOSING_CHARS = 20;
export const SUBSTANTIVE_NARRATIVE_MIN_WORDS = 900;
export const SUBSTANTIVE_NARRATIVE_TARGET_MIN_WORDS = 1_000;
export const SUBSTANTIVE_NARRATIVE_TARGET_MAX_WORDS = 1_400;
export const GENERAL_NARRATIVE_TARGET_MIN_WORDS = 800;
export const GENERAL_NARRATIVE_TARGET_MAX_WORDS = 1_000;

export type NarrativeValidationResult = {
  narrative?: NarrativeMemo;
  valid: boolean;
  warnings: string[];
  metrics: {
    section_count: number;
    paragraph_count: number;
    body_chars: number;
    word_count: number;
  };
};

export type NarrativeSourceDepth = {
  adequate: boolean;
  material_signal_count: number;
  evidence_count: number;
  evidence_character_count: number;
  target_min_words: number;
  target_max_words: number;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function uniqueStrings(value: unknown, maxItems = 8) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const output: string[] = [];
  value.forEach((entry) => {
    const text = asText(entry);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || output.length >= maxItems) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

function countWords(value: string) {
  return value.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
}

export function assessNarrativeSourceDepth(params: {
  factSheet?: ProposalFactSheet;
  retrievedEvidencePacket?: RetrievedMediationEvidencePacket;
}): NarrativeSourceDepth {
  const factSheet = params.factSheet;
  const packet = params.retrievedEvidencePacket;
  const materialSignalCount = factSheet
    ? [
        factSheet.project_goal,
        ...factSheet.scope_deliverables,
        factSheet.timeline.start,
        factSheet.timeline.duration,
        ...factSheet.timeline.milestones,
        ...factSheet.constraints,
        ...factSheet.success_criteria_kpis,
        ...factSheet.vendor_preferences,
        ...factSheet.assumptions,
        ...factSheet.risks.map((entry) => entry.risk),
        ...factSheet.open_questions,
        ...factSheet.missing_info,
      ].filter((entry) => asText(entry)).length
    : 0;
  const evidenceCount =
    packet?.retrieval_strategy === 'heuristic_commercial_terms_v1'
      ? Number(packet.evidence_count || 0)
      : 0;
  const evidenceCharacterCount =
    packet?.retrieval_strategy === 'heuristic_commercial_terms_v1'
      ? Number(packet.character_budget_used || 0)
      : 0;
  const coverageCount = factSheet
    ? Object.values(factSheet.source_coverage).filter(Boolean).length
    : 0;
  const adequate =
    materialSignalCount >= 8 ||
    (evidenceCount >= 2 && evidenceCharacterCount >= 350) ||
    (coverageCount >= 3 && evidenceCount >= 1 && evidenceCharacterCount >= 220);

  return {
    adequate,
    material_signal_count: materialSignalCount,
    evidence_count: evidenceCount,
    evidence_character_count: evidenceCharacterCount,
    target_min_words: adequate
      ? SUBSTANTIVE_NARRATIVE_TARGET_MIN_WORDS
      : GENERAL_NARRATIVE_TARGET_MIN_WORDS,
    target_max_words: adequate
      ? SUBSTANTIVE_NARRATIVE_TARGET_MAX_WORDS
      : GENERAL_NARRATIVE_TARGET_MAX_WORDS,
  };
}

export function decisionStatusForFitLevel(fitLevel: FitLevel): MediationDecisionStatus {
  if (fitLevel === 'high') return 'ready_to_finalize';
  if (fitLevel === 'medium') return 'proceed_with_conditions';
  if (fitLevel === 'low') return 'not_viable';
  return 'explore_further';
}

export function normalizeMediationDecisionStatus(
  value: unknown,
  fallback: MediationDecisionStatus,
): MediationDecisionStatus {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (
    normalized === 'not_viable' ||
    normalized === 'explore_further' ||
    normalized === 'proceed_with_conditions' ||
    normalized === 'ready_to_finalize'
  ) {
    return normalized;
  }
  return fallback;
}

export function normalizeNarrativeMemo(value: unknown): NarrativeMemo | undefined {
  const raw = toRecord(value);
  if (!raw) return undefined;
  const title = asText(raw.title);
  const closing = asText(raw.closing);
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((entry) => {
          const section = toRecord(entry);
          if (!section) return null;
          const heading = asText(section.heading);
          const paragraphs = uniqueStrings(section.paragraphs, 6);
          if (!heading || paragraphs.length === 0) return null;
          return { heading, paragraphs };
        })
        .filter((entry): entry is NarrativeMemo['sections'][number] => Boolean(entry))
    : [];
  if (!title || sections.length === 0) return undefined;
  return { title, sections, closing };
}

const STRONG_POSITIVE_PATTERNS = [
  /\bready to (?:finali[sz]e|sign|approve|proceed|commit)\b/i,
  /\bapprove (?:the |this )?(?:final )?(?:agreement|deal|proposal|terms)\b/i,
  /\bfinali[sz]e (?:the |this )?(?:agreement|deal|proposal|terms)\b/i,
  /\bmove directly to signature\b/i,
  /\bproceed immediately\b/i,
  /\bsign (?:now|immediately|without delay)\b/i,
  /\bclean commitment is supportable\b/i,
  /\bno material concerns?\b/i,
  /\blow[- ]risk\b/i,
];

const STRONG_NEGATIVE_PATTERNS = [
  /\bdo not proceed\b/i,
  /\bshould not (?:sign|approve|proceed|commit)\b/i,
  /\breject (?:the |this )?(?:agreement|deal|proposal|current structure)\b/i,
  /\bpause (?:the |this )?(?:agreement|deal|proposal|approval|negotiation)\b/i,
  /\bnot viable\b/i,
  /\bhigh[- ]risk\b/i,
];

const UNCERTAINTY_PATTERNS = [
  /\bmissing\b/i,
  /\bunresolved\b/i,
  /\bunclear\b/i,
  /\buncertain\b/i,
  /\bnot (?:yet )?(?:defined|established|agreed|known|clear)\b/i,
  /\bremains? open\b/i,
  /\bstill needs?\b/i,
  /\bbefore (?:committing|commitment|approval|signature|proceeding|launch)\b/i,
  /\bdepends? on\b/i,
  /\bconditional\b/i,
  /\bprovided that\b/i,
  /\bif\b/i,
  /\btension\b/i,
  /\buntil\b/i,
];

const NEGATION_WINDOW_PATTERN =
  /\b(?:not|isn't|is not|cannot|can't|should not|do not|without|before)\b/i;

function hasUnnegatedPattern(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return false;
  const prefix = text.slice(Math.max(0, match.index - 32), match.index);
  return !NEGATION_WINDOW_PATTERN.test(prefix);
}

function hasStrongPositiveDecisionLanguage(text: string) {
  return STRONG_POSITIVE_PATTERNS.some((pattern) => hasUnnegatedPattern(text, pattern));
}

function hasStrongNegativeDecisionLanguage(text: string) {
  return STRONG_NEGATIVE_PATTERNS.some((pattern) => hasUnnegatedPattern(text, pattern));
}

export function decisionLanguageWarnings(
  text: string,
  status: MediationDecisionStatus,
) {
  const warnings: string[] = [];
  if (
    status !== 'ready_to_finalize' &&
    hasStrongPositiveDecisionLanguage(text)
  ) {
    warnings.push('narrative_conflicts_with_conditional_or_negative_decision');
  }
  if (
    status === 'ready_to_finalize' &&
    hasStrongNegativeDecisionLanguage(text)
  ) {
    warnings.push('narrative_conflicts_with_positive_decision');
  }
  return warnings;
}

function hasRigidDecisionBriefHeadings(narrative: NarrativeMemo) {
  if (narrative.sections.length < 3) return false;
  const rigid = new Set([
    'recommendation',
    'confidence',
    'status',
    'risks',
    'open questions',
    'next step',
    'next steps',
    'where the parties align',
    'where the deal is stuck',
    'suggested bridge',
  ]);
  const headings = narrative.sections.map((section) =>
    section.heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  );
  return headings.length >= 3 && headings.every((heading) => rigid.has(heading));
}

const QUESTION_HEADING_PATTERN =
  /\b(?:open questions?|questions? for|still needs? answering|evidence still missing|before committing|resolve first|what would change my view)\b/i;
const PROBLEM_HEADING_PATTERN =
  /\b(?:deal is stuck|gets difficult|could break down|risk concentrates|real hesitation|blocking commitment)\b/i;
const NEXT_STEP_HEADING_PATTERN =
  /\b(?:next step|next move|move to make now|practical next move|action to take)\b/i;
const RECOMMENDATION_OR_ACTION_PATTERN =
  /\b(?:recommend|move forward|proceed|advance|finali[sz]e|sign|approve|draft|prepare|hold (?:a|one) (?:session|meeting|workshop)|the next step|should now|must now)\b/i;
const RISK_CONTENT_PATTERN =
  /\b(?:risk|break down|fail|dispute|exposure|ambiguity|uncertainty|blocker|tension|unresolved|unclear|undefined|could leave|may leave)\b/i;
const CONCRETE_ACTION_PATTERN =
  /\b(?:draft|prepare|document|record|agree|define|confirm|schedule|hold|create|map|register|review|negotiate|assign|circulate|write|set|establish)\b/i;

function sectionContentAlignmentWarnings(narrative: NarrativeMemo) {
  const warnings: string[] = [];
  narrative.sections.forEach((section) => {
    const heading = section.heading;
    const body = section.paragraphs.join(' ');
    if (
      QUESTION_HEADING_PATTERN.test(heading) &&
      RECOMMENDATION_OR_ACTION_PATTERN.test(body)
    ) {
      warnings.push('narrative_question_section_contains_recommendation_or_action');
    }
    if (
      PROBLEM_HEADING_PATTERN.test(heading) &&
      RECOMMENDATION_OR_ACTION_PATTERN.test(body) &&
      !RISK_CONTENT_PATTERN.test(body)
    ) {
      warnings.push('narrative_problem_section_contains_bridge_or_action');
    }
    if (
      NEXT_STEP_HEADING_PATTERN.test(heading) &&
      !CONCRETE_ACTION_PATTERN.test(body)
    ) {
      warnings.push('narrative_next_step_lacks_concrete_action');
    }
  });
  return [...new Set(warnings)];
}

export function validateNarrativeMemo(
  value: unknown,
  options: {
    fitLevel?: FitLevel;
    decisionStatus?: MediationDecisionStatus;
    missingCount?: number;
    validateContentAlignment?: boolean;
  } = {},
): NarrativeValidationResult {
  const narrative = normalizeNarrativeMemo(value);
  const warnings: string[] = [];

  if (!narrative) {
    return {
      valid: false,
      warnings: ['narrative_missing_or_malformed'],
      metrics: { section_count: 0, paragraph_count: 0, body_chars: 0, word_count: 0 },
    };
  }

  const paragraphCount = narrative.sections.reduce(
    (count, section) => count + section.paragraphs.length,
    0,
  );
  const bodyText = [
    narrative.title,
    ...narrative.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    narrative.closing,
  ].join(' ');
  const bodyChars = narrative.sections.reduce(
    (count, section) => count + section.paragraphs.join(' ').length,
    narrative.closing.length,
  );

  if (narrative.title.length < 8) warnings.push('narrative_title_too_short');
  if (
    narrative.sections.length < NARRATIVE_MIN_SECTIONS ||
    narrative.sections.length > NARRATIVE_MAX_SECTIONS
  ) {
    warnings.push('narrative_section_count_invalid');
  }
  if (paragraphCount < NARRATIVE_MIN_PARAGRAPHS) {
    warnings.push('narrative_paragraph_count_too_low');
  }
  if (bodyChars < NARRATIVE_MIN_BODY_CHARS) {
    warnings.push('narrative_body_too_short');
  }
  if (
    narrative.sections.some(
      (section) => section.paragraphs.join(' ').length < NARRATIVE_MIN_SECTION_CHARS,
    )
  ) {
    warnings.push('narrative_section_too_thin');
  }
  if (narrative.closing.length < NARRATIVE_MIN_CLOSING_CHARS) {
    warnings.push('narrative_closing_missing_or_thin');
  }
  if (
    /^\s*[{[]/.test(bodyText) ||
    /["']internal_analysis["']|\bdecision_status\b|\bevidence_used\b|\boutput_mode\b/i.test(bodyText)
  ) {
    warnings.push('narrative_contains_internal_or_json_artifacts');
  }
  if (hasRigidDecisionBriefHeadings(narrative)) {
    warnings.push('narrative_uses_rigid_decision_brief_headings');
  }
  if (options.validateContentAlignment) {
    warnings.push(...sectionContentAlignmentWarnings(narrative));
  }

  const status =
    options.decisionStatus ||
    (options.fitLevel ? decisionStatusForFitLevel(options.fitLevel) : undefined);
  if (status) {
    warnings.push(...decisionLanguageWarnings(bodyText, status));
  }
  if (
    Number(options.missingCount || 0) > 0 &&
    !UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(bodyText))
  ) {
    warnings.push('narrative_does_not_acknowledge_missing_information');
  }

  return {
    narrative,
    valid: warnings.length === 0,
    warnings,
    metrics: {
      section_count: narrative.sections.length,
      paragraph_count: paragraphCount,
      body_chars: bodyChars,
      word_count: countWords(bodyText),
    },
  };
}
