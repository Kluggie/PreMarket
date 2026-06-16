import type {
  FitLevel,
  MediationDecisionStatus,
  NarrativeMemo,
  ProposalFactSheet,
  RetrievedMediationEvidencePacket,
} from './vertex-evaluation-v2-types.js';
import type { MediationRoundContext } from './mediation-progress.js';

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

const CONDITIONAL_VIABILITY_PATTERNS = [
  /\bworkable\b/i,
  /\bplausible\b/i,
  /\bbridgeable\b/i,
  /\bworth pursuing\b/i,
  /\brealistic (?:agreement |deal |pilot )?(?:path|structure|landing zone)\b/i,
  /\blanding zone\b/i,
  /\bcredible path to agreement\b/i,
];

const CURRENT_STRUCTURE_NEGATIVE_PATTERNS = [
  /\bcurrent (?:proposal|structure|draft|terms?) (?:is|are|remains?) not viable\b/i,
  /\bnot viable as (?:currently )?(?:drafted|structured|proposed)\b/i,
  /\bdo not proceed (?:with|on) the current (?:proposal|structure|draft|terms?)\b/i,
];

const ALTERNATIVE_STRUCTURE_PATTERNS = [
  /\b(?:alternative|narrower|restructured|materially different|replacement) (?:proposal|structure|deal|pilot|arrangement)\b/i,
  /\bcould become workable\b/i,
  /\bwould need to be restructured\b/i,
  /\bonly a different structure\b/i,
];

const CONDITIONAL_NEGATIVE_PATTERNS = [
  /\bdo not proceed\b[^.]{0,120}\b(?:until|unless|before)\b/i,
  /\bshould not (?:sign|approve|proceed|commit)\b[^.]{0,120}\b(?:until|unless|before)\b/i,
  /\bpause\b[^.]{0,120}\b(?:until|unless|while)\b/i,
];

