import { eq, sql } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getToken(req: any, tokenParam?: string) {
  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  const rawToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return String(rawToken || '').trim();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function normalizeVisibility(value: unknown) {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'hidden' || normalized === 'private' || normalized === 'not_shared') {
    return 'hidden';
  }
  return 'full';
}

function normalizeValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const text = String(value);
  return text.length > 0 ? text : null;
}

function parseResponseRows(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as Array<{
      questionId: string;
      value: string | null;
      valueType: string;
      rangeMin: string | null;
      rangeMax: string | null;
      visibility: string;
      metadata: Record<string, unknown>;
    }>;
  }

  return input
    .map((entry) => {
      const questionId = asText((entry as any)?.questionId || (entry as any)?.question_id);
      if (!questionId) {
        return null;
      }

      const value = normalizeValue((entry as any)?.value);
      const rangeMin = asText((entry as any)?.rangeMin || (entry as any)?.range_min) || null;
      const rangeMax = asText((entry as any)?.rangeMax || (entry as any)?.range_max) || null;
      if (!value && !rangeMin && !rangeMax) {
        return null;
      }

      return {
        questionId,
        value,
        valueType: asText((entry as any)?.valueType || (entry as any)?.value_type) || 'text',
        rangeMin,
        rangeMax,
        visibility: normalizeVisibility((entry as any)?.visibility),
        metadata:
          (entry as any)?.metadata &&
          typeof (entry as any).metadata === 'object' &&
          !Array.isArray((entry as any).metadata)
            ? (entry as any).metadata
            : {},
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function isExpired(expiresAt: Date | string | null) {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, '/api/sharedReports/[token]/respond', async (context) => {
    ensureMethod(req, ['POST']);

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    const db = getDb();
    const [link] = await db
      .select()
      .from(schema.sharedLinks)
      .where(eq(schema.sharedLinks.token, token))
      .limit(1);

    if (!link) {
      throw new ApiError(404, 'token_not_found', 'Shared report link not found');
    }

    context.userId = link.userId;
    if (link.mode !== 'shared_report') {
      throw new ApiError(404, 'token_not_found', 'Shared report link not found');
    }

    if (link.status !== 'active') {
      throw new ApiError(410, 'token_inactive', 'Shared report link is inactive');
    }
    if (!link.canView) {
      throw new ApiError(403, 'view_not_allowed', 'Viewing is disabled for this shared report');
    }
    if (isExpired(link.expiresAt)) {
      throw new ApiError(410, 'token_expired', 'Shared report link has expired');
    }
    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new ApiError(410, 'max_uses_reached', 'Shared report link reached its usage limit');
    }

    const body = await readJsonBody(req);
    const responderEmail = normalizeEmail(
      body.responderEmail || body.responder_email || body.email || link.recipientEmail,
    );
    if (link.recipientEmail && responderEmail && normalizeEmail(link.recipientEmail) !== responderEmail) {
      throw new ApiError(403, 'recipient_mismatch', 'This link belongs to a different recipient');
    }

    const feedbackMessage = asText(body.message || body.feedback || body.response || '');
    const responseRows = parseResponseRows(body.responses);

    if (!feedbackMessage && responseRows.length === 0) {
      throw new ApiError(400, 'invalid_input', 'message or responses is required');
    }

    const rowsToInsert = [...responseRows];
    if (feedbackMessage) {
      rowsToInsert.push({
        questionId: 'recipient_feedback',
        value: feedbackMessage,
        valueType: 'text',
        rangeMin: null,
        rangeMax: null,
        visibility: 'full',
        metadata: {
          source: 'shared_report_message',
        },
      });
    }

    const now = new Date();
    await db.insert(schema.sharedLinkResponses).values(
      rowsToInsert.map((row) => ({
        id: newId('share_resp'),
        sharedLinkId: link.id,
        proposalId: link.proposalId,
        questionId: row.questionId,
        value: row.value,
        valueType: row.valueType,
        rangeMin: row.rangeMin,
        rangeMax: row.rangeMax,
        visibility: row.visibility,
        enteredByParty: 'b',
        responderEmail: responderEmail || null,
        metadata: row.metadata,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const [updatedLink] = await db
      .update(schema.sharedLinks)
      .set({
        uses: sql`${schema.sharedLinks.uses} + 1`,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.sharedLinks.id, link.id))
      .returning();

    ok(res, 200, {
      sharedReport: {
        token: updatedLink.token,
        status: updatedLink.status,
        uses: updatedLink.uses,
        max_uses: updatedLink.maxUses,
      },
      savedResponses: rowsToInsert.length,
    });
  });
}
