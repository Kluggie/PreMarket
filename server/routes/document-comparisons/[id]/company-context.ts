import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { ensureComparisonFound } from '../_helpers.js';

const MIN_COMPANY_NAME_CHARS = 2;
const MAX_COMPANY_NAME_CHARS = 160;
const MAX_COMPANY_WEBSITE_CHARS = 320;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCompanyName(value: unknown) {
  const name = asText(value);
  if (!name) {
    throw new ApiError(400, 'invalid_input', 'companyName is required');
  }
  if (name.length < MIN_COMPANY_NAME_CHARS) {
    throw new ApiError(400, 'invalid_input', `companyName must be at least ${MIN_COMPANY_NAME_CHARS} characters`);
  }
  return name.slice(0, MAX_COMPANY_NAME_CHARS);
}

function normalizeWebsite(value: unknown) {
  const raw = asText(value).slice(0, MAX_COMPANY_WEBSITE_CHARS);
  if (!raw) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ApiError(400, 'invalid_input', 'website must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, 'invalid_input', 'website must use http or https');
  }

  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/company-context', async (context) => {
    ensureMethod(req, ['PATCH']);

    const comparisonId = getComparisonId(req, comparisonIdParam);
    if (!comparisonId) {
      throw new ApiError(400, 'invalid_input', 'Comparison id is required');
    }

    const auth = await requireUser(req, res);
    if (!auth.ok || !auth.user) {
      return;
    }
    const userId = auth.user.id;
    context.userId = userId;

    const body = await readJsonBody(req);
    const companyName = normalizeCompanyName(body.companyName || body.company_name);
    const companyWebsite = normalizeWebsite(body.website || body.companyWebsite || body.company_website);

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.documentComparisons)
      .where(
        and(
          eq(schema.documentComparisons.id, comparisonId),
          eq(schema.documentComparisons.userId, userId),
        ),
      )
      .limit(1);

    ensureComparisonFound(existing);

    const now = new Date();
    const [updated] = await db
      .update(schema.documentComparisons)
      .set({
        companyName,
        companyWebsite,
        updatedAt: now,
      })
      .where(eq(schema.documentComparisons.id, comparisonId))
      .returning();

    ok(res, 200, {
      comparison_id: comparisonId,
      company_context: {
        company_name: updated?.companyName || companyName,
        company_website: updated?.companyWebsite || companyWebsite,
      },
      updated_at: updated?.updatedAt || now,
    });
  });
}