const PUBLIC_EVIDENCE_META_PATTERNS = [
  /\bconfidential (?:context|material|materials|information|evidence|source|sources)\b/i,
  /\bprivate (?:context|material|materials|information|evidence|source|sources|willingness|fallback|concession|pressure|threshold|thresholds|limit|limits|resourcing concerns?)\b/i,
  /\binternal (?:analysis|evidence|context|information|pricing flexibility|pipeline pressure|pressure|threshold|thresholds|limit|limits|fallback|resourcing concerns?|constraints?)\b/i,
  /\bhidden (?:posture|position|positions|threshold|thresholds|limit|limits)\b/i,
  /\bconfidential[- ]only\b/i,
  /\bretrieval diagnostics?\b/i,
  /\binternal evidence visibility\b/i,
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

function hasConditionalViabilityLanguage(text: string) {
  return CONDITIONAL_VIABILITY_PATTERNS.some((pattern) => hasUnnegatedPattern(text, pattern));
}

function describesQualifiedAlternativeStructure(text: string) {
  return (
    CURRENT_STRUCTURE_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text)) &&
    ALTERNATIVE_STRUCTURE_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function hasConditionalNegativeLanguage(text: string) {
  return CONDITIONAL_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function mentionsPrivateOrInternalEvidenceSource(text: string) {
  return PUBLIC_EVIDENCE_META_PATTERNS.some((pattern) => pattern.test(text));
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
  if (
    status === 'not_viable' &&
    hasConditionalViabilityLanguage(text) &&
    !describesQualifiedAlternativeStructure(text)
  ) {
    warnings.push('narrative_presents_viable_path_under_not_viable_decision');
  }
  if (
    status === 'proceed_with_conditions' &&
    hasStrongNegativeDecisionLanguage(text) &&
    !hasConditionalNegativeLanguage(text)
  ) {
    warnings.push('narrative_rejects_deal_under_conditional_decision');
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

const PROGRESS_LANGUAGE_PATTERN =
  /\b(?:since (?:the )?(?:last|prior|previous) (?:round|review)|this round|compared (?:with|to) (?:the )?(?:last|prior|previous)|has (?:now )?(?:resolved|closed|narrowed|changed|regressed)|is now (?:agreed|defined|resolved|clear|aligned)|partly answered since|partially resolved since|remains unchanged from|new issue (?:has )?(?:appeared|emerged)|new concern (?:has )?(?:appeared|emerged)|moved closer|moved further|progress (?:was|has been|is))\b/i;
const CAUSAL_LANGUAGE_PATTERN =
  /\b(?:because|as a result|given|reflects?|due to|based on|now that|while|although|but)\b/i;
const RECOMMENDATION_CONTINUITY_PATTERN =
  /\b(?:recommendation|recommended path|case for proceeding|case for pausing|remains conditional|remains unchanged|has changed|is stronger|is weaker)\b/i;
const CONFIDENCE_CONTINUITY_PATTERN =
  /\bconfidence\b.{0,120}\b(?:increas|decreas|remain|unchanged|stronger|weaker)\b|\b(?:increas|decreas|remain|unchanged)\w*\b.{0,120}\bconfidence\b/i;

function continuityTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 5),
  );
}

function narrativeMentionsIssue(bodyText: string, label: string) {
  const bodyTokens = continuityTokens(bodyText);
  const issueTokens = continuityTokens(label);
  if (issueTokens.size === 0) return false;
  let overlap = 0;
  issueTokens.forEach((token) => {
    if (bodyTokens.has(token)) overlap += 1;
  });
  return overlap >= Math.min(2, issueTokens.size);
}

function laterRoundContinuityWarnings(params: {
  narrative: NarrativeMemo;
  bodyText: string;
  context?: MediationRoundContext;
  decisionStatus?: MediationDecisionStatus;
  confidence?: number;
}) {
  const context = params.context;
  if (!context || context.current_bilateral_round_number <= 1 || !context.prior_review_summary) {
    return [] as string[];
  }

  const warnings: string[] = [];
  const delta = context.delta_analysis;
  if (!PROGRESS_LANGUAGE_PATTERN.test(params.bodyText)) {
    warnings.push('later_round_narrative_lacks_visible_progress_analysis');
  }

  const activePriorIssues = [
    ...context.prior_review_summary.prior_open_questions,
    ...context.prior_review_summary.prior_unresolved_issues,
  ];
  if (
    activePriorIssues.length > 0 &&
    !activePriorIssues.some((issue) => narrativeMentionsIssue(params.bodyText, issue.label))
  ) {
    warnings.push('later_round_narrative_ignores_prior_open_issues');
  }

  const newIssues = (delta?.issue_changes || []).filter(
    (issue) => issue.current_status === 'newly_introduced',
  );
  if (
    newIssues.length > 0 &&
    !newIssues.some((issue) => narrativeMentionsIssue(params.bodyText, issue.label))
  ) {
    warnings.push('later_round_narrative_ignores_new_issues');
  }

  const rawIssueIds = new Set([
    ...activePriorIssues.map((issue) => issue.issue_id),
    ...(delta?.issue_changes || []).map((issue) => issue.issue_id),
  ]);
  if ([...rawIssueIds].some((issueId) => issueId && params.bodyText.includes(issueId))) {
    warnings.push('narrative_exposes_raw_issue_id');
  }

  const priorStatus = context.prior_review_summary.prior_decision_status;
  if (
    priorStatus &&
    params.decisionStatus &&
    (
      priorStatus !== params.decisionStatus ||
      context.current_bilateral_round_number >= 3
    ) &&
    (
      !RECOMMENDATION_CONTINUITY_PATTERN.test(params.bodyText) ||
      !CAUSAL_LANGUAGE_PATTERN.test(params.bodyText)
    )
  ) {
    warnings.push('later_round_recommendation_change_not_explained');
  }

  const priorConfidence = context.prior_review_summary.prior_confidence_0_1;
  if (
    typeof priorConfidence === 'number' &&
    typeof params.confidence === 'number' &&
    Math.abs(priorConfidence - params.confidence) >= 0.05 &&
    (
      !CONFIDENCE_CONTINUITY_PATTERN.test(params.bodyText) ||
      !CAUSAL_LANGUAGE_PATTERN.test(params.bodyText)
    )
  ) {
    warnings.push('later_round_confidence_change_not_explained');
  }

  return [...new Set(warnings)];
}

export function validateNarrativeMemo(
  value: unknown,
  options: {
    fitLevel?: FitLevel;
    decisionStatus?: MediationDecisionStatus;
    confidence?: number;
    missingCount?: number;
    validateContentAlignment?: boolean;
    mediationRoundContext?: MediationRoundContext;
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
  if (mentionsPrivateOrInternalEvidenceSource(bodyText)) {
    warnings.push('narrative_mentions_private_or_internal_evidence_source');
  }
  if (hasRigidDecisionBriefHeadings(narrative)) {
    warnings.push('narrative_uses_rigid_decision_brief_headings');
  }
  if (options.validateContentAlignment) {
    warnings.push(...sectionContentAlignmentWarnings(narrative));
  }
  warnings.push(
    ...laterRoundContinuityWarnings({
      narrative,
      bodyText,
      context: options.mediationRoundContext,
      decisionStatus: options.decisionStatus,
      confidence: options.confidence,
    }),
  );

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
