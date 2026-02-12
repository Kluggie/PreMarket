import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

const ENDPOINT = 'GetSharedComparisonDetails';
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
  return typeof fromQuery === 'string' && fromQuery.trim().length > 0 ? fromQuery.trim() : null;
}

function toConsumeView(req: Request, body: any): boolean {
  if (typeof body?.consumeView === 'boolean') return body.consumeView;
  const raw = new URL(req.url).searchParams.get('consumeView');
  if (raw === null) return true;
  return raw !== 'false';
}

function toDebugMode(req: Request, body: any): boolean {
  if (body?.debug === '1' || body?.debug === 1 || body?.debug === true) return true;
  return new URL(req.url).searchParams.get('debug') === '1';
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

Deno.serve(async (req) => {
  const correlationId = `shared_cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

    const token = toToken(req, body);
    const consumeView = toConsumeView(req, body);
    const debugMode = toDebugMode(req, body);

    if (!token) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        error: 'MISSING_TOKEN',
        message: 'Token is required',
        ...(debugMode ? { debug: { endpointUsed: ENDPOINT } } : {}),
        correlationId
      }, 400);
    }

    const validation = await validateShareLinkAccess(base44, { token, consumeView });

    if (!validation.ok) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        error: validation.code || 'ACCESS_DENIED',
        message: validation.message || 'Access denied',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            resolvedShareLinkId: validation.shareLink?.id || null,
            resolvedDocumentComparisonId: validation.shareLink?.documentComparisonId || null,
            shareLinkFound: Boolean(validation.shareLink?.id),
            documentComparisonFound: false,
            docATextLength: 0,
            docBTextLength: 0,
            documentComparisonKeys: []
          }
        } : {}),
        correlationId
      }, validation.statusCode || 403);
    }

    const resolvedShareLink = validation.shareLink;
    const resolvedDocumentComparisonId = asString(resolvedShareLink?.documentComparisonId);

    if (!resolvedDocumentComparisonId) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        error: 'DOCUMENT_COMPARISON_NOT_FOUND',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            resolvedShareLinkId: resolvedShareLink.id,
            resolvedDocumentComparisonId: null,
            shareLinkFound: true,
            documentComparisonFound: false,
            docATextLength: 0,
            docBTextLength: 0,
            documentComparisonKeys: []
          }
        } : {}),
        correlationId
      }, 404);
    }

    const comparisonRows = await base44.asServiceRole.entities.DocumentComparison
      .filter({ id: resolvedDocumentComparisonId }, '-created_date', 1)
      .catch(() => []);
    const comparisonRecord = comparisonRows?.[0] || null;

    if (!comparisonRecord) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        error: 'DOCUMENT_COMPARISON_NOT_FOUND',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            resolvedShareLinkId: resolvedShareLink.id,
            resolvedDocumentComparisonId,
            shareLinkFound: true,
            documentComparisonFound: false,
            docATextLength: 0,
            docBTextLength: 0,
            documentComparisonKeys: []
          }
        } : {}),
        correlationId
      }, 404);
    }

    const docAText = String(comparisonRecord.doc_a_plaintext ?? '');
    const docBText = String(comparisonRecord.doc_b_plaintext ?? '');
    const docASpans = Array.isArray(comparisonRecord.doc_a_spans_json) ? comparisonRecord.doc_a_spans_json : [];
    const docBSpans = Array.isArray(comparisonRecord.doc_b_spans_json) ? comparisonRecord.doc_b_spans_json : [];

    return respond({
      ok: true,
      endpoint: ENDPOINT,
      shareLink: {
        id: resolvedShareLink.id,
        proposalId: resolvedShareLink.proposalId,
        documentComparisonId: resolvedDocumentComparisonId,
        recipientEmail: resolvedShareLink.recipientEmail,
        expiresAt: resolvedShareLink.expiresAt,
        uses: resolvedShareLink.viewCount,
        maxUses: resolvedShareLink.maxViews
      },
      comparison: {
        id: asString(comparisonRecord.id) || resolvedDocumentComparisonId,
        docA: {
          text: docAText,
          spans: docASpans
        },
        docB: {
          text: docBText,
          spans: docBSpans
        }
      },
      ...(debugMode ? {
        debug: {
          endpointUsed: ENDPOINT,
          resolvedShareLinkId: resolvedShareLink.id,
          resolvedDocumentComparisonId,
          shareLinkFound: true,
          documentComparisonFound: true,
          docATextLength: docAText.length,
          docBTextLength: docBText.length,
          documentComparisonKeys: Object.keys(comparisonRecord || {})
        }
      } : {}),
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return respond({
      ok: false,
      endpoint: ENDPOINT,
      error: 'INTERNAL_ERROR',
      message: err.message || 'Failed to load shared comparison details',
      correlationId
    }, 500);
  }
});
