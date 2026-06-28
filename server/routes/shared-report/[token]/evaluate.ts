import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { schema } from '../../../_lib/db/client.js';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
} from '../../../_lib/document-editor-sanitization.js';
import { ApiError } from '../../../_lib/errors.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  evaluateMeaningfulPayloadContribution,
  hasMeaningfulRecipientContribution,
} from '../../../_lib/meaningful-recipient-contribution.js';
import {
  buildMediationRoundContext,
  enrichMediationRoundContext,
  extractMediationReport,
  type MediationRoundContext,
} from '../../../_lib/mediation-progress.js';
import {
  buildDraftContributionEntries,
  buildSharedHistoryComposite,
  formatContributionsForAi,
  getLinkRecipientAuthorRole,
  loadSharedReportHistory,
  resolveSharedReportLinkRound,
} from '../../../_lib/shared-report-history.js';
import { evaluateDocumentComparisonWithVertex } from '../../../_lib/vertex-evaluation.js';
import { evaluateWithVertexV2 } from '../../../_lib/vertex-evaluation-v2.js';
import {
  buildEvidenceCandidatesFromContributions,
  buildPriorMediationEvidenceCandidate,
} from '../../../_lib/mediation-evidence-retrieval.js';
import {
  buildStoredV2Evaluation,
  buildRecipientSafeEvaluationProjection,
  CONFIDENTIAL_LABEL,
  SHARED_LABEL,
} from '../../document-comparisons/_helpers.js';
import { assertDocumentComparisonWithinLimits } from '../../document-comparisons/_limits.js';
import {
  buildBudgetedContext,
  buildConvergenceDigest,
  SOFT_TOKEN_CEILING,
  PROMPT_TOKEN_HARD_CEILING,
  type ExchangeRoundSnapshot,
} from '../../../_lib/evaluation-context-budget.js';
import { buildMediationContextEstimate } from '../../../../src/lib/mediationContextLoad.js';
import {
  DRAFT_STATUS,
  RECIPIENT_ROLE,
  SENT_STATUS,
  SHARED_REPORT_ROUTE,
  assertPayloadSize,
  buildDefaultConfidentialPayload,
  buildDefaultSharedPayload,
  getCurrentRecipientDraft,
  getPayloadText,
  getToken,
  logTokenEvent,
  mapRecipientSafeEvaluationDiagnostics,
  requireRecipientAuthorization,
  resolveSharedReportToken,
  toObject,
} from '../_shared.js';
import {
  releaseAiMediationReviewReservation,
  reserveAiMediationReviewCredit,
} from '../../../_lib/starter-entitlements.js';
import { getRecipientAiReviewEnabled } from '../../../_lib/shared-link-review-permissions.js';
import { MEDIATION_REVIEW_STAGE } from '../../../../src/lib/opportunityReviewStage.js';

const SHARED_REPORT_EVALUATE_ROUTE = `${SHARED_REPORT_ROUTE}/evaluate`;
const MIN_SHARED_EVALUATION_TEXT_LENGTH = 40;
const SHARED_REPORT_EVALUATION_BUDGET_MS = 270_000;
const RECIPIENT_AI_REVIEW_NOT_ENABLED_MESSAGE =
  'The proposal owner has not enabled recipient AI reviews for this link.';
const RECIPIENT_REREVIEW_LIMIT_REACHED_MESSAGE =
  'A re-review has already been generated for this round. You can still edit and send your response, or ask the opportunity owner to review the next update.';

