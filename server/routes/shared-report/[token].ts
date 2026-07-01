import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../_lib/audit-events.js';
import { schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { buildSharedReportScopedActivityHistory } from '../../_lib/proposal-activity.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  buildReviewContextHistoryState,
  buildDraftContributionEntries,
  buildSharedHistoryComposite,
  formatContributionsForAi,
  getLinkRecipientAuthorRole,
  loadSharedReportHistory,
  resolveSharedReportLinkRound,
} from '../../_lib/shared-report-history.js';
import { evaluateMeaningfulPayloadContribution } from '../../_lib/meaningful-recipient-contribution.js';
import {
  buildMediationRoundContext,
  enrichMediationRoundContext,
  extractMediationReport,
} from '../../_lib/mediation-progress.js';
import {
  buildEvidenceCandidatesFromContributions,
  buildPriorMediationEvidenceCandidate,
} from '../../_lib/mediation-evidence-retrieval.js';
import {
  buildBudgetedContext,
  buildConvergenceDigest,
} from '../../_lib/evaluation-context-budget.js';
import { mapProposalOutcomeForUser } from '../../_lib/proposal-outcomes.js';
import { getProposalThreadState } from '../../_lib/proposal-thread-state.js';
import {
  buildMediationContextEstimate,
  estimateRetrievedContextFromCandidates,
} from '../../../src/lib/mediationContextLoad.js';
import {
  asText,
  buildDefaultConfidentialPayload,
  SHARED_REPORT_ROUTE,
  buildDefaultSharedPayload,
  buildLatestReport,
  buildParentView,
  buildShareViewWithReviewState,
  computeDraftContentHash,
  extractPayloadText,
  getCurrentRecipientDraft,
  getPayloadText,
  getRecipientAiReviewStateForRound,
  getLatestRecipientEvaluationRun,
  getLatestRecipientSentRevision,
  getToken,
  logTokenEvent,
  mapEvaluationRunView,
  mapDraftView,
  getRecipientAuthorizationState,
  getAiReviewFreshnessForDraft,
  resolveSharedReportToken,
  toObject,
} from './_shared.js';

function coercePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return null;
  }
  return Math.floor(numeric);
}

function mapConfidentialHistoryEntry(entry: any) {
  const payload = toObject(entry?.contentPayload);
  const authorRole = asText(entry?.authorRole).toLowerCase();
  const authorLabel = asText(entry?.authorLabel) || (authorRole === 'proposer' ? 'Proposer' : 'Recipient');
  return {
    id: entry?.id || null,
    author_role: authorRole || null,
    author_label: authorLabel,
    visibility: 'confidential',
    visibility_label: `Confidential to ${authorLabel}`,
    round_number: coercePositiveInt(entry?.roundNumber),
    sequence_index: coercePositiveInt(entry?.sequenceIndex),
    source_kind: asText(entry?.sourceKind) || 'manual',
    label: asText(payload.label) || `Confidential to ${authorLabel}`,
    text: asText(payload.text || payload.notes),
    html: asText(payload.html),
    json:
      payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
        ? payload.json
        : null,
    source: asText(payload.source) || 'typed',
    files: Array.isArray(payload.files) ? payload.files : [],
    created_at: entry?.createdAt || null,
    updated_at: entry?.updatedAt || null,
    synthetic: Boolean(entry?.synthetic),
  };
}

async function loadSharedReportLinkLineage(db: any, seedLink: any) {
  const lineage = [];
  const seen = new Set<string>();
  let cursor = seedLink || null;

  while (cursor) {
    const cursorId = asText(cursor?.id);
    if (!cursorId || seen.has(cursorId)) {
      break;
    }
    lineage.push(cursor);
    seen.add(cursorId);

    const metadata = toObject(cursor?.reportMetadata);
    const parentLinkId = asText(metadata.parent_link_id || metadata.parentLinkId);
    const parentToken = asText(metadata.parent_token || metadata.parentToken);

    let parent = null;
    if (parentLinkId) {
      const [row] = await db
        .select()
        .from(schema.sharedLinks)
        .where(eq(schema.sharedLinks.id, parentLinkId))
        .limit(1);
      parent = row || null;
    } else if (parentToken) {
      const [row] = await db
        .select()
        .from(schema.sharedLinks)
        .where(eq(schema.sharedLinks.token, parentToken))
        .limit(1);
      parent = row || null;
    }

    cursor = parent;
  }

  return lineage;
}

