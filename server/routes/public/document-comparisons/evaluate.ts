import { ok } from '../../../_lib/api-response.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import {
  assertGuestAiMediationAllowed,
  assertGuestPreviewEvaluationWithinLimits,
  buildGuestPreviewComparison,
  classifyGuestEvaluationFailure,
  recordGuestAiMediationSuccess,
  resolveGuestComparisonPreviewInput,
  runGuestEvaluationModel,
  toGuestEvaluationApiError,
  withGuestAttemptMetadata,
} from './_guest.js';

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/public/document-comparisons/evaluate', async (context: any) => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const previewInput = resolveGuestComparisonPreviewInput(body);
    assertGuestAiMediationAllowed(req, {
      guestDraftId: previewInput.guestDraftId,
      guestSessionId: previewInput.guestSessionId,
    });

    const requestId = typeof context?.requestId === 'string' && context.requestId.trim()
      ? context.requestId.trim()
      : newId('request');
    const inputTrace = assertGuestPreviewEvaluationWithinLimits({
      guestDraftId: previewInput.guestDraftId,
      docAText: previewInput.docAText,
      docBText: previewInput.docBText,
    });

    let evaluation: Record<string, unknown> | null = null;
    const attemptStartedAt = new Date();

    try {
      const evaluated = await runGuestEvaluationModel({
        title: previewInput.title,
        docAText: previewInput.docAText,
        docBText: previewInput.docBText,
        requestId,
      });
      evaluation = withGuestAttemptMetadata({
        evaluation: evaluated,
        requestId,
        attemptNumber: 1,
        startedAt: attemptStartedAt,
        completedAt: new Date(),
        inputTrace,
      });
    } catch (error: any) {
      const attemptCompletedAt = new Date();
      const classified = classifyGuestEvaluationFailure(error);
      throw toGuestEvaluationApiError({
        classified,
        requestId,
        attemptCount: 1,
      });
    }

    const comparison = buildGuestPreviewComparison({
      guestDraftId: previewInput.guestDraftId,
      title: previewInput.title,
      docAText: previewInput.docAText,
      docBText: previewInput.docBText,
      docAHtml: previewInput.docAHtml,
      docBHtml: previewInput.docBHtml,
      docAJson: previewInput.docAJson,
      docBJson: previewInput.docBJson,
      docASource: previewInput.docASource,
      docBSource: previewInput.docBSource,
      docAFiles: previewInput.docAFiles,
      docBFiles: previewInput.docBFiles,
    });
    recordGuestAiMediationSuccess(req, {
      guestDraftId: previewInput.guestDraftId,
      guestSessionId: previewInput.guestSessionId,
    });

    ok(res, 200, {
      comparison,
      evaluation: evaluation?.report || {},
      evaluation_result: evaluation,
      evaluation_input_trace: inputTrace,
      request_id: requestId,
      attempt_count: 1,
    });
  });
}
