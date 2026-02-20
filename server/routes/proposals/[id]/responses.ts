import { and, asc, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { assertProposalOwnership, requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { newId } from '../../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function getProposalId(req: any, proposalIdParam?: string) {
  if (proposalIdParam && proposalIdParam.trim().length > 0) {
    return proposalIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeVisibility(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hidden' || normalized === 'not_shared' || normalized === 'private') {
    return 'hidden';
  }
  return 'full';
}

function serializeValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  const text = String(value);
  return text.length > 0 ? text : null;
}

function parseValue(rawValue: string | null) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function mapResponseRow(row) {
  return {
    id: row.id,
    proposal_id: row.proposalId,
    question_id: row.questionId,
    section_id: row.sectionId,
    value: parseValue(row.value),
    value_type: row.valueType,
    range_min: row.rangeMin,
    range_max: row.rangeMax,
    visibility: row.visibility,
    claim_type: row.claimType,
    entered_by_party: row.enteredByParty,
    created_date: row.createdAt,
    updated_date: row.updatedAt,
  };
}

export default async function handler(req: any, res: any, proposalIdParam?: string) {
  await withApiRoute(req, res, '/api/proposals/[id]/responses', async (context) => {
    ensureMethod(req, ['GET', 'PUT']);

    const proposalId = getProposalId(req, proposalIdParam);
    if (!proposalId) {
      throw new ApiError(400, 'invalid_input', 'Proposal id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    await assertProposalOwnership(auth.user.id, proposalId);

    const db = getDb();

    if (req.method === 'GET') {
      const rows = await db
        .select()
        .from(schema.proposalResponses)
        .where(
          and(
            eq(schema.proposalResponses.proposalId, proposalId),
            eq(schema.proposalResponses.userId, auth.user.id),
          ),
        )
        .orderBy(asc(schema.proposalResponses.createdAt));

      ok(res, 200, {
        responses: rows.map(mapResponseRow),
      });
      return;
    }

    const body = await readJsonBody(req);
    const rawResponses = Array.isArray(body.responses) ? body.responses : null;

    if (!rawResponses) {
      throw new ApiError(400, 'invalid_input', 'responses array is required');
    }

    const now = new Date();
    const normalizedRows = rawResponses
      .map((entry) => {
        const questionId = asText(entry?.question_id || entry?.questionId);
        if (!questionId) {
          return null;
        }

        const enteredByParty = asText(entry?.entered_by_party || entry?.enteredByParty || 'a') || 'a';

        const incomingValue = entry?.value;
        const isRange = incomingValue && typeof incomingValue === 'object' && incomingValue.type === 'range';

        const valueType = isRange
          ? 'range'
          : asText(entry?.value_type || entry?.valueType || 'text') || 'text';

        return {
          id: newId('response'),
          proposalId,
          userId: auth.user.id,
          questionId,
          sectionId: asText(entry?.section_id || entry?.sectionId) || null,
          value: isRange ? null : serializeValue(incomingValue),
          valueType,
          rangeMin: isRange ? asText(incomingValue?.min || '') || null : asText(entry?.range_min || entry?.rangeMin) || null,
          rangeMax: isRange ? asText(incomingValue?.max || '') || null : asText(entry?.range_max || entry?.rangeMax) || null,
          visibility: normalizeVisibility(entry?.visibility),
          claimType: asText(entry?.claim_type || entry?.claimType) || null,
          enteredByParty,
          createdAt: now,
          updatedAt: now,
        };
      })
      .filter(Boolean);

    await db
      .delete(schema.proposalResponses)
      .where(
        and(
          eq(schema.proposalResponses.proposalId, proposalId),
          eq(schema.proposalResponses.userId, auth.user.id),
        ),
      );

    if (normalizedRows.length > 0) {
      await db.insert(schema.proposalResponses).values(normalizedRows);
    }

    const savedRows = await db
      .select()
      .from(schema.proposalResponses)
      .where(
        and(
          eq(schema.proposalResponses.proposalId, proposalId),
          eq(schema.proposalResponses.userId, auth.user.id),
        ),
      )
      .orderBy(asc(schema.proposalResponses.createdAt));

    ok(res, 200, {
      responses: savedRows.map(mapResponseRow),
    });
  });
}
