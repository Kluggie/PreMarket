import { eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
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
  getToken,
  logTokenEvent,
  resolveSharedReportToken,
  stableJsonEquals,
  toObject,
} from '../_shared.js';

const SHARED_REPORT_DRAFT_ROUTE = `${SHARED_REPORT_ROUTE}/draft`;

function pickSharedPayload(body: Record<string, unknown>) {
  return body.shared_payload ?? body.sharedPayload ?? {};
}

function pickConfidentialPayload(body: Record<string, unknown>) {
  return body.recipient_confidential_payload ?? body.recipientConfidentialPayload ?? {};
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_DRAFT_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

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
      enforceMaxUses: false,
    });

    const body = await readJsonBody(req);
    const sharedPayload = pickSharedPayload(body);
    const confidentialPayload = pickConfidentialPayload(body);

    assertJsonObjectField(sharedPayload, 'shared_payload');
    assertJsonObjectField(confidentialPayload, 'recipient_confidential_payload');
    assertPayloadSize(sharedPayload, 'shared_payload');
    assertPayloadSize(confidentialPayload, 'recipient_confidential_payload');

    const currentDraft = await getCurrentRecipientDraft(resolved.db, resolved.link.id);
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
          updatedAt: now,
        })
        .where(eq(schema.sharedReportRecipientRevisions.id, currentDraft.id))
        .returning();
      savedDraft = updated || currentDraft;
    } else {
      const [created] = await resolved.db
        .insert(schema.sharedReportRecipientRevisions)
        .values({
          id: newId('share_rev'),
          sharedLinkId: resolved.link.id,
          proposalId: resolved.proposal.id,
          comparisonId: resolved.comparison?.id || null,
          actorRole: RECIPIENT_ROLE,
          status: DRAFT_STATUS,
          sharedPayload,
          recipientConfidentialPayload: confidentialPayload,
          previousRevisionId: null,
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
