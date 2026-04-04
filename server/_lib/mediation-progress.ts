export type MediationMovementDirection = 'converging' | 'stalled' | 'diverging';

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
  if (normalized === 'converging' || normalized === 'stalled' || normalized === 'diverging') {
    return normalized;
  }
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
  const bilateralRoundNumber = clampPositiveInteger(
    mediationRoundContext?.current_bilateral_round_number,
    generated?.bilateral_round_number || 1,
  );
  const priorMissing = normalizeProgressArray(mediationRoundContext?.prior_missing, 6);
  const remainingDeltas =
    generated?.remaining_deltas && generated.remaining_deltas.length > 0
      ? generated.remaining_deltas
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
      : heuristicResolved;
  const newOpenIssues =
    generated?.new_open_issues && generated.new_open_issues.length > 0
      ? generated.new_open_issues
      : heuristicNewOpenIssues;
  const deltaSummary =
    generated?.delta_summary ||
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