function buildLineageScopeFromLinks(links: any[], comparisonId: string) {
  const lineageLinkIds: string[] = [];
  const lineageLinkTokens: string[] = [];
  const lineageRecipientEmails: string[] = [];
  const lineageComparisonIds: string[] = [];
  const seenComparisonIds = new Set<string>();

  (Array.isArray(links) ? links : []).forEach((link) => {
    const linkId = asText(link?.id);
    if (linkId) {
      lineageLinkIds.push(linkId);
    }

    const linkToken = asText(link?.token);
    if (linkToken) {
      lineageLinkTokens.push(linkToken);
    }

    const recipientEmail = asText(link?.recipientEmail || link?.recipient_email).toLowerCase();
    if (recipientEmail) {
      lineageRecipientEmails.push(recipientEmail);
    }

    const metadata = toObject(link?.reportMetadata);
    const metadataComparisonId = asText(metadata.comparison_id || metadata.comparisonId);
    if (metadataComparisonId && !seenComparisonIds.has(metadataComparisonId)) {
      lineageComparisonIds.push(metadataComparisonId);
      seenComparisonIds.add(metadataComparisonId);
    }
  });

  const normalizedComparisonId = asText(comparisonId);
  if (normalizedComparisonId && !seenComparisonIds.has(normalizedComparisonId)) {
    lineageComparisonIds.push(normalizedComparisonId);
  }

  return {
    lineageLinkIds,
    lineageLinkTokens,
    lineageRecipientEmails,
    lineageComparisonIds,
  };
}

const MAX_HISTORY_ROUNDS = 4;

