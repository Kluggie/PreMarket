export const MEDIATION_CONTEXT_CHARS_PER_TOKEN = 4;
export const MEDIATION_REVIEW_EFFECTIVE_INPUT_BUDGET_TOKENS = 20_000;
export const MEDIATION_REVIEW_OUTPUT_RESERVE_TOKENS = 6_144;
export const MEDIATION_RETRIEVAL_MAX_ITEMS = 10;
export const MEDIATION_RETRIEVAL_MAX_EXCERPT_CHARS = 760;
export const MEDIATION_RETRIEVAL_MAX_TOTAL_CHARS = 6_800;
export const MEDIATION_PROMPT_OVERHEAD_BASE_TOKENS = 450;
export const MEDIATION_PROMPT_OVERHEAD_PRIOR_ROUNDS_TOKENS = 150;
export const MEDIATION_PROMPT_OVERHEAD_RETRIEVAL_TOKENS = 150;
export const MEDIATION_PROMPT_OVERHEAD_SUMMARY_TOKENS = 150;

export const MEDIATION_CAPACITY_BANDS = [
  { label: 'Very Light', threshold: 0.10, labelColor: 'text-emerald-600', filledColor: 'bg-emerald-400' },
  { label: 'Light', threshold: 0.25, labelColor: 'text-emerald-600', filledColor: 'bg-emerald-400' },
  { label: 'Moderate', threshold: 0.50, labelColor: 'text-blue-600', filledColor: 'bg-blue-400' },
  { label: 'Heavy', threshold: 0.75, labelColor: 'text-amber-600', filledColor: 'bg-amber-500' },
  { label: 'Very Heavy', threshold: 0.90, labelColor: 'text-orange-600', filledColor: 'bg-orange-500' },
  { label: 'Near Limit', threshold: Infinity, labelColor: 'text-red-600', filledColor: 'bg-red-500' },
];

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function countWords(value) {
  const text = asText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function estimateTokensFromText(value) {
  const text = asText(value);
  return text ? Math.ceil(text.length / MEDIATION_CONTEXT_CHARS_PER_TOKEN) : 0;
}

function toSafeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function getRecencyScore(candidate) {
  const roundNumber = toSafeInteger(candidate?.round_number || candidate?.roundNumber || 0, 0);
  if (roundNumber > 0) {
    return roundNumber * 10;
  }
  const updatedAt = Date.parse(candidate?.updated_at || candidate?.updatedAt || candidate?.created_at || candidate?.createdAt || '');
  if (Number.isFinite(updatedAt)) {
    return Math.floor(updatedAt / 1000);
  }
  return 0;
}

function getCandidatePriority(candidate) {
  const sourceType = String(candidate?.source_type || candidate?.sourceType || '').trim().toLowerCase();
  if (sourceType === 'prior_mediation') return 5;
  if (sourceType === 'confidential_contribution') return 4;
  if (sourceType === 'shared_contribution') return 4;
  if (sourceType === 'primary_confidential_context') return 3;
  if (sourceType === 'primary_shared_context') return 3;
  return 1;
}

export function estimateRetrievedContextFromCandidates(candidates = []) {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const text = asText(candidate?.text);
      if (!text) {
        return null;
      }
      return {
        id: asText(candidate?.id) || `candidate:${index + 1}`,
        text,
        priority: getCandidatePriority(candidate),
        recencyScore: getRecencyScore(candidate),
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      right.priority - left.priority ||
      right.recencyScore - left.recencyScore ||
      left.id.localeCompare(right.id),
    );

  const selected = [];
  let characterBudgetUsed = 0;
  let omittedCount = 0;

  for (const candidate of normalized) {
    const excerptChars = Math.min(candidate.text.length, MEDIATION_RETRIEVAL_MAX_EXCERPT_CHARS);
    if (
      selected.length >= MEDIATION_RETRIEVAL_MAX_ITEMS ||
      characterBudgetUsed + excerptChars > MEDIATION_RETRIEVAL_MAX_TOTAL_CHARS
    ) {
      omittedCount += 1;
      continue;
    }
    selected.push(candidate);
    characterBudgetUsed += excerptChars;
  }

  return {
    retrievedChunkCount: selected.length,
    retrievedContextTokens: Math.ceil(characterBudgetUsed / MEDIATION_CONTEXT_CHARS_PER_TOKEN),
    omittedRetrievedChunkCount: omittedCount,
  };
}

export function getCapacityBand(usageRatio) {
  const normalizedRatio = Number.isFinite(Number(usageRatio))
    ? Math.max(0, Number(usageRatio))
    : 0;
  return MEDIATION_CAPACITY_BANDS.find((band) => normalizedRatio < band.threshold) || MEDIATION_CAPACITY_BANDS[MEDIATION_CAPACITY_BANDS.length - 1];
}

function normalizeOmissions(omittedDueToCapacity) {
  if (!Array.isArray(omittedDueToCapacity)) {
    return [];
  }
  return omittedDueToCapacity
    .map((entry) => asText(entry))
    .filter(Boolean);
}

export function buildMediationContextEstimate(params = {}) {
  const visibleSharedText = asText(params.visibleSharedText);
  const visibleConfidentialText = asText(params.visibleConfidentialText);
  const directSharedText = asText(params.directSharedText);
  const directConfidentialText = asText(params.directConfidentialText);
  const priorRoundText = asText(params.priorRoundText);
  const summaryMemoryText = asText(params.summaryMemoryText);

  const currentBundleWords = countWords(visibleSharedText) + countWords(visibleConfidentialText);
  const visibleSharedTokens = estimateTokensFromText(visibleSharedText);
  const visibleConfidentialTokens = estimateTokensFromText(visibleConfidentialText);
  const currentBundleEstimatedTokens =
    visibleSharedTokens + visibleConfidentialTokens;

  const directSharedTokens =
    params.directSharedTokens !== undefined
      ? toSafeInteger(params.directSharedTokens)
      : estimateTokensFromText(directSharedText);
  const directConfidentialTokens =
    params.directConfidentialTokens !== undefined
      ? toSafeInteger(params.directConfidentialTokens)
      : estimateTokensFromText(directConfidentialText);
  const priorRoundTokens =
    params.priorRoundTokens !== undefined
      ? toSafeInteger(params.priorRoundTokens)
      : estimateTokensFromText(priorRoundText);
  const summaryMemoryTokens =
    params.summaryMemoryTokens !== undefined
      ? toSafeInteger(params.summaryMemoryTokens)
      : estimateTokensFromText(summaryMemoryText);

  const retrievedChunkCount =
    params.retrievedChunkCount !== undefined ? toSafeInteger(params.retrievedChunkCount) : 0;
  const retrievedContextTokens =
    params.retrievedContextTokens !== undefined ? toSafeInteger(params.retrievedContextTokens) : 0;
  const initialProposalContextIncluded = Boolean(params.initialProposalContextIncluded);
  const priorRoundsConsidered =
    params.priorRoundsConsidered !== undefined
      ? toSafeInteger(params.priorRoundsConsidered)
      : params.includedPriorRounds !== undefined
        ? toSafeInteger(params.includedPriorRounds)
        : 0;
  const previousReviewsConsidered =
    params.previousReviewsConsidered !== undefined
      ? toSafeInteger(params.previousReviewsConsidered)
      : 0;
  const hasPriorContextBeyondBaseline =
    priorRoundsConsidered > 0 || previousReviewsConsidered > 0;

  const promptOverheadTokens =
    params.promptOverheadTokens !== undefined
      ? toSafeInteger(params.promptOverheadTokens)
      : MEDIATION_PROMPT_OVERHEAD_BASE_TOKENS +
        (hasPriorContextBeyondBaseline ? MEDIATION_PROMPT_OVERHEAD_PRIOR_ROUNDS_TOKENS : 0) +
        (retrievedChunkCount > 0 ? MEDIATION_PROMPT_OVERHEAD_RETRIEVAL_TOKENS : 0) +
        (summaryMemoryTokens > 0 ? MEDIATION_PROMPT_OVERHEAD_SUMMARY_TOKENS : 0);

  const outputReserveTokens =
    params.outputReserveTokens !== undefined
      ? toSafeInteger(params.outputReserveTokens)
      : MEDIATION_REVIEW_OUTPUT_RESERVE_TOKENS;
  const effectiveContextBudgetTokens =
    params.effectiveContextBudgetTokens !== undefined
      ? Math.max(1, toSafeInteger(params.effectiveContextBudgetTokens, 1))
      : MEDIATION_REVIEW_EFFECTIVE_INPUT_BUDGET_TOKENS;

  const totalEstimatedInputTokens =
    directSharedTokens +
    directConfidentialTokens +
    retrievedContextTokens +
    summaryMemoryTokens +
    promptOverheadTokens;

  const usageRatio = totalEstimatedInputTokens / effectiveContextBudgetTokens;
  const capacityBandMatch = getCapacityBand(usageRatio);
  const capacityBand = {
    label: capacityBandMatch.label,
    labelColor: capacityBandMatch.labelColor,
    filledColor: capacityBandMatch.filledColor,
  };
  const omissions = normalizeOmissions(params.omittedDueToCapacity);

  return {
    currentBundleWords,
    currentBundleEstimatedTokens,
    visibleSharedTokens,
    visibleConfidentialTokens,
    directSharedTokens,
    directConfidentialTokens,
    priorRoundTokens,
    retrievedContextTokens,
    summaryMemoryTokens,
    promptOverheadTokens,
    outputReserveTokens,
    totalEstimatedInputTokens,
    effectiveContextBudgetTokens,
    usageRatio,
    capacityLabel: capacityBandMatch.label,
    capacityBand,
    omittedDueToCapacity: omissions,
    omittedDueToCapacityCount: omissions.length,
    initialProposalContextIncluded,
    priorRoundsConsidered,
    includedPriorRounds: priorRoundsConsidered,
    previousReviewsConsidered,
    retrievedChunkCount,
    retrievedContextChunks: retrievedChunkCount,
    estimatorMode: asText(params.estimatorMode) || 'heuristic',
  };
}

export function buildBundleOnlyContextEstimate(params = {}) {
  return buildMediationContextEstimate({
    visibleSharedText: params.sharedText,
    visibleConfidentialText: params.confidentialText,
    directSharedText: params.sharedText,
    directConfidentialText: params.confidentialText,
    priorRoundText: '',
    summaryMemoryText: '',
    retrievedChunkCount: 0,
    retrievedContextTokens: 0,
    initialProposalContextIncluded: false,
    priorRoundsConsidered: 0,
    previousReviewsConsidered: 0,
    omittedDueToCapacity: [],
    estimatorMode: 'bundle_only',
  });
}
