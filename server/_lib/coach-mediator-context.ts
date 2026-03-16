/**
 * coach-mediator-context.ts
 *
 * Pure-function module that extracts a **safe, bounded, one-sided** mediator
 * context from shared/public evaluation outputs for use in Step 2 private
 * guidance (the "coach" layer).
 *
 * ─── Safety contract ──────────────────────────────────────────────────────
 * This module ONLY reads already-published shared/public evaluation data:
 *   • publicReport / resultPublicReport  (the shareable evaluation output)
 *   • The report's why[], missing[], recommendation, fit_level, next_actions
 *
 * It NEVER reads:
 *   • Raw confidential text from either party
 *   • Private coaching threads from the other side
 *   • Hidden internal fields that were never shared
 *
 * The output is safe for injection into a single party's private coaching
 * prompt without leaking the other side's confidential information.
 *
 * ─── Scope ────────────────────────────────────────────────────────────────
 * Consumed by:
 *   • server/_lib/vertex-coach.ts      (prompt builder)
 *   • server/routes/document-comparisons/[id]/coach.ts  (owner route)
 *   • server/routes/shared-report/[token]/coach.ts      (recipient route)
 *
 * NOT consumed by:
 *   • Evaluation engine (vertex-evaluation*.ts)
 *   • Proposer-side or template-side routes
 * ──────────────────────────────────────────────────────────────────────────
 */

// ── Limits ────────────────────────────────────────────────────────────────

/** Max chars for the latest shared report summary text. */
export const LATEST_SUMMARY_MAX_CHARS = 600;

/** Max chars for each prior round summary. */
export const PRIOR_SUMMARY_MAX_CHARS = 250;

/** Max number of prior round summaries to include. */
export const MAX_PRIOR_ROUND_SUMMARIES = 3;

/** Max number of open/missing items to surface. */
export const MAX_OPEN_ITEMS = 10;

/** Max number of addressed/resolved items to surface. */
export const MAX_ADDRESSED_ITEMS = 10;

/** Max chars per individual issue/item string. */
export const ITEM_MAX_CHARS = 200;

/** Hard ceiling on total mediator context block chars. */
export const MEDIATOR_CONTEXT_MAX_CHARS = 4000;

// ── Types ─────────────────────────────────────────────────────────────────

export interface SafeMediatorContext {
  /** Human-readable summary of the latest shared evaluation/report. */
  latestSharedReportSummary: string;
  /** Bounded summaries from prior shared-report rounds (newest-first). */
  priorSharedReportSummaries: Array<{
    round: number;
    summary: string;
    createdAt: string;
  }>;
  /** Issues/blockers that remain open per the shared evaluation. */
  openIssues: string[];
  /** Items that the shared evaluation considers adequately addressed. */
  addressedItems: string[];
  /** Missing information or evidence the mediator still wants. */
  missingItems: string[];
  /** The mediator's latest recommendation (e.g. "Medium fit"). */
  latestMediatorRecommendation: string;
  /** Brief status tag for the latest round (e.g. "medium — 65/100"). */
  latestRoundStatus: string;
}

/**
 * An already-persisted shared-report evaluation run, as loaded from the DB.
 * Only the safe/public fields are required.
 */
export interface EvaluationRunRow {
  resultPublicReport?: unknown;
  resultJson?: unknown;
  createdAt?: Date | string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function toStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (result.length >= maxItems) break;
    // Handle both plain strings and { text: "..." } objects
    const raw = typeof entry === 'string' ? entry : asText((entry as any)?.text ?? entry);
    const text = raw.trim();
    if (text) {
      result.push(truncate(text, maxChars));
    }
  }
  return result;
}