async function getExchangeHistory(
  db: any,
  params: {
    proposalId: string;
    comparisonId?: string | null;
  },
) {
  const conditions = [
    eq(schema.sharedReportEvaluationRuns.proposalId, params.proposalId),
    eq(schema.sharedReportEvaluationRuns.actorRole, 'recipient'),
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
    .limit(MAX_HISTORY_ROUNDS + 1);

  const ordered = runs.reverse();
  const trimmed = ordered.length > MAX_HISTORY_ROUNDS
    ? ordered.slice(ordered.length - MAX_HISTORY_ROUNDS)
    : ordered;

  return trimmed.map((run: any, index: number) => {
    const json = toObject(run.resultJson);
    const snapshot = toObject(json?.shared_snapshot);
    const inputTrace = toObject(json?.input_trace);
    const evalResult = toObject(json?.evaluation_result);
    const evalReport = toObject(evalResult?.report);
    const missingSource = Array.isArray(evalReport?.missing)
      ? evalReport.missing
      : Array.isArray(evalResult?.missing)
        ? evalResult.missing
        : [];
    const missingQuestions = missingSource
      .map((entry: any) => asText(entry?.text ?? entry))
      .filter(Boolean);
    const roundNumber = Number(inputTrace?.exchange_round || 0);

    return {
      round: Number.isFinite(roundNumber) && roundNumber >= 1 ? Math.floor(roundNumber) : index + 1,
      evaluationRunId: asText(run.id),
      sharedTextSnapshot: asText(snapshot?.text),
      sharedTextLength: Number(inputTrace?.shared_length || 0) || 0,
      confidentialLength: Number(inputTrace?.confidential_length || 0) || 0,
      missingQuestions,
      report: extractMediationReport(evalReport),
      createdAt: run.createdAt,
    };
  });
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_ROUTE, async (context) => {
    ensureMethod(req, ['GET']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    let currentUser: any = null;
    try {
      const auth = await requireUser(req, res);
      if (auth.ok) {
        currentUser = auth.user;
      }
    } catch (error: any) {
      if (
        !(error instanceof ApiError) ||
        (error.code !== 'unauthorized' && error.code !== 'mfa_required')
      ) {
        throw error;
      }
    }

    logTokenEvent(context, 'resolve_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: true,
    });
    const currentLinkRound = resolveSharedReportLinkRound(resolved.link.reportMetadata);
    const activeRoundNumber = currentLinkRound + 1;
    const lineageLinks = await loadSharedReportLinkLineage(resolved.db, resolved.link);
    const comparisonId = asText(resolved.comparison?.id || resolved.proposal?.documentComparisonId);
    const lineageScope = buildLineageScopeFromLinks(lineageLinks, comparisonId);

    const [
      currentDraft,
      latestEvaluation,
      latestSentRevision,
      sharedHistory,
      activityEvents,
      lineageRevisionRows,
      lineageEvaluationRows,
      recipientAiReviewState,
    ] = await Promise.all([
      getCurrentRecipientDraft(resolved.db, resolved.link.id),
      getLatestRecipientEvaluationRun(resolved.db, resolved.link.id),
      getLatestRecipientSentRevision(resolved.db, resolved.link.id),
      loadSharedReportHistory({
        db: resolved.db,
        proposal: resolved.proposal,
        comparison: resolved.comparison,
      }),
      resolved.proposal?.id
        ? resolved.db
            .select({
              id: schema.proposalEvents.id,
              eventType: schema.proposalEvents.eventType,
              actorRole: schema.proposalEvents.actorRole,
              createdAt: schema.proposalEvents.createdAt,
              eventData: sql`jsonb_build_object(
                'shared_link_id', coalesce(${schema.proposalEvents.eventData}->>'shared_link_id', ${schema.proposalEvents.eventData}->>'sharedLinkId', ${schema.proposalEvents.eventData}->>'link_id', ${schema.proposalEvents.eventData}->>'linkId', ${schema.proposalEvents.eventData}->>'share_id', ${schema.proposalEvents.eventData}->>'shareId', ${schema.proposalEvents.eventData}->>'shared_report_link_id', ${schema.proposalEvents.eventData}->>'sharedReportLinkId'),
                'shared_link_token', coalesce(${schema.proposalEvents.eventData}->>'shared_link_token', ${schema.proposalEvents.eventData}->>'sharedLinkToken', ${schema.proposalEvents.eventData}->>'share_token', ${schema.proposalEvents.eventData}->>'shareToken', ${schema.proposalEvents.eventData}->>'link_token', ${schema.proposalEvents.eventData}->>'linkToken', ${schema.proposalEvents.eventData}->>'token'),
                'recipient_email', coalesce(${schema.proposalEvents.eventData}->>'recipient_email', ${schema.proposalEvents.eventData}->>'recipientEmail'),
                'revision_id', coalesce(${schema.proposalEvents.eventData}->>'revision_id', ${schema.proposalEvents.eventData}->>'revisionId'),
                'evaluation_run_id', coalesce(${schema.proposalEvents.eventData}->>'evaluation_run_id', ${schema.proposalEvents.eventData}->>'evaluationRunId'),
                'comparison_id', coalesce(${schema.proposalEvents.eventData}->>'comparison_id', ${schema.proposalEvents.eventData}->>'comparisonId', ${schema.proposalEvents.eventData}->>'document_comparison_id', ${schema.proposalEvents.eventData}->>'documentComparisonId')
              )`,
              versionSnapshot: sql`jsonb_build_object(
                'proposal', jsonb_build_object(
                  'partyBEmail', ${schema.proposalVersions.snapshotData}->'proposal'->>'partyBEmail',
                  'party_b_email', ${schema.proposalVersions.snapshotData}->'proposal'->>'party_b_email',
                  'documentComparisonId', ${schema.proposalVersions.snapshotData}->'proposal'->>'documentComparisonId',
                  'document_comparison_id', ${schema.proposalVersions.snapshotData}->'proposal'->>'document_comparison_id'
                ),
                'sharedLinks', coalesce(${schema.proposalVersions.snapshotData}->'sharedLinks', '[]'::jsonb),
                'recipientRevisions', coalesce(${schema.proposalVersions.snapshotData}->'recipientRevisions', '[]'::jsonb),
                'evaluations', coalesce(${schema.proposalVersions.snapshotData}->'evaluations', '[]'::jsonb),
                'documentComparison', jsonb_build_object(
                  'id', ${schema.proposalVersions.snapshotData}->'documentComparison'->>'id'
                )
              )`,
            })
            .from(schema.proposalEvents)
            .leftJoin(
              schema.proposalVersions,
              eq(schema.proposalVersions.id, schema.proposalEvents.proposalVersionId),
            )
            .where(eq(schema.proposalEvents.proposalId, resolved.proposal.id))
            .orderBy(desc(schema.proposalEvents.createdAt))
            .limit(100)
        : Promise.resolve([]),
      lineageScope.lineageLinkIds.length > 0
        ? resolved.db
            .select({ id: schema.sharedReportRecipientRevisions.id })
            .from(schema.sharedReportRecipientRevisions)
            .where(inArray(schema.sharedReportRecipientRevisions.sharedLinkId, lineageScope.lineageLinkIds))
        : Promise.resolve([]),
      lineageScope.lineageLinkIds.length > 0
        ? resolved.db
            .select({ id: schema.sharedReportEvaluationRuns.id })
            .from(schema.sharedReportEvaluationRuns)
            .where(inArray(schema.sharedReportEvaluationRuns.sharedLinkId, lineageScope.lineageLinkIds))
        : Promise.resolve([]),
      getRecipientAiReviewStateForRound(resolved.db, {
        link: resolved.link,
        outgoingRoundNumber: activeRoundNumber,
      }),
    ]);
    const currentUserId = asText(currentUser?.id || currentUser?.sub);
    const proposalOwnerUserId = asText(resolved.proposal?.userId);

    // Compute AI review freshness state
    const recipientAiReviewFreshness = await getAiReviewFreshnessForDraft(resolved.db, {
      link: resolved.link,
      currentDraft,
    });

    const activityAccessMode =
      currentUserId && proposalOwnerUserId
        ? currentUserId === proposalOwnerUserId
          ? 'owner'
          : 'recipient'
        : currentUser
          ? 'recipient'
          : 'token';
    const activityParticipantContext = {
      party_a: {
        company_name: asText(resolved.comparison?.companyName),
        email: asText(resolved.proposal?.partyAEmail),
      },
      party_b: {
        name: asText(resolved.comparison?.recipientName || (resolved.proposal as any)?.partyBName),
        email: asText(resolved.comparison?.recipientEmail || resolved.proposal?.partyBEmail),
      },
    };
    const activityHistory = buildSharedReportScopedActivityHistory(activityEvents, {
      accessMode: activityAccessMode,
      limit: 8,
      participantContext: activityParticipantContext,
      scope: {
        ...lineageScope,
        comparisonId,
        lineageRevisionIds: (Array.isArray(lineageRevisionRows) ? lineageRevisionRows : []).map((row) =>
          asText(row?.id),
        ),
        lineageEvaluationRunIds: (Array.isArray(lineageEvaluationRows) ? lineageEvaluationRows : []).map((row) =>
          asText(row?.id),
        ),
      },
    });
    const draftAuthorRole = getLinkRecipientAuthorRole({
      proposal: resolved.proposal,
      link: resolved.link,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: 'shared-report/[token]',
          event: 'workspace_build_start',
          comparisonId: resolved.comparison?.id || null,
          docBTextLength: String(resolved.comparison?.docBText || '').length,
          docBTextPreview: String(resolved.comparison?.docBText || '').slice(0, 80) || '(empty)',
          publicReportKeys: resolved.comparison?.publicReport
            ? Object.keys(resolved.comparison.publicReport)
            : [],
          proposalId: resolved.proposal?.id || null,
          reportMetadata: resolved.link?.reportMetadata || {},
        }),
      );
    }

    const baselineSharedPayload = buildDefaultSharedPayload({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const baselineAiReport = buildLatestReport({
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const defaults = {
      shared_payload: baselineSharedPayload,
      recipient_confidential_payload: buildDefaultConfidentialPayload(),
    };
    const recipientAuthorization = getRecipientAuthorizationState(resolved.link, currentUser);
    const treatAsRecipientViewer = Boolean(
      currentUser &&
      recipientAuthorization.authorized &&
      currentUserId &&
      proposalOwnerUserId &&
      currentUserId !== proposalOwnerUserId,
    );
    const canViewOwnHistoricalConfidential = Boolean(currentUser && recipientAuthorization.authorized);
    const visibleConfidentialHistoryEntries = canViewOwnHistoricalConfidential
      ? (Array.isArray(sharedHistory.confidentialEntries) ? sharedHistory.confidentialEntries : [])
          .filter((entry) => asText(entry?.authorRole).toLowerCase() === draftAuthorRole)
          .filter((entry) => {
            const roundNumber = coercePositiveInt(entry?.roundNumber);
            if (roundNumber === null) {
              return true;
            }
            return roundNumber < activeRoundNumber;
          })
          .map((entry) => mapConfidentialHistoryEntry(entry))
      : [];
    const parentOutcome = currentUser
      ? mapProposalOutcomeForUser(resolved.proposal, currentUser, {
          authorizedRecipientUserId: resolved.link.authorizedUserId,
          sharedReceivedProposalIds: treatAsRecipientViewer ? [resolved.proposal.id] : [],
        })
      : null;
    const parentThreadState = parentOutcome
      ? getProposalThreadState(resolved.proposal, currentUser, {
          actorRole: parentOutcome.actor_role || null,
          outcome: parentOutcome,
        })
      : null;
    const shareView: any = buildShareViewWithReviewState(resolved.link, {
      ...recipientAiReviewState,
      hasCurrentAiReview: recipientAiReviewFreshness.hasCurrentReview,
      hasStaleAiReview: recipientAiReviewFreshness.hasStaleReview,
      canRunExtraAiReview: recipientAiReviewFreshness.canRunExtraReview,
      staleReviewEvaluationId: recipientAiReviewFreshness.staleReviewEvaluationId,
      currentReviewEvaluationId: recipientAiReviewFreshness.currentReviewEvaluationId,
    });
    const isAuthenticated = Boolean(currentUser);
    const canViewAuthorizationDetails = Boolean(isAuthenticated && recipientAuthorization.aliasVerifiedMatch);

    await logAuditEventBestEffort({
      eventType: 'share.link.accessed',
      userId: resolved.link.userId,
      req,
      metadata: {
        share_id: resolved.link.id,
        proposal_id: resolved.proposal?.id || null,
        authenticated: isAuthenticated,
      },
    });

    if (!canViewAuthorizationDetails) {
      shareView.authorization = {
        ...(shareView.authorization || {}),
        authorized_email: null,
        authorized_at: null,
      };
    }
    shareView.authorization = {
      ...(shareView.authorization || {}),
      authorized_for_current_user: recipientAuthorization.authorized,
      direct_email_match: recipientAuthorization.directEmailMatch,
      alias_verified_match: recipientAuthorization.aliasVerifiedMatch,
      requires_verification: recipientAuthorization.requiresVerification,
    };

    const effectiveDraft = currentDraft || {
      sharedPayload: baselineSharedPayload,
      recipientConfidentialPayload: defaults.recipient_confidential_payload,
      createdAt: null,
      updatedAt: null,
    };
    const sharedPayload = toObject(effectiveDraft.sharedPayload || baselineSharedPayload);
    const confidentialPayload = toObject(
      effectiveDraft.recipientConfidentialPayload || defaults.recipient_confidential_payload,
    );
    const outgoingRoundNumber = currentLinkRound + 1;
    const sharedFallbackText = asText(baselineSharedPayload?.text);
    const currentRoundSharedText = getPayloadText(sharedPayload, sharedFallbackText);
    const currentRoundConfidentialText = getPayloadText(confidentialPayload, '');
    const sharedDraftContribution = evaluateMeaningfulPayloadContribution({
      payload: sharedPayload,
      baselinePayload: baselineSharedPayload,
      defaultLabel: 'Shared by Recipient',
      visibility: 'shared',
    });
    const confidentialDraftContribution = evaluateMeaningfulPayloadContribution({
      payload: confidentialPayload,
      baselinePayload: defaults.recipient_confidential_payload,
      defaultLabel: 'Confidential to Recipient',
      visibility: 'confidential',
    });
    const draftEntries = buildDraftContributionEntries({
      authorRole: draftAuthorRole,
      roundNumber: outgoingRoundNumber,
      sharedPayload,
      confidentialPayload,
      sourceKind: 'draft',
      createdAt: effectiveDraft.createdAt || null,
      updatedAt: effectiveDraft.updatedAt || null,
    });
    const draftSharedEntries = draftEntries.filter(
      (entry: any) => entry.visibility === 'shared' && sharedDraftContribution.hasMeaningfulContribution,
    );
    const draftConfidentialEntries = draftEntries.filter(
      (entry: any) =>
        entry.visibility === 'confidential' && confidentialDraftContribution.hasMeaningfulContribution,
    );
    const sharedHistoryEntriesForAi = [
      ...sharedHistory.contributions.filter((entry: any) => entry.visibility === 'shared'),
      ...draftSharedEntries,
    ];
    const confidentialHistoryEntriesForAi = [
      ...sharedHistory.contributions.filter((entry: any) => entry.visibility === 'confidential'),
      ...draftConfidentialEntries,
    ];
    const sharedText = formatContributionsForAi(sharedHistoryEntriesForAi);
    const confidentialText = formatContributionsForAi(confidentialHistoryEntriesForAi);
    const visibleSharedBundle = buildSharedHistoryComposite([
      ...sharedHistory.sharedEntries,
      ...draftSharedEntries.map((entry: any) => ({
        id: entry.id,
        visibility_label: `Shared by ${entry.authorLabel}`,
        label: entry.contentPayload?.label || `Shared by ${entry.authorLabel}`,
        text: entry.contentPayload?.text || '',
        html: entry.contentPayload?.html || '',
        source: entry.contentPayload?.source || 'typed',
        files: entry.contentPayload?.files || [],
      })),
    ]);
    const exchangeHistory = await getExchangeHistory(resolved.db, {
      proposalId: resolved.proposal.id,
      comparisonId: resolved.comparison?.id || null,
    });
    const sharedSnapshotByRound = new Map(
      sharedHistory.sharedRoundSnapshots.map((entry: any) => [Number(entry.round || 0), entry.sharedTextSnapshot]),
    );
    const normalizedExchangeHistory = exchangeHistory.map((entry: any) => ({
      ...entry,
      sharedTextSnapshot:
        asText(sharedSnapshotByRound.get(Number(entry.round || 0))) || entry.sharedTextSnapshot,
    }));
    const priorBilateralRounds = normalizedExchangeHistory.filter((entry: any) => entry.report);
    const reviewContextHistory = buildReviewContextHistoryState({
      contributions: sharedHistory.contributions,
      outgoingRoundNumber,
      previousReviewsConsidered: priorBilateralRounds.length,
    });
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
    const priorEvalSnapshots = normalizedExchangeHistory.map((entry: any) => ({
      round: entry.round,
      sharedTextSnapshot: entry.sharedTextSnapshot,
      missingQuestions: entry.missingQuestions || [],
      createdAt: entry.createdAt,
    }));
    const convergenceDigest = buildConvergenceDigest(priorEvalSnapshots, sharedText);
    const budgeted = buildBudgetedContext({
      currentSharedText: sharedText,
      confidentialText,
      historyRounds: [],
      priorEvaluationRounds: priorEvalSnapshots,
    });
    const retrievalCandidates = [
      ...buildEvidenceCandidatesFromContributions(
        reviewContextHistory.priorRoundEntries,
      ),
      ...priorBilateralRounds
        .map((round: any) =>
          buildPriorMediationEvidenceCandidate({
            id: round.evaluationRunId,
            roundNumber: round.round,
            report: round.report,
            createdAt: round.createdAt,
          }),
        )
        .filter(Boolean),
    ];
    const retrievedEstimate = estimateRetrievedContextFromCandidates(retrievalCandidates);
    const omittedDueToCapacity = [];
    if (budgeted.budget.trimmedFromShared > 0) {
      omittedDueToCapacity.push(`${budgeted.budget.trimmedFromShared.toLocaleString()} shared chars trimmed`);
    }
    if (budgeted.budget.trimmedFromConfidential > 0) {
      omittedDueToCapacity.push(`${budgeted.budget.trimmedFromConfidential.toLocaleString()} confidential chars trimmed`);
    }
    if (retrievedEstimate.omittedRetrievedChunkCount > 0) {
      omittedDueToCapacity.push(`${retrievedEstimate.omittedRetrievedChunkCount.toLocaleString()} retrieved chunks omitted`);
    }
    const reviewContextEstimate = buildMediationContextEstimate({
      visibleSharedText: visibleSharedBundle.text || '',
      visibleConfidentialText: currentRoundConfidentialText,
      directSharedText: budgeted.sharedText,
      directConfidentialText: budgeted.confidentialText,
      priorRoundText: formatContributionsForAi(reviewContextHistory.priorRoundEntries),
      summaryMemoryText: [
        convergenceDigest?.digestText || '',
        priorBilateralRounds.length > 0 && mediationRoundContext ? JSON.stringify(mediationRoundContext) : '',
      ].filter(Boolean).join('\n'),
      retrievedChunkCount: retrievedEstimate.retrievedChunkCount,
      retrievedContextTokens: retrievedEstimate.retrievedContextTokens,
      initialProposalContextIncluded: reviewContextHistory.initialProposalContextIncluded,
      priorRoundsConsidered: reviewContextHistory.priorRoundsConsidered,
      previousReviewsConsidered: reviewContextHistory.previousReviewsConsidered,
      omittedDueToCapacity,
      estimatorMode: 'workspace_preflight',
    });

    if (process.env.NODE_ENV !== 'production') {
      console.info(
        JSON.stringify({
          level: 'info',
          route: 'shared-report/[token]',
          event: 'workspace_review_context_estimate',
          comparisonId: resolved.comparison?.id || null,
          proposalId: resolved.proposal?.id || null,
          reviewContextEstimate,
        }),
      );
    }

    ok(res, 200, {
      share: shareView,
      parent: buildParentView({
        proposal: resolved.proposal,
        comparison: resolved.comparison,
        owner: resolved.owner,
        outcome: parentOutcome,
        primaryStatusKey: parentThreadState?.primaryStatusKey || null,
        primaryStatusLabel: parentThreadState?.primaryStatusLabel || null,
      }),
      comparison: {
        id: resolved.comparison?.id || resolved.proposal.documentComparisonId || null,
        title: resolved.comparison?.title || resolved.proposal.title || 'Shared Report',
        counterparty_name: resolved.comparison?.recipientName || (resolved.proposal as any)?.partyBName || null,
        status: resolved.comparison?.status || resolved.proposal.status || null,
        company_name: resolved.comparison?.companyName || null,
        company_website: resolved.comparison?.companyWebsite || null,
        created_at: resolved.comparison?.createdAt || resolved.proposal.createdAt || null,
        updated_at: resolved.comparison?.updatedAt || resolved.proposal.updatedAt || null,
      },
      baseline: {
        shared_payload: baselineSharedPayload,
        ai_report: baselineAiReport,
      },
      baseline_shared: baselineSharedPayload,
      baseline_ai_report: baselineAiReport,
      review_context_estimate: reviewContextEstimate,
      shared_history: {
        entries: sharedHistory.sharedEntries,
        confidential_entries: visibleConfidentialHistoryEntries,
        max_round_number: sharedHistory.maxRoundNumber,
      },
      activity_history: activityHistory,
      party_context: {
        draft_author_role: draftAuthorRole,
        current_link_round: currentLinkRound,
        next_outgoing_round: currentLinkRound + 1,
      },
      latestEvaluation: mapEvaluationRunView(latestEvaluation),
      latestReport:
        latestEvaluation?.status === 'success' && latestEvaluation?.resultPublicReport
          ? latestEvaluation.resultPublicReport
          : baselineAiReport,
      recipientDraft: mapDraftView(currentDraft),
      currentDraft: mapDraftView(currentDraft),
      latestSentRevision: mapDraftView(latestSentRevision),
      defaults,
    });

    logTokenEvent(context, 'resolve_success', token, {
      linkId: resolved.link.id,
      hasDraft: Boolean(currentDraft),
      hasEvaluation: Boolean(latestEvaluation),
    });
  });
}
