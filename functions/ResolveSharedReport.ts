import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const DEBUG_DEPLOY_MARKER = 'DEPLOY_MARKER_RESOLVE_SHARED_COMPARISON_2026_02_12';
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

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseObjectField(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function toComparisonText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nested = (value as Record<string, unknown>).text;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

function pickComparisonText(candidates: Array<{ path: string; value: unknown }>) {
  for (const candidate of candidates) {
    const text = toComparisonText(candidate.value);
    if (typeof text === 'string' && text.trim().length > 0) {
      return {
        text,
        pathUsed: candidate.path
      };
    }
  }
  return {
    text: '',
    pathUsed: null as string | null
  };
}

function parseComparisonSpans(value: unknown): any[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickComparisonSpans(candidates: Array<{ path: string; value: unknown }>) {
  let fallback: any[] | null = null;
  let fallbackPath: string | null = null;

  for (const candidate of candidates) {
    const spans = parseComparisonSpans(candidate.value);
    if (!spans) continue;
    if (fallback === null) {
      fallback = spans;
      fallbackPath = candidate.path;
    }
    if (spans.length > 0) {
      return {
        spans,
        pathUsed: candidate.path
      };
    }
  }

  return {
    spans: fallback || [],
    pathUsed: fallbackPath
  };
}

function buildComparisonView(documentComparison: any) {
  if (!documentComparison || typeof documentComparison !== 'object') return null;

  const data = parseObjectField(documentComparison?.data);
  const inputsJson = parseObjectField(documentComparison?.inputs_json);
  const inputs = parseObjectField(documentComparison?.inputs);
  const dataInputsJson = parseObjectField(data?.inputs_json);
  const dataInputs = parseObjectField(data?.inputs);

  const docA = pickComparisonText([
    { path: 'doc_a_plaintext', value: documentComparison?.doc_a_plaintext },
    { path: 'docA_plaintext', value: documentComparison?.docA_plaintext },
    { path: 'doc_a_text', value: documentComparison?.doc_a_text },
    { path: 'docA_text', value: documentComparison?.docA_text },
    { path: 'doc_a.text', value: documentComparison?.doc_a },
    { path: 'docA.text', value: documentComparison?.docA },
    { path: 'doc_a_content', value: documentComparison?.doc_a_content },
    { path: 'docA_content', value: documentComparison?.docA_content },
    { path: 'data.doc_a_plaintext', value: data?.doc_a_plaintext },
    { path: 'data.docA_plaintext', value: data?.docA_plaintext },
    { path: 'data.doc_a_text', value: data?.doc_a_text },
    { path: 'data.docA_text', value: data?.docA_text },
    { path: 'data.doc_a.text', value: data?.doc_a },
    { path: 'data.docA.text', value: data?.docA },
    { path: 'inputs_json.doc_a_plaintext', value: inputsJson?.doc_a_plaintext },
    { path: 'inputs_json.docA_plaintext', value: inputsJson?.docA_plaintext },
    { path: 'inputs_json.doc_a.text', value: inputsJson?.doc_a },
    { path: 'inputs_json.docA.text', value: inputsJson?.docA },
    { path: 'inputs.doc_a.text', value: inputs?.doc_a },
    { path: 'inputs.docA.text', value: inputs?.docA },
    { path: 'data.inputs_json.doc_a_plaintext', value: dataInputsJson?.doc_a_plaintext },
    { path: 'data.inputs_json.docA_plaintext', value: dataInputsJson?.docA_plaintext },
    { path: 'data.inputs_json.doc_a.text', value: dataInputsJson?.doc_a },
    { path: 'data.inputs_json.docA.text', value: dataInputsJson?.docA },
    { path: 'data.inputs.doc_a.text', value: dataInputs?.doc_a },
    { path: 'data.inputs.docA.text', value: dataInputs?.docA }
  ]);
  const docB = pickComparisonText([
    { path: 'doc_b_plaintext', value: documentComparison?.doc_b_plaintext },
    { path: 'docB_plaintext', value: documentComparison?.docB_plaintext },
    { path: 'doc_b_text', value: documentComparison?.doc_b_text },
    { path: 'docB_text', value: documentComparison?.docB_text },
    { path: 'doc_b.text', value: documentComparison?.doc_b },
    { path: 'docB.text', value: documentComparison?.docB },
    { path: 'doc_b_content', value: documentComparison?.doc_b_content },
    { path: 'docB_content', value: documentComparison?.docB_content },
    { path: 'data.doc_b_plaintext', value: data?.doc_b_plaintext },
    { path: 'data.docB_plaintext', value: data?.docB_plaintext },
    { path: 'data.doc_b_text', value: data?.doc_b_text },
    { path: 'data.docB_text', value: data?.docB_text },
    { path: 'data.doc_b.text', value: data?.doc_b },
    { path: 'data.docB.text', value: data?.docB },
    { path: 'inputs_json.doc_b_plaintext', value: inputsJson?.doc_b_plaintext },
    { path: 'inputs_json.docB_plaintext', value: inputsJson?.docB_plaintext },
    { path: 'inputs_json.doc_b.text', value: inputsJson?.doc_b },
    { path: 'inputs_json.docB.text', value: inputsJson?.docB },
    { path: 'inputs.doc_b.text', value: inputs?.doc_b },
    { path: 'inputs.docB.text', value: inputs?.docB },
    { path: 'data.inputs_json.doc_b_plaintext', value: dataInputsJson?.doc_b_plaintext },
    { path: 'data.inputs_json.docB_plaintext', value: dataInputsJson?.docB_plaintext },
    { path: 'data.inputs_json.doc_b.text', value: dataInputsJson?.doc_b },
    { path: 'data.inputs_json.docB.text', value: dataInputsJson?.docB },
    { path: 'data.inputs.doc_b.text', value: dataInputs?.doc_b },
    { path: 'data.inputs.docB.text', value: dataInputs?.docB }
  ]);
  const spansA = pickComparisonSpans([
    { path: 'doc_a_spans_json', value: documentComparison?.doc_a_spans_json },
    { path: 'docA_spans_json', value: documentComparison?.docA_spans_json },
    { path: 'doc_a_spans', value: documentComparison?.doc_a_spans },
    { path: 'docA_spans', value: documentComparison?.docA_spans },
    { path: 'doc_a.spans', value: parseObjectField(documentComparison?.doc_a)?.spans },
    { path: 'docA.spans', value: parseObjectField(documentComparison?.docA)?.spans },
    { path: 'data.doc_a_spans_json', value: data?.doc_a_spans_json },
    { path: 'data.docA_spans_json', value: data?.docA_spans_json },
    { path: 'data.doc_a_spans', value: data?.doc_a_spans },
    { path: 'data.docA_spans', value: data?.docA_spans },
    { path: 'data.doc_a.spans', value: parseObjectField(data?.doc_a)?.spans },
    { path: 'data.docA.spans', value: parseObjectField(data?.docA)?.spans }
  ]);
  const spansB = pickComparisonSpans([
    { path: 'doc_b_spans_json', value: documentComparison?.doc_b_spans_json },
    { path: 'docB_spans_json', value: documentComparison?.docB_spans_json },
    { path: 'doc_b_spans', value: documentComparison?.doc_b_spans },
    { path: 'docB_spans', value: documentComparison?.docB_spans },
    { path: 'doc_b.spans', value: parseObjectField(documentComparison?.doc_b)?.spans },
    { path: 'docB.spans', value: parseObjectField(documentComparison?.docB)?.spans },
    { path: 'data.doc_b_spans_json', value: data?.doc_b_spans_json },
    { path: 'data.docB_spans_json', value: data?.docB_spans_json },
    { path: 'data.doc_b_spans', value: data?.doc_b_spans },
    { path: 'data.docB_spans', value: data?.docB_spans },
    { path: 'data.doc_b.spans', value: parseObjectField(data?.doc_b)?.spans },
    { path: 'data.docB.spans', value: parseObjectField(data?.docB)?.spans }
  ]);

  return {
    id: asString(documentComparison?.id),
    docAPathUsed: docA.pathUsed,
    docBPathUsed: docB.pathUsed,
    docASpansPathUsed: spansA.pathUsed,
    docBSpansPathUsed: spansB.pathUsed,
    docA: {
      text: docA.text,
      spans: spansA.spans,
      source: 'typed'
    },
    docB: {
      text: docB.text,
      spans: spansB.spans,
      source: 'typed'
    }
  };
}

function resolveDocumentComparisonId(payload: any): string | null {
  const shareLink = toObject(payload?.shareLink);
  const reportData = toObject(payload?.reportData);
  const proposalView = toObject(payload?.proposalView);
  const debug = toObject(payload?.debug);

  return (
    asString(shareLink?.documentComparisonId) ||
    asString(shareLink?.document_comparison_id) ||
    asString(reportData?.documentComparisonId) ||
    asString(reportData?.document_comparison_id) ||
    asString(proposalView?.document_comparison_id) ||
    asString(proposalView?.documentComparisonId) ||
    asString(debug?.resolvedDocumentComparisonId) ||
    null
  );
}

function resolveProposalId(payload: any): string | null {
  const shareLink = toObject(payload?.shareLink);
  const reportData = toObject(payload?.reportData);

  return (
    asString(payload?.proposalId) ||
    asString(payload?.sourceProposalId) ||
    asString(shareLink?.proposalId) ||
    asString(shareLink?.proposal_id) ||
    asString(reportData?.proposalId) ||
    asString(reportData?.proposal_id) ||
    null
  );
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

      const upstreamData = upstream?.data && typeof upstream.data === 'object' ? upstream.data : {};
      const upstreamDebug = upstreamData?.debug && typeof upstreamData.debug === 'object' ? upstreamData.debug : null;
      const upstreamComparisonView = upstreamData?.comparisonView || upstreamData?.reportData?.comparisonView || null;
      const upstreamDocALength = String(upstreamComparisonView?.docA?.text || '').trim().length;
      const upstreamDocBLength = String(upstreamComparisonView?.docB?.text || '').trim().length;
      const hasUpstreamComparisonContent = upstreamDocALength > 0 || upstreamDocBLength > 0;
      const resolvedDocumentComparisonId = resolveDocumentComparisonId(upstreamData);
      const resolvedProposalId = resolveProposalId(upstreamData);

      let documentComparison: any = null;
      let comparisonView = upstreamComparisonView;

      if (!hasUpstreamComparisonContent && (resolvedDocumentComparisonId || resolvedProposalId)) {
        if (resolvedDocumentComparisonId) {
          const rows = await base44.asServiceRole.entities.DocumentComparison
            .filter({ id: resolvedDocumentComparisonId }, '-created_date', 1)
            .catch(() => []);
          documentComparison = rows?.[0] || null;
        }

        if (!documentComparison && resolvedProposalId) {
          const byProposal = await base44.asServiceRole.entities.DocumentComparison
            .filter({ proposal_id: resolvedProposalId }, '-created_date', 1)
            .catch(() => []);
          documentComparison = byProposal?.[0] || null;
        }

        if (!documentComparison && resolvedProposalId) {
          const byDataProposal = await base44.asServiceRole.entities.DocumentComparison
            .filter({ 'data.proposal_id': resolvedProposalId }, '-created_date', 1)
            .catch(() => []);
          documentComparison = byDataProposal?.[0] || null;
        }

        const built = buildComparisonView(documentComparison);
        if (built) {
          comparisonView = built;
        }
      }

      const responseData: any = {
        ...upstreamData
      };
      const reportData = toObject(responseData.reportData);

      if (comparisonView) {
        responseData.comparisonView = comparisonView;
        responseData.reportData = {
          ...reportData,
          comparisonView,
          documentComparisonId:
            asString(reportData?.documentComparisonId) ||
            resolvedDocumentComparisonId ||
            asString((comparisonView as any)?.id) ||
            null
        };
      }

      const finalDocALength = String(responseData?.comparisonView?.docA?.text || responseData?.reportData?.comparisonView?.docA?.text || '').trim().length;
      const finalDocBLength = String(responseData?.comparisonView?.docB?.text || responseData?.reportData?.comparisonView?.docB?.text || '').trim().length;
      const comparisonData = parseObjectField(documentComparison?.data);

      return respond({
        ...responseData,
        ...(debugMode ? {
          debug: {
            ...(upstreamDebug || {}),
            endpointUsed: 'ResolveSharedReport',
            deployMarker: DEBUG_DEPLOY_MARKER,
            resolvedDocumentComparisonId:
              resolvedDocumentComparisonId ||
              asString((responseData?.comparisonView as any)?.id) ||
              null,
            docComparisonFound: Boolean(documentComparison),
            docALength: finalDocALength,
            docBLength: finalDocBLength,
            docAPathUsed: asString((responseData?.comparisonView as any)?.docAPathUsed),
            docBPathUsed: asString((responseData?.comparisonView as any)?.docBPathUsed),
            docASpansPathUsed: asString((responseData?.comparisonView as any)?.docASpansPathUsed),
            docBSpansPathUsed: asString((responseData?.comparisonView as any)?.docBSpansPathUsed),
            comparisonViewTopLevelPresent: Boolean(responseData?.comparisonView),
            comparisonViewInReportDataPresent: Boolean((responseData?.reportData as any)?.comparisonView),
            topLevelKeys: Object.keys(documentComparison || {}),
            dataKeys: Object.keys(comparisonData || {})
          }
        } : {}),
        endpoint: 'ResolveSharedReport',
        correlationId: responseData?.correlationId || correlationId
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
