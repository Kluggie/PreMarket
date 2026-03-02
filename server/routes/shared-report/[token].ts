import { ok } from '../../_lib/api-response.js';
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
  resolveSharedReportToken,
} from './_shared.js';

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_ROUTE, async (context) => {
    ensureMethod(req, ['GET']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
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

    ok(res, 200, {
      share: buildShareView(resolved.link),
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
