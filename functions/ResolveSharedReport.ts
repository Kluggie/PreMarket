import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    if (!token) {
      return Response.json({
        ok: false,
        status: 'invalid',
        code: 'MISSING_TOKEN',
        reason: 'MISSING_TOKEN',
        message: 'Token is required',
        correlationId
      }, { status: 400 });
    }

    try {
      const upstream = await base44.asServiceRole.functions.invoke('GetSharedReportData', {
        token,
        consumeView
      });
      return Response.json({
        ...upstream.data,
        endpoint: 'ResolveSharedReport',
        correlationId: upstream.data?.correlationId || correlationId
      }, { status: upstream.status || 200 });
    } catch (upstreamError) {
      const { statusCode, payload } = extractError(upstreamError);
      return Response.json({
        ...(payload || {
          ok: false,
          status: 'invalid',
          code: 'UPSTREAM_ERROR',
          reason: 'UPSTREAM_ERROR',
          message: String((upstreamError as any)?.message || 'Failed to resolve shared report')
        }),
        endpoint: 'ResolveSharedReport',
        correlationId
      }, { status: statusCode || 500 });
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({
      ok: false,
      status: 'invalid',
      code: 'INTERNAL_ERROR',
      reason: 'INTERNAL_ERROR',
      message: err.message || 'Failed to resolve shared report',
      endpoint: 'ResolveSharedReport',
      correlationId
    }, { status: 500 });
  }
});
