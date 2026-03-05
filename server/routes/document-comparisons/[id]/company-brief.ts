import { and, eq } from 'drizzle-orm';
import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { getDb, schema } from '../../../_lib/db/client.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { generateCompanyBrief } from '../../../_lib/company-brief.js';
import { ensureComparisonFound } from '../_helpers.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export default async function handler(req: any, res: any, comparisonIdParam?: string) {
  await withApiRoute(req, res, '/api/document-comparisons/[id]/company-brief', async (context) => {
    ensureMethod(req, ['POST']);

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

    const body = await readJsonBody(req);
    const companyName = asText(existing.companyName);
    const companyWebsite = asText(existing.companyWebsite);
    const lens = asText(body.lens || body.focus || '');

    if (!companyName) {
      throw new ApiError(400, 'missing_company_context', 'Set company context before running Company Brief.');
    }

    const result = await generateCompanyBrief({
      companyName,
      website: companyWebsite,
      lens,
    });

    ok(res, 200, {
      comparison_id: comparisonId,
      provider: result.provider,
      model: result.model,
      company_brief: {
        company_name: companyName,
        company_website: companyWebsite || null,
        lens: lens || 'risk_negotiation',
        limited: result.limited,
        citation_count: result.citationCount,
        content: result.briefText,
        sources: result.sources,
        searches: result.searches,
      },
      generated_at: new Date().toISOString(),
    });
  });
}
