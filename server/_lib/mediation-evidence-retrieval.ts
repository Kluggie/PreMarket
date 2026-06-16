import { sanitizeUserInput } from './vertex-input-sanitizer.js';
import type { MediationRoundContext } from './mediation-progress.js';
import type {
  MediationEvidenceCandidate,
  MediationEvidenceSourceType,
  ProposalFactSheet,
  RetrievedMediationEvidenceItem,
  RetrievedMediationEvidencePacket,
} from './vertex-evaluation-v2-types.js';

export const MEDIATION_EVIDENCE_MAX_ITEMS = 10;
export const MEDIATION_EVIDENCE_MAX_EXCERPT_CHARS = 760;
export const MEDIATION_EVIDENCE_MAX_TOTAL_CHARS = 6_800;

const COMMERCIAL_TERM_GROUPS: Array<{ label: string; patterns: string[]; weight: number }> = [
  {
    label: 'economics',
    patterns: [
      'price', 'pricing', 'fee', 'fees', 'commission', 'revenue share', 'payment',
      'milestone payment', 'subscription', 'valuation', 'equity', 'rent', 'deposit',
      'minimum order', 'unit price', 'royalty',
    ],
    weight: 5,
  },
  {
    label: 'customer_attribution',
    patterns: [
      'referral', 'attribution', 'lead ownership', 'client protection', 'non-circumvention',
      'customer ownership', 'customer handoff', 'bypass', 'direct sell',
    ],
    weight: 6,
  },
  {
    label: 'rights_and_control',
    patterns: [
      'exclusivity', 'semi-exclusivity', 'approval', 'control rights', 'governance',
      'ownership', 'board', 'territory', 'permitted use', 'subletting',
    ],
    weight: 5,
  },
  {
    label: 'performance_and_timing',
    patterns: [
      'pilot', 'success criteria', 'performance threshold', 'renewal', 'expansion',
      'deadline', 'start date', 'term', 'timeline', 'closing condition', 'earnout',
      'lead time', 'notice period',
    ],
    weight: 4,
  },
  {
    label: 'obligations_and_risk',
    patterns: [
      'implementation', 'onboarding', 'training', 'support', 'sla', 'warranty',
      'indemnity', 'liability', 'dependency', 'deliverable', 'acceptance criteria',
      'change control', 'maintenance', 'repairs', 'resourcing',
    ],
    weight: 4,
  },
  {
    label: 'negotiation_gap',
    patterns: [
      'unresolved', 'unclear', 'concern', 'disagree', 'cannot accept', 'must',
      'required', 'conditional', 'subject to', 'tbd', 'to be agreed', 'renegotiation',
    ],
    weight: 5,
  },
];

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'being',
  'between', 'both', 'could', 'does', 'each', 'from', 'have', 'into', 'more',
  'most', 'must', 'other', 'over', 'same', 'should', 'some', 'such', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'under', 'very', 'what', 'when', 'where', 'which', 'while', 'will',
  'with', 'would',
]);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpaces(value: unknown) {
  return sanitizeUserInput(value).replace(/\s+/g, ' ').trim();
}

function safeIsoDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as Date | string | number);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeForDedup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return new Set(
    normalizeForDedup(value)
      .split(' ')
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function splitEvidenceText(value: string) {
  const normalized = sanitizeUserInput(value).replace(/\r/g, '').trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n{2,}|(?:\n\s*[-*]\s+)|(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((entry) => normalizeSpaces(entry))
    .filter((entry) => entry.length >= 24);
  return paragraphs.length ? paragraphs : [normalizeSpaces(normalized)];
}

function factSheetQueryText(
  factSheet: ProposalFactSheet,
  mediationRoundContext?: MediationRoundContext,
) {
  const continuityText = mediationRoundContext?.prior_review_summary
    ? [
        ...mediationRoundContext.prior_review_summary.prior_open_questions.flatMap((issue) => [
          issue.label,
          issue.question || '',
        ]),
        ...mediationRoundContext.prior_review_summary.prior_unresolved_issues.flatMap((issue) => [
          issue.label,
          issue.question || '',
        ]),
      ]
    : [];
  return normalizeSpaces([
    factSheet.project_goal || '',
    ...factSheet.scope_deliverables,
    factSheet.timeline.start || '',
    factSheet.timeline.duration || '',
    ...factSheet.timeline.milestones,
    ...factSheet.constraints,
    ...factSheet.success_criteria_kpis,
    ...factSheet.vendor_preferences,
    ...factSheet.assumptions,
    ...factSheet.risks.map((entry) => entry.risk),
    ...factSheet.open_questions,
    ...factSheet.missing_info,
    ...continuityText,
  ].join(' '));
}

function continuityQueryText(mediationRoundContext?: MediationRoundContext) {
  const summary = mediationRoundContext?.prior_review_summary;
  if (!summary) return '';
  return normalizeSpaces([
    ...summary.prior_open_questions.flatMap((issue) => [issue.label, issue.question || '']),
    ...summary.prior_unresolved_issues.flatMap((issue) => [issue.label, issue.question || '']),
  ].join(' '));
}

function extractCommercialTerms(text: string) {
  const lower = text.toLowerCase();
  return COMMERCIAL_TERM_GROUPS
    .filter((group) => group.patterns.some((pattern) => lower.includes(pattern)))
    .map((group) => group.label);
}

function sourceWeight(sourceType: MediationEvidenceSourceType) {
  if (sourceType === 'shared_contribution' || sourceType === 'confidential_contribution') return 14;
  if (sourceType === 'prior_mediation') return 8;
  return 6;
}

function recencyWeight(candidate: MediationEvidenceCandidate, latestRound: number) {
  const round = Number(candidate.round_number || 0);
  if (round > 0 && latestRound > 0) {
    return Math.max(0, 8 - Math.max(0, latestRound - round) * 2);
  }
  return 0;
}

function bestExcerpt(candidate: MediationEvidenceCandidate, queryText: string) {
  const segments = splitEvidenceText(candidate.text);
  const ranked = segments
    .map((segment, index) => {
      const terms = extractCommercialTerms(segment);
      const termScore = COMMERCIAL_TERM_GROUPS.reduce((total, group) => {
        const hits = group.patterns.filter((pattern) => segment.toLowerCase().includes(pattern)).length;
        return total + Math.min(2, hits) * group.weight;
      }, 0);
      return {
        segment,
        index,
        terms,
        score: termScore + tokenOverlap(segment, queryText) * 20,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = ranked.slice(0, 2).sort((left, right) => left.index - right.index);
  let excerpt = selected.map((entry) => entry.segment).join(' ');
  if (excerpt.length > MEDIATION_EVIDENCE_MAX_EXCERPT_CHARS) {
    const marker = ' [TRUNCATED]';
    const contentLimit = MEDIATION_EVIDENCE_MAX_EXCERPT_CHARS - marker.length;
    const cut = excerpt.lastIndexOf(' ', contentLimit);
    excerpt = `${excerpt.slice(0, cut > 560 ? cut : contentLimit).trim()}${marker}`;
  }
  return {
    excerpt,
    extractedTerms: [...new Set(selected.flatMap((entry) => entry.terms))],
    segmentScore: selected.reduce((total, entry) => total + entry.score, 0),
  };
}

function buildTitle(candidate: MediationEvidenceCandidate, excerpt: string) {
  const explicit = normalizeSpaces(candidate.title_or_summary);
  if (explicit) return explicit.slice(0, 180);
  const firstSentence = excerpt.split(/(?<=[.!?])\s+/)[0] || excerpt;
  return firstSentence.slice(0, 180);
}

function buildVersionInfo(candidate: MediationEvidenceCandidate) {
  const parts = [
    candidate.version_info,
    candidate.round_number ? `round ${candidate.round_number}` : '',
    candidate.updated_at ? `updated ${candidate.updated_at}` : candidate.created_at ? `created ${candidate.created_at}` : '',
  ].filter(Boolean);
  return parts.join('; ');
}

function normalizeCandidate(candidate: MediationEvidenceCandidate, index: number) {
  const text = normalizeSpaces(candidate.text);
  if (!text) return null;
  return {
    ...candidate,
    id: normalizeSpaces(candidate.id) || `evidence:${index + 1}`,
    source_label: normalizeSpaces(candidate.source_label),
    source_role: normalizeSpaces(candidate.source_role),
    text,
    limitations: Array.isArray(candidate.limitations)
      ? candidate.limitations.map(normalizeSpaces).filter(Boolean).slice(0, 4)
      : [],
  };
}

function fallbackCandidates(params: {
  sharedText: string;
  confidentialText: string;
}): MediationEvidenceCandidate[] {
  return [
    {
      id: 'primary:shared',
      source_type: 'primary_shared_context',
      source_label: 'Current shared deal context',
      source_role: 'both_parties',
      visibility: 'shared',
      text: params.sharedText,
      title_or_summary: 'Current shared deal context',
      party_or_side: 'shared',
      version_info: 'current evaluation input',
      limitations: ['Source attribution was unavailable; this item represents the bundled shared context.'],
    },
    {
      id: 'primary:confidential',
      source_type: 'primary_confidential_context',
      source_label: 'Current confidential context',
      source_role: 'both_parties',
      visibility: 'confidential',
      text: params.confidentialText,
      title_or_summary: 'Current confidential context',
      party_or_side: 'confidential',
      version_info: 'current evaluation input',
      limitations: [
        'Confidential evidence may calibrate conclusions but must not be quoted or exposed in shared output.',
      ],
    },
  ];
}

export function buildEvidenceCandidatesFromContributions(
  entries: unknown[],
): MediationEvidenceCandidate[] {
  return (Array.isArray(entries) ? entries : [])
    .map((raw: any, index) => {
      const visibility = asText(raw?.visibility).toLowerCase() === 'confidential'
        ? 'confidential'
        : 'shared';
      const payload = raw?.contentPayload && typeof raw.contentPayload === 'object'
        ? raw.contentPayload
        : {};
      const text = asText(payload.text || payload.notes);
      if (!text) return null;
      const files = Array.isArray(payload.files)
        ? payload.files.map((file: any) => asText(file?.filename || file?.name)).filter(Boolean)
        : [];
      const sourceLabel =
        asText(payload.label) ||
        `${visibility === 'confidential' ? 'Confidential to' : 'Shared by'} ${asText(raw?.authorLabel) || asText(raw?.authorRole) || 'party'}`;
      return {
        id: asText(raw?.id) || `contribution:${visibility}:${index + 1}`,
        source_type:
          visibility === 'confidential' ? 'confidential_contribution' : 'shared_contribution',
        source_label: sourceLabel,
        source_role: asText(raw?.authorRole) || 'unknown',
        visibility,
        text,
        title_or_summary: sourceLabel,
        party_or_side: asText(raw?.authorRole) || undefined,
        round_number: Number(raw?.roundNumber || 0) || null,
        version_info: asText(raw?.sourceKind) || undefined,
        created_at: safeIsoDate(raw?.createdAt),
        updated_at: safeIsoDate(raw?.updatedAt),
        file_names: files,
        limitations: files.length > 0
          ? [`Uploaded file metadata available: ${files.join(', ')}. Excerpt reflects text already extracted into the contribution.`]
          : [],
      } satisfies MediationEvidenceCandidate;
    })
    .filter((entry): entry is MediationEvidenceCandidate => Boolean(entry));
}

export function buildPriorMediationEvidenceCandidate(params: {
  id?: string | null;
  roundNumber?: number | null;
  report?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
}): MediationEvidenceCandidate | null {
  const report = params.report || {};
  const why = Array.isArray(report.why) ? report.why.map(asText).filter(Boolean) : [];
  const missing = Array.isArray(report.missing) ? report.missing.map(asText).filter(Boolean) : [];
  const text = normalizeSpaces([
    asText(report.primary_insight),
    ...why,
    ...missing.map((entry) => `Open issue: ${entry}`),
  ].join(' '));
  if (!text) return null;
  return {
    id: params.id ? `prior_mediation:${params.id}` : `prior_mediation:round_${params.roundNumber || 'unknown'}`,
    source_type: 'prior_mediation',
    source_label: 'Prior bilateral mediation review',
    source_role: 'mediator',
    visibility: 'internal_derived',
    text,
    title_or_summary: asText(report.report_title) || 'Prior bilateral mediation review',
    party_or_side: 'bilateral',
    round_number: Number(params.roundNumber || 0) || null,
    version_info: 'prior generated mediation output',
    created_at: safeIsoDate(params.createdAt),
    limitations: [
      'Derived from a prior model-generated review; use only for issue continuity and verify against current source contributions.',
    ],
  };
}

export function retrieveMediationEvidence(params: {
  factSheet: ProposalFactSheet;
  sharedText: string;
  confidentialText: string;
  candidates?: MediationEvidenceCandidate[];
  generatedAt?: string;
  maxItems?: number;
  maxTotalChars?: number;
  mediationRoundContext?: MediationRoundContext;
}): RetrievedMediationEvidencePacket {
  const maxItems = Math.max(1, Math.min(20, Number(params.maxItems || MEDIATION_EVIDENCE_MAX_ITEMS)));
  const maxTotalChars = Math.max(
    1_000,
    Math.min(20_000, Number(params.maxTotalChars || MEDIATION_EVIDENCE_MAX_TOTAL_CHARS)),
  );
  const suppliedCandidates = Array.isArray(params.candidates)
    ? params.candidates.map(normalizeCandidate).filter(Boolean)
    : [];
  const usingFallback = suppliedCandidates.length === 0;
  const candidates = usingFallback
    ? fallbackCandidates(params).map(normalizeCandidate).filter(Boolean)
    : suppliedCandidates;
  const queryText = factSheetQueryText(params.factSheet, params.mediationRoundContext);
  const continuityQuery = continuityQueryText(params.mediationRoundContext);
  const latestRound = candidates.reduce(
    (max, candidate) => Math.max(max, Number(candidate?.round_number || 0)),
    0,
  );
  let lowRelevanceOmittedCount = 0;

  const ranked = candidates
    .map((candidate) => {
      if (!candidate) return null;
      const selected = bestExcerpt(candidate, queryText);
      if (!selected.excerpt) return null;
      const concreteSignals = (selected.excerpt.match(
        /(?:[$€£]\s?\d|\b\d+(?:\.\d+)?%|\b\d+\s*(?:day|week|month|year|seat|user|customer|lead)s?\b)/gi,
      ) || []).length;
      const hasMeaningfulSignal =
        usingFallback ||
        selected.extractedTerms.length > 0 ||
        selected.segmentScore >= 4 ||
        concreteSignals > 0;
      if (!hasMeaningfulSignal) {
        lowRelevanceOmittedCount += 1;
        return null;
      }
      const score =
        sourceWeight(candidate.source_type) +
        recencyWeight(candidate, latestRound) +
        Math.min(18, selected.segmentScore) +
        Math.min(8, concreteSignals * 2) +
        (candidate.file_names?.length ? 2 : 0);
      const includeReasons = [
        selected.extractedTerms.length
          ? `contains deal-specific ${selected.extractedTerms.join(', ')} evidence`
          : 'provides current deal context',
        Number(candidate.round_number || 0) === latestRound && latestRound > 0
          ? 'latest available round'
          : '',
        concreteSignals > 0 ? 'contains concrete commercial terms or timing' : '',
        continuityQuery &&
        tokenOverlap(selected.excerpt, continuityQuery) >= 0.25
          ? 'addresses a prior unresolved mediation issue'
          : '',
      ].filter(Boolean);
      const limitations = [...(candidate.limitations || [])];
      if (
        latestRound > 0 &&
        Number(candidate.round_number || 0) > 0 &&
        Number(candidate.round_number || 0) < latestRound
      ) {
        limitations.push(
          'Older-round source: treat conflicting terms as possibly stale or superseded by the latest shared material.',
        );
      }
      if (candidate.visibility === 'confidential') {
        limitations.push(
          'Confidential: use only to calibrate internal reasoning; do not quote, cite, or reveal the underlying detail publicly.',
        );
      }
      return {
        id: candidate.id,
        source_type: candidate.source_type,
        source_label: candidate.source_label,
        source_role: candidate.source_role,
        visibility: candidate.visibility,
        relevance_score: Math.round(Math.min(100, score) * 100) / 100,
        title_or_summary: buildTitle(candidate, selected.excerpt),
        excerpt: selected.excerpt,
        extracted_terms: selected.extractedTerms,
        dates_or_version_info: buildVersionInfo(candidate) || undefined,
        party_or_side: candidate.party_or_side,
        confidence: candidate.source_type === 'prior_mediation' ? 0.62 : 0.9,
        include_reason: includeReasons.join('; '),
        limitations: [...new Set(limitations)].slice(0, 5),
      } satisfies RetrievedMediationEvidenceItem;
    })
    .filter((entry): entry is RetrievedMediationEvidenceItem => Boolean(entry))
    .sort((left, right) =>
      right.relevance_score - left.relevance_score ||
      left.id.localeCompare(right.id),
    );

  const selected: RetrievedMediationEvidenceItem[] = [];
  let characterBudgetUsed = 0;
  let deduplicatedCount = 0;
  let budgetOmittedCount = 0;
  for (const item of ranked) {
    const duplicate = selected.some(
      (existing) =>
        normalizeForDedup(existing.excerpt) === normalizeForDedup(item.excerpt) ||
        tokenOverlap(existing.excerpt, item.excerpt) >= 0.86,
    );
    if (duplicate) {
      deduplicatedCount += 1;
      continue;
    }
    if (selected.length >= maxItems || characterBudgetUsed + item.excerpt.length > maxTotalChars) {
      budgetOmittedCount += 1;
      continue;
    }
    selected.push(item);
    characterBudgetUsed += item.excerpt.length;
  }

  const warnings: string[] = [];
  if (usingFallback) warnings.push('structured_source_provenance_unavailable');
  if (selected.length === 0) warnings.push('no_retrievable_evidence');
  if (lowRelevanceOmittedCount > 0) {
    warnings.push(`excluded_${lowRelevanceOmittedCount}_low_relevance_items`);
  }
  if (deduplicatedCount > 0) warnings.push(`deduplicated_${deduplicatedCount}_overlapping_items`);
  if (budgetOmittedCount > 0) warnings.push(`evidence_budget_omitted_${budgetOmittedCount}_items`);

  return {
    retrieval_strategy: usingFallback
      ? 'primary_context_fallback_v1'
      : 'heuristic_commercial_terms_v1',
    evidence_count: selected.length,
    omitted_evidence_count: candidates.length - selected.length,
    token_budget_used: Math.ceil(characterBudgetUsed / 4),
    character_budget_used: characterBudgetUsed,
    retrieval_warnings: warnings,
    generated_at: params.generatedAt || new Date().toISOString(),
    items: selected,
  };
}

export function retrieveMediationEvidenceSafely(
  params: Parameters<typeof retrieveMediationEvidence>[0],
  retriever: typeof retrieveMediationEvidence = retrieveMediationEvidence,
): RetrievedMediationEvidencePacket {
  try {
    return retriever(params);
  } catch {
    return {
      retrieval_strategy: Array.isArray(params.candidates) && params.candidates.length > 0
        ? 'heuristic_commercial_terms_v1'
        : 'primary_context_fallback_v1',
      evidence_count: 0,
      omitted_evidence_count: Array.isArray(params.candidates) ? params.candidates.length : 0,
      token_budget_used: 0,
      character_budget_used: 0,
      retrieval_warnings: ['retrieval_failed'],
      generated_at: params.generatedAt || new Date().toISOString(),
      items: [],
    };
  }
}
