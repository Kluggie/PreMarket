export type MediationMovementDirection =
  | 'converging'
  | 'stalled'
  | 'diverging'
  | 'mixed_movement'
  | 'no_material_movement'
  | 'insufficient_evidence';

export type MediationIssueStatus =
  | 'resolved'
  | 'partially_resolved'
  | 'narrowed'
  | 'still_blocking'
  | 'unchanged'
  | 'regressed'
  | 'newly_introduced'
  | 'superseded'
  | 'no_longer_relevant'
  | 'unclear';

export type PublicSafeMediationIssue = {
  issue_id: string;
  label: string;
  question?: string;
  prior_status: 'open' | 'resolved';
};

export type PublicSafePriorReviewSummary = {
  prior_evaluation_id?: string;
  prior_round_number?: number;
  prior_recommendation?: string;
  prior_decision_status?: string;
  prior_confidence_0_1?: number;
  prior_fit_level?: string;
  prior_primary_insight?: string;
  prior_recommended_conditions?: string[];
  prior_next_step?: string;
  prior_open_questions: PublicSafeMediationIssue[];
  prior_unresolved_issues: PublicSafeMediationIssue[];
  prior_resolved_issues: PublicSafeMediationIssue[];
  prior_movement_direction?: MediationMovementDirection;
  prior_delta_summary?: string;
  prior_public_safe_rationale?: string;
  generated_at_iso?: string;
  report_version?: string;
};

export type MediationDeltaIssue = {
  issue_id: string;
  label: string;
  prior_status?: 'open' | 'resolved';
  current_status: MediationIssueStatus;
  evidence_summary: string;
  evidence_basis:
    | 'current_shared_material'
    | 'current_retrieved_shared_evidence'
    | 'insufficient_shared_evidence';
};

export type MediationDeltaAnalysis = {
  prior_round_number?: number;
  current_round_number: number;
  issue_changes: MediationDeltaIssue[];
  resolved_issue_ids: string[];
  partially_resolved_issue_ids: string[];
  unchanged_issue_ids: string[];
  regressed_issue_ids: string[];
  superseded_issue_ids: string[];
  new_issue_ids: string[];
  movement_direction: MediationMovementDirection;
  progress_summary: string;
};

export type StoredMediationProgressMetadata = {
  bilateral_round_number?: number;
  prior_bilateral_round_id?: string | null;
  prior_bilateral_round_number?: number;
  delta_summary?: string;
  resolved_since_last_round?: string[];
  remaining_deltas?: string[];
  new_open_issues?: string[];
  movement_direction?: MediationMovementDirection;
};

