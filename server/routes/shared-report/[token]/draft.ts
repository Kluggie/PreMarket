import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { schema } from '../../../_lib/db/client.js';
import {
  DRAFT_STATUS,
  RECIPIENT_ROLE,
  SHARED_REPORT_ROUTE,
  buildDefaultConfidentialPayload,
  assertJsonObjectField,
  assertPayloadSize,
  buildDefaultSharedPayload,
  getCurrentRecipientDraft,
  getLatestRecipientSentRevision,
  getToken,
  logTokenEvent,
  resolveSharedReportToken,
  clampWorkflowStep,
  requireRecipientAuthorization,
  stableJsonEquals,
  toObject,
} from '../_shared.js';

const SHARED_REPORT_DRAFT_ROUTE = `${SHARED_REPORT_ROUTE}/draft`;
const IMMUTABLE_HISTORY_DOC_PREFIXES = [
  'shared-history-',
  'confidential-history-',
  'history-confidential-',
];

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickSharedPayload(body: Record<string, unknown>) {
  return body.shared_payload ?? body.sharedPayload ?? {};
}

function pickConfidentialPayload(body: Record<string, unknown>) {
  return body.recipient_confidential_payload ?? body.recipientConfidentialPayload ?? {};
}

function pickWorkflowStep(body: Record<string, unknown>) {
  return body.workflow_step ?? body.workflowStep ?? body.step ?? body.draft_step ?? 0;
}

function pickEditorState(body: Record<string, unknown>) {
  return body.editor_state ?? body.editorState ?? {};
}

function assertNoHistoricalDocumentReferences(editorState: Record<string, unknown>) {
  const documents = Array.isArray(editorState.documents) ? editorState.documents : [];
  const hasHistoricalReference = documents.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const doc = entry as Record<string, unknown>;
    const id = asText(doc.id).toLowerCase();
    if (id && IMMUTABLE_HISTORY_DOC_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      return true;
    }
    if (doc.isHistoricalRound === true || doc.is_historical_round === true) {
      return true;
    }
    const historySource = asText(doc.historySource || doc.history_source || doc.historyOrigin || doc.history_origin)
      .toLowerCase();
    return historySource === 'previous_round';
  });

  if (hasHistoricalReference) {
    throw new ApiError(
      403,
      'historical_round_read_only',
      'Previous round content is view-only and cannot be changed',
    );
  }
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_DRAFT_ROUTE, async (context) => {
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

    logTokenEvent(context, 'draft_save_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
    });
    requireRecipientAuthorization(resolved.link, auth.user);

    const body = await readJsonBody(req);
    const sharedPayload = pickSharedPayload(body);
    const confidentialPayload = pickConfidentialPayload(body);
    const editorState = pickEditorState(body);

    assertJsonObjectField(sharedPayload, 'shared_payload');
    assertJsonObjectField(confidentialPayload, 'recipient_confidential_payload');
    assertJsonObjectField(editorState, 'editor_state');
    assertNoHistoricalDocumentReferences(editorState as Record<string, unknown>);
    assertPayloadSize(sharedPayload, 'shared_payload');
    assertPayloadSize(confidentialPayload, 'recipient_confidential_payload');
    assertPayloadSize(editorState, 'editor_state');

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
    const workflowStep = clampWorkflowStep(
      pickWorkflowStep(body),
      currentDraft ? Number(currentDraft.workflowStep || 0) : 0,
    );
    const baselineSharedPayload = currentDraft
      ? toObject(currentDraft.sharedPayload)
      : buildDefaultSharedPayload({
          proposal: resolved.proposal,
          comparison: resolved.comparison,
        });
    const baselineConfidentialPayload = currentDraft
      ? toObject(currentDraft.recipientConfidentialPayload)
      : buildDefaultConfidentialPayload();

    if (!resolved.link.canEdit && !stableJsonEquals(sharedPayload, baselineSharedPayload)) {
      throw new ApiError(403, 'edit_not_allowed', 'Shared Information is read-only for this link');
    }
    if (
      !resolved.link.canEditConfidential &&
      !stableJsonEquals(confidentialPayload, baselineConfidentialPayload)
    ) {
      throw new ApiError(403, 'confidential_edit_not_allowed', 'Confidential Information is read-only for this link');
    }

    const now = new Date();
    let savedDraft: any = null;

    if (currentDraft) {
      const [updated] = await resolved.db
        .update(schema.sharedReportRecipientRevisions)
        .set({
          sharedPayload,
          recipientConfidentialPayload: confidentialPayload,
          workflowStep,
          editorState,
          updatedAt: now,
        })
        .where(eq(schema.sharedReportRecipientRevisions.id, currentDraft.id))
        .returning();
      savedDraft = updated || currentDraft;
    } else {
      const latestSentRevision = await getLatestRecipientSentRevision(resolved.db, resolved.link.id);
      const [created] = await resolved.db
        .insert(schema.sharedReportRecipientRevisions)
        .values({
          id: newId('share_rev'),
          sharedLinkId: resolved.link.id,
          proposalId: resolved.proposal.id,
          comparisonId: resolved.comparison?.id || null,
          actorRole: RECIPIENT_ROLE,
          status: DRAFT_STATUS,
          workflowStep,
          sharedPayload,
          recipientConfidentialPayload: confidentialPayload,
          editorState,
          previousRevisionId: latestSentRevision?.id || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      savedDraft = created;
    }

    ok(res, 200, {
      ok: true,
      draft_id: savedDraft.id,
      updated_at: savedDraft.updatedAt || now,
    });

    logTokenEvent(context, 'draft_save_success', token, {
      linkId: resolved.link.id,
      draftId: savedDraft.id,
    });
  });
}
