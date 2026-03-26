/**
 * evaluation-context-budget.ts
 *
 * Additive helper module for controlling total evaluation payload size
 * and providing convergence-aware prior-round context to the AI model.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * Budget + convergence functions (`buildBudgetedContext`, `buildConvergenceDigest`)
 * are consumed ONLY by the shared-report multi-round recipient re-evaluation
 * flow (`server/routes/shared-report/[token]/evaluate.ts`).
 *
 * `preflightPromptCheck` is a universal utility — it is also imported by
 * the V2 engine (`server/_lib/vertex-evaluation-v2.ts`) to verify the final
 * assembled prompt before each Vertex call.
 *
 * Neither category is used by, and intentionally does NOT apply to:
 *   - The proposer-side document comparison evaluation
 *     (`server/routes/document-comparisons/[id]/evaluate.ts`)
 *   - The edge-function evaluation paths (`functions/`)
 *   - Any V1 engine paths
 *
 * This scope limitation is deliberate. The proposer-side flow has no
 * exchange history and no convergence concern. Extending budget/convergence
 * helpers to other flows should be a separate, tested migration.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Design goals:
 * - Pure functions — no side effects, no DB access, no model calls.
 * - Backward-compatible — consumed only by callers that opt in.
 * - Small payloads pass through unchanged (no-op path).
 * - Large payloads are deterministically trimmed in a safe priority order.
 * - Prior-round question tracking enables convergence without redesigning
 *   the evaluation pipeline.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The V2 engine truncates shared + confidential to 16 000 chars each.
 * We budget slightly below that to leave headroom for structural markers.
 */
export const MAX_SHARED_BUDGET = 16_000;
export const MAX_CONFIDENTIAL_BUDGET = 16_000;

/**
 * When the combined evaluation payload (history preamble + current text)
 * is within this char count, no trimming is applied at all.
 * Set to the sum of both ceilings so normal payloads are untouched.
 */
export const SAFE_TOTAL_CHARS = MAX_SHARED_BUDGET + MAX_CONFIDENTIAL_BUDGET;

/**
 * Per-round history snapshot budget — how many chars each prior round's
 * shared text is allowed to consume. Matches the existing
 * HISTORY_SNAPSHOT_MAX_CHARS constant in shared-report evaluate.ts.
 */
export const HISTORY_SNAPSHOT_BUDGET = 2_000;

/** Maximum prior rounds to include in context. */
export const MAX_HISTORY_ROUNDS = 4;

/**
 * Maximum characters to spend on the prior-questions convergence digest.
 * This is deliberately compact — a summary, not a replay.
 */
export const MAX_CONVERGENCE_DIGEST_CHARS = 1_500;

/** Maximum new questions the model may introduce per round. */
export const MAX_NEW_QUESTIONS_PER_ROUND = 3;

/** Maximum total open (unresolved) questions carried forward. */
export const MAX_OPEN_QUESTIONS_CARRIED = 8;

/**
 * Approximate characters-per-token ratio used for token preflight estimates.
 * Matches the CHARS_PER_TOKEN constant used elsewhere in the codebase
 * (src/config/aiLimits.js). A conservative estimate — slightly over-counting
 * tokens is safer than under-counting.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Soft token ceiling for the combined evaluation input (shared + confidential
 * + convergence digest). If the estimated token count exceeds this, the
 * budget helpers have already trimmed aggressively — this constant is
 * exposed for telemetry and preflight assertions downstream.
 *
 * Based on MAX_SHARED_BUDGET + MAX_CONFIDENTIAL_BUDGET + convergence digest
 * overhead ≈ 33 500 chars ≈ 8 375 tokens. We round up to 9 000 for safety.
 */
export const SOFT_TOKEN_CEILING = 9_000;

/**
 * Hard token ceiling for the fully assembled Pass B evaluation prompt
 * (system instructions + fact sheet JSON + convergence digest + input JSON).
 *
 * Normal prompts are ~10 000–16 000 tokens. This ceiling gives ~50% headroom
 * and catches runaway payloads before they reach Vertex. Set conservatively:
 * the Gemini context window is 1 M tokens, so this is a quality/cost guard,
 * not a hard limit guard.
 *
 * If the final assembled prompt exceeds this, `preflightPromptCheck` will
 * signal that a deterministic trim pass is needed.
 */
