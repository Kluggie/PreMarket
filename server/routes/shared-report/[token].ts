import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { logAuditEventBestEffort } from '../../_lib/audit-events.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  getLinkRecipientAuthorRole,
  loadSharedReportHistory,
  resolveSharedReportLinkRound,
} from '../../_lib/shared-report-history.js';
import {
  buildDefaultConfidentialPayload,
  SHARED_REPORT_ROUTE,
  buildDefaultSharedPayload,
  buildLatestReport,
  buildParentView,
  buildShareView,
  getCurrentRecipientDraft,
  getLatestRecipientEvaluationRun,
  getLatestRecipientSentRevision,
  getToken,
  logTokenEvent,
  mapEvaluationRunView,
  mapDraftView,
  getRecipientAuthorizationState,
  resolveSharedReportToken,
} from './_shared.js';

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
      enforceMaxUses: true,
    });

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    const latestEvaluation = await getLatestRecipientEvaluationRun(resolved.db, resolved.link.id);
    const latestSentRevision = await getLatestRecipientSentRevision(resolved.db, resolved.link.id);
    const sharedHistory = await loadSharedReportHistory({
      db: resolved.db,
      proposal: resolved.proposal,
      comparison: resolved.comparison,
    });
    const currentLinkRound = resolveSharedReportLinkRound(resolved.link.reportMetadata);
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
    const shareView: any = buildShareView(resolved.link);
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

    if (!isAuthenticated) {
      shareView.invited_email = null;
    }
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

    ok(res, 200, {
      share: shareView,
      parent: buildParentView({
        proposal: resolved.proposal,
        comparison: resolved.comparison,
        owner: resolved.owner,
      }),
      comparison: {
        id: resolved.comparison?.id || resolved.proposal.documentComparisonId || null,
        title: resolved.comparison?.title || resolved.proposal.title || 'Shared Report',
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
      shared_history: {
        entries: sharedHistory.sharedEntries,
        max_round_number: sharedHistory.maxRoundNumber,
      },
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
