import { ok } from '../../../_lib/api-response.js';
import { dispatchDueAgreementRequestEmails } from '../../../_lib/proposal-agreement-request-emails.js';
import { ApiError } from '../../../_lib/errors.js';
import { ensureMethod, withApiRoute } from '../../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(req: any) {
  const rawValue =
    (Array.isArray(req.query?.limit) ? req.query.limit[0] : req.query?.limit) ||
    (Array.isArray(req.body?.limit) ? req.body.limit[0] : req.body?.limit);
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 25;
  }
  return Math.max(1, Math.floor(numericValue));
}

function isAuthorizedDispatchRequest(req: any) {
  const configuredSecret = asText(process.env.CRON_SECRET || process.env.PROPOSAL_EMAIL_DISPATCH_SECRET);
  const authHeader = asText(req?.headers?.authorization);
  const vercelCronHeader = asText(
    req?.headers?.['x-vercel-cron'] || req?.headers?.['x-vercel-scheduled'],
  );
  if (configuredSecret) {
    return authHeader === `Bearer ${configuredSecret}`;
  }

  return Boolean(vercelCronHeader) || asText(process.env.NODE_ENV).toLowerCase() === 'test';
}

export default async function handler(req: any, res: any) {
  await withApiRoute(
    req,
    res,
    '/api/internal/proposal-agreement-request-emails/dispatch',
    async () => {
      ensureMethod(req, ['GET', 'POST']);

      if (!isAuthorizedDispatchRequest(req)) {
        throw new ApiError(401, 'unauthorized', 'Dispatch authorization required');
      }

      const summary = await dispatchDueAgreementRequestEmails({
        limit: readLimit(req),
      });

      ok(res, 200, summary);
    },
  );
}
