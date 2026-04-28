import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const UI_REPORT_FIELD = 'output_report_json';
const DIAGNOSTICS_FLAG = 'EVAL_TEXT_DIAGNOSTICS';
const DIAGNOSTICS_KEY_NAME = 'DIAG_HASH_KEY';

function readEnv(name: string): string | null {
  try {
    return Deno.env.get(name) || null;
  } catch {
    return null;
  }
}

const TEXT_DIAGNOSTICS_ENABLED = readEnv(DIAGNOSTICS_FLAG) === '1';
const TEXT_DIAGNOSTICS_KEY = readEnv(DIAGNOSTICS_KEY_NAME);
const TEXT_ENCODER = new TextEncoder();
let cachedDiagnosticsCryptoKey: Promise<CryptoKey | null> | null = null;

function toShortHex(buffer: ArrayBuffer, bytes = 6): string {
  const arr = new Uint8Array(buffer).slice(0, bytes);
  return Array.from(arr).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getDiagnosticsCryptoKey(): Promise<CryptoKey | null> {
  if (!TEXT_DIAGNOSTICS_ENABLED || !TEXT_DIAGNOSTICS_KEY) return null;
  if (!cachedDiagnosticsCryptoKey) {
    cachedDiagnosticsCryptoKey = crypto.subtle
      .importKey(
        'raw',
        TEXT_ENCODER.encode(TEXT_DIAGNOSTICS_KEY),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      .then((key) => key)
      .catch(() => null);
  }
  return cachedDiagnosticsCryptoKey;
}

async function hmacFingerprint(value: string): Promise<string | null> {
  if (!TEXT_DIAGNOSTICS_ENABLED) return null;
  const key = await getDiagnosticsCryptoKey();
  if (!key) return null;
  try {
    const signature = await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(value));
    return toShortHex(signature, 6);
  } catch {
    return null;
  }
}

function normalizeDiagComparisonLevel(level: unknown): 'hidden' | null {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'hidden' || normalized === 'confidential' || normalized === 'partial') return 'hidden';
  return null;
}

function normalizeDiagComparisonSpans(
  spans: unknown,
  textLength: number
): Array<{ start: number; end: number; level: 'hidden' }> {
  if (!Array.isArray(spans)) return [];

  return spans
    .map((span: any) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeDiagComparisonLevel(span?.level);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.min(rawStart, textLength));
      const end = Math.max(0, Math.min(rawEnd, textLength));
      if (end <= start) return null;

      return { start, end, level };
    })
    .filter((span): span is { start: number; end: number; level: 'hidden' } => Boolean(span))
    .sort((a, b) => a.start - b.start);
}

function removeHiddenComparisonTextForDiagnostics(text: string, spans: unknown) {
  const normalizedSpans = normalizeDiagComparisonSpans(spans, text.length);
  if (normalizedSpans.length === 0) {
    return {
      text,
      hiddenSpanCount: 0
    };
  }

  let output = '';
  let cursor = 0;

  for (const span of normalizedSpans) {
    if (span.start > cursor) {
      output += text.slice(cursor, span.start);
    }
    cursor = Math.max(cursor, span.end);
  }

  if (cursor < text.length) {
    output += text.slice(cursor);
  }

  return {
    text: output,
    hiddenSpanCount: normalizedSpans.length
  };
}

async function buildEvaluationDocDiagnostics(params: {
  fullText: string;
  spans: unknown;
  evaluationText: string;
}) {
  const fullText = String(params.fullText || '');
  const evaluationText = String(params.evaluationText || '');
  const redacted = removeHiddenComparisonTextForDiagnostics(fullText, params.spans);
  const redactedText = redacted.text;

  return {
    fullTextLen: fullText.length,
    redactedTextLen: redactedText.length,
    evaluationTextLen: evaluationText.length,
    hiddenCharCount: Math.max(0, fullText.length - redactedText.length),
    hiddenSpanCount: redacted.hiddenSpanCount,
    fullFingerprint: await hmacFingerprint(fullText),
    redactedFingerprint: await hmacFingerprint(redactedText),
    evaluationFingerprint: await hmacFingerprint(evaluationText)
  };
}

