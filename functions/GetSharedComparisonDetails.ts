import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { validateShareLinkAccess } from './_utils/sharedLink.ts';

const ENDPOINT = 'GetSharedComparisonDetails';
const BACKEND_DEPLOY_MARKER = 'DEPLOY_MARKER_GET_SHARED_COMPARISON_DETAILS_2026_02_12';
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

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractShareLinkDocumentComparisonId(shareLink: any): string | null {
  if (!shareLink || typeof shareLink !== 'object') return null;
  const context = toObject(shareLink.context);
  const data = toObject(shareLink.data);
  const metadata = toObject(shareLink.metadata);

  return (
    asString(shareLink.documentComparisonId) ||
    asString(shareLink.document_comparison_id) ||
    asString(context.documentComparisonId) ||
    asString(context.document_comparison_id) ||
    asString(data.documentComparisonId) ||
    asString(data.document_comparison_id) ||
    asString(metadata.documentComparisonId) ||
    asString(metadata.document_comparison_id) ||
    null
  );
}

function normalizeTextCandidate(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nestedText = (value as Record<string, unknown>).text;
    if (typeof nestedText === 'string') return nestedText;
  }
  return null;
}

function pickTextFromCandidates(candidates: Array<{ key: string; value: unknown }>) {
  for (const candidate of candidates) {
    const text = normalizeTextCandidate(candidate.value);
    if (typeof text === 'string' && text.trim().length > 0) {
      return {
        text,
        chosenKey: candidate.key
      };
    }
  }

  return {
    text: '',
    chosenKey: null as string | null
  };
}

