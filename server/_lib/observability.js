import { randomUUID } from 'node:crypto';

export function createRequestContext(req, route) {
  const requestIdHeader = req.headers?.['x-request-id'];
  const requestId =
    (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || randomUUID();

  return {
    requestId,
    route,
    startMs: Date.now(),
    userId: null,
  };
}

export function logRequest(context, details = {}) {
  const elapsedMs = Date.now() - context.startMs;
  const entry = {
    level: 'info',
    requestId: context.requestId,
    route: context.route,
    userId: context.userId || undefined,
    elapsedMs,
    ...details,
  };

  console.log(JSON.stringify(entry));
}

export function logRequestError(context, error, details = {}) {
  const elapsedMs = Date.now() - context.startMs;
  const entry = {
    level: 'error',
    requestId: context.requestId,
    route: context.route,
    userId: context.userId || undefined,
    elapsedMs,
    errorMessage: error instanceof Error ? error.message : String(error || 'unknown_error'),
    ...details,
  };

  console.error(JSON.stringify(entry));
}