export const PROMPT_TOKEN_HARD_CEILING = 20_000;

/**
 * Minimum char budget an unresolved history round will receive under
 * budget pressure. Prevents unresolved context from being fully discarded.
 */
export const UNRESOLVED_ROUND_FLOOR = 200;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriorQuestion {
  /** The question text as it appeared in a prior missing[] entry. */
  text: string;
  /** The round number when this question was first asked. */
  firstAskedRound: number;
  /** Whether we consider this resolved (answered / addressed in a later round). */
  resolved: boolean;
  /** Optional: evidence that the question was addressed. */
  resolution?: string;
}

export interface ConvergenceDigest {
  /** Total evaluation rounds completed so far. */
  totalRounds: number;
  /** Questions that were resolved in prior rounds. */
  resolvedQuestions: PriorQuestion[];
  /** Questions still open / unresolved. */
  openQuestions: PriorQuestion[];
  /** Formatted text block to inject into the prompt. */
  digestText: string;
  /** Char length of the digest text. */
  digestChars: number;
}

export interface ExchangeRoundSnapshot {
  round: number;
  sharedTextSnapshot: string;
  missingQuestions: string[];
  /** Created date or ISO string from the prior run. */
  createdAt: Date | string;
}

export interface PreflightResult {
  /** Character count of the full prompt string. */
  promptChars: number;
  /** Estimated token count (promptChars / CHARS_PER_TOKEN_ESTIMATE). */
  estimatedPromptTokens: number;
  /** Whether the prompt exceeds PROMPT_TOKEN_HARD_CEILING. */
  overCeiling: boolean;
  /** The ceiling value used. */
  ceiling: number;
}