function toIsoString(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

// ── V2-format report parsing ──────────────────────────────────────────────

function parseV2Report(report: Record<string, unknown>): {
  why: string[];
  missing: string[];
  fitLevel: string;
  recommendation: string;
  confidence: number;
} {
  const why = toStringList(report.why, MAX_ADDRESSED_ITEMS, ITEM_MAX_CHARS);
  const missing = toStringList(report.missing, MAX_OPEN_ITEMS, ITEM_MAX_CHARS);
  const fitLevel = asText(report.fit_level) || 'unknown';
  const recommendation = asText(report.recommendation) || '';
  const confidence = Number(report.confidence_0_1 || 0) || 0;
  return { why, missing, fitLevel, recommendation, confidence };
}

// ── V1-format report parsing ──────────────────────────────────────────────

function parseV1Report(evalResult: Record<string, unknown>): {
  why: string[];
  missing: string[];
  fitLevel: string;
  recommendation: string;
  confidence: number;
  nextActions: string[];
} {
  const report = toObject(evalResult.report);
  const summary = toObject(report.summary);
  const fitLevel = asText(summary.fit_level) || asText(evalResult.recommendation)?.toLowerCase() || 'unknown';
  const recommendation = asText(evalResult.recommendation) || '';
  const confidence = Number(evalResult.confidence || 0) || 0;
  const topFitReasons = toStringList(summary.top_fit_reasons, MAX_ADDRESSED_ITEMS, ITEM_MAX_CHARS);
  const topBlockers = toStringList(summary.top_blockers, MAX_OPEN_ITEMS, ITEM_MAX_CHARS);
  const nextActions = toStringList(summary.next_actions, 5, ITEM_MAX_CHARS);
  // followup_questions are mediator-derived and safe
  const followups = Array.isArray(report.followup_questions) ? report.followup_questions : [];
  const missingFromFollowups: string[] = [];
  for (const fq of followups) {
    if (missingFromFollowups.length >= MAX_OPEN_ITEMS) break;
    const text = asText((fq as any)?.question_text);
    if (text) missingFromFollowups.push(truncate(text, ITEM_MAX_CHARS));
  }
  // Merge blockers + followups as "missing/open" items (deduplicated by first N chars)
  const seenPrefixes = new Set(topBlockers.map((b) => b.slice(0, 60).toLowerCase()));
  const mergedMissing = [...topBlockers];
  for (const fq of missingFromFollowups) {
    if (mergedMissing.length >= MAX_OPEN_ITEMS) break;
    const prefix = fq.slice(0, 60).toLowerCase();
    if (!seenPrefixes.has(prefix)) {
      mergedMissing.push(fq);
      seenPrefixes.add(prefix);
    }
  }

  return {
    why: topFitReasons,
    missing: mergedMissing,
    fitLevel,
    recommendation,
    confidence,
    nextActions,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Extracts a safe mediator context from the *latest* evaluation output.
 *
 * Accepts either:
 *   • A V2-format publicReport (has `why`, `missing`, `fit_level`)
 *   • A V1-format evaluationResult (has `report.summary.*`)
 *
 * Returns `null` if there is no usable evaluation data.
 */
export function extractSafeMediatorContext(params: {
  /** The publicReport from the comparison or latest evaluation run. */
  publicReport?: unknown;
  /** The full evaluationResult (V1 format) — used only as fallback. */
  evaluationResult?: unknown;
  /**
   * Prior evaluation runs (newest-first), each containing
   * `resultPublicReport` and optionally `resultJson`.
   * Used for priorSharedReportSummaries.
   */
  priorRuns?: EvaluationRunRow[];
}): SafeMediatorContext | null {
  const pubReport = toObject(params.publicReport);
  const evalResult = toObject(params.evaluationResult);

  // Determine whether we have any usable evaluation data
  const hasV2 = Array.isArray(pubReport.why) || Array.isArray(pubReport.missing) || asText(pubReport.fit_level);
  const hasV1 = Boolean(evalResult.report) || Boolean(evalResult.recommendation);
  if (!hasV2 && !hasV1) return null;

  // Parse the latest evaluation
  let why: string[];
  let missing: string[];
  let fitLevel: string;
  let recommendation: string;
  let confidence: number;
  let nextActions: string[] = [];

  if (hasV2) {
    const v2 = parseV2Report(pubReport);
    why = v2.why;
    missing = v2.missing;
    fitLevel = v2.fitLevel;
    recommendation = v2.recommendation || (
      fitLevel === 'high' ? 'High' : fitLevel === 'medium' ? 'Medium' : 'Low'
    );
    confidence = v2.confidence;
  } else {
    const v1 = parseV1Report(evalResult);
    why = v1.why;
    missing = v1.missing;
    fitLevel = v1.fitLevel;
    recommendation = v1.recommendation;
    confidence = v1.confidence;
    nextActions = v1.nextActions;
  }

  // Build the latest summary text
  const scorePart = confidence > 0 ? ` (${Math.round(confidence * 100)}% confidence)` : '';
  const summaryParts = [
    `Fit level: ${fitLevel}${scorePart}.`,
  ];
  if (why.length > 0) {
    summaryParts.push(`Strengths: ${why.slice(0, 3).join('; ')}.`);
  }
  if (missing.length > 0) {
    summaryParts.push(`Open gaps: ${missing.slice(0, 3).join('; ')}.`);
  }
  const latestSummary = truncate(summaryParts.join(' '), LATEST_SUMMARY_MAX_CHARS);

  // Build prior round summaries (newest-first)
  const priorSummaries: SafeMediatorContext['priorSharedReportSummaries'] = [];
  if (Array.isArray(params.priorRuns)) {
    // Skip the first run if it's the same as "latest" (caller should exclude it)
    for (const run of params.priorRuns) {
      if (priorSummaries.length >= MAX_PRIOR_ROUND_SUMMARIES) break;
      const runPub = toObject(run.resultPublicReport);
      const runJson = toObject(run.resultJson);
      const runEval = toObject(runJson.evaluation_result);
      const runHasV2 = Array.isArray(runPub.why) || Array.isArray(runPub.missing);
      const runHasV1 = Boolean(runEval.report) || Boolean(runEval.recommendation);
      if (!runHasV2 && !runHasV1) continue;

      let runSummary: string;
      if (runHasV2) {
        const v2 = parseV2Report(runPub);
        const parts: string[] = [`Fit: ${v2.fitLevel}.`];
        if (v2.missing.length > 0) parts.push(`Gaps: ${v2.missing.slice(0, 2).join('; ')}.`);
        if (v2.why.length > 0) parts.push(`Strengths: ${v2.why.slice(0, 2).join('; ')}.`);
        runSummary = truncate(parts.join(' '), PRIOR_SUMMARY_MAX_CHARS);
      } else {
        const v1 = parseV1Report(runEval);
        const parts: string[] = [`Fit: ${v1.fitLevel}.`];
        if (v1.missing.length > 0) parts.push(`Gaps: ${v1.missing.slice(0, 2).join('; ')}.`);
        if (v1.why.length > 0) parts.push(`Strengths: ${v1.why.slice(0, 2).join('; ')}.`);
        runSummary = truncate(parts.join(' '), PRIOR_SUMMARY_MAX_CHARS);
      }

      priorSummaries.push({
        round: priorSummaries.length + 1,
        summary: runSummary,
        createdAt: toIsoString(run.createdAt),
      });
    }
  }

  // Build the recommendation string
  const recoText = recommendation
    ? `${recommendation} fit`
    : fitLevel !== 'unknown'
      ? `${fitLevel} fit`
      : '';

  // Build the round status
  const statusParts = [fitLevel];
  if (confidence > 0) statusParts.push(`${Math.round(confidence * 100)}/100`);
  const latestRoundStatus = statusParts.join(' — ');

  return {
    latestSharedReportSummary: latestSummary,
    priorSharedReportSummaries: priorSummaries,
    openIssues: missing,
    addressedItems: why,
    missingItems: missing, // alias — callers may prefer one name over the other
    latestMediatorRecommendation: recoText || nextActions[0] || '',
    latestRoundStatus,
  };
}

/**
 * Formats a SafeMediatorContext into a bounded text block suitable for
 * injection into a coach/private-guidance prompt.
 *
 * Returns an empty string if `ctx` is null (no evaluation data available).
 * The output is hard-capped at MEDIATOR_CONTEXT_MAX_CHARS.
 */
export function formatMediatorContextBlock(ctx: SafeMediatorContext | null): string {
  if (!ctx) return '';

  const lines: string[] = [
    '',
    '=== Shared Mediation Context (derived from shared AI reports — safe for private guidance) ===',
  ];

  if (ctx.latestRoundStatus) {
    lines.push(`Status: ${ctx.latestRoundStatus}`);
  }
  if (ctx.latestMediatorRecommendation) {
    lines.push(`Mediator recommendation: ${ctx.latestMediatorRecommendation}`);
  }

  if (ctx.latestSharedReportSummary) {
    lines.push('');
    lines.push(`Latest shared report summary: ${ctx.latestSharedReportSummary}`);
  }

  if (ctx.openIssues.length > 0) {
    lines.push('');
    lines.push('Open issues / still missing:');
    for (const issue of ctx.openIssues) {
      lines.push(`- ${issue}`);
    }
  }

  if (ctx.addressedItems.length > 0) {
    lines.push('');
    lines.push('What has been addressed:');
    for (const item of ctx.addressedItems) {
      lines.push(`- ${item}`);
    }
  }

  if (ctx.priorSharedReportSummaries.length > 0) {
    lines.push('');
    lines.push('Prior shared report round summaries (newest first):');
    for (const ps of ctx.priorSharedReportSummaries) {
      const dateTag = ps.createdAt ? ` (${ps.createdAt.split('T')[0]})` : '';
      lines.push(`- Round ${ps.round}${dateTag}: ${ps.summary}`);
    }
  }

  lines.push('=== End Mediation Context ===');
  lines.push('');

  const block = lines.join('\n');
  return truncate(block, MEDIATOR_CONTEXT_MAX_CHARS);
}