async function logEvaluationTextDiagnostics(params: {
  correlationId: string;
  comparisonId: string;
  proposalId: string | null;
  vertexInputText: string;
  docAFullText: string;
  docASpans: unknown;
  docBFullText: string;
  docBSpans: unknown;
}) {
  if (!TEXT_DIAGNOSTICS_ENABLED) return;

  if (!TEXT_DIAGNOSTICS_KEY) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'text_diagnostics_missing_key',
      source: 'EvaluateDocumentComparison',
      correlationId: params.correlationId,
      comparisonId: params.comparisonId,
      envFlag: DIAGNOSTICS_FLAG,
      keyName: DIAGNOSTICS_KEY_NAME
    }));
    return;
  }

  const docA = await buildEvaluationDocDiagnostics({
    fullText: params.docAFullText,
    spans: params.docASpans,
    evaluationText: params.docAFullText
  });
  const docB = await buildEvaluationDocDiagnostics({
    fullText: params.docBFullText,
    spans: params.docBSpans,
    evaluationText: params.docBFullText
  });
  const vertexInputText = String(params.vertexInputText || '');
  const vertexInput = {
    textLen: vertexInputText.length,
    fingerprint: await hmacFingerprint(vertexInputText)
  };

  console.log(JSON.stringify({
    level: 'info',
    event: 'evaluation_text_diagnostics',
    source: 'EvaluateDocumentComparison',
    correlationId: params.correlationId,
    comparisonId: params.comparisonId,
    proposalId: params.proposalId,
    docA,
    docB,
    vertexInput
  }));

  const maybeWarnForDoc = (docLabel: 'docA' | 'docB', doc: any) => {
    const hasHidden = Number(doc?.hiddenSpanCount || 0) > 0;
    const sameLength = Number(doc?.evaluationTextLen || 0) === Number(doc?.redactedTextLen || -1);
    const fpA = typeof doc?.evaluationFingerprint === 'string' ? doc.evaluationFingerprint : null;
    const fpB = typeof doc?.redactedFingerprint === 'string' ? doc.redactedFingerprint : null;
    const sameFingerprint = Boolean(fpA && fpB && fpA === fpB);
    if (hasHidden && sameLength && sameFingerprint) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'evaluation_using_redacted_text',
        source: 'EvaluateDocumentComparison',
        correlationId: params.correlationId,
        comparisonId: params.comparisonId,
        proposalId: params.proposalId,
        doc: docLabel,
        hiddenSpanCount: doc.hiddenSpanCount,
        evaluationTextLen: doc.evaluationTextLen,
        redactedTextLen: doc.redactedTextLen
      }));
    }
  };

  maybeWarnForDoc('docA', docA);
  maybeWarnForDoc('docB', docB);
}

