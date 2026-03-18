import { ok } from '../../../_lib/api-response.js';
import { ApiError } from '../../../_lib/errors.js';
import { readJsonBody } from '../../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';
import { generateCompanyBrief } from '../../../_lib/company-brief.js';
import {
  assertGuestAiAssistanceAllowed,
  resolveGuestComparisonPreviewInput,
} from './_guest.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/public/document-comparisons/company-brief', async () => {
    ensureMethod(req, ['POST']);

    const body = await readJsonBody(req);
    const previewInput = resolveGuestComparisonPreviewInput(body);
    assertGuestAiAssistanceAllowed(req, previewInput.guestSessionId);

    const companyName = asText(previewInput.companyName);
    const companyWebsite = asText(previewInput.companyWebsite);
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
      comparison_id: previewInput.guestDraftId,
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