function parseSpansCandidate(value: unknown): any[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickSpansFromCandidates(candidates: Array<{ key: string; value: unknown }>) {
  let fallback: { spans: any[]; chosenKey: string } | null = null;

  for (const candidate of candidates) {
    const spans = parseSpansCandidate(candidate.value);
    if (!spans) continue;
    if (!fallback) {
      fallback = {
        spans,
        chosenKey: candidate.key
      };
    }
    if (spans.length > 0) {
      return {
        spans,
        chosenKey: candidate.key
      };
    }
  }

  if (fallback) return fallback;
  return {
    spans: [],
    chosenKey: null as string | null
  };
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
        deployMarker: BACKEND_DEPLOY_MARKER,
        error: 'MISSING_TOKEN',
        message: 'Token is required',
        ...(debugMode ? { debug: { endpointUsed: ENDPOINT, deployMarker: BACKEND_DEPLOY_MARKER } } : {}),
        correlationId
      }, 400);
    }

    const validation = await validateShareLinkAccess(base44, { token, consumeView });

    if (!validation.ok) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        deployMarker: BACKEND_DEPLOY_MARKER,
        error: validation.code || 'ACCESS_DENIED',
        message: validation.message || 'Access denied',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            deployMarker: BACKEND_DEPLOY_MARKER,
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
    const resolvedDocumentComparisonId =
      asString(resolvedShareLink?.documentComparisonId) ||
      extractShareLinkDocumentComparisonId(resolvedShareLink);

    if (!resolvedDocumentComparisonId) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        deployMarker: BACKEND_DEPLOY_MARKER,
        error: 'DOCUMENT_COMPARISON_NOT_FOUND',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            deployMarker: BACKEND_DEPLOY_MARKER,
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
        deployMarker: BACKEND_DEPLOY_MARKER,
        error: 'DOCUMENT_COMPARISON_NOT_FOUND',
        ...(debugMode ? {
          debug: {
            endpointUsed: ENDPOINT,
            deployMarker: BACKEND_DEPLOY_MARKER,
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

    const data = toObject(comparisonRecord.data);

    const textCandidatesA = [
      { key: 'doc_a_plaintext', value: comparisonRecord.doc_a_plaintext },
      { key: 'docA_plaintext', value: comparisonRecord.docA_plaintext },
      { key: 'doc_a_text', value: comparisonRecord.doc_a_text },
      { key: 'docA_text', value: comparisonRecord.docA_text },
      { key: 'doc_a', value: comparisonRecord.doc_a },
      { key: 'docA', value: comparisonRecord.docA },
      { key: 'doc_a_content', value: comparisonRecord.doc_a_content },
      { key: 'docA_content', value: comparisonRecord.docA_content },
      { key: 'data.doc_a_plaintext', value: data.doc_a_plaintext },
      { key: 'data.docA_plaintext', value: data.docA_plaintext },
      { key: 'data.doc_a_text', value: data.doc_a_text },
      { key: 'data.docA_text', value: data.docA_text }
    ];
    const textCandidatesB = [
      { key: 'doc_b_plaintext', value: comparisonRecord.doc_b_plaintext },
      { key: 'docB_plaintext', value: comparisonRecord.docB_plaintext },
      { key: 'doc_b_text', value: comparisonRecord.doc_b_text },
      { key: 'docB_text', value: comparisonRecord.docB_text },
      { key: 'doc_b', value: comparisonRecord.doc_b },
      { key: 'docB', value: comparisonRecord.docB },
      { key: 'doc_b_content', value: comparisonRecord.doc_b_content },
      { key: 'docB_content', value: comparisonRecord.docB_content },
      { key: 'data.doc_b_plaintext', value: data.doc_b_plaintext },
      { key: 'data.docB_plaintext', value: data.docB_plaintext },
      { key: 'data.doc_b_text', value: data.doc_b_text },
      { key: 'data.docB_text', value: data.docB_text }
    ];

    const spansCandidatesA = [
      { key: 'doc_a_spans_json', value: comparisonRecord.doc_a_spans_json },
      { key: 'docA_spans_json', value: comparisonRecord.docA_spans_json },
      { key: 'doc_a_spans', value: comparisonRecord.doc_a_spans },
      { key: 'docA_spans', value: comparisonRecord.docA_spans },
      { key: 'data.doc_a_spans_json', value: data.doc_a_spans_json },
      { key: 'data.docA_spans_json', value: data.docA_spans_json },
      { key: 'data.doc_a_spans', value: data.doc_a_spans },
      { key: 'data.docA_spans', value: data.docA_spans }
    ];
    const spansCandidatesB = [
      { key: 'doc_b_spans_json', value: comparisonRecord.doc_b_spans_json },
      { key: 'docB_spans_json', value: comparisonRecord.docB_spans_json },
      { key: 'doc_b_spans', value: comparisonRecord.doc_b_spans },
      { key: 'docB_spans', value: comparisonRecord.docB_spans },
      { key: 'data.doc_b_spans_json', value: data.doc_b_spans_json },
      { key: 'data.docB_spans_json', value: data.docB_spans_json },
      { key: 'data.doc_b_spans', value: data.doc_b_spans },
      { key: 'data.docB_spans', value: data.docB_spans }
    ];

    const pickedTextA = pickTextFromCandidates(textCandidatesA);
    const pickedTextB = pickTextFromCandidates(textCandidatesB);
    const pickedSpansA = pickSpansFromCandidates(spansCandidatesA);
    const pickedSpansB = pickSpansFromCandidates(spansCandidatesB);

    const docAText = pickedTextA.text;
    const docBText = pickedTextB.text;
    const docASpans = pickedSpansA.spans;
    const docBSpans = pickedSpansB.spans;
    const docALength = docAText.trim().length;
    const docBLength = docBText.trim().length;

    const debugPayload = {
      documentComparisonId: resolvedDocumentComparisonId,
      found: docALength > 0 && docBLength > 0,
      triedKeysA: textCandidatesA.map((candidate) => candidate.key),
      triedKeysB: textCandidatesB.map((candidate) => candidate.key),
      chosenKeyA: pickedTextA.chosenKey,
      chosenKeyB: pickedTextB.chosenKey,
      docALength,
      docBLength,
      topLevelKeys: Object.keys(comparisonRecord || {}),
      dataKeys: Object.keys(data || {})
    };

    if (docALength === 0 || docBLength === 0) {
      return respond({
        ok: false,
        endpoint: ENDPOINT,
        deployMarker: BACKEND_DEPLOY_MARKER,
        error: 'DOC_TEXT_MISSING',
        errorCode: 'DOC_TEXT_MISSING',
        message: 'Document comparison text is missing',
        ...(debugMode ? { debug: debugPayload } : {}),
        correlationId
      }, 422);
    }

    return respond({
      ok: true,
      endpoint: ENDPOINT,
      deployMarker: BACKEND_DEPLOY_MARKER,
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
        debug: debugPayload
      } : {}),
      correlationId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return respond({
      ok: false,
      endpoint: ENDPOINT,
      deployMarker: BACKEND_DEPLOY_MARKER,
      error: 'INTERNAL_ERROR',
      message: err.message || 'Failed to load shared comparison details',
      correlationId
    }, 500);
  }
});