export type MediationRoundContext = {
  current_bilateral_round_number: number;
  prior_bilateral_round_id?: string;
  prior_bilateral_round_number?: number;
  prior_primary_insight?: string;
  prior_fit_level?: string;
  prior_confidence_0_1?: number;
  prior_missing?: string[];
  prior_bridgeability_notes?: string[];
  prior_critical_incompatibilities?: string[];
  prior_delta_summary?: string;
  prior_movement_direction?: MediationMovementDirection;
  prior_review_summary?: PublicSafePriorReviewSummary;
  delta_analysis?: MediationDeltaAnalysis;
  current_state_deal_model?: {
    near_agreed_terms: string[];
    blocking_terms: string[];
  };
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeText(value: unknown) {
  return asText(value)
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeading(value: unknown) {
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

function shortText(value: unknown, maxChars = 480) {
  const text = normalizeText(value);
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return `${text.slice(0, cut > maxChars * 0.6 ? cut : maxChars).trim()}…`;
}

const UNSAFE_CONTINUITY_PATTERN =
  /\b(?:confidential|private|hidden|internal analysis|internal pressure|pipeline pressure|walk-away|walkaway|hard limit|maximum acceptable|minimum acceptable|private concession|willingness to compromise|fallback position|resourcing concern)\b/i;
const RAW_EVIDENCE_ID_PATTERN = /\[[a-z][a-z0-9_-]*:[^\]]+\]/i;

function publicSafeContinuityText(value: unknown, maxChars = 700) {
  const text = normalizeText(value);
  if (!text || UNSAFE_CONTINUITY_PATTERN.test(text) || RAW_EVIDENCE_ID_PATTERN.test(text)) {
    return '';
  }
  return shortText(text, maxChars);
}

function splitHeadingBody(value: unknown) {
  const text = normalizeText(value);
  const colon = text.indexOf(':');
  if (colon <= 0 || colon > 100) {
    return { heading: '', body: text };
  }
  return {
    heading: text.slice(0, colon).trim(),
    body: text.slice(colon + 1).trim(),
  };
}

function publicPresentationSections(report: Record<string, unknown>) {
  const sections: Array<{ heading: string; body: string }> = [];
  const add = (headingValue: unknown, bodyValue: unknown) => {
    const heading = normalizeText(headingValue);
    const bodyCandidate = Array.isArray(bodyValue)
      ? uniqueText(bodyValue).join(' ')
      : normalizeText(bodyValue);
    const body = publicSafeContinuityText(bodyCandidate, 1_200);
    if (!heading || !body) return;
    sections.push({ heading, body });
  };

  if (Array.isArray(report.why)) {
    report.why.forEach((entry) => {
      const parsed = splitHeadingBody(entry);
      if (parsed.heading && parsed.body) add(parsed.heading, parsed.body);
    });
  }

  const narrative = toObject(report.narrative);
  if (Array.isArray(narrative.sections)) {
    narrative.sections.forEach((entry) => {
      const section = toObject(entry);
      add(section.heading, section.paragraphs);
    });
  }
  if (normalizeText(narrative.closing)) {
    add('Next Step', narrative.closing);
  }

  if (Array.isArray(report.presentation_sections)) {
    report.presentation_sections.forEach((entry) => {
      const section = toObject(entry);
      add(section.heading || section.title, [
        ...(Array.isArray(section.paragraphs) ? section.paragraphs : []),
        ...(Array.isArray(section.bullets) ? section.bullets : []),
        normalizeText(section.body),
      ]);
    });
  }

  const deduped = new Map<string, { heading: string; body: string }>();
  sections.forEach((section) => {
    const key = `${normalizeHeading(section.heading)}:${section.body.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, section);
  });
  return [...deduped.values()];
}

const ISSUE_DIMENSIONS: Array<{
  id: string;
  label: string;
  patterns: RegExp[];
  completePatterns?: RegExp[];
}> = [
  {
    id: 'commission_trigger',
    label: 'Commission trigger and entitlement',
    patterns: [/\bcommission\b/i, /\breferral fee\b/i],
    completePatterns: [
      /\bcommission\b.{0,120}\b(?:earned|payable|due|triggered)\b.{0,80}\b(?:when|after|upon|on)\b/i,
      /\bcommission\b.{0,120}\b(?:signed customer|customer pays|paid subscription|receipt of payment)\b/i,
    ],
  },
  {
    id: 'referral_definition',
    label: 'Referral definition and qualification',
    patterns: [/\breferral\b/i, /\bqualified lead\b/i, /\bsuccessful introduction\b/i],
    completePatterns: [
      /\b(?:referral|lead)\b.{0,100}\b(?:means|counts as|is accepted when|qualif(?:y|ies|ied))\b/i,
    ],
  },
  {
    id: 'payment_timing',
    label: 'Payment timing',
    patterns: [/\bpayment timing\b/i, /\bpaid\b/i, /\binvoice\b/i, /\bnet[- ]?\d+\b/i],
    completePatterns: [
      /\b(?:paid|payment|invoice)\b.{0,100}\b(?:within|no later than|net[- ]?\s*\d+|\d+\s+days?)\b/i,
    ],
  },
  {
    id: 'client_protection',
    label: 'Client protection and non-circumvention',
    patterns: [
      /\bclient protection\b/i,
      /\bnon[- ]?circumvention\b/i,
      /\bprotection window\b/i,
      /\bbypass(?:ing)?\b/i,
    ],
    completePatterns: [
      /\b(?:client protection|protection window|non[- ]?circumvention)\b.{0,140}\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:day|week|month|year)s?\b/i,
      /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:day|week|month|year)s?\b.{0,140}\b(?:client protection|protection window|non[- ]?circumvention)\b/i,
    ],
  },
  {
    id: 'direct_sale_rules',
    label: 'Direct-sale and bypass rules',
    patterns: [/\bdirect[- ]?sell\b/i, /\bdirect sale\b/i, /\bbypass(?:ing)?\b/i],
    completePatterns: [
      /\b(?:direct[- ]?sell|direct sale|bypass)\b.{0,120}\b(?:allowed|prohibited|permitted|requires|must|may not)\b/i,
    ],
  },
  {
    id: 'implementation_responsibility',
    label: 'Implementation, onboarding, training, and support responsibilities',
    patterns: [
      /\bimplementation\b/i,
      /\bonboarding\b/i,
      /\btraining\b/i,
      /\bcustomer handoff\b/i,
      /\bproduct support\b/i,
    ],
    completePatterns: [
      /\b(?:implementation|onboarding|training|support|customer handoff)\b.{0,140}\b(?:responsible for|owned by|handled by|provided by|will own|will provide|retains?)\b/i,
      /\b(?:responsible for|owned by|handled by|provided by|will own|will provide|retains?)\b.{0,140}\b(?:implementation|onboarding|training|support|customer handoff)\b/i,
    ],
  },
  {
    id: 'renewal_expansion_economics',
    label: 'Renewal and expansion economics',
    patterns: [/\brenewal\b/i, /\bexpansion\b/i, /\brecurring revenue share\b/i, /\brelated accounts?\b/i],
    completePatterns: [
      /\b(?:renewal|expansion|recurring revenue share|related accounts?)\b.{0,140}\b(?:commissionable|not commissionable|applies|does not apply|only while|percentage|%)\b/i,
    ],
  },
  {
    id: 'post_pilot_rights',
    label: 'Post-pilot rights and performance thresholds',
    patterns: [
      /\bsemi[- ]?exclusiv/i,
      /\bpost[- ]?pilot\b/i,
      /\bperformance threshold\b/i,
      /\brenegotiation\b/i,
    ],
    completePatterns: [
      /\b(?:semi[- ]?exclusiv|post[- ]?pilot|renegotiation)\b.{0,160}\b(?:threshold|after|if|only when|qualified referrals?|signed customers?)\b/i,
    ],
  },
  {
    id: 'implementation_fee_ownership',
    label: 'Implementation fee ownership',
    patterns: [/\bimplementation fees?\b/i, /\bconsulting fees?\b/i],
    completePatterns: [
      /\b(?:implementation|consulting) fees?\b.{0,120}\b(?:retained by|paid to|belong to|owned by|invoiced by)\b/i,
    ],
  },
  {
    id: 'acceptance_criteria',
    label: 'Acceptance and completion criteria',
    patterns: [/\bacceptance criteria\b/i, /\bsign[- ]?off\b/i, /\bcompletion criteria\b/i],
  },
  {
    id: 'timeline_dependency',
    label: 'Timeline and dependencies',
    patterns: [/\btimeline\b/i, /\bdeadline\b/i, /\bdependenc(?:y|ies)\b/i, /\bmilestone\b/i],
  },
  {
    id: 'approval_ownership',
    label: 'Approval and decision ownership',
    patterns: [/\bapproval\b/i, /\bdecision owner\b/i, /\bsign[- ]?off authority\b/i],
  },
  {
    id: 'confidentiality_publicity',
    label: 'Confidentiality and publicity',
    patterns: [/\bconfidentiality\b/i, /\bpublicity\b/i, /\bpress release\b/i, /\bannouncement\b/i],
  },
  {
    id: 'exclusivity',
    label: 'Exclusivity',
    patterns: [/\bexclusiv/i],
  },
  {
    id: 'termination_exit',
    label: 'Termination and exit rights',
    patterns: [/\btermination\b/i, /\bnotice period\b/i, /\bexit right\b/i, /\bbreak clause\b/i],
  },
];

function fallbackIssueHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function mediationIssueIdForText(value: unknown) {
  const text = normalizeText(value);
  const dimension = ISSUE_DIMENSIONS.find((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  );
  if (dimension) return dimension.id;
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `issue_${fallbackIssueHash(normalized || 'unknown')}`;
}

function issueLabelForText(value: unknown) {
  const issueId = mediationIssueIdForText(value);
  return ISSUE_DIMENSIONS.find((entry) => entry.id === issueId)?.label || shortText(stripWhyMatters(value), 140);
}

function toPublicIssue(value: unknown, priorStatus: 'open' | 'resolved'): PublicSafeMediationIssue | null {
  const question = stripWhyMatters(value);
  if (!question) return null;
  return {
    issue_id: mediationIssueIdForText(question),
    label: issueLabelForText(question),
    ...(question ? { question } : {}),
    prior_status: priorStatus,
  };
}

function dedupePublicIssues(values: Array<PublicSafeMediationIssue | null>) {
  const seen = new Set<string>();
  return values.filter((entry): entry is PublicSafeMediationIssue => {
    if (!entry || seen.has(entry.issue_id)) return false;
    seen.add(entry.issue_id);
    return true;
  });
}

function decisionStatusFromPublicReport(report: Record<string, unknown>, recommendation: string) {
  const combined = `${recommendation} ${normalizeText(report.recommendation)}`.toLowerCase();
  if (/\bnot viable\b|\bdo not proceed\b/.test(combined)) return 'not_viable';
  if (/\bready to finali[sz]e\b|\bmove toward final agreement\b/.test(combined)) {
    return 'ready_to_finalize';
  }
  if (/\bproceed with conditions\b|\bproceed only\b/.test(combined)) {
    return 'proceed_with_conditions';
  }
  if (/\bexplore further\b/.test(combined)) return 'explore_further';
  const fitLevel = normalizeText(report.fit_level).toLowerCase();
  if (fitLevel === 'high') return 'ready_to_finalize';
  if (fitLevel === 'medium') return 'proceed_with_conditions';
  if (fitLevel === 'low') return 'not_viable';
  return 'explore_further';
}

function buildPublicSafePriorReviewSummary(params: {
  priorBilateralRoundId?: string | null;
  priorReport: Record<string, unknown>;
}): PublicSafePriorReviewSummary {
  const report = params.priorReport;
  const sections = publicPresentationSections(report);
  const recommendationSection = sections.find((section) =>
    /\b(recommendation|recommended path|decision readiness)\b/i.test(section.heading),
  );
  const bridgeSection = sections.find((section) =>
    /\b(suggested bridge|bridge|path forward|route forward)\b/i.test(section.heading),
  );
  const nextStepSection = sections.find((section) =>
    /\b(next step|next move|action to take|move to make now)\b/i.test(section.heading),
  );
  const recommendation = shortText(
    publicSafeContinuityText(
      recommendationSection?.body || report.primary_insight || report.summary,
      600,
    ),
    600,
  );
  const openQuestions = normalizeProgressArray(report.remaining_deltas || report.missing, 8)
    .map((entry) => publicSafeContinuityText(entry, 280))
    .filter(Boolean);
  const unresolvedIssues = uniqueText([
    ...openQuestions,
    ...sections
      .filter((section) => /\b(stuck|unresolved|blocker|risk|still open)\b/i.test(section.heading))
      .map((section) => section.body),
  ]).slice(0, 8);
  const resolvedIssues = normalizeProgressArray(report.resolved_since_last_round, 6)
    .map((entry) => publicSafeContinuityText(entry, 280))
    .filter(Boolean);
  const recommendedConditions = uniqueText([
    ...(bridgeSection ? [bridgeSection.body] : []),
    ...(recommendationSection && /\b(if|until|provided|condition|before)\b/i.test(recommendationSection.body)
      ? [recommendationSection.body]
      : []),
  ]).slice(0, 4);
  const priorOpenQuestions = dedupePublicIssues(
    openQuestions.map((entry) => toPublicIssue(entry, 'open')),
  );
  const priorUnresolvedIssues = dedupePublicIssues(
    unresolvedIssues.map((entry) => toPublicIssue(entry, 'open')),
  );
  const priorResolvedIssues = dedupePublicIssues(
    resolvedIssues.map((entry) => toPublicIssue(entry, 'resolved')),
  );
  const confidence = clampConfidence(report.confidence_0_1);
  const movement = normalizeMovementDirection(report.movement_direction);

  return {
    ...(asText(params.priorBilateralRoundId)
      ? { prior_evaluation_id: asText(params.priorBilateralRoundId) }
      : {}),
    ...(clampPositiveInteger(report.bilateral_round_number, 0)
      ? { prior_round_number: clampPositiveInteger(report.bilateral_round_number, 0) }
      : {}),
    ...(recommendation ? { prior_recommendation: recommendation } : {}),
    ...(recommendation
      ? { prior_decision_status: decisionStatusFromPublicReport(report, recommendation) }
      : {}),
    ...(confidence !== undefined ? { prior_confidence_0_1: confidence } : {}),
    ...(normalizeText(report.fit_level)
      ? { prior_fit_level: normalizeText(report.fit_level).toLowerCase() }
      : {}),
    ...(publicSafeContinuityText(report.primary_insight, 500)
      ? { prior_primary_insight: publicSafeContinuityText(report.primary_insight, 500) }
      : {}),
    ...(recommendedConditions.length > 0
      ? { prior_recommended_conditions: recommendedConditions }
      : {}),
    ...(nextStepSection?.body
      ? { prior_next_step: shortText(nextStepSection.body, 420) }
      : {}),
    prior_open_questions: priorOpenQuestions,
    prior_unresolved_issues: priorUnresolvedIssues,
    prior_resolved_issues: priorResolvedIssues,
    ...(movement ? { prior_movement_direction: movement } : {}),
    ...(normalizeText(report.delta_summary)
      ? { prior_delta_summary: shortText(report.delta_summary, 500) }
      : {}),
    ...(recommendation
      ? {
          prior_public_safe_rationale: shortText(
            uniqueText([
              publicSafeContinuityText(report.primary_insight, 500),
              recommendation,
            ]).join(' '),
            700,
          ),
        }
      : {}),
    ...(normalizeText(report.generated_at_iso)
      ? { generated_at_iso: normalizeText(report.generated_at_iso) }
      : {}),
    ...(normalizeText(report.report_format)
      ? { report_version: normalizeText(report.report_format) }
      : {}),
  };
}

function clampPositiveInteger(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric >= 0 && numeric <= 1) {
    return numeric;
  }
  if (numeric > 1 && numeric <= 100) {
    return Math.max(0, Math.min(1, numeric / 100));
  }
  return undefined;
}

function normalizeMovementDirection(value: unknown): MediationMovementDirection | undefined {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === 'converging' ||
    normalized === 'stalled' ||
    normalized === 'diverging' ||
    normalized === 'mixed_movement' ||
    normalized === 'no_material_movement' ||
    normalized === 'insufficient_evidence'
  ) {
    return normalized;
  }
  if (normalized === 'mixed' || normalized === 'mixed movement') return 'mixed_movement';
  if (normalized === 'closer to agreement') return 'converging';
  if (normalized === 'further from agreement') return 'diverging';
  if (normalized === 'no movement' || normalized === 'no material movement') return 'no_material_movement';
  return undefined;
}

function stripWhyMatters(value: unknown) {
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

const STOPWORDS = new Set([
  'about', 'after', 'also', 'been', 'before', 'being', 'between', 'both',
  'could', 'does', 'each', 'even', 'from', 'have', 'into', 'just', 'more',
  'most', 'much', 'must', 'only', 'other', 'over', 'some', 'such', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'very', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would',
  'your',
]);

function extractKeywords(text: string) {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
}

function keywordOverlap(left: string, right: string) {
  const leftKeywords = extractKeywords(left);
  const rightKeywords = extractKeywords(right);
  if (leftKeywords.size === 0 || rightKeywords.size === 0) {
    return 0;
  }
  let matches = 0;
  leftKeywords.forEach((keyword) => {
    if (rightKeywords.has(keyword)) {
      matches += 1;
    }
  });
  return matches / Math.min(leftKeywords.size, rightKeywords.size);
}

function itemsOverlap(left: string, right: string) {
  const normalizedLeft = stripWhyMatters(left).toLowerCase();
  const normalizedRight = stripWhyMatters(right).toLowerCase();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return true;
  }
  return keywordOverlap(normalizedLeft, normalizedRight) >= 0.68;
}

function joinNatural(items: string[]) {
  const values = uniqueText(items);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function normalizeProgressArray(value: unknown, maxItems = 4) {
  if (!Array.isArray(value)) return [] as string[];
  return uniqueText(
    value.map((entry) => {
      if (typeof entry === 'string') return stripWhyMatters(entry);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return stripWhyMatters(
          (entry as Record<string, unknown>).text ||
          (entry as Record<string, unknown>).title ||
          (entry as Record<string, unknown>).description,
        );
      }
      return '';
    }),
  ).slice(0, maxItems);
}

function flattenNarrativeText(value: unknown) {
  if (typeof value === 'string') {
    return normalizeText(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return normalizeText(entry);
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          return normalizeText(record.text || record.title || record.description);
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return normalizeText(record.text || record.summary || record.primary_insight);
  }
  return '';
}

function inferMovementDirectionFromSummary(value: unknown): MediationMovementDirection | undefined {
  const text = normalizeText(value).toLowerCase();
  if (!text) return undefined;

  const hasConvergingSignal = [
    'closer to executable agreement',
    'closer to agreement',
    'has narrowed materially',
    'narrowed materially',
    'narrowed',
    'substantially aligned',
    'now aligned',
    'reduced scope ambiguity',
    'material progress',
  ].some((phrase) => text.includes(phrase));
  const hasDivergingSignal = [
    'pushed the negotiation further from executable agreement',
    'further from executable agreement',
    'further from agreement',
    'drifting apart',
    'drifting rather than narrowing',
    'new blockers emerged',
  ].some((phrase) => text.includes(phrase));
  const hasStalledSignal = [
    'little substantive movement',
    'little movement',
    'remain unchanged',
    'still stalled',
  ].some((phrase) => text.includes(phrase));

  if (hasConvergingSignal && !hasDivergingSignal) {
    return 'converging';
  }
  if (hasDivergingSignal && !hasConvergingSignal) {
    return 'diverging';
  }
  if (hasStalledSignal) {
    return 'stalled';
  }
  return undefined;
}

function inferMovementDirectionFromNarrative(value: unknown): MediationMovementDirection | undefined {
  const text = flattenNarrativeText(value).toLowerCase();
  if (!text) return undefined;

  const hasConvergingSignal = [
    'closer to agreement',
    'closer to executable agreement',
    'now largely aligned',
    'largely aligned',
    'substantially aligned',
    'narrows the remaining issue',
    'narrowed the remaining issue',
    'implementation path is more concrete',
    'main blocker is no longer',
  ].some((phrase) => text.includes(phrase));
  const hasDivergingSignal = [
    'further from agreement',
    'further from executable agreement',
    'drifting apart',
    'new blocker',
    'new blockers',
    'more open issues',
  ].some((phrase) => text.includes(phrase));
  const hasStalledSignal = [
    'little substantive movement',
    'main unresolved issues remain',
    'still unclear',
    'still unresolved',
  ].some((phrase) => text.includes(phrase));

  if (hasConvergingSignal && !hasDivergingSignal) {
    return 'converging';
  }
  if (hasDivergingSignal && !hasConvergingSignal) {
    return 'diverging';
  }
  if (hasStalledSignal) {
    return 'stalled';
  }
  return undefined;
}

function inferMovementDirectionFromSharedTextDelta(params: {
  currentSharedText?: unknown;
  priorSharedText?: unknown;
}): MediationMovementDirection | undefined {
  const currentText = normalizeText(params.currentSharedText).toLowerCase();
  const priorText = normalizeText(params.priorSharedText).toLowerCase();
  if (!currentText || !priorText || currentText === priorText) {
    return undefined;
  }

  const hasConvergingSignal = [
    'confirms',
    'confirm',
    'aligned',
    'alignment',
    'agree',
    'agreed',
    'acceptable if',
    'resolved',
    'remaining issue',
    'narrows the remaining issue',
    'narrows remaining issue',
    'only remaining',
  ].some((phrase) => currentText.includes(phrase));
  const hasDivergingSignal = [
    'new blocker',
    'additional blocker',
    'new dependency',
    'additional dependency',
    'cannot accept',
    'will not accept',
    'reopens',
    'expands the scope',
  ].some((phrase) => currentText.includes(phrase));

  if (hasConvergingSignal && !hasDivergingSignal) {
    return 'converging';
  }
  if (hasDivergingSignal && !hasConvergingSignal) {
    return 'diverging';
  }
  return undefined;
}

function buildMovementDirection(params: {
  priorMissing: string[];
  remainingDeltas: string[];
  resolvedSinceLastRound: string[];
  newOpenIssues: string[];
}) {
  const priorCount = params.priorMissing.length;
  const remainingCount = params.remainingDeltas.length;
  const resolvedCount = params.resolvedSinceLastRound.length;
  const newCount = params.newOpenIssues.length;

  // Be conservative: later bilateral rounds should only be called "diverging"
  // when friction is materially broader than the prior round. A single reframed
  // issue or one new blocker alongside one resolved blocker is usually mixed or
  // converging, not true drift.
  if (priorCount === 0) {
    return resolvedCount > 0 && newCount === 0 ? 'converging' as const : 'stalled' as const;
  }

  if (remainingCount === 0 && (resolvedCount > 0 || priorCount > 0)) {
    return 'converging' as const;
  }
  if (resolvedCount > 0 && resolvedCount >= newCount && remainingCount <= priorCount) {
    return 'converging' as const;
  }
  if (resolvedCount > newCount) {
    return 'converging' as const;
  }
  if (
    newCount >= resolvedCount + 2 &&
    remainingCount > priorCount
  ) {
    return 'diverging' as const;
  }
  if (
    newCount > resolvedCount &&
    remainingCount > priorCount + 1
  ) {
    return 'diverging' as const;
  }
  if (
    remainingCount < priorCount &&
    newCount === 0
  ) {
    return 'converging' as const;
  }
  return 'stalled' as const;
}

function buildDeltaSummary(params: {
  movementDirection: MediationMovementDirection;
  resolvedSinceLastRound: string[];
  remainingDeltas: string[];
  newOpenIssues: string[];
}) {
  const resolvedPreview = joinNatural(params.resolvedSinceLastRound.slice(0, 2));
  const remainingPreview = joinNatural(params.remainingDeltas.slice(0, 2));
  const newIssuesPreview = joinNatural(params.newOpenIssues.slice(0, 2));

  if (params.movementDirection === 'converging') {
    if (resolvedPreview && remainingPreview) {
      return `Since the prior bilateral round, ${resolvedPreview} appears narrower or resolved, while the main remaining deltas now center on ${remainingPreview}.`;
    }
    if (resolvedPreview) {
      return `Since the prior bilateral round, the negotiation appears closer to executable agreement because ${resolvedPreview} moved materially.`;
    }
    if (remainingPreview) {
      return `Since the prior bilateral round, the negotiation appears closer to executable agreement, although ${remainingPreview} still needs resolution.`;
    }
    return 'Since the prior bilateral round, the negotiation appears closer to executable agreement.';
  }

  if (params.movementDirection === 'diverging') {
    if (newIssuesPreview) {
      return `Since the prior bilateral round, new blockers emerged around ${newIssuesPreview}, which has pushed the negotiation further from executable agreement.`;
    }
    if (remainingPreview) {
      return `Since the prior bilateral round, the negotiation appears to be drifting because the unresolved deltas now center on ${remainingPreview}.`;
    }
    return 'Since the prior bilateral round, the negotiation appears to be drifting rather than narrowing.';
  }

  if (remainingPreview) {
    return `Since the prior bilateral round, little substantive movement is visible and the main unresolved deltas remain ${remainingPreview}.`;
  }
  if (newIssuesPreview) {
    return `Since the prior bilateral round, movement is mixed and new friction emerged around ${newIssuesPreview}.`;
  }
  return 'Since the prior bilateral round, little substantive movement is visible in the negotiation.';
}

export function extractMediationReport(value: unknown) {
  const root = toObject(value);
  const directReport = toObject(root.report);
  const evaluationResult = toObject(root.evaluation_result);
  const nestedReport = toObject(evaluationResult.report);
  const publicReport = toObject(root.public_report);
  const candidate = [directReport, nestedReport, publicReport, root].find(
    (entry) => normalizeText((entry as Record<string, unknown>).analysis_stage).toLowerCase() === 'mediation_review',
  );
  return candidate || null;
}

function sharedEvidenceText(packet: unknown) {
  const raw = toObject(packet);
  const items = Array.isArray(raw.items) ? raw.items.map(toObject) : [];
  const sharedItems = items.filter((item) => {
    const visibility = normalizeText(item.visibility).toLowerCase();
    const sourceType = normalizeText(item.source_type).toLowerCase();
    return visibility === 'shared' || sourceType === 'primary_shared_context';
  });
  const latestRound = sharedItems.reduce(
    (max, item) => Math.max(max, clampPositiveInteger(item.round_number, 0)),
    0,
  );
  const latestItems = latestRound > 0
    ? sharedItems.filter((item) => clampPositiveInteger(item.round_number, 0) === latestRound)
    : sharedItems;
  return uniqueText(
    latestItems.flatMap((item) => [
      item.title_or_summary,
      item.excerpt,
    ]),
  ).join(' ');
}

function relevantIssueText(issue: PublicSafeMediationIssue, currentText: string) {
  const dimension = ISSUE_DIMENSIONS.find((entry) => entry.id === issue.issue_id);
  const sentences = currentText
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map(normalizeText)
    .filter(Boolean);
  const issueKeywords = extractKeywords(`${issue.label} ${issue.question || ''}`);
  const relevantIndexes = sentences.reduce((indexes, sentence, index) => {
    if (dimension?.patterns.some((pattern) => pattern.test(sentence))) {
      indexes.push(index);
      return indexes;
    }
    const sentenceKeywords = extractKeywords(sentence);
    let matches = 0;
    issueKeywords.forEach((keyword) => {
      if (sentenceKeywords.has(keyword)) matches += 1;
    });
    if (matches >= Math.min(2, Math.max(1, issueKeywords.size))) indexes.push(index);
    return indexes;
  }, [] as number[]);
  const expandedIndexes = new Set<number>();
  relevantIndexes.forEach((index) => {
    expandedIndexes.add(index);
    if (index > 0) expandedIndexes.add(index - 1);
    if (index + 1 < sentences.length) expandedIndexes.add(index + 1);
  });
  return [...expandedIndexes]
    .sort((left, right) => left - right)
    .map((index) => sentences[index])
    .slice(-4)
    .join(' ');
}

function classifyPriorIssue(
  issue: PublicSafeMediationIssue,
  evidenceText: string,
): MediationIssueStatus {
  if (!evidenceText) return 'unchanged';
  const dimension = ISSUE_DIMENSIONS.find((entry) => entry.id === issue.issue_id);
  const lower = evidenceText.toLowerCase();

  if (/\b(?:removed from|no longer part of|not applicable|out of scope|dropped from)\b/i.test(evidenceText)) {
    return 'no_longer_relevant';
  }
  if (/\b(?:supersedes?|replaces?|replaced by|instead of|changed from|no longer applies)\b/i.test(evidenceText)) {
    return 'superseded';
  }
  if (
    /\b(?:cannot agree|cannot accept|will not accept|rejects?|reopens?|new blocker|additional blocker)\b/i.test(
      evidenceText,
    )
  ) {
    return 'regressed';
  }
  if (dimension?.completePatterns?.some((pattern) => pattern.test(evidenceText))) {
    return 'resolved';
  }

  if (
    /\b(?:still did not|still does not|still not|still unresolved|remains unresolved|remains open|cannot proceed|cannot sign|before signature|still needs agreement)\b/i.test(
      evidenceText,
    ) &&
    (
      dimension?.patterns.some((pattern) => pattern.test(lower)) ||
      keywordOverlap(`${issue.label} ${issue.question || ''}`, evidenceText) >= 0.5
    )
  ) {
    return 'still_blocking';
  }

  const concreteSignal =
    /\b\d+(?:\.\d+)?\s*(?:%|days?|weeks?|months?|years?)\b/i.test(evidenceText) ||
    /\b(?:will|must|shall|is responsible for|owned by|handled by|provided by|retained by|paid to)\b/i.test(
      evidenceText,
    );
  const explicitButIncomplete =
    /\b(?:will apply|to be agreed|remains open|still needs|in principle|subject to|intends? to)\b/i.test(
      evidenceText,
    );
  if (explicitButIncomplete) return 'partially_resolved';
  if (concreteSignal) return 'narrowed';
  if (
    dimension?.patterns.some((pattern) => pattern.test(lower)) ||
    keywordOverlap(`${issue.label} ${issue.question || ''}`, evidenceText) >= 0.5
  ) {
    return 'unchanged';
  }
  return 'unclear';
}

function deltaEvidenceSummary(
  issue: PublicSafeMediationIssue,
  status: MediationIssueStatus,
  relevantText: string,
) {
  const evidence = shortText(relevantText, 320);
  if (evidence) return evidence;
  if (status === 'unchanged') {
    return `The current shared record does not provide a substantive answer on ${issue.label.toLowerCase()}.`;
  }
  return `The available shared record is insufficient to determine movement on ${issue.label.toLowerCase()}.`;
}

function inferNewIssues(
  currentText: string,
  knownIssueIds: Set<string>,
): MediationDeltaIssue[] {
  return ISSUE_DIMENSIONS
    .filter((dimension) => !knownIssueIds.has(dimension.id))
    .filter((dimension) => dimension.patterns.some((pattern) => pattern.test(currentText)))
    .filter((dimension) => {
      const relevant = currentText
        .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .filter((sentence) => dimension.patterns.some((pattern) => pattern.test(sentence)))
        .join(' ');
      return /\b(?:new|introduc|expects?|requires?|must|concern|unresolved|not agreed|cannot accept|subject to)\b/i.test(
        relevant,
      );
    })
    .slice(0, 4)
    .map((dimension) => ({
      issue_id: dimension.id,
      label: dimension.label,
      current_status: 'newly_introduced' as const,
      evidence_summary: shortText(
        currentText
          .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
          .filter((sentence) => dimension.patterns.some((pattern) => pattern.test(sentence)))
          .slice(-2)
          .join(' '),
        320,
      ),
      evidence_basis: 'current_shared_material' as const,
    }));
}

function buildDeltaAnalysis(params: {
  context: MediationRoundContext;
  currentSharedText: string;
  retrievedEvidencePacket?: unknown;
}): MediationDeltaAnalysis | undefined {
  const summary = params.context.prior_review_summary;
  if (!summary || params.context.current_bilateral_round_number <= 1) return undefined;

  const retrievedSharedText = sharedEvidenceText(params.retrievedEvidencePacket);
  const currentSharedText = normalizeText(params.currentSharedText);
  const comparisonText = normalizeText([retrievedSharedText, currentSharedText].filter(Boolean).join(' '));
  const priorIssues = dedupePublicIssues([
    ...summary.prior_open_questions,
    ...summary.prior_unresolved_issues,
  ]);
  const issueChanges = priorIssues.map((issue) => {
    const relevantText = relevantIssueText(issue, comparisonText);
    const currentStatus = classifyPriorIssue(issue, relevantText);
    return {
      issue_id: issue.issue_id,
      label: issue.label,
      prior_status: issue.prior_status,
      current_status: currentStatus,
      evidence_summary: deltaEvidenceSummary(issue, currentStatus, relevantText),
      evidence_basis: relevantText
        ? retrievedSharedText && relevantIssueText(issue, retrievedSharedText)
          ? 'current_retrieved_shared_evidence' as const
          : 'current_shared_material' as const
        : 'insufficient_shared_evidence' as const,
    };
  });
  const knownIssueIds = new Set([
    ...priorIssues.map((issue) => issue.issue_id),
    ...summary.prior_resolved_issues.map((issue) => issue.issue_id),
  ]);
  const newIssues = inferNewIssues(comparisonText, knownIssueIds);
  const allChanges = [...issueChanges, ...newIssues];
  const resolved = allChanges.filter((entry) =>
    entry.current_status === 'resolved' || entry.current_status === 'no_longer_relevant',
  );
  const partial = allChanges.filter((entry) =>
    entry.current_status === 'partially_resolved' || entry.current_status === 'narrowed',
  );
  const stillBlocking = allChanges.filter((entry) => entry.current_status === 'still_blocking');
  const unchanged = allChanges.filter((entry) =>
    entry.current_status === 'unchanged' || entry.current_status === 'unclear' || entry.current_status === 'still_blocking',
  );
  const regressed = allChanges.filter((entry) => entry.current_status === 'regressed');
  const superseded = allChanges.filter((entry) => entry.current_status === 'superseded');
  const movementDirection: MediationMovementDirection =
    !comparisonText
      ? 'insufficient_evidence'
      : (resolved.length > 0 || partial.length > 0) && (newIssues.length > 0 || regressed.length > 0 || stillBlocking.length > 0)
        ? 'mixed_movement'
        : regressed.length > 0 || newIssues.length > resolved.length + partial.length
          ? 'diverging'
          : resolved.length > 0 || partial.length > 0
            ? 'converging'
            : 'no_material_movement';
  const movedLabels = [...resolved, ...partial].map((entry) => entry.label).slice(0, 2);
  const openLabels = [...unchanged, ...regressed].map((entry) => entry.label).slice(0, 2);
  const newLabels = newIssues.map((entry) => entry.label).slice(0, 2);
  const progressSummary =
    movementDirection === 'converging'
      ? `The shared record shows progress on ${joinNatural(movedLabels)}, while ${joinNatural(openLabels) || 'some prior issues'} still needs resolution.`
      : movementDirection === 'diverging'
        ? `The latest shared material introduces or worsens ${joinNatural(newLabels.length ? newLabels : regressed.map((entry) => entry.label))}.`
        : movementDirection === 'mixed_movement'
          ? `The shared record closes some issues (${joinNatural(movedLabels) || 'partial progress'}) but introduces or keeps blockers around ${joinNatural([...newLabels, ...stillBlocking.map((entry) => entry.label)].slice(0, 2)) || 'remaining terms'}.`
          : movementDirection === 'insufficient_evidence'
            ? 'The current shared record is too sparse to determine reliable movement since the prior round.'
            : `The current shared record does not materially resolve ${joinNatural(openLabels) || 'the prior open issues'}.`;

  return {
    ...(summary.prior_round_number
      ? { prior_round_number: summary.prior_round_number }
      : {}),
    current_round_number: params.context.current_bilateral_round_number,
    issue_changes: allChanges,
    resolved_issue_ids: resolved.map((entry) => entry.issue_id),
    partially_resolved_issue_ids: partial.map((entry) => entry.issue_id),
    unchanged_issue_ids: unchanged.map((entry) => entry.issue_id),
    regressed_issue_ids: regressed.map((entry) => entry.issue_id),
    superseded_issue_ids: superseded.map((entry) => entry.issue_id),
    new_issue_ids: newIssues.map((entry) => entry.issue_id),
    movement_direction: movementDirection,
    progress_summary: progressSummary,
  };
}

export function enrichMediationRoundContext(params: {
  mediationRoundContext?: MediationRoundContext;
  currentSharedText: string;
  retrievedEvidencePacket?: unknown;
}) {
  const context = params.mediationRoundContext;
  if (!context || context.current_bilateral_round_number <= 1 || !context.prior_review_summary) {
    return context;
  }
  const deltaAnalysis = buildDeltaAnalysis({
    context,
    currentSharedText: params.currentSharedText,
    retrievedEvidencePacket: params.retrievedEvidencePacket,
  });
  const sentenceParts = normalizeText(params.currentSharedText)
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  const nearAgreedTerms = uniqueText(
    sentenceParts.filter((entry) => /\b(?:agreed|accepted|confirmed|set at|earned after|applies for|finalized)\b/i.test(entry)),
  ).slice(0, 6);
  const blockingTerms = uniqueText(
    sentenceParts.filter((entry) => /\b(?:remains open|still unresolved|cannot proceed|cannot sign|before signature|requires approval|still needs)\b/i.test(entry)),
  ).slice(0, 6);
  return {
    ...context,
    ...(deltaAnalysis ? { delta_analysis: deltaAnalysis } : {}),
    current_state_deal_model: {
      near_agreed_terms: nearAgreedTerms,
      blocking_terms: blockingTerms,
    },
  } satisfies MediationRoundContext;
}

export function buildMediationRoundContext(params: {
  bilateralRoundNumber: number;
  priorBilateralRoundId?: string | null;
  priorReport?: Record<string, unknown> | null;
}) {
  const bilateralRoundNumber = clampPositiveInteger(params.bilateralRoundNumber, 1);
  const priorReport = toObject(params.priorReport);
  if (bilateralRoundNumber <= 1) {
    return {
      current_bilateral_round_number: 1,
    } satisfies MediationRoundContext;
  }

  const priorReviewSummary = buildPublicSafePriorReviewSummary({
    priorBilateralRoundId: params.priorBilateralRoundId,
    priorReport,
  });

  return {
    current_bilateral_round_number: bilateralRoundNumber,
    ...(asText(params.priorBilateralRoundId)
      ? { prior_bilateral_round_id: asText(params.priorBilateralRoundId) }
      : {}),
    ...(clampPositiveInteger(priorReport.bilateral_round_number, 0)
      ? { prior_bilateral_round_number: clampPositiveInteger(priorReport.bilateral_round_number, 0) }
      : {}),
    ...(normalizeText(priorReport.primary_insight)
      ? { prior_primary_insight: normalizeText(priorReport.primary_insight) }
      : {}),
    ...(normalizeText(priorReport.fit_level)
      ? { prior_fit_level: normalizeText(priorReport.fit_level).toLowerCase() }
      : {}),
    ...(clampConfidence(priorReport.confidence_0_1) !== undefined
      ? { prior_confidence_0_1: clampConfidence(priorReport.confidence_0_1) }
      : {}),
    ...(normalizeProgressArray(priorReport.remaining_deltas || priorReport.missing, 6).length > 0
      ? { prior_missing: normalizeProgressArray(priorReport.remaining_deltas || priorReport.missing, 6) }
      : {}),
    ...(normalizeProgressArray(
      toObject(priorReport.negotiation_analysis).bridgeability_notes,
      4,
    ).length > 0
      ? {
          prior_bridgeability_notes: normalizeProgressArray(
            toObject(priorReport.negotiation_analysis).bridgeability_notes,
            4,
          ),
        }
      : {}),
    ...(normalizeProgressArray(
      toObject(priorReport.negotiation_analysis).critical_incompatibilities,
      4,
    ).length > 0
      ? {
          prior_critical_incompatibilities: normalizeProgressArray(
            toObject(priorReport.negotiation_analysis).critical_incompatibilities,
            4,
          ),
        }
      : {}),
    ...(normalizeText(priorReport.delta_summary)
      ? { prior_delta_summary: normalizeText(priorReport.delta_summary) }
      : {}),
    ...(normalizeMovementDirection(priorReport.movement_direction)
      ? { prior_movement_direction: normalizeMovementDirection(priorReport.movement_direction) }
      : {}),
    prior_review_summary: priorReviewSummary,
  } satisfies MediationRoundContext;
}

export function normalizeStoredMediationProgress(value: unknown) {
  const raw = toObject(value);
  const bilateralRoundNumber = clampPositiveInteger(raw.bilateral_round_number, 0);
  const priorBilateralRoundId = asText(raw.prior_bilateral_round_id) || null;
  const priorBilateralRoundNumber = clampPositiveInteger(raw.prior_bilateral_round_number, 0);
  const deltaSummary = normalizeText(raw.delta_summary);
  const resolvedSinceLastRound = normalizeProgressArray(raw.resolved_since_last_round);
  const remainingDeltas = normalizeProgressArray(raw.remaining_deltas || raw.missing);
  const newOpenIssues = normalizeProgressArray(raw.new_open_issues);
  const movementDirection = normalizeMovementDirection(raw.movement_direction);

  if (
    !bilateralRoundNumber &&
    !priorBilateralRoundId &&
    !deltaSummary &&
    resolvedSinceLastRound.length === 0 &&
    remainingDeltas.length === 0 &&
    newOpenIssues.length === 0 &&
    !movementDirection
  ) {
    return null;
  }

  return {
    ...(bilateralRoundNumber ? { bilateral_round_number: bilateralRoundNumber } : {}),
    ...(priorBilateralRoundId ? { prior_bilateral_round_id: priorBilateralRoundId } : {}),
    ...(priorBilateralRoundNumber ? { prior_bilateral_round_number: priorBilateralRoundNumber } : {}),
    ...(deltaSummary ? { delta_summary: deltaSummary } : {}),
    ...(resolvedSinceLastRound.length > 0 ? { resolved_since_last_round: resolvedSinceLastRound } : {}),
    ...(remainingDeltas.length > 0 ? { remaining_deltas: remainingDeltas } : {}),
    ...(newOpenIssues.length > 0 ? { new_open_issues: newOpenIssues } : {}),
    ...(movementDirection ? { movement_direction: movementDirection } : {}),
  } satisfies StoredMediationProgressMetadata;
}

export function buildStoredMediationProgress(params: {
  currentMissing: unknown;
  generatedProgress?: unknown;
  currentNarrative?: unknown;
  currentSharedText?: unknown;
  priorSharedText?: unknown;
  mediationRoundContext?: MediationRoundContext;
}) {
  const generated = normalizeStoredMediationProgress(params.generatedProgress);
  const mediationRoundContext = params.mediationRoundContext;
  const deltaAnalysis = mediationRoundContext?.delta_analysis;
  const bilateralRoundNumber = clampPositiveInteger(
    mediationRoundContext?.current_bilateral_round_number,
    generated?.bilateral_round_number || 1,
  );
  const priorMissing = normalizeProgressArray(mediationRoundContext?.prior_missing, 6);
  const remainingDeltas =
    generated?.remaining_deltas && generated.remaining_deltas.length > 0
      ? generated.remaining_deltas
      : deltaAnalysis?.issue_changes
        ? uniqueText(
            deltaAnalysis.issue_changes
              .filter((issue) =>
                issue.current_status === 'partially_resolved' ||
                issue.current_status === 'narrowed' ||
                issue.current_status === 'unchanged' ||
                issue.current_status === 'regressed' ||
                issue.current_status === 'unclear',
              )
              .map((issue) => issue.label),
          ).slice(0, 6)
      : normalizeProgressArray(params.currentMissing, 6);

  const heuristicResolved = priorMissing.filter(
    (priorItem) => !remainingDeltas.some((currentItem) => itemsOverlap(priorItem, currentItem)),
  ).slice(0, 4);
  const heuristicNewOpenIssues = remainingDeltas.filter(
    (currentItem) => !priorMissing.some((priorItem) => itemsOverlap(priorItem, currentItem)),
  ).slice(0, 4);
  const inferredSummaryMovement = inferMovementDirectionFromSummary(generated?.delta_summary);
  const inferredNarrativeMovement = inferMovementDirectionFromNarrative(params.currentNarrative);
  const inferredSharedTextMovement = inferMovementDirectionFromSharedTextDelta({
    currentSharedText: params.currentSharedText,
    priorSharedText: params.priorSharedText,
  });
  const movementDirection =
    generated?.movement_direction ||
    deltaAnalysis?.movement_direction ||
    inferredSummaryMovement ||
    inferredNarrativeMovement ||
    inferredSharedTextMovement ||
    (bilateralRoundNumber > 1
      ? buildMovementDirection({
          priorMissing,
          remainingDeltas,
          resolvedSinceLastRound:
            generated?.resolved_since_last_round && generated.resolved_since_last_round.length > 0
              ? generated.resolved_since_last_round
              : heuristicResolved,
          newOpenIssues:
            generated?.new_open_issues && generated.new_open_issues.length > 0
              ? generated.new_open_issues
              : heuristicNewOpenIssues,
        })
      : undefined);
  const resolvedSinceLastRound =
    generated?.resolved_since_last_round && generated.resolved_since_last_round.length > 0
      ? generated.resolved_since_last_round
      : deltaAnalysis?.issue_changes
        ? uniqueText(
            deltaAnalysis.issue_changes
              .filter((issue) =>
                issue.current_status === 'resolved' ||
                issue.current_status === 'superseded' ||
                issue.current_status === 'no_longer_relevant',
              )
              .map((issue) => issue.label),
          ).slice(0, 4)
      : heuristicResolved;
  const newOpenIssues =
    generated?.new_open_issues && generated.new_open_issues.length > 0
      ? generated.new_open_issues
      : deltaAnalysis?.issue_changes
        ? uniqueText(
            deltaAnalysis.issue_changes
              .filter((issue) => issue.current_status === 'newly_introduced')
              .map((issue) => issue.label),
          ).slice(0, 4)
      : heuristicNewOpenIssues;
  const deltaSummary =
    generated?.delta_summary ||
    deltaAnalysis?.progress_summary ||
    (bilateralRoundNumber > 1
      ? buildDeltaSummary({
          movementDirection: movementDirection || 'stalled',
          resolvedSinceLastRound,
          remainingDeltas,
          newOpenIssues,
        })
      : '');

  return {
    bilateral_round_number: bilateralRoundNumber,
    ...(asText(mediationRoundContext?.prior_bilateral_round_id)
      ? { prior_bilateral_round_id: asText(mediationRoundContext?.prior_bilateral_round_id) }
      : {}),
    ...(clampPositiveInteger(mediationRoundContext?.prior_bilateral_round_number, 0)
      ? {
          prior_bilateral_round_number: clampPositiveInteger(
            mediationRoundContext?.prior_bilateral_round_number,
            0,
          ),
        }
      : {}),
    ...(bilateralRoundNumber > 1 && deltaSummary ? { delta_summary: deltaSummary } : {}),
    ...(bilateralRoundNumber > 1 && resolvedSinceLastRound.length > 0
      ? { resolved_since_last_round: resolvedSinceLastRound }
      : {}),
    ...(remainingDeltas.length > 0 ? { remaining_deltas: remainingDeltas } : {}),
    ...(bilateralRoundNumber > 1 && newOpenIssues.length > 0
      ? { new_open_issues: newOpenIssues }
      : {}),
    ...(bilateralRoundNumber > 1 && movementDirection
      ? { movement_direction: movementDirection }
      : {}),
  } satisfies StoredMediationProgressMetadata;
}