export interface BudgetResult {
  /** The shared text to send to the V2 engine (may include history preamble). */
  sharedText: string;
  /** The confidential text to send (may be trimmed). */
  confidentialText: string;
  /** Convergence digest to inject into the evaluation prompt. */
  convergenceDigest: ConvergenceDigest | null;
  /** Whether any trimming was applied. */
  wasTrimmed: boolean;
  /** Estimated token count (chars / CHARS_PER_TOKEN_ESTIMATE) for preflight. */
  estimatedTokens: number;
  /** Breakdown of char allocations for telemetry. */
  budget: {
    sharedInputChars: number;
    confidentialInputChars: number;
    historyChars: number;
    convergenceDigestChars: number;
    totalChars: number;
    trimmedFromShared: number;
    trimmedFromConfidential: number;
    trimmedFromHistory: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Deterministic text similarity check used to decide whether a prior
 * question has been "answered" by new shared text content.
 *
 * Uses keyword overlap rather than fuzzy matching — simple, predictable,
 * and avoids false positives.
 */

/** Common stopwords filtered out before keyword comparison. */
const STOPWORDS = new Set([
  'about', 'after', 'also', 'been', 'before', 'being', 'between',
  'both', 'could', 'does', 'each', 'even', 'from', 'have', 'into',
  'just', 'more', 'most', 'much', 'must', 'only', 'other', 'over',
  'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'very', 'what', 'when', 'where',
  'which', 'while', 'will', 'with', 'would', 'your',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

function keywordOverlap(a: string, b: string): { ratio: number; matchCount: number } {
  const setA = extractKeywords(a);
  const setB = extractKeywords(b);
  if (setA.size === 0 || setB.size === 0) return { ratio: 0, matchCount: 0 };
  let matches = 0;
  for (const word of setA) {
    if (setB.has(word)) matches += 1;
  }
  return { ratio: matches / Math.min(setA.size, setB.size), matchCount: matches };
}

/**
 * Check whether a question appears to have been addressed by the current
 * shared text. We require BOTH a high keyword overlap ratio AND a minimum
 * number of matched content keywords. This avoids false positives where a
 * short generic question happens to share a few common words with the text.
 *
 * Thresholds are deliberately conservative — it is safer to leave a question
 * open (the model can still decide to resolve it) than to incorrectly hide
 * it and lose convergence signal.
 */
export const RESOLUTION_OVERLAP_THRESHOLD = 0.65;
export const RESOLUTION_MIN_MATCHED_KEYWORDS = 3;

function isQuestionAddressedByText(question: string, sharedText: string): boolean {
  const { ratio, matchCount } = keywordOverlap(question, sharedText);
  return ratio >= RESOLUTION_OVERLAP_THRESHOLD && matchCount >= RESOLUTION_MIN_MATCHED_KEYWORDS;
}

/**
 * Deduplicate questions across rounds using keyword similarity.
 * If two questions overlap > 0.7, they are considered duplicates and only
 * the earliest is kept.
 */
const DEDUP_OVERLAP_THRESHOLD = 0.7;

function deduplicateQuestions(questions: PriorQuestion[]): PriorQuestion[] {
  const kept: PriorQuestion[] = [];
  for (const q of questions) {
    const isDupe = kept.some(
      (existing) => keywordOverlap(existing.text, q.text).ratio >= DEDUP_OVERLAP_THRESHOLD,
    );
    if (!isDupe) {
      kept.push(q);
    }
  }
  return kept;
}

// ─── Convergence digest builder ───────────────────────────────────────────────

/**
 * Build a convergence digest from prior evaluation rounds.
 *
 * This is the key enabler for AI convergence. By providing the model with
 * a compact summary of what was already asked and what has been resolved,
 * the model can focus on remaining gaps rather than re-asking everything.
 *
 * @param priorRounds - Snapshots of prior evaluation results (missing[] + shared text)
 * @param currentSharedText - The current round's shared text (used to detect resolution)
 * @returns A convergence digest, or null if there are no prior rounds
 */
export function buildConvergenceDigest(
  priorRounds: ExchangeRoundSnapshot[],
  currentSharedText: string,
): ConvergenceDigest | null {
  if (!priorRounds || priorRounds.length === 0) {
    return null;
  }

  // Step 1: Collect all questions from all prior rounds
  const allQuestions: PriorQuestion[] = [];
  for (const round of priorRounds) {
    for (const q of round.missingQuestions) {
      const text = asText(q);
      if (!text) continue;
      allQuestions.push({
        text,
        firstAskedRound: round.round,
        resolved: false,
      });
    }
  }

  // Step 2: Deduplicate across rounds
  const unique = deduplicateQuestions(allQuestions);

  // Step 3: Check each question against the current shared text for resolution
  const resolvedQuestions: PriorQuestion[] = [];
  const openQuestions: PriorQuestion[] = [];

  for (const q of unique) {
    if (isQuestionAddressedByText(q.text, currentSharedText)) {
      resolvedQuestions.push({
        ...q,
        resolved: true,
        resolution: 'Addressed in current shared text',
      });
    } else {
      openQuestions.push(q);
    }
  }

  // Step 4: Cap open questions to avoid unbounded growth
  const cappedOpen = openQuestions.slice(0, MAX_OPEN_QUESTIONS_CARRIED);

  // Step 5: Build the text digest
  const totalRounds = priorRounds.length;
  const lines: string[] = [
    `=== PRIOR EVALUATION CONVERGENCE CONTEXT ===`,
    `${totalRounds} prior evaluation round(s) have been completed.`,
    '',
  ];

  if (resolvedQuestions.length > 0) {
    lines.push(`RESOLVED (${resolvedQuestions.length} questions addressed — do NOT re-ask these):`);
    for (const q of resolvedQuestions.slice(0, 10)) {
      // Trim the question to save space — just the core ask
      const shortQ = q.text.length > 120 ? q.text.slice(0, 117) + '...' : q.text;
      lines.push(`  [R${q.firstAskedRound}] ✓ ${shortQ}`);
    }
    if (resolvedQuestions.length > 10) {
      lines.push(`  ... and ${resolvedQuestions.length - 10} more resolved.`);
    }
    lines.push('');
  }

  if (cappedOpen.length > 0) {
    lines.push(`STILL OPEN (${cappedOpen.length} questions remain unresolved — prioritize these):`);
    for (const q of cappedOpen) {
      const shortQ = q.text.length > 150 ? q.text.slice(0, 147) + '...' : q.text;
      lines.push(`  [R${q.firstAskedRound}] ✗ ${shortQ}`);
    }
    lines.push('');
  }

  if (resolvedQuestions.length > 0 && cappedOpen.length === 0) {
    lines.push('All prior questions have been addressed. If no new material gaps exist, move toward a decision.');
    lines.push('');
  }

  lines.push(`CONVERGENCE RULES:`);
  lines.push(`- Do NOT re-ask resolved questions unless new contradictory evidence appears.`);
  lines.push(`- Prioritize resolving the STILL OPEN questions above.`);
  lines.push(`- Introduce at most ${MAX_NEW_QUESTIONS_PER_ROUND} genuinely new questions this round.`);
  lines.push(`- If remaining open items are low-value or non-blocking, move toward a decision instead of expanding scope.`);
  lines.push(`=== END CONVERGENCE CONTEXT ===`);

  let digestText = lines.join('\n');

  // Trim if over budget
  if (digestText.length > MAX_CONVERGENCE_DIGEST_CHARS) {
    digestText = digestText.slice(0, MAX_CONVERGENCE_DIGEST_CHARS - 3) + '...';
  }

  return {
    totalRounds,
    resolvedQuestions,
    openQuestions: cappedOpen,
    digestText,
    digestChars: digestText.length,
  };
}

// ─── Budget-controlled context builder ────────────────────────────────────────

/**
 * Build size-controlled evaluation context from the raw inputs.
 *
 * For small payloads (within SAFE_TOTAL_CHARS), this is a no-op passthrough.
 * For large payloads, it deterministically trims in priority order:
 *
 * TRIMMING PRIORITY (highest priority = trimmed LAST):
 *   1. Current-round shared text — ALWAYS preserved first (up to MAX_SHARED_BUDGET).
 *      This is the user's latest contribution and must never be sacrificed for history.
 *   2. Confidential text — capped independently to MAX_CONFIDENTIAL_BUDGET.
 *   3. History from rounds with UNRESOLVED questions — kept longer so the model
 *      can see context for still-open blockers.
 *   4. History from rounds with ALL questions resolved — trimmed first since
 *      the convergence digest already summarises their outcome.
 *
 * The net effect: older, already-addressed exchange history is the first thing
 * shed when budget is tight, guaranteeing the newest current-round content and
 * any still-open context always win.
 *
 * @param params.currentSharedText - Current round's shared text (full)
 * @param params.confidentialText - Combined confidential bundle (full)
 * @param params.historyRounds - Prior exchange rounds (optional)
 * @param params.priorEvaluationRounds - Prior evaluation snapshots for convergence (optional)
 * @returns BudgetResult with trimmed/passthrough texts
 */
export function buildBudgetedContext(params: {
  currentSharedText: string;
  confidentialText: string;
  historyRounds?: Array<{ round: number; sharedTextSnapshot: string }>;
  priorEvaluationRounds?: ExchangeRoundSnapshot[];
}): BudgetResult {
  const currentShared = params.currentSharedText || '';
  const confidential = params.confidentialText || '';
  const historyRounds = params.historyRounds || [];
  const priorEvalRounds = params.priorEvaluationRounds || [];

  // Build convergence digest (independent of size budgeting)
  const convergenceDigest = buildConvergenceDigest(priorEvalRounds, currentShared);

  // If no history and both texts fit, passthrough with no changes
  const totalRaw = currentShared.length + confidential.length;
  if (historyRounds.length === 0 && totalRaw <= SAFE_TOTAL_CHARS) {
    return {
      sharedText: currentShared,
      confidentialText: confidential,
      convergenceDigest,
      wasTrimmed: false,
      estimatedTokens: Math.ceil(totalRaw / CHARS_PER_TOKEN_ESTIMATE),
      budget: {
        sharedInputChars: currentShared.length,
        confidentialInputChars: confidential.length,
        historyChars: 0,
        convergenceDigestChars: convergenceDigest?.digestChars || 0,
        totalChars: totalRaw,
        trimmedFromShared: 0,
        trimmedFromConfidential: 0,
        trimmedFromHistory: 0,
      },
    };
  }

  // ── Step 1: Reserve current-round shared text (highest priority) ───────
  // The user's latest shared content is ALWAYS preserved first.
  const currentSharedCapped = currentShared.slice(0, MAX_SHARED_BUDGET);

  // ── Step 2: Build history preamble with remaining budget ───────────────
  // History only gets whatever space remains after current text is reserved.
  let historyChars = 0;
  let trimmedFromHistory = 0;
  const historyBudget = Math.max(0, MAX_SHARED_BUDGET - currentSharedCapped.length);

  const roundCount = Math.min(historyRounds.length, MAX_HISTORY_ROUNDS);
  const recentRounds = historyRounds.slice(-roundCount);

  // Build a set of rounds whose questions are ALL resolved, so we can
  // give them less budget (the digest already summarises them).
  const resolvedRoundNumbers = new Set<number>();
  if (convergenceDigest) {
    // Collect rounds where every question was resolved
    const resolvedQRounds = new Set(convergenceDigest.resolvedQuestions.map((q) => q.firstAskedRound));
    const openQRounds = new Set(convergenceDigest.openQuestions.map((q) => q.firstAskedRound));
    for (const rn of resolvedQRounds) {
      if (!openQRounds.has(rn)) {
        resolvedRoundNumbers.add(rn);
      }
    }
  }

  let historyPreamble = '';
  if (recentRounds.length > 0 && historyBudget > 200) {
    // ── Dynamic compression policy ─────────────────────────────────────
    //
    // PRIORITY ORDER (trim first → trim last):
    //   1. Older resolved rounds — their outcome is already captured in the
    //      convergence digest, so the raw snapshot is the lowest-value input.
    //   2. Older unresolved rounds — still relevant but outweighed by the
    //      most-recent unresolved context.
    //   3. Newest unresolved round — gets a 15 % bonus because it represents
    //      the most current exchange state.
    //
    // COMPRESSION BEHAVIOUR:
    //   • NO pressure (totalDemand ≤ historyBudget):
    //       Every round gets its full content up to HISTORY_SNAPSHOT_BUDGET.
    //       Resolved rounds are NOT penalized.
    //   • MILD pressure (1 < ratio ≤ 2):
    //       Resolved rounds are mildly compressed via a linearly decreasing
    //       weight factor. Unresolved rounds keep weight 1.0.
    //   • HIGH pressure (ratio > 2):
    //       Resolved rounds are aggressively compressed (floor: 25 % weight).
    //       Unresolved rounds are protected by UNRESOLVED_ROUND_FLOOR.
    //
    // The policy is fully deterministic — no randomness, no LLM calls.

    // Compute what each round ideally wants (capped at HISTORY_SNAPSHOT_BUDGET).
    const demands: number[] = recentRounds.map(
      (r) => Math.min((r.sharedTextSnapshot || '').length, HISTORY_SNAPSHOT_BUDGET),
    );
    const totalDemand = demands.reduce((a, b) => a + b, 0);

    // Pressure ratio: ≤ 1.0 = fits comfortably, > 1.0 = over budget.
    const pressureRatio = totalDemand > 0 ? totalDemand / historyBudget : 0;

    let roundBudgets: number[];

    if (pressureRatio <= 1.0) {
      // ── NO PRESSURE: every round gets its full demand. ────────────────
      // Resolved rounds are NOT penalized when budget is comfortable.
      roundBudgets = demands.slice();
    } else {
      // ── PRESSURE: resolved rounds compress first, unresolved protected.
      //
      // resolvedFactor scales linearly from the onset of pressure:
      //   pressure 1.0  →  1.00 (no penalty)
      //   pressure 1.5  →  0.81
      //   pressure 2.0  →  0.63
      //   pressure 3.0+ →  0.25 (floor — never fully discard)
      const resolvedFactor = Math.max(0.25, 1.0 - (pressureRatio - 1.0) * 0.375);

      // Assign allocation weights per round.
      const weights = recentRounds.map((r, i) => {
        const isResolved = resolvedRoundNumbers.has(r.round);
        if (isResolved) return resolvedFactor;
        // Newest unresolved round gets a small 15 % bonus.
        const isNewest = i === recentRounds.length - 1;
        return isNewest ? 1.15 : 1.0;
      });

      // Weighted proportional allocation.
      const weightedDemands = demands.map((d, i) => d * weights[i]);
      const totalWeighted = weightedDemands.reduce((a, b) => a + b, 0);

      roundBudgets = totalWeighted > 0
        ? weightedDemands.map((wd) => Math.floor((wd / totalWeighted) * historyBudget))
        : demands.map(() => Math.floor(historyBudget / recentRounds.length));

      // Unresolved rounds: enforce a safe floor.
      for (let i = 0; i < recentRounds.length; i++) {
        if (!resolvedRoundNumbers.has(recentRounds[i].round)) {
          roundBudgets[i] = Math.max(roundBudgets[i], Math.min(UNRESOLVED_ROUND_FLOOR, demands[i]));
        }
      }
    }

    const historyParts: string[] = [];
    for (let i = 0; i < recentRounds.length; i++) {
      const round = recentRounds[i];
      const budget = roundBudgets[i];
      const original = round.sharedTextSnapshot || '';
      const trimmed = original.length > budget
        ? original.slice(0, Math.max(0, budget)) + '…'
        : original;

      if (original.length > trimmed.length) {
        trimmedFromHistory += original.length - trimmed.length;
      }

      historyParts.push(`[Exchange Round ${round.round} — Previously Shared Information]\n${trimmed}`);
      historyChars += trimmed.length;
    }

    const currentRound = recentRounds.length + 1;
    historyPreamble = [
      `=== EXCHANGE HISTORY ===`,
      `This shared report is in evaluation round ${currentRound}.`,
      `${recentRounds.length} previous round(s) of shared information are included below for context.`,
      ``,
      historyParts.join('\n\n---\n\n'),
      ``,
      `=== CURRENT ROUND (Round ${currentRound}) — CURRENT SHARED INFORMATION ===`,
    ].join('\n');
  }

  // Compose final shared text — current round AFTER history preamble
  const sharedText = historyPreamble
    ? historyPreamble + '\n' + currentSharedCapped
    : currentSharedCapped;

  // ── Step 3: Cap confidential text (independent budget) ─────────────────
  const confidentialCapped = confidential.slice(0, MAX_CONFIDENTIAL_BUDGET);
  const trimmedFromConfidential = Math.max(0, confidential.length - confidentialCapped.length);
  const trimmedFromShared = Math.max(0, currentShared.length - currentSharedCapped.length);

  const wasTrimmed = trimmedFromShared > 0 || trimmedFromConfidential > 0 || trimmedFromHistory > 0;

  // ── Step 4: Token estimate for telemetry/preflight ─────────────────────
  const totalChars = sharedText.length + confidentialCapped.length + (convergenceDigest?.digestChars || 0);
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);

  return {
    sharedText,
    confidentialText: confidentialCapped,
    convergenceDigest,
    wasTrimmed,
    estimatedTokens,
    budget: {
      sharedInputChars: sharedText.length,
      confidentialInputChars: confidentialCapped.length,
      historyChars,
      convergenceDigestChars: convergenceDigest?.digestChars || 0,
      totalChars,
      trimmedFromShared,
      trimmedFromConfidential,
      trimmedFromHistory,
    },
  };
}

// ─── Prompt-level token preflight ─────────────────────────────────────────────

/**
 * Run a near-exact token preflight check on the fully assembled prompt.
 *
 * This operates on the EXACT string that will be sent to Vertex (the
 * complete Pass B evaluation prompt), not just the raw inputs. It uses
 * the chars-per-token heuristic (4 chars ≈ 1 token) which is well-calibrated
 * for English text with Gemini's tokenizer.
 *
 * ── Why not the Vertex countTokens API? ──────────────────────────────────
 * The Vertex AI `countTokens` endpoint exists and returns an exact count,
 * but it requires an authenticated network call (~200-500 ms added latency)
 * and introduces a new failure path on the critical evaluation route. Given
 * that the chars/4 estimate is within ~10 % of the real count for English
 * text and our ceiling has generous headroom, the latency/failure risk
 * outweighs the precision benefit. If exact counts become important later,
 * the integration point is here.
 *
 * @param promptText - The fully assembled prompt string (same as sent to Vertex).
 * @returns PreflightResult with estimated tokens and whether the ceiling is exceeded.
 */
export function preflightPromptCheck(promptText: string): PreflightResult {
  const promptChars = promptText.length;
  const estimatedPromptTokens = Math.ceil(promptChars / CHARS_PER_TOKEN_ESTIMATE);
  const overCeiling = estimatedPromptTokens > PROMPT_TOKEN_HARD_CEILING;
  return {
    promptChars,
    estimatedPromptTokens,
    overCeiling,
    ceiling: PROMPT_TOKEN_HARD_CEILING,
  };
}