function logEvaluationRuntime(
  context: any,
  event: string,
  details: Record<string, unknown> = {},
) {
  console.info(
    JSON.stringify({
      level: 'info',
      route: SHARED_REPORT_EVALUATE_ROUTE,
      event,
      requestId: context?.requestId || null,
      ...details,
    }),
  );
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildSharedReviewIdempotencyKey(params: {
  sharedLinkId: string;
  revisionId: string;
  proposalId: string;
  comparisonId?: string | null;
  outgoingRoundNumber: number;
  sharedText: string;
  confidentialText: string;
}) {
  return createHash('sha256')
    .update(stableJson(params))
    .digest('hex');
}

function getDocumentComparisonEvaluator() {
  const override = (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
  if (typeof override === 'function') {
    return override as typeof evaluateDocumentComparisonWithVertex;
  }
  return evaluateDocumentComparisonWithVertex;
}

function resolveDocumentComparisonEngine(req: any): 'v1' | 'v2' {
  const queryEngine = asLower(req.query?.engine || '');
  if (queryEngine === 'v1' || queryEngine === 'v2') {
    return queryEngine;
  }

  if (typeof (globalThis as any).__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ === 'function') {
    return 'v1';
  }

  const runtimeEnv = asLower(process.env.NODE_ENV || '');
  const configuredEngine = asLower(process.env.EVAL_ENGINE || '');
  if (runtimeEnv !== 'test' && (configuredEngine === 'v1' || configuredEngine === 'v2')) {
    return configuredEngine;
  }
  // NODE_ENV=test is the only environment that keeps v1 for test isolation.
  // Every other environment — including unset NODE_ENV (local Vercel dev) — uses v2.
  // Force v1 via EVAL_ENGINE=v1 or ?engine=v1 if ever needed.
  if (runtimeEnv === 'test') {
    return 'v1';
  }
  return 'v2';
}

function convertV2ResponseToEvaluation(
  v2Result: any,
  options: {
    mediationRoundContext?: MediationRoundContext;
    sharedProgressContext?: {
      currentSharedText?: string;
      priorSharedText?: string;
    };
  } = {},
): Record<string, unknown> {
  return buildStoredV2Evaluation(v2Result, options);
}

function toV2ApiError(error: any) {
  const parseKind = asLower(error?.parse_error_kind);
  const details =
    error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  const upstreamStatus = Number((details as any).status || 0);
  const statusCode =
    parseKind === 'vertex_timeout'
      ? 504
      : Number.isFinite(upstreamStatus) && upstreamStatus > 0
        ? upstreamStatus
        : 502;
  const code =
    parseKind === 'vertex_timeout'
      ? 'vertex_timeout'
      : parseKind === 'vertex_http_error' && statusCode === 501
        ? 'not_configured'
        : parseKind === 'vertex_http_error'
          ? 'vertex_request_failed'
          : 'invalid_model_output';
  return new ApiError(statusCode, code, 'Vertex evaluation failed', {
    reasonCode: parseKind || null,
    parseErrorKind: parseKind || null,
    parseErrorName: parseKind || null,
    parseErrorMessage: JSON.stringify({
      parse_error_kind: parseKind || null,
      raw_text_length: Number(error?.raw_text_length || 0) || 0,
      had_json_fence: null,
      finish_reason: asText(error?.finish_reason) || null,
      schema_missing_keys: Array.isArray((details as any).schema_missing_keys)
        ? (details as any).schema_missing_keys
        : [],
      category_count: null,
    }),
    rawTextLength: Number(error?.raw_text_length || 0) || 0,
    finishReason: asText(error?.finish_reason) || null,
    retryable: Boolean(error?.retryable),
    upstreamStatus: Number.isFinite(upstreamStatus) && upstreamStatus > 0 ? upstreamStatus : null,
    ...details,
  });
}

function coercePayloadHtml(payload: unknown, fallbackText = '') {
  const source = toObject(payload);
  const html = asText(source.html);
  if (html) {
    return sanitizeEditorHtml(html);
  }
  const text = getPayloadText(payload, fallbackText);
  return sanitizeEditorHtml(text);
}

function coercePayloadText(payload: unknown, fallbackText = '') {
  const text = getPayloadText(payload, fallbackText);
  if (text) {
    return sanitizeEditorText(text);
  }
  const html = coercePayloadHtml(payload, fallbackText);
  return sanitizeEditorText(htmlToEditorText(html));
}

function buildConfidentialBundle(params: {
  proposerConfidentialText: string;
  recipientConfidentialText: string;
}) {
  const parts: string[] = [];
  if (params.proposerConfidentialText) {
    parts.push(`[Proposer Confidential Information]\n${params.proposerConfidentialText}`);
  }
  if (params.recipientConfidentialText) {
    parts.push(`[Recipient Confidential Information]\n${params.recipientConfidentialText}`);
  }
  return parts.join('\n\n').trim();
}

// ── Exchange history helpers ────────────────────────────────────────────────

/**
 * Maximum characters to include from each prior round's shared text snapshot
 * when building the exchange-history preamble. Keeps total input within the
 * V2 engine's 12 000-char shared budget without crowding out the current round.
 */
const HISTORY_SNAPSHOT_MAX_CHARS = 2000;

/**
 * Maximum number of previous rounds to include in the exchange-history
 * preamble. Older rounds are omitted to stay within input limits.
 */
const MAX_HISTORY_ROUNDS = 4;

interface ExchangeHistoryRound {
  round: number;
  evaluationRunId: string;
  sharedTextSnapshot: string;
  sharedTextLength: number;
  confidentialLength: number;
  /** Prior missing[] questions extracted from the evaluation result. */
  missingQuestions: string[];
  report: Record<string, unknown> | null;
  createdAt: Date | string;
}

/**
 * Queries previous successful evaluation runs for this shared link and
 * extracts their shared-text snapshots from `resultJson.shared_snapshot.text`.
 * Returns rounds ordered oldest-first, limited to MAX_HISTORY_ROUNDS most
 * recent rounds.
 */
async function getExchangeHistory(
  db: any,
  params: {
    proposalId: string;
    comparisonId?: string | null;
  },
): Promise<ExchangeHistoryRound[]> {
  const conditions = [
    eq(schema.sharedReportEvaluationRuns.proposalId, params.proposalId),
    eq(schema.sharedReportEvaluationRuns.actorRole, RECIPIENT_ROLE),
    eq(schema.sharedReportEvaluationRuns.status, 'success'),
  ];
  if (params.comparisonId) {
    conditions.push(eq(schema.sharedReportEvaluationRuns.comparisonId, params.comparisonId));
  }
  const runs = await db
    .select({
      id: schema.sharedReportEvaluationRuns.id,
      resultJson: schema.sharedReportEvaluationRuns.resultJson,
      createdAt: schema.sharedReportEvaluationRuns.createdAt,
    })
    .from(schema.sharedReportEvaluationRuns)
    .where(and(...conditions))
    .orderBy(desc(schema.sharedReportEvaluationRuns.createdAt))
    .limit(MAX_HISTORY_ROUNDS + 1); // +1 to trim last after reversing

  // Reverse to oldest-first and drop the oldest if over MAX_HISTORY_ROUNDS
  const ordered = runs.reverse();
  const trimmed = ordered.length > MAX_HISTORY_ROUNDS
    ? ordered.slice(ordered.length - MAX_HISTORY_ROUNDS)
    : ordered;

  return trimmed.map((run: any, index: number) => {
    const json = toObject(run.resultJson);
    const snapshot = toObject(json?.shared_snapshot);
    const inputTrace = toObject(json?.input_trace);
    // Extract prior missing[] questions for convergence tracking
    const evalResult = toObject(json?.evaluation_result);
    const evalReport = toObject(evalResult?.report);
    const missingQuestions: string[] = [];
    const missingSource = Array.isArray(evalReport?.missing)
      ? evalReport.missing
      : Array.isArray(evalResult?.missing)
        ? evalResult.missing
        : [];
    for (const entry of missingSource) {
      const text = asText(entry?.text ?? entry);
      if (text) missingQuestions.push(text);
    }
    const roundNumber = Number(inputTrace?.exchange_round || 0);
    return {
      round: Number.isFinite(roundNumber) && roundNumber >= 1 ? Math.floor(roundNumber) : index + 1,
      evaluationRunId: run.id,
      sharedTextSnapshot: asText(snapshot?.text),
      sharedTextLength: Number(inputTrace?.shared_length || 0) || 0,
      confidentialLength: Number(inputTrace?.confidential_length || 0) || 0,
      missingQuestions,
      report: extractMediationReport(evalReport),
      createdAt: run.createdAt,
    };
  });
}

/**
 * Builds the evaluation shared text with exchange history prepended.
 *
 * When there are previous evaluation rounds, a preamble is added before the
 * current shared text so the AI model can see how shared information has
 * evolved across rounds. Each prior round's shared text is truncated to
 * HISTORY_SNAPSHOT_MAX_CHARS to stay within input budgets.
 *
 * If the recipient moved text from confidential to shared in a later round,
 * that text naturally appears in the shared section and the AI treats it as
 * shared — satisfying the "if confidential info is later revealed, treat as
 * shared" requirement.
 */
function buildHistoryAwareSharedText(
  currentSharedText: string,
  history: ExchangeHistoryRound[],
): string {
  if (history.length === 0) {
    return currentSharedText;
  }

  const historyParts = history.map((round) => {
    const snapshot = round.sharedTextSnapshot;
    const truncated = snapshot.length > HISTORY_SNAPSHOT_MAX_CHARS
      ? snapshot.slice(0, HISTORY_SNAPSHOT_MAX_CHARS) + '…'
      : snapshot;
    return `[Exchange Round ${round.round} — Previously Shared Information]\n${truncated}`;
  });

  const currentRound = history.length + 1;
  return [
    `=== EXCHANGE HISTORY ===`,
    `This shared report is in evaluation round ${currentRound}.`,
    `${history.length} previous round(s) of shared information are included below for context.`,
    ``,
    historyParts.join('\n\n---\n\n'),
    ``,
    `=== CURRENT ROUND (Round ${currentRound}) — CURRENT SHARED INFORMATION ===`,
    currentSharedText,
  ].join('\n');
}

function toApiError(error: any) {
  if (error instanceof ApiError) {
    return error;
  }
  const statusCode = Number(error?.statusCode || error?.status || 500);
  const safeStatus = Number.isFinite(statusCode) && statusCode >= 400 && statusCode <= 599 ? Math.floor(statusCode) : 500;
  const code = asText(error?.code) || 'evaluation_failed';
  const message = asText(error?.message) || 'AI mediation failed';
  return new ApiError(safeStatus, code, message);
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  const routeStartedAt = Date.now();
  await withApiRoute(req, res, SHARED_REPORT_EVALUATE_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    logTokenEvent(context, 'evaluate_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
    });
    requireRecipientAuthorization(resolved.link, auth.user);

    const defaultSharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const defaultConfidentialPayload = buildDefaultConfidentialPayload();

    let currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    const now = new Date();

    if (!currentDraft) {
      const [created] = await resolved.db
        .insert(schema.sharedReportRecipientRevisions)
        .values({
          id: newId('share_rev'),
          sharedLinkId: resolved.link.id,
          proposalId: resolved.proposal.id,
          comparisonId: resolved.comparison?.id || null,
          actorRole: RECIPIENT_ROLE,
          status: DRAFT_STATUS,
          workflowStep: 2,
          sharedPayload: defaultSharedPayload,
          recipientConfidentialPayload: defaultConfidentialPayload,
          editorState: {},
          previousRevisionId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      currentDraft = created || null;
    }

    if (!currentDraft) {
      throw new ApiError(500, 'draft_resolution_failed', 'Unable to resolve recipient draft for evaluation');
    }

    const sharedPayload = toObject(currentDraft.sharedPayload);
    const confidentialPayload = toObject(currentDraft.recipientConfidentialPayload);
    const sharedHistory = await loadSharedReportHistory({
      db: resolved.db,
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const draftAuthorRole = getLinkRecipientAuthorRole({
      proposal: resolved.proposal,
      link: resolved.link,
    });
    const outgoingRoundNumber = resolveSharedReportLinkRound(resolved.link.reportMetadata) + 1;

    assertPayloadSize(sharedPayload, 'shared_payload');
    assertPayloadSize(confidentialPayload, 'recipient_confidential_payload');

    const sharedFallbackText = String(resolved.comparison?.docBText || defaultSharedPayload.text || '');
    const currentRoundSharedText = coercePayloadText(sharedPayload, sharedFallbackText);
    const currentRoundRecipientConfidentialText = coercePayloadText(confidentialPayload, '');
    const sharedDraftContribution = evaluateMeaningfulPayloadContribution({
      payload: sharedPayload,
      baselinePayload: defaultSharedPayload,
      defaultLabel: 'Shared by Recipient',
      visibility: 'shared',
    });
    const confidentialDraftContribution = evaluateMeaningfulPayloadContribution({
      payload: confidentialPayload,
      baselinePayload: defaultConfidentialPayload,
      defaultLabel: 'Confidential to Recipient',
      visibility: 'confidential',
    });
    const hasMeaningfulDraftSharedInput = sharedDraftContribution.hasMeaningfulContribution;
    const hasMeaningfulDraftConfidentialInput =
      confidentialDraftContribution.hasMeaningfulContribution;
    const draftEntries = buildDraftContributionEntries({
      authorRole: draftAuthorRole,
      roundNumber: outgoingRoundNumber,
      sharedPayload,
      confidentialPayload,
      sourceKind: 'draft',
      createdAt: currentDraft.createdAt,
      updatedAt: currentDraft.updatedAt,
    });
    const draftSharedEntries = draftEntries.filter(
      (entry) => entry.visibility === 'shared' && hasMeaningfulDraftSharedInput,
    );
    const draftConfidentialEntries = draftEntries.filter(
      (entry) => entry.visibility === 'confidential' && hasMeaningfulDraftConfidentialInput,
    );
    const meaningfulRecipientContribution = hasMeaningfulRecipientContribution({
      recipientAuthorRole: draftAuthorRole,
      historyContributions: sharedHistory.contributions,
      historyBaselinePayloads: {
        shared: defaultSharedPayload,
        confidential: defaultConfidentialPayload,
      },
      draftPayloads: [
        {
          key: 'shared',
          payload: sharedPayload,
          baselinePayload: defaultSharedPayload,
          defaultLabel: 'Shared by Recipient',
          visibility: 'shared',
        },
        {
          key: 'confidential',
          payload: confidentialPayload,
          baselinePayload: defaultConfidentialPayload,
          defaultLabel: 'Confidential to Recipient',
          visibility: 'confidential',
        },
      ],
    });
    const historyHasRecipientContent =
      meaningfulRecipientContribution.historyContributionIds.length > 0;
    const hasMeaningfulRecipientContent =
      meaningfulRecipientContribution.hasMeaningfulContribution;
    const sharedHistoryEntriesForAi = [
      ...sharedHistory.contributions.filter((entry) => entry.visibility === 'shared'),
      ...draftSharedEntries,
    ];
    const confidentialHistoryEntriesForAi = [
      ...sharedHistory.contributions.filter((entry) => entry.visibility === 'confidential'),
      ...draftConfidentialEntries,
    ];
    const sharedText = formatContributionsForAi(sharedHistoryEntriesForAi);
    const confidentialBundle = formatContributionsForAi(confidentialHistoryEntriesForAi);
    const priorRoundText = formatContributionsForAi(
      sharedHistory.contributions.filter((entry) => {
        const roundNumber = Number(entry?.roundNumber || 0);
        return Number.isFinite(roundNumber) && roundNumber >= 1 && roundNumber < outgoingRoundNumber;
      }),
    );
    const visibleSharedBundle = buildSharedHistoryComposite([
      ...sharedHistory.sharedEntries,
      ...draftSharedEntries.map((entry) => ({
        id: entry.id,
        visibility_label: `Shared by ${entry.authorLabel}`,
        label: entry.contentPayload?.label || `Shared by ${entry.authorLabel}`,
        text: entry.contentPayload?.text || '',
        html: entry.contentPayload?.html || '',
        source: entry.contentPayload?.source || 'typed',
        files: entry.contentPayload?.files || [],
      })),
    ]);
    const sharedHtml = visibleSharedBundle.html;

    // ── Exchange history: include previous rounds' shared text ──────────────
    const exchangeHistory = await getExchangeHistory(resolved.db, {
      proposalId: resolved.proposal.id,
      comparisonId: resolved.comparison?.id || null,
    });
    const sharedSnapshotByRound = new Map(
      sharedHistory.sharedRoundSnapshots.map((entry) => [Number(entry.round || 0), entry.sharedTextSnapshot]),
    );
    const normalizedExchangeHistory = exchangeHistory.map((entry) => ({
      ...entry,
      sharedTextSnapshot:
        asText(sharedSnapshotByRound.get(Number(entry.round || 0))) || entry.sharedTextSnapshot,
    }));
    const priorBilateralRounds = normalizedExchangeHistory.filter((entry) => entry.report);
    const latestPriorBilateralRound = priorBilateralRounds[priorBilateralRounds.length - 1] || null;
    const baseMediationRoundContext = buildMediationRoundContext({
      bilateralRoundNumber: priorBilateralRounds.length + 1,
      priorBilateralRoundId: latestPriorBilateralRound?.evaluationRunId || null,
      priorReport: latestPriorBilateralRound?.report || null,
    });
    const mediationRoundContext = enrichMediationRoundContext({
      mediationRoundContext: baseMediationRoundContext,
      currentSharedText: currentRoundSharedText,
    }) || baseMediationRoundContext;
    const mediationEvidenceCandidates = [
      ...buildEvidenceCandidatesFromContributions([
        ...sharedHistoryEntriesForAi,
        ...confidentialHistoryEntriesForAi,
      ]),
      ...priorBilateralRounds
        .map((round) =>
          buildPriorMediationEvidenceCandidate({
            id: round.evaluationRunId,
            roundNumber: round.round,
            report: round.report,
            createdAt: round.createdAt,
          }),
        )
        .filter(Boolean),
    ];

    // ── Build convergence digest from prior evaluation rounds ───────────────
    const priorEvalSnapshots: ExchangeRoundSnapshot[] = normalizedExchangeHistory.map((h) => ({
      round: h.round,
      sharedTextSnapshot: h.sharedTextSnapshot,
      missingQuestions: h.missingQuestions || [],
      createdAt: h.createdAt,
    }));
    const convergenceDigest = buildConvergenceDigest(priorEvalSnapshots, sharedText);

    // ── Budget-controlled context assembly ──────────────────────────────────
    const budgeted = buildBudgetedContext({
      currentSharedText: sharedText,
      confidentialText: confidentialBundle,
      historyRounds: [],
      priorEvaluationRounds: priorEvalSnapshots,
    });
    const evaluationSharedText = budgeted.sharedText;
    const evaluationConfidentialText = budgeted.confidentialText;

    if (!hasMeaningfulRecipientContent) {
      throw new ApiError(
        409,
        'recipient_input_required',
        'Recipient input is required before AI Mediation Review can run.',
      );
    }

    if (sharedText.length < MIN_SHARED_EVALUATION_TEXT_LENGTH) {
      throw new ApiError(
        400,
        'invalid_input',
        `Shared Information must be at least ${MIN_SHARED_EVALUATION_TEXT_LENGTH} characters before evaluation.`,
      );
    }

    assertDocumentComparisonWithinLimits({
      docAText: confidentialBundle,
      docBText: sharedText,
    });

    const reviewIdempotencyKey = buildSharedReviewIdempotencyKey({
      sharedLinkId: resolved.link.id,
      revisionId: currentDraft.id,
      proposalId: resolved.proposal.id,
      comparisonId: resolved.comparison?.id || null,
      outgoingRoundNumber,
      sharedText,
      confidentialText: confidentialBundle,
    });
    const recipientAiReviewEnabled = getRecipientAiReviewEnabled(resolved.link);

    if (!recipientAiReviewEnabled) {
      throw new ApiError(
        403,
        'recipient_ai_review_not_enabled',
        RECIPIENT_AI_REVIEW_NOT_ENABLED_MESSAGE,
        {
          exchange_round: outgoingRoundNumber,
          shared_link_id: resolved.link.id,
        },
      );
    }

    // Cache hit = exact same inputs already have a saved successful AI result,
    // so there is no model call and no owner review-credit usage.
    const [duplicateRun] = await resolved.db
      .select()
      .from(schema.sharedReportEvaluationRuns)
      .where(
        and(
          eq(schema.sharedReportEvaluationRuns.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportEvaluationRuns.status, 'success'),
          sql`${schema.sharedReportEvaluationRuns.resultJson}->>'review_idempotency_key' = ${reviewIdempotencyKey}`,
        ),
      )
      .orderBy(desc(schema.sharedReportEvaluationRuns.createdAt))
      .limit(1);

    if (duplicateRun) {
      const duplicateResultJson = toObject(duplicateRun.resultJson);
      ok(res, 200, {
        ok: true,
        cached: true,
        evaluation_id: duplicateRun.id,
        evaluation: {
          public_report: duplicateRun.resultPublicReport || {},
          evaluation_result: duplicateResultJson.evaluation_result || {},
          status: 'success',
          runtime_diagnostics: mapRecipientSafeEvaluationDiagnostics({
            id: duplicateRun.id,
            status: 'success',
            resultJson: duplicateResultJson,
            resultPublicReport: duplicateRun.resultPublicReport || {},
          }),
        },
      });
      return;
    }

    // Identical cache miss already started: keep the existing in-flight contract.
    const [pendingDuplicateRun] = await resolved.db
      .select({
        id: schema.sharedReportEvaluationRuns.id,
        revisionId: schema.sharedReportEvaluationRuns.revisionId,
      })
      .from(schema.sharedReportEvaluationRuns)
      .where(
        and(
          eq(schema.sharedReportEvaluationRuns.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportEvaluationRuns.status, 'pending'),
          sql`${schema.sharedReportEvaluationRuns.resultJson}->>'review_idempotency_key' = ${reviewIdempotencyKey}`,
        ),
      )
      .orderBy(desc(schema.sharedReportEvaluationRuns.createdAt))
      .limit(1);

    if (pendingDuplicateRun) {
      throw new ApiError(
        409,
        'evaluation_already_running',
        'AI mediation is already running for this unchanged draft.',
        {
          evaluation_id: pendingDuplicateRun.id,
          revision_id: pendingDuplicateRun.revisionId,
        },
      );
    }

    // Cache miss = inputs changed or no saved result exists. Before any model
    // call or owner review-credit reservation, enforce the per-round policy:
    // 1) recipient full AI reviews must be owner-enabled for this link, and
    // 2) each side gets at most one additional non-cached re-review per round.
    const [roundReviewCountRow] = await resolved.db
      .select({
        runCount: sql<number>`count(*)::int`,
      })
      .from(schema.sharedReportEvaluationRuns)
      .where(
        and(
          eq(schema.sharedReportEvaluationRuns.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportEvaluationRuns.actorRole, RECIPIENT_ROLE),
          inArray(schema.sharedReportEvaluationRuns.status, ['pending', 'success']),
          sql`${schema.sharedReportEvaluationRuns.resultJson}->'input_trace'->>'exchange_round' = ${String(outgoingRoundNumber)}`,
        ),
      );

    const existingRoundRunCount = Number(roundReviewCountRow?.runCount || 0) || 0;

    const [latestRoundReviewRun] = await resolved.db
      .select({
        id: schema.sharedReportEvaluationRuns.id,
        revisionId: schema.sharedReportEvaluationRuns.revisionId,
        status: schema.sharedReportEvaluationRuns.status,
      })
      .from(schema.sharedReportEvaluationRuns)
      .where(
        and(
          eq(schema.sharedReportEvaluationRuns.sharedLinkId, resolved.link.id),
          eq(schema.sharedReportEvaluationRuns.actorRole, RECIPIENT_ROLE),
          inArray(schema.sharedReportEvaluationRuns.status, ['pending', 'success']),
          sql`${schema.sharedReportEvaluationRuns.resultJson}->'input_trace'->>'exchange_round' = ${String(outgoingRoundNumber)}`,
        ),
      )
      .orderBy(desc(schema.sharedReportEvaluationRuns.createdAt))
      .limit(1);

    const additionalRoundReviewsUsed = Math.max(0, existingRoundRunCount - 1);
    if (additionalRoundReviewsUsed >= 1) {
      throw new ApiError(
        409,
        'recipient_rereview_limit_reached',
        RECIPIENT_REREVIEW_LIMIT_REACHED_MESSAGE,
        {
          evaluation_id: latestRoundReviewRun?.id || null,
          revision_id: latestRoundReviewRun?.revisionId || null,
          exchange_round: outgoingRoundNumber,
          status: latestRoundReviewRun?.status || null,
        },
      );
    }

    let reviewReservationId: string | null = await reserveAiMediationReviewCredit(resolved.db, {
      userId: resolved.link.userId,
      userEmail: resolved.owner?.email || resolved.proposal.partyAEmail || null,
      source: 'shared_report_mediation',
      scopeId: resolved.link.id,
      requestId: context?.requestId || null,
    });

    const evaluationRunId = newId('share_eval');
    try {
      await resolved.db.insert(schema.sharedReportEvaluationRuns).values({
        id: evaluationRunId,
        sharedLinkId: resolved.link.id,
        proposalId: resolved.proposal.id,
        comparisonId: resolved.comparison?.id || null,
        revisionId: currentDraft.id,
        actorRole: RECIPIENT_ROLE,
        status: 'pending',
        resultPublicReport: {},
        resultJson: {
          review_idempotency_key: reviewIdempotencyKey,
          input_trace: {
            exchange_round: outgoingRoundNumber,
          },
        },
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await releaseAiMediationReviewReservation(resolved.db, reviewReservationId);
      reviewReservationId = null;
      throw error;
    }

    let evaluatorStartedAt: number | null = null;
    let evaluationDiagnostics: Record<string, unknown> = {};
    try {
      const engine = resolveDocumentComparisonEngine(req);
      evaluatorStartedAt = Date.now();
      let evaluated: any;
      let v2Preflight: { promptChars?: number; estimatedPromptTokens?: number; overCeiling?: boolean; trimTriggered?: boolean } = {};
      logEvaluationRuntime(context, 'evaluation_model_start', {
        evaluationId: evaluationRunId,
        engine,
        analysisStage: MEDIATION_REVIEW_STAGE,
      });
      if (engine === 'v2') {
        // Hard try-catch so any unexpected evaluator throw produces a valid
        // completed_with_warnings result rather than a 502.
        let v2Result: any;
        try {
          v2Result = await evaluateWithVertexV2({
            sharedText: evaluationSharedText,
            confidentialText: evaluationConfidentialText,
            analysisStage: MEDIATION_REVIEW_STAGE,
            requestId: context?.requestId || undefined,
            generationModel: asText(process.env.VERTEX_DOC_COMPARE_GENERATION_MODEL) || undefined,
            verifierModel: asText(process.env.VERTEX_DOC_COMPARE_VERIFIER_MODEL) || undefined,
            extractModel: asText(process.env.VERTEX_DOC_COMPARE_EXTRACT_MODEL) || undefined,
            convergenceDigestText: convergenceDigest?.digestText || undefined,
            mediationRoundContext,
            evidenceCandidates: mediationEvidenceCandidates,
            executionDeadlineMs: routeStartedAt + SHARED_REPORT_EVALUATION_BUDGET_MS,
            maxQualityRepairCalls: 1,
          });
        } catch (unexpectedError: any) {
          if (asLower(unexpectedError?.code) === 'openai_not_configured') {
            throw unexpectedError;
          }
          v2Result = {
            ok: true,
            data: {
              analysis_stage: MEDIATION_REVIEW_STAGE,
              fit_level: 'unknown',
              confidence_0_1: 0.2,
              why: [
                'Executive Summary: The AI mediation review could not be generated due to an unexpected internal error.',
                'Key Strengths: Unable to assess — model call failed unexpectedly.',
                'Key Risks: Unable to assess — insufficient data.',
                'Decision Readiness: Incomplete. Please address missing items and retry.',
                'Recommendations: Review the missing items below and re-run AI mediation.',
              ],
              missing: [
                'What is the confirmed scope and set of deliverables?',
                'What is the confirmed timeline and go-live date?',
                'What are the measurable success criteria (KPIs)?',
              ],
              redactions: [],
            },
            attempt_count: 1,
            model: null,
            _internal: {
              warnings: ['vertex_unexpected_error_fallback_used'],
              failure_kind: 'unexpected_error',
            },
          };
        }

        if (!v2Result.ok) {
          const error = v2Result.error;
          const parseKind = asLower(error?.parse_error_kind || error?.code || '');

          // Confidential leak is a security hard failure — never return
          // a partially-generated result that might contain leaked data.
          if (parseKind === 'confidential_leak_detected') {
            throw toV2ApiError(v2Result.error);
          }

          // For all other ok:false cases (e.g. not_configured) — use a
          // completed_with_warnings fallback so the API returns 200, not 502.
          v2Result = {
            ok: true,
            data: {
              analysis_stage: MEDIATION_REVIEW_STAGE,
              fit_level: 'unknown',
              confidence_0_1: 0.2,
              why: [
                'Executive Summary: The AI mediation review could not be generated. This review is incomplete.',
                'Key Strengths: Unable to assess due to model configuration or availability issue.',
                'Key Risks: Unable to assess — please retry or contact support if issue persists.',
                'Decision Readiness: Incomplete. Address missing items below.',
                'Recommendations: Retry AI mediation once the underlying issue is resolved.',
              ],
              missing: [
                'What is the confirmed scope and set of deliverables?',
                'What is the confirmed timeline and go-live date?',
                'What are the measurable success criteria (KPIs)?',
                'What budget and resource constraints apply?',
                'What are the key risks and their mitigations?',
              ],
              redactions: [],
            },
            attempt_count: 1,
            model: null,
            _internal: {
              warnings: ['vertex_not_configured_fallback_used'],
              failure_kind: parseKind,
            },
          };
        }
        evaluated = convertV2ResponseToEvaluation(v2Result, {
          mediationRoundContext,
          sharedProgressContext: {
            currentSharedText: currentRoundSharedText,
            priorSharedText: latestPriorBilateralRound?.sharedTextSnapshot || '',
          },
        });
        evaluationDiagnostics = {
          provider: (v2Result as any)?._internal?.models_used?.provider || null,
          model: (v2Result as any)?.model || (v2Result as any)?.generation_model || null,
          passBAttempts: (v2Result as any)?._internal?.pass_b_attempt_count || null,
          refinementAttempted: Boolean((v2Result as any)?._internal?.refinement?.attempted),
          refinementApplied: Boolean((v2Result as any)?._internal?.refinement?.applied),
          regenerationTriggered: Boolean((v2Result as any)?._internal?.regeneration?.triggered),
          rawQualityScore: (v2Result as any)?._internal?.raw_quality_score ?? null,
          qualityWarnings: (v2Result as any)?._internal?.quality_warnings || [],
          rendererPath: (v2Result as any)?._internal?.narrative_validation?.renderer_path || null,
          narrativeValid: (v2Result as any)?._internal?.narrative_validation?.valid ?? null,
          narrativeValidationWarnings:
            (v2Result as any)?._internal?.narrative_validation?.warnings || [],
          failureKind: (v2Result as any)?._internal?.failure_kind || null,
          fallbackMode: (v2Result as any)?._internal?.fallback_mode || null,
          providerStatus: (v2Result as any)?._internal?.failure_details?.provider_status ?? null,
          providerCode: (v2Result as any)?._internal?.failure_details?.provider_code || null,
          failurePhase: (v2Result as any)?._internal?.failure_details?.failure_phase || null,
          responseReceived:
            (v2Result as any)?._internal?.failure_details?.response_received ?? null,
          rawTextLength:
            (v2Result as any)?._internal?.failure_details?.raw_text_length ?? null,
          finishReason:
            (v2Result as any)?._internal?.failure_details?.finish_reason || null,
          schemaMissingKeys:
            (v2Result as any)?._internal?.failure_details?.schema_missing_keys || [],
          schemaInvalidFields:
            (v2Result as any)?._internal?.failure_details?.schema_invalid_fields || [],
          warnings: (v2Result as any)?._internal?.warnings || [],
          retrievalStrategy: (v2Result as any)?._internal?.retrieval?.retrieval_strategy || null,
          evidenceCount: (v2Result as any)?._internal?.retrieval?.evidence_count ?? 0,
          omittedEvidenceCount: (v2Result as any)?._internal?.retrieval?.omitted_evidence_count ?? 0,
          evidenceBudgetUsed: (v2Result as any)?._internal?.retrieval?.token_budget_used ?? 0,
          retrievalWarnings: (v2Result as any)?._internal?.retrieval?.retrieval_warnings || [],
          modelCallCount: (v2Result as any)?._internal?.runtime?.model_call_count ?? null,
          modelElapsedMs: (v2Result as any)?._internal?.runtime?.model_elapsed_ms ?? null,
          runtimeBudgetMs: (v2Result as any)?._internal?.runtime?.budget_ms ?? null,
          runtimeBudgetRemainingMs:
            (v2Result as any)?._internal?.runtime?.budget_remaining_ms ?? null,
          runtimeBudgetExhausted:
            Boolean((v2Result as any)?._internal?.runtime?.budget_exhausted),
          runtimePhaseElapsedMs:
            (v2Result as any)?._internal?.runtime?.phase_elapsed_ms || {},
          qualityRepairCallCount:
            (v2Result as any)?._internal?.runtime?.quality_repair_call_count ?? 0,
          narrativeWordCount:
            (v2Result as any)?._internal?.narrative_validation?.word_count ?? null,
          narrativeParagraphCount:
            (v2Result as any)?._internal?.narrative_validation?.paragraph_count ?? null,
          narrativeSectionCount:
            (v2Result as any)?._internal?.narrative_validation?.section_count ?? null,
        };
        // Extract preflight data for input_trace
        v2Preflight = (v2Result as any)?._internal?.preflight || {};
      } else {
        const evaluateComparison = getDocumentComparisonEvaluator();
        evaluated = await evaluateComparison(
          {
            title: asText(resolved.comparison?.title) || asText(resolved.proposal.title) || 'Shared Report',
            docAText: evaluationConfidentialText,
            docBText: evaluationSharedText,
            docASpans: [],
            docBSpans: [],
            partyALabel: CONFIDENTIAL_LABEL,
            partyBLabel: SHARED_LABEL,
          },
          {
            correlationId: context?.requestId || null,
            routeName: SHARED_REPORT_EVALUATE_ROUTE,
            entityId: currentDraft.id,
            inputChars: evaluationConfidentialText.length + evaluationSharedText.length,
          },
        );
      }
      logEvaluationRuntime(context, 'evaluation_model_complete', {
        evaluationId: evaluationRunId,
        engine,
        elapsedMs: Date.now() - evaluatorStartedAt,
        ...evaluationDiagnostics,
      });

      const projection = buildRecipientSafeEvaluationProjection({
        evaluationResult: evaluated || {},
        publicReport: evaluated?.report || {},
        confidentialText: confidentialBundle,
        sharedText,
        title: asText(resolved.comparison?.title) || asText(resolved.proposal.title),
      });

      const completedAt = new Date();
      const omittedDueToCapacity = [];
      if (budgeted.budget.trimmedFromShared > 0) {
        omittedDueToCapacity.push(`${budgeted.budget.trimmedFromShared.toLocaleString()} shared chars trimmed`);
      }
      if (budgeted.budget.trimmedFromConfidential > 0) {
        omittedDueToCapacity.push(`${budgeted.budget.trimmedFromConfidential.toLocaleString()} confidential chars trimmed`);
      }
      if (Number(evaluationDiagnostics.omittedEvidenceCount || 0) > 0) {
        omittedDueToCapacity.push(`${Number(evaluationDiagnostics.omittedEvidenceCount || 0).toLocaleString()} retrieved chunks omitted`);
      }
      if (Boolean(v2Preflight.trimTriggered)) {
        omittedDueToCapacity.push('prompt tightened during token preflight');
      }
      const priorRoundNumbers = new Set(
        sharedHistory.contributions
          .map((entry) => Number(entry?.roundNumber || 0))
          .filter((roundNumber) => Number.isFinite(roundNumber) && roundNumber >= 1 && roundNumber < outgoingRoundNumber),
      );
      const reviewContextEstimate = buildMediationContextEstimate({
        visibleSharedText: visibleSharedBundle.text || '',
        visibleConfidentialText: currentRoundRecipientConfidentialText,
        directSharedText: evaluationSharedText,
        directConfidentialText: evaluationConfidentialText,
        priorRoundText,
        summaryMemoryText: [
          convergenceDigest?.digestText || '',
          priorBilateralRounds.length > 0 && mediationRoundContext ? JSON.stringify(mediationRoundContext) : '',
        ].filter(Boolean).join('\n'),
        retrievedChunkCount: Number(evaluationDiagnostics.evidenceCount || 0),
        retrievedContextTokens: Number(evaluationDiagnostics.evidenceBudgetUsed || 0),
        includedPriorRounds: priorRoundNumbers.size,
        omittedDueToCapacity,
        estimatorMode: 'evaluate_runtime',
      });
      if (process.env.NODE_ENV !== 'production') {
        logEvaluationRuntime(context, 'review_context_estimate', {
          evaluationId: evaluationRunId,
          contextEstimate: reviewContextEstimate,
        });
      }
      const completedEvaluationDiagnostics = {
        ...evaluationDiagnostics,
        evaluatorElapsedMs: Date.now() - evaluatorStartedAt,
        routeElapsedMs: Date.now() - routeStartedAt,
      };
      await resolved.db
        .update(schema.sharedReportEvaluationRuns)
        .set({
          status: 'success',
          resultPublicReport: projection.public_report || {},
          resultJson: {
            evaluation_result: projection.evaluation_result || {},
            evaluation_diagnostics: completedEvaluationDiagnostics,
            input_trace: {
              shared_length: sharedText.length,
              current_round_shared_length: currentRoundSharedText.length,
              evaluation_shared_length: evaluationSharedText.length,
              confidential_length: confidentialBundle.length,
              current_round_confidential_length: currentRoundRecipientConfidentialText.length,
              exchange_round: outgoingRoundNumber,
              previous_rounds: normalizedExchangeHistory.length,
              bilateral_round_number: mediationRoundContext.current_bilateral_round_number,
              prior_bilateral_round_id: mediationRoundContext.prior_bilateral_round_id || null,
              prior_bilateral_round_number: mediationRoundContext.prior_bilateral_round_number || null,
              attributed_shared_entries: sharedHistoryEntriesForAi.length,
              attributed_confidential_entries: confidentialHistoryEntriesForAi.length,
              current_round_author_role: draftAuthorRole,
              analysis_stage: MEDIATION_REVIEW_STAGE,
              has_meaningful_recipient_content: hasMeaningfulRecipientContent,
              history_has_recipient_content: historyHasRecipientContent,
              draft_shared_input_count: draftSharedEntries.length,
              draft_confidential_input_count: draftConfidentialEntries.length,
              budget_was_trimmed: budgeted.wasTrimmed,
              estimated_input_chars: budgeted.budget.totalChars,
              estimated_input_tokens: budgeted.estimatedTokens,
              soft_token_ceiling: SOFT_TOKEN_CEILING,
              prompt_token_hard_ceiling: PROMPT_TOKEN_HARD_CEILING,
              token_preflight_ok: budgeted.estimatedTokens <= SOFT_TOKEN_CEILING,
              // Real prompt-level preflight (from V2 engine _internal)
              preflight_prompt_chars: v2Preflight.promptChars ?? null,
              preflight_estimated_prompt_tokens: v2Preflight.estimatedPromptTokens ?? null,
              preflight_over_ceiling: v2Preflight.overCeiling ?? null,
              preflight_trim_triggered: v2Preflight.trimTriggered ?? false,
              convergence_digest_chars: convergenceDigest?.digestChars || 0,
              convergence_open_questions: convergenceDigest?.openQuestions?.length || 0,
              convergence_resolved_questions: convergenceDigest?.resolvedQuestions?.length || 0,
              context_estimate: reviewContextEstimate,
            },
            review_idempotency_key: reviewIdempotencyKey,
            exchange_history: normalizedExchangeHistory.map((round) => ({
              round: round.round,
              evaluation_run_id: round.evaluationRunId,
              shared_text_length: round.sharedTextLength,
              confidential_length: round.confidentialLength,
              created_at: round.createdAt,
            })),
            authored_history: {
              shared: sharedHistoryEntriesForAi.map((entry) => ({
                contribution_id: entry.id,
                author_role: entry.authorRole,
                visibility: entry.visibility,
                round_number: entry.roundNumber,
                source_kind: entry.sourceKind,
                text_length: Number(String(entry?.contentPayload?.text || '').length),
              })),
              confidential: confidentialHistoryEntriesForAi.map((entry) => ({
                contribution_id: entry.id,
                author_role: entry.authorRole,
                visibility: entry.visibility,
                round_number: entry.roundNumber,
                source_kind: entry.sourceKind,
                text_length: Number(
                  String(entry?.contentPayload?.text || entry?.contentPayload?.notes || '').length,
                ),
              })),
            },
            shared_snapshot: {
              text: sharedText,
              html: sharedHtml,
            },
          },
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        })
        .where(eq(schema.sharedReportEvaluationRuns.id, evaluationRunId));

      await releaseAiMediationReviewReservation(resolved.db, reviewReservationId);
      reviewReservationId = null;

      await resolved.db
        .update(schema.sharedReportRecipientRevisions)
        .set({
          workflowStep: 3,
          updatedAt: completedAt,
        })
        .where(eq(schema.sharedReportRecipientRevisions.id, currentDraft.id));

      ok(res, 200, {
        ok: true,
        evaluation_id: evaluationRunId,
        evaluation: {
          public_report: projection.public_report || {},
          evaluation_result: projection.evaluation_result || {},
          status: 'success',
          runtime_diagnostics: mapRecipientSafeEvaluationDiagnostics({
            id: evaluationRunId,
            status: 'success',
            resultJson: {
              evaluation_diagnostics: completedEvaluationDiagnostics,
            },
            resultPublicReport: projection.public_report || {},
          }),
        },
      });

      logTokenEvent(context, 'evaluate_success', token, {
        linkId: resolved.link.id,
        revisionId: currentDraft.id,
        evaluationId: evaluationRunId,
      });
    } catch (error: any) {
      const failure = toApiError(error);
      logEvaluationRuntime(context, 'evaluation_failed', {
        evaluationId: evaluationRunId,
        statusCode: failure.statusCode,
        errorCode: failure.code,
        evaluatorElapsedMs:
          evaluatorStartedAt === null ? null : Date.now() - evaluatorStartedAt,
        routeElapsedMs: Date.now() - routeStartedAt,
        ...evaluationDiagnostics,
      });
      const failedAt = new Date();
      await resolved.db
        .update(schema.sharedReportEvaluationRuns)
        .set({
          status: 'error',
          errorCode: failure.code,
          errorMessage: failure.message,
          resultJson: {
            error: {
              code: failure.code,
              message: failure.message,
              status_code: failure.statusCode,
            },
            evaluation_diagnostics: {
              ...evaluationDiagnostics,
              evaluatorElapsedMs:
                evaluatorStartedAt === null ? null : Date.now() - evaluatorStartedAt,
              routeElapsedMs: Date.now() - routeStartedAt,
              failureReason: failure.code,
            },
          },
          updatedAt: failedAt,
        })
        .where(eq(schema.sharedReportEvaluationRuns.id, evaluationRunId));
      await releaseAiMediationReviewReservation(resolved.db, reviewReservationId);
      reviewReservationId = null;
      throw failure;
    }
  });
}
