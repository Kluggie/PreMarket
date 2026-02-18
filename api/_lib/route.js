import { fail } from './api-response.js';
import { ApiError, toApiError } from './errors.js';
import { createRequestContext, logRequest, logRequestError } from './observability.js';

export async function withApiRoute(req, res, route, handler) {
  const context = createRequestContext(req, route);

  try {
    await handler(context);
  } catch (error) {
    const apiError = toApiError(error);

    logRequestError(context, error, {
      statusCode: apiError.statusCode,
      errorCode: apiError.code,
    });

    fail(res, apiError.statusCode, apiError.code, apiError.message, apiError.extra || {});
    return;
  }

  logRequest(context, {
    statusCode: res.statusCode,
  });
}

export function ensureMethod(req, allowedMethods) {
  if (!allowedMethods.includes(req.method || '')) {
    throw new ApiError(405, 'method_not_allowed', 'Method not allowed', {
      allow: allowedMethods,
    });
  }
}
