import { ok } from '../../../_lib/api-response.js';
import { requireUser } from '../../../_lib/auth.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { generateCompanyBrief } from '../../../_lib/company-brief.js';
import {
  SHARED_REPORT_ROUTE,
  getToken,
  logTokenEvent,
  requireRecipientAuthorization,
  resolveSharedReportToken,
} from '../_shared.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

const SHARED_REPORT_COMPANY_BRIEF_ROUTE = `${SHARED_REPORT_ROUTE}/company-brief`;

export default async function handler(req: any, res: any, tokenParam?: string) {
  await withApiRoute(req, res, SHARED_REPORT_COMPANY_BRIEF_ROUTE, async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok || !auth.user) {
      return;
    }
    context.userId = auth.user.id;

    const token = getToken(req, tokenParam);
    if (!token) {
      throw new ApiError(400, 'invalid_input', 'Token is required');
    }

    logTokenEvent(context, 'company_brief_start', token);
    const resolved = await resolveSharedReportToken({
      req,
      context,
      token,
      consumeView: false,
      enforceMaxUses: false,
    });
    requireRecipientAuthorization(resolved.link, auth.user);

    if (!resolved.link.canReevaluate) {
      throw new ApiError(403, 'reevaluation_not_allowed', 'AI support is disabled for this link');
    }

    const body = await readJsonBody(req);

    // Recipient provides company name/website inline (not persisted to the comparison).
    // Falls back to the comparison's saved company context if available.
    const companyName = asText(body.company_name || body.companyName)
      || asText(resolved.comparison?.companyName);
    const companyWebsite = asText(body.company_website || body.companyWebsite)
      || asText(resolved.comparison?.companyWebsite);
    const lens = asText(body.lens || body.focus || '');

    if (!companyName) {
      throw new ApiError(400, 'missing_company_context', 'Enter a company name before running Company Brief.');
    }

    const result = await generateCompanyBrief({
      companyName,
      website: companyWebsite,
      lens,
    });

    const comparisonId = asText(resolved.comparison?.id || resolved.proposal?.documentComparisonId);

    ok(res, 200, {
      comparison_id: comparisonId || null,
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

    logTokenEvent(context, 'company_brief_success', token, {
      linkId: resolved.link.id,
      comparisonId,
      companyName,
    });
  });
}