Deno.serve(async (req) => {
  let comparison_id;
  let force = false;
  let trigger: string | null = null;
  let base44;
  let linkedProposalId = null;
  let reportShapeLogged = false;
  let persistEvaluationReport: null | ((params: {
    proposalId: string | null;
    status: 'succeeded' | 'failed';
    outputReport?: any;
    errorMessage?: string | null;
  }) => Promise<{
    persistedEvaluationReport: boolean;
    persistedReportId: string | null;
    persistErrorSafe: string | null;
  }>) = null;
  const correlationId = `eval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let persistOutcome: {
    persistedEvaluationReport: boolean;
    persistedReportId: string | null;
    persistErrorSafe: string | null;
  } = {
    persistedEvaluationReport: false,
    persistedReportId: null,
    persistErrorSafe: null
  };

  const respond = (payload: Record<string, any>, status = 200, override?: typeof persistOutcome) => {
    const info = override ?? persistOutcome;
    return Response.json({
      ...payload,
      persistedEvaluationReport: info.persistedEvaluationReport,
      persistedReportId: info.persistedReportId,
      persistErrorSafe: info.persistErrorSafe,
      linkedProposalId
    }, { status });
  };
  
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return respond({
        error: 'Unauthorized', 
        ok: false,
        errorCode: 'UNAUTHORIZED',
        correlationId
      }, 401);
    }

    const body = await req.json().catch(() => ({}));
    comparison_id = body.comparison_id;
    force = body.force === true;
    trigger = body.trigger || null;
    
    if (!comparison_id) {
      return respond({
        error: 'comparison_id is required', 
        ok: false,
        message: 'Missing comparison ID',
        correlationId
      }, 400);
    }

    if (trigger !== 'user_click') {
      return respond({
        ok: false,
        errorCode: 'USER_TRIGGER_REQUIRED',
        error: 'Explicit user trigger required',
        message: 'Evaluation can only run from an explicit user click.',
        correlationId
      }, 400);
    }

    // Load comparison record
    const comparisons = await base44.entities.DocumentComparison.filter({ id: comparison_id });
    const comparison = comparisons[0];
    
    if (!comparison) {
      return respond({
        error: 'Comparison not found', 
        ok: false,
        message: 'Comparison record not found in database',
        correlationId
      }, 404);
    }

    const sortByNewest = (items: any[]) =>
      [...items].sort((a, b) => {
        const dateA = a?.generated_at || a?.data?.generated_at || a?.created_date || a?.data?.created_date || 0;
        const dateB = b?.generated_at || b?.data?.generated_at || b?.created_date || b?.data?.created_date || 0;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });

    const asPersistError = (value: unknown): string => {
      if (value instanceof Error) return value.message;
      if (typeof value === 'string') return value;
      return 'Unknown persistence error';
    };

    const logPersistError = (context: string, error: unknown) => {
      console.error(
        `[Persist] ${context}`,
        asPersistError(error),
        (error as any)?.response?.data || (error as any)?.data || null,
        { correlationId }
      );
    };

    const sanitizePersistPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return payload;
      const clone: Record<string, any> = { ...payload };
      if (clone[UI_REPORT_FIELD] && typeof clone[UI_REPORT_FIELD] === 'object') {
        clone[UI_REPORT_FIELD] = {
          _type: 'object',
          keys: Object.keys(clone[UI_REPORT_FIELD])
        };
      }
      if (clone.data && typeof clone.data === 'object') {
        clone.data = { ...clone.data };
        if (clone.data[UI_REPORT_FIELD] && typeof clone.data[UI_REPORT_FIELD] === 'object') {
          clone.data[UI_REPORT_FIELD] = {
            _type: 'object',
            keys: Object.keys(clone.data[UI_REPORT_FIELD])
          };
        }
      }
      return clone;
    };

    linkedProposalId = comparison.proposal_id || comparison?.data?.proposal_id || null;
    if (!linkedProposalId) {
      const linkedProposals = await base44.asServiceRole.entities.Proposal.filter({
        document_comparison_id: comparison_id
      });
      linkedProposalId = linkedProposals[0]?.id || null;
    }
    if (!linkedProposalId) {
      const linkedProposalsData = await base44.asServiceRole.entities.Proposal.filter({
        'data.document_comparison_id': comparison_id
      } as any).catch(() => []);
      linkedProposalId = linkedProposalsData[0]?.id || null;
    }
    if (!linkedProposalId) {
      return respond({
        ok: false,
        errorCode: 'MISSING_LINKED_PROPOSAL',
        error: 'No linked proposal found for this document comparison',
        message: 'Could not resolve the linked proposal. Please reconnect this comparison to a proposal and retry.',
        correlationId
      }, 400);
    }

    const markProposalEvaluated = async () => {
      if (!linkedProposalId) return;
      try {
        await base44.asServiceRole.entities.Proposal.update(linkedProposalId, {
          status: 'evaluated',
          draft_step: null,
          draft_updated_at: new Date().toISOString()
        });
      } catch (proposalUpdateError) {
        console.warn(
          '[EvaluateDocumentComparison] Proposal update failed:',
          proposalUpdateError?.message || proposalUpdateError
        );
      }
    };

    persistEvaluationReport = async ({
      proposalId,
      status,
      outputReport,
      errorMessage
    }: {
      proposalId: string | null;
      status: 'succeeded' | 'failed';
      outputReport?: any;
      errorMessage?: string | null;
    }) => {
      if (!proposalId) {
        return {
          persistedEvaluationReport: false,
          persistedReportId: null,
          persistErrorSafe: 'No linked proposal id available for EvaluationReport persistence'
        };
      }

      if (status === 'succeeded' && (!outputReport || typeof outputReport !== 'object')) {
        return {
          persistedEvaluationReport: false,
          persistedReportId: null,
          persistErrorSafe: 'Missing output_report_json for succeeded EvaluationReport persistence'
        };
      }

      const nowIso = new Date().toISOString();
      const failureMessage = errorMessage || 'Evaluation failed';
      let persistedReportId: string | null = null;

      try {
        const existingReports = await base44.asServiceRole.entities.EvaluationReport.filter({
          'data.proposal_id': proposalId
        } as any);
        if (existingReports.length === 0) {
          const fallbackTopLevelReports = await base44.asServiceRole.entities.EvaluationReport.filter({
            proposal_id: proposalId
          });
          existingReports.push(...fallbackTopLevelReports);
        }
        if (!reportShapeLogged && existingReports.length > 0) {
          reportShapeLogged = true;
          const sample = existingReports[0];
          console.log('[Persist] EvaluationReport row shape sample', {
            correlationId,
            topLevelKeys: Object.keys(sample || {}),
            dataKeys: sample?.data && typeof sample.data === 'object'
              ? Object.keys(sample.data)
              : []
          });
        }
        const latestReport = sortByNewest(existingReports)[0] || null;
        const operation = latestReport?.id ? 'update' : 'create';
        const existingData = latestReport?.data && typeof latestReport.data === 'object'
          ? { ...latestReport.data }
          : {};

        const updateData = status === 'succeeded'
          ? {
              ...existingData,
              proposal_id: proposalId,
              status: 'succeeded',
              output_report_json: outputReport,
              generated_at: nowIso,
              error_message: null
            }
          : {
              ...existingData,
              proposal_id: proposalId,
              status: 'failed',
              error_message: failureMessage
            };

        const createData = status === 'succeeded'
          ? {
              proposal_id: proposalId,
              status: 'succeeded',
              output_report_json: outputReport,
              generated_at: nowIso
            }
          : {
              proposal_id: proposalId,
              status: 'failed',
              error_message: failureMessage
            };

        const updatePayload = { data: updateData };
        const createPayload = { data: createData };

        const attemptedPayload = operation === 'update' ? updatePayload : createPayload;
        console.log('[Persist] attempting EvaluationReport write', {
          proposalId,
          correlationId,
          operation,
          payload: sanitizePersistPayload(attemptedPayload)
        });

        if (latestReport?.id) {
          await base44.asServiceRole.entities.EvaluationReport.update(latestReport.id, updatePayload);
          persistedReportId = latestReport.id;
        } else {
          const created = await base44.asServiceRole.entities.EvaluationReport.create(createPayload);
          persistedReportId = created?.id || null;
        }

        const verifyRows = await base44.asServiceRole.entities.EvaluationReport.filter({
          'data.proposal_id': proposalId
        });
        const effectiveVerifyRows = verifyRows.length > 0
          ? verifyRows
          : await base44.asServiceRole.entities.EvaluationReport.filter({ proposal_id: proposalId });
        const latestVerified = sortByNewest(effectiveVerifyRows)[0] || null;
        const latestVerifiedData = latestVerified?.data && typeof latestVerified.data === 'object'
          ? latestVerified.data
          : {};
        const verified = status === 'succeeded'
          ? (
              (latestVerifiedData?.status || latestVerified?.status) === 'succeeded' &&
              !!(latestVerifiedData?.output_report_json || latestVerified?.output_report_json) &&
              typeof (latestVerifiedData?.output_report_json || latestVerified?.output_report_json) === 'object'
            )
          : (latestVerifiedData?.status || latestVerified?.status) === 'failed';

        if (!verified) {
          const verifyError = status === 'succeeded'
            ? 'EvaluationReport verification failed: latest row is missing data.status=succeeded and data.output_report_json'
            : 'EvaluationReport verification failed: latest row is missing data.status=failed';
          console.error('[Persist] verification failed', {
            proposalId,
            correlationId,
            latestReportId: latestVerified?.id || null,
            latestStatus: latestVerifiedData?.status || latestVerified?.status || null,
            hasOutputReportJson: !!(latestVerifiedData?.output_report_json || latestVerified?.output_report_json)
          });
          return {
            persistedEvaluationReport: false,
            persistedReportId: persistedReportId || latestVerified?.id || null,
            persistErrorSafe: verifyError
          };
        }

        console.log('[Persist] success', {
          id: latestVerified?.id || persistedReportId,
          proposalId,
          correlationId
        });
        return {
          persistedEvaluationReport: true,
          persistedReportId: latestVerified?.id || persistedReportId,
          persistErrorSafe: null
        };
      } catch (persistError) {
        logPersistError('EvaluationReport create/update failed', persistError);
        return {
          persistedEvaluationReport: false,
          persistedReportId,
          persistErrorSafe: asPersistError(persistError)
        };
      }
    };

    if (!comparison.doc_a_plaintext || !comparison.doc_a_plaintext.trim()) {
      const errorMessage = 'Document A has no text';
      persistOutcome = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'failed',
        errorMessage
      });
      return respond({
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: errorMessage,
        message: `${comparison.party_a_label || 'Document A'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, 400);
    }
    
    if (!comparison.doc_b_plaintext || !comparison.doc_b_plaintext.trim()) {
      const errorMessage = 'Document B has no text';
      persistOutcome = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'failed',
        errorMessage
      });
      return respond({
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: errorMessage,
        message: `${comparison.party_b_label || 'Document B'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, 400);
    }

    const comparisonCachedReport = comparison.evaluation_report_json || comparison?.data?.evaluation_report_json || null;

    // Fast path for reruns: return existing report unless force=true
    if (!force && comparisonCachedReport) {
      if (comparison.status !== 'evaluated') {
        await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
          status: 'evaluated',
          generated_at: comparison.generated_at || new Date().toISOString()
        });
      }

      const persistResult = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'succeeded',
        outputReport: comparisonCachedReport
      });
      persistOutcome = persistResult;
      await markProposalEvaluated();

      return respond({
        ok: true,
        cached: true,
        reportId: persistResult.persistedReportId || null,
        report: comparisonCachedReport,
        public_report: comparisonCachedReport,
        internal_report: comparisonCachedReport,
        correlationId
      }, 200, persistResult);
    }

    // Build redacted views
    const buildRedactedView = (plaintext, spans) => {
      if (!spans || spans.length === 0) return plaintext;
      
      const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
      let redacted = '';
      let lastIndex = 0;
      
      sortedSpans.forEach(span => {
        redacted += plaintext.substring(lastIndex, span.start);
        if (span.level === 'confidential') {
          redacted += '[CONFIDENTIAL REDACTED]';
        } else if (span.level === 'partial') {
          redacted += '[PARTIAL REDACTED]';
        }
        lastIndex = span.end;
      });
      
      redacted += plaintext.substring(lastIndex);
      return redacted;
    };

    const docASpans = comparison.doc_a_spans_json || [];
    const docBSpans = comparison.doc_b_spans_json || [];
    
    const redactedViewA = buildRedactedView(comparison.doc_a_plaintext, docASpans);
    const redactedViewB = buildRedactedView(comparison.doc_b_plaintext, docBSpans);

    // Prepare AI inputs
    const systemPrompt = `You are generating ONE shared comparison report visible to both parties.

CRITICAL RULES - CONFIDENTIALITY:
- You MAY read full_text_a and full_text_b for analysis (they contain confidential info).
- You MUST write the report using ONLY information that is safe to reveal.
- DO NOT quote or reproduce any content from confidential or partial spans.
- DO NOT include exact numbers, names, identifiers, or sentences from confidential/partial spans.
- If a conclusion depends on confidential/partial info, say so generically:
  "A confidential detail affects X" or "Partial information suggests Y"
- Prefer basing findings on redacted_view_a and redacted_view_b when possible.

OUTPUT FORMAT:
Return JSON only with this structure:
{
  "summary": {
    "match_level": "High"|"Medium"|"Low"|"Unknown",
    "match_score_0_100": <number or null>,
    "rationale": "<short redaction-safe explanation>"
  },
  "alignment_points": [
    {
      "title": "<point title>",
      "detail": "<redaction-safe detail>",
      "evidence_source": "redacted"
    }
  ],
  "conflicts_or_gaps": [
    {
      "title": "<conflict title>",
      "detail": "<redaction-safe detail>",
      "severity": "high"|"medium"|"low"
    }
  ],
  "depends_on_confidential": <boolean>,
  "followup_requests": ["<safe request for what to share next>"],
  "redaction_notes": {
    "confidential_spans_a_count": <number>,
    "partial_spans_a_count": <number>,
    "confidential_spans_b_count": <number>,
    "partial_spans_b_count": <number>
  }
}`;

    const userContent = JSON.stringify({
      docA: {
        label: comparison.party_a_label,
        redacted_view: redactedViewA,
        full_text: comparison.doc_a_plaintext,
        spans_summary: {
          confidential_count: docASpans.filter(s => s.level === 'confidential').length,
          partial_count: docASpans.filter(s => s.level === 'partial').length
        }
      },
      docB: {
        label: comparison.party_b_label,
        redacted_view: redactedViewB,
        full_text: comparison.doc_b_plaintext,
        spans_summary: {
          confidential_count: docBSpans.filter(s => s.level === 'confidential').length,
          partial_count: docBSpans.filter(s => s.level === 'partial').length
        }
      },
      task: "Compare these two documents and produce a compatibility/alignment report. Focus on: key similarities, conflicts, gaps, and strategic alignment. Be concise and actionable."
    });

    // Update status to running
    await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
      status: 'submitted'
    });

    const vertexInputText = systemPrompt + '\n\n' + userContent;
    await logEvaluationTextDiagnostics({
      correlationId,
      comparisonId: comparison_id,
      proposalId: linkedProposalId,
      vertexInputText,
      docAFullText: comparison.doc_a_plaintext,
      docASpans,
      docBFullText: comparison.doc_b_plaintext,
      docBSpans
    });

    // Call GenerateContent via service role (uses Vertex OAuth)
    console.log('[EvaluateDocumentComparison] Calling GenerateContent with correlationId:', correlationId);
    
    let result;
    try {
      result = await base44.asServiceRole.functions.invoke('GenerateContent', {
        text: vertexInputText,
        temperature: 0.2,
        maxOutputTokens: 2000,
        thinkingBudget: 0
      });
    } catch (invokeError) {
      const err = invokeError instanceof Error ? invokeError : new Error(String(invokeError));
      const innerData = (invokeError as any)?.response?.data || (invokeError as any)?.data || null;

      console.error(
        '[EvaluateDocumentComparison] GenerateContent invoke error:',
        err.message,
        'innerData:',
        innerData,
        'correlationId:',
        correlationId
      );

      if (!innerData) {
        await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
          status: 'failed',
          error_message: err.message
        });
        persistOutcome = await persistEvaluationReport({
          proposalId: linkedProposalId,
          status: 'failed',
          errorMessage: err.message
        });

        return respond({
          ok: false,
          errorCode: 'VERTEX_CALL_FAILED',
          error: err.message,
          message: 'AI evaluation service failed. Please try again or contact support.',
          detailsSafe: 'The Vertex AI function could not be invoked',
          correlationId
        }, 500);
      }

      result = { data: innerData };
    }

    console.log('[EvaluateDocumentComparison] GenerateContent result:', result?.data?.ok ? 'success' : 'failed');

    if (!result || !result.data || !result.data.ok) {
      const errorCode = result?.data?.errorCode || 'VERTEX_GENERATION_FAILED';
      const errorMsg = result?.data?.error || result?.data?.message || 'AI generation failed';
      const errorDetails = result?.data?.detailsSafe || result?.data?.raw?.error || '';
      console.error('[EvaluateDocumentComparison] GenerateContent failed:', errorMsg, 'correlationId:', correlationId);
      
      await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: errorMsg
      });
      persistOutcome = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'failed',
        errorMessage: errorMsg
      });

      const responseStatus = errorCode === 'UNAUTHORIZED' ? 401 : 200;
      return respond({
        ok: false,
        errorCode,
        error: errorMsg,
        message: result?.data?.message || 'Vertex AI generation failed. Please try again or contact support.',
        detailsSafe: errorDetails ? `Vertex error: ${errorDetails}` : 'The AI model did not return a successful response',
        correlationId,
        innerCorrelationId: result?.data?.correlationId
      }, responseStatus);
    }

    const outputText = result.data.outputText;
    if (!outputText) {
      console.error('[EvaluateDocumentComparison] Empty output from GenerateContent, correlationId:', correlationId);
      await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Empty AI output'
      });
      persistOutcome = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'failed',
        errorMessage: 'Empty AI output'
      });
      
      return respond({
        ok: false,
        errorCode: 'EMPTY_AI_OUTPUT',
        error: 'Empty AI output',
        message: 'AI returned empty response. Please try again.',
        detailsSafe: 'The Vertex AI model did not generate any content',
        correlationId
      }, 200);
    }

    // Parse output
    let reportJson;
    try {
      reportJson = JSON.parse(outputText);
    } catch (parseError) {
      console.error('[EvaluateDocumentComparison] JSON parse failed:', parseError.message, 'correlationId:', correlationId);
      console.error('[EvaluateDocumentComparison] Raw output:', outputText.substring(0, 500));
      
      await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Failed to parse AI output as JSON'
      });
      persistOutcome = await persistEvaluationReport({
        proposalId: linkedProposalId,
        status: 'failed',
        errorMessage: `Failed to parse AI output as JSON: ${parseError.message}`
      });
      
      return respond({
        ok: false,
        errorCode: 'INVALID_JSON_OUTPUT',
        error: 'Invalid AI output format',
        message: 'AI returned invalid JSON format. Please try again.',
        detailsSafe: `Parse error: ${parseError.message}`,
        correlationId
      }, 200);
    }

    // Leak check: ensure no confidential span text appears in report
    const reportString = JSON.stringify(reportJson).toLowerCase();
    const allConfidentialSpans = [
      ...docASpans.filter(s => s.level === 'confidential'),
      ...docBSpans.filter(s => s.level === 'confidential')
    ];
    
    for (const span of allConfidentialSpans) {
      const docText = docASpans.includes(span) 
        ? comparison.doc_a_plaintext 
        : comparison.doc_b_plaintext;
      const confidentialText = docText.substring(span.start, span.end);
      
      // Only check spans over 10 chars to avoid false positives on common words
      if (confidentialText.length > 10) {
        if (reportString.includes(confidentialText.toLowerCase())) {
          await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
            status: 'failed',
            error_message: 'Report blocked due to potential disclosure of confidential content'
          });
          persistOutcome = await persistEvaluationReport({
            proposalId: linkedProposalId,
            status: 'failed',
            errorMessage: 'Report blocked due to potential disclosure of confidential content'
          });
          console.error('[EvaluateDocumentComparison] Leak detected:', confidentialText.substring(0, 50), 'correlationId:', correlationId);
          return respond({
            ok: false,
            errorCode: 'CONFIDENTIAL_LEAK_DETECTED',
            error: 'Report blocked due to potential disclosure',
            message: 'Report blocked: confidential content detected in AI output. Please review highlights and try again.',
            detailsSafe: 'The AI included text from a confidential span in the report',
            correlationId
          }, 400);
        }
      }
    }

    // Build public report (sanitized) - store both internal and public
    const publicReportResult = await base44.asServiceRole.functions.invoke('BuildPublicReport', {
      internalReportJson: reportJson,
      evaluationResponses: [] // Document comparison doesn't have ProposalResponse records
    });
    
    const publicReport = publicReportResult.data.ok 
      ? publicReportResult.data.publicReportJson 
      : reportJson; // Fallback if sanitization fails

    // Update with successful report - store public report only in legacy field
    await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
      status: 'evaluated',
      evaluation_report_json: publicReport, // Store public/sanitized version
      model_name: 'gemini-2.0-flash-exp',
      prompt_version: 'v1.0',
      generated_at: new Date().toISOString()
    });

    const persistResult = await persistEvaluationReport({
      proposalId: linkedProposalId,
      status: 'succeeded',
      outputReport: publicReport
    });
    persistOutcome = persistResult;
    await markProposalEvaluated();

    console.log('[EvaluateDocumentComparison] Success, correlationId:', correlationId);

    return respond({
      ok: true,
      cached: false,
      reportId: persistResult.persistedReportId || null,
      report: publicReport,
      public_report: publicReport,
      internal_report: reportJson,
      correlationId
    }, 200, persistResult);

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('EvaluateDocumentComparison error:', error);
    
    // Try to update comparison with error
    if (comparison_id) {
      try {
        if (!base44) {
          base44 = createClientFromRequest(req);
        }
        await base44.asServiceRole.entities.DocumentComparison.update(comparison_id, {
          status: 'failed',
          error_message: err.message
        });
        try {
          if (linkedProposalId && persistEvaluationReport) {
            persistOutcome = await persistEvaluationReport({
              proposalId: linkedProposalId,
              status: 'failed',
              errorMessage: err.message
            });
          }
        } catch (reportUpdateError) {
          console.error(
            '[EvaluateDocumentComparison] Failed to persist EvaluationReport failure:',
            reportUpdateError?.message || reportUpdateError,
            (reportUpdateError as any)?.response?.data || (reportUpdateError as any)?.data || null
          );
        }
      } catch (updateError) {
        console.error('Failed to update comparison with error:', updateError);
      }
    }
    
    console.error('[EvaluateDocumentComparison] Unexpected error:', err.message, 'correlationId:', correlationId);
    console.error('[EvaluateDocumentComparison] Stack:', err.stack);
    
    return respond({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      error: err.message,
      message: 'Evaluation failed with internal error. Please try again or contact support.',
      detailsSafe: err.message,
      correlationId
    }, 500);
  }
});
