import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

function respond(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: NO_CACHE_HEADERS
  });
}

function toToken(req: Request, body: any): string | null {
  const fromBody = typeof body?.token === 'string' ? body.token.trim() : '';
  if (fromBody) return fromBody;
  const fromQuery = new URL(req.url).searchParams.get('token');
  return fromQuery && fromQuery.trim() ? fromQuery.trim() : null;
}

function toConsumeView(req: Request, body: any): boolean {
  if (typeof body?.consumeView === 'boolean') return body.consumeView;
  const raw = new URL(req.url).searchParams.get('consumeView');
  if (raw === null) return true;
  return raw !== 'false';
}

function toDebugMode(req: Request, body: any): boolean {
  if (body?.debug === '1' || body?.debug === 1 || body?.debug === true) return true;
  const raw = new URL(req.url).searchParams.get('debug');
  return raw === '1';
}

function extractError(error: any) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    500;

  const payload =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;

  return { statusCode, payload };
}

Deno.serve(async (req) => {
  const correlationId = `resolve_shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

    const token = toToken(req, body);
    const consumeView = toConsumeView(req, body);
    const debugMode = toDebugMode(req, body);

    if (!token) {
      return respond({
        ok: false,
        status: 'invalid',
        code: 'MISSING_TOKEN',
        reason: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, 400);
    }

    try {
      const upstream = await base44.asServiceRole.functions.invoke('GetSharedReportData', {
        token,
        consumeView,
        ...(debugMode ? { debug: '1' } : {})
      });
      const upstreamData = upstream?.data || {};
      const upstreamDebug = upstreamData?.debug && typeof upstreamData.debug === 'object' ? upstreamData.debug : null;
      return respond({
        ...upstreamData,
        ...(debugMode ? {
          debug: {
            ...(upstreamDebug || {}),
            endpointUsed: 'ResolveSharedReport'
          }
        } : {}),
        endpoint: 'ResolveSharedReport',
        correlationId: upstreamData?.correlationId || correlationId
      }, upstream.status || 200);
    } catch (upstreamError) {
      const { statusCode, payload } = extractError(upstreamError);
      return respond({
        ...(payload || {
          ok: false,
          status: 'invalid',
          code: 'UPSTREAM_ERROR',
          reason: 'UPSTREAM_ERROR',
          message: String((upstreamError as any)?.message || 'Failed to resolve shared report')
        }),
        endpoint: 'ResolveSharedReport',
        correlationId
      }, statusCode || 500);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return respond({
      ok: false,
      status: 'invalid',
      code: 'INTERNAL_ERROR',
      reason: 'INTERNAL_ERROR',
      message: err.message || 'Failed to resolve shared report',
      endpoint: 'ResolveSharedReport',
      correlationId
    }, 500);
  }
});
