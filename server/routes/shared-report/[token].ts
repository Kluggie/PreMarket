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
  getToken,
  logTokenEvent,
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
    const defaults = {
      shared_payload: buildDefaultSharedPayload({
        proposal: resolved.proposal,
        comparison: resolved.comparison,
      }),
      recipient_confidential_payload: buildDefaultConfidentialPayload(),
    };

    ok(res, 200, {
      share: buildShareView(resolved.link),
      parent: buildParentView({
        proposal: resolved.proposal,
        comparison: resolved.comparison,
        owner: resolved.owner,
      }),
      latestReport: buildLatestReport({
        proposal: resolved.proposal,
        comparison: resolved.comparison,
      }),
      currentDraft: mapDraftView(currentDraft),
      defaults,
    });

    logTokenEvent(context, 'resolve_success', token, {
      linkId: resolved.link.id,
      hasDraft: Boolean(currentDraft),
    });
  });
}
