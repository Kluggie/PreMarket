import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
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
      if (!(error instanceof ApiError) || error.code !== 'unauthorized') {
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
        created_at: resolved.comparison?.createdAt || resolved.proposal.createdAt || null,
        updated_at: resolved.comparison?.updatedAt || resolved.proposal.updatedAt || null,
      },
      baseline: {
        shared_payload: baselineSharedPayload,
        ai_report: baselineAiReport,
      },
      baseline_shared: baselineSharedPayload,
      baseline_ai_report: baselineAiReport,
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
