import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const buildStamp = 'EDC_PATCH_2026-02-08_01';
  let comparison_id;
  let base44;
  const correlationId = `eval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const respond = (body: Record<string, unknown>, status = 200) =>
    Response.json({ buildStamp, ...body }, { status });
  
  try {
    console.log('[EvaluateDocumentComparison] buildStamp:', buildStamp, 'correlationId:', correlationId);
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return respond({ 
        error: 'Unauthorized', 
        ok: false,
        correlationId 
      }, 401);
    }

    const body = await req.json();
    comparison_id = body.comparison_id;
    const force = Boolean(body.force);
    
    if (!comparison_id) {
      return respond({ 
        error: 'comparison_id is required', 
        ok: false,
        message: 'Missing comparison ID',
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
    
    if (!comparison.doc_a_plaintext || !comparison.doc_a_plaintext.trim()) {
      return respond({ 
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Document A has no text',
        message: `${comparison.party_a_label || 'Document A'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, 400);
    }
    
    if (!comparison.doc_b_plaintext || !comparison.doc_b_plaintext.trim()) {
      return respond({ 
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Document B has no text',
        message: `${comparison.party_b_label || 'Document B'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, 400);
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
    const systemPromptVersion = 'v1_2026-02-08';

    const normalizeSpansForFingerprint = (spans: any[]) =>
      [...(spans || [])]
        .map((span) => ({
          start: Number(span?.start || 0),
          end: Number(span?.end || 0),
          level: String(span?.level || ''),
        }))
        .sort((a, b) => (a.start - b.start) || (a.end - b.end) || a.level.localeCompare(b.level));

    const fingerprintPayload = {
      comparison_id,
      doc_a_plaintext: comparison.doc_a_plaintext || '',
      doc_b_plaintext: comparison.doc_b_plaintext || '',
      doc_a_spans: normalizeSpansForFingerprint(docASpans),
      doc_b_spans: normalizeSpansForFingerprint(docBSpans),
      system_prompt_version: systemPromptVersion,
    };

    const fingerprintBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(fingerprintPayload)),
    );
    const inputFingerprint = Array.from(new Uint8Array(fingerprintBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    let storedFingerprint = comparison.input_fingerprint || null;
    if (!storedFingerprint && typeof comparison.prompt_version === 'string') {
      const prefix = `${systemPromptVersion}:`;
      if (comparison.prompt_version.startsWith(prefix)) {
        storedFingerprint = comparison.prompt_version.slice(prefix.length);
      }
    }

    if (
      !force &&
      comparison.evaluation_report_json &&
      (comparison.status === 'evaluated' || comparison.status === 'succeeded') &&
      storedFingerprint === inputFingerprint
    ) {
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'evaluated'
      }).catch(() => undefined);

      return respond({
        ok: true,
        cached: true,
        report: comparison.evaluation_report_json,
        public_report: comparison.evaluation_report_json,
        internal_report: comparison.evaluation_report_json,
        correlationId
      }, 200);
    }
    
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
    await base44.entities.DocumentComparison.update(comparison_id, {
      status: 'submitted'
    });

    // Call GenerateContent via service role (uses Vertex OAuth)
    console.log('[EvaluateDocumentComparison] Calling GenerateContent with correlationId:', correlationId);
    
    let result;
    try {
      result = await base44.asServiceRole.functions.invoke('GenerateContent', {
        text: systemPrompt + '\n\n' + userContent,
        temperature: 0.2,
        maxOutputTokens: 2000,
        thinkingBudget: 0
      });
    } catch (invokeError) {
      const err = invokeError as {
        message?: string;
        response?: { data?: any; status?: number };
        data?: any;
        status?: number;
      };
      let innerData = err?.response?.data || err?.data || null;

      if (!innerData) {
        try {
          const fallbackUrl = new URL(req.url);
          fallbackUrl.pathname = fallbackUrl.pathname.replace(
            /\/EvaluateDocumentComparison$/,
            '/GenerateContent',
          );
          const forwardHeaders = new Headers(req.headers);
          forwardHeaders.delete('host');
          forwardHeaders.delete('content-length');
          forwardHeaders.delete('accept-encoding');
          forwardHeaders.set('content-type', 'application/json');

          const fallbackResp = await fetch(fallbackUrl, {
            method: 'POST',
            headers: forwardHeaders,
            body: JSON.stringify({
              text: systemPrompt + '\n\n' + userContent,
              temperature: 0.2,
              maxOutputTokens: 2000,
              thinkingBudget: 0,
            }),
          });
          innerData = await fallbackResp.json().catch(() => null);
          if (innerData) {
            result = { data: innerData };
          }
        } catch (fallbackErr) {
          console.error(
            '[EvaluateDocumentComparison] GenerateContent fallback fetch failed:',
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            'correlationId:',
            correlationId,
          );
        }
      }

      if (!innerData) {
        console.error(
          '[EvaluateDocumentComparison] GenerateContent invoke error with no inner payload:',
          JSON.stringify(
            {
              message: err?.message || null,
              status: err?.response?.status || err?.status || null,
              correlationId,
            },
            null,
            2,
          ),
        );
        await base44.entities.DocumentComparison.update(comparison_id, {
          status: 'failed',
          error_message: `GenerateContent invoke failed: ${err?.message || 'Unknown error'}`
        });

        return respond({
          ok: false,
          errorCode: 'VERTEX_CALL_FAILED',
          error: err?.message || 'GenerateContent invoke failed',
          message: 'AI evaluation service failed. Please try again or contact support.',
          detailsSafe: 'No inner payload from GenerateContent invoke or fallback',
          correlationId
        }, 500);
      }

      result = { data: innerData };
    }

    console.log('[EvaluateDocumentComparison] GenerateContent result:', result?.data?.ok ? 'success' : 'failed');

    if (!result || !result.data || !result.data.ok) {
      const errorCode = result?.data?.errorCode || 'VERTEX_GENERATION_FAILED';
      const errorMsg = result?.data?.error || result?.data?.message || 'AI generation failed';
      const innerCorrelationId = result?.data?.correlationId || result?.data?.correlation_id || null;
      const detailsSafe = result?.data?.detailsSafe || result?.data?.raw?.error || '';
      console.error('[EvaluateDocumentComparison] GenerateContent failed:', errorMsg, 'correlationId:', correlationId);
      
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message:
          `${errorCode}: ${errorMsg}${innerCorrelationId ? ` (${innerCorrelationId})` : ''}`.slice(0, 500)
      });
      
      return respond({ 
        ok: false,
        errorCode,
        error: errorMsg,
        message: 'Vertex AI generation failed. Please try again or contact support.',
        detailsSafe: detailsSafe ? String(detailsSafe).slice(0, 1000) : 'The AI model did not return a successful response',
        correlationId,
        innerCorrelationId
      }, 500);
    }

    const outputText = result.data.outputText;
    if (!outputText) {
      console.error('[EvaluateDocumentComparison] Empty output from GenerateContent, correlationId:', correlationId);
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Empty AI output'
      });
      
      return respond({ 
        ok: false,
        errorCode: 'EMPTY_AI_OUTPUT',
        error: 'Empty AI output',
        message: 'AI returned empty response. Please try again.',
        detailsSafe: 'The Vertex AI model did not generate any content',
        correlationId
      }, 500);
    }

    // Parse output
    let reportJson;
    try {
      reportJson = JSON.parse(outputText);
    } catch (parseError) {
      console.error('[EvaluateDocumentComparison] JSON parse failed:', parseError.message, 'correlationId:', correlationId);
      console.error('[EvaluateDocumentComparison] Raw output:', outputText.substring(0, 500));
      
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Failed to parse AI output as JSON'
      });
      
      return respond({ 
        ok: false,
        errorCode: 'INVALID_JSON_OUTPUT',
        error: 'Invalid AI output format',
        message: 'AI returned invalid JSON format. Please try again.',
        detailsSafe: `Parse error: ${parseError.message}`,
        correlationId
      }, 500);
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
          await base44.entities.DocumentComparison.update(comparison_id, {
            status: 'failed',
            error_message: 'Report blocked due to potential disclosure of confidential content'
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
    try {
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'evaluated',
        evaluation_report_json: publicReport, // Store public/sanitized version
        model_name: 'gemini-2.0-flash-exp',
        prompt_version: `${systemPromptVersion}:${inputFingerprint}`,
        input_fingerprint: inputFingerprint,
        generated_at: new Date().toISOString()
      });
    } catch (_) {
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'evaluated',
        evaluation_report_json: publicReport, // Store public/sanitized version
        model_name: 'gemini-2.0-flash-exp',
        prompt_version: `${systemPromptVersion}:${inputFingerprint}`,
        generated_at: new Date().toISOString()
      });
    }

    // Update linked Proposal status to 'evaluated'
    const proposals = await base44.asServiceRole.entities.Proposal.filter({ 
      document_comparison_id: comparison_id 
    });
    if (proposals.length > 0) {
      await base44.asServiceRole.entities.Proposal.update(proposals[0].id, {
        status: 'evaluated',
        draft_step: null,
        draft_updated_at: new Date().toISOString()
      });
    }

    console.log('[EvaluateDocumentComparison] Success, correlationId:', correlationId);

    return respond({
      ok: true,
      cached: false,
      report: publicReport,
      public_report: publicReport,
      internal_report: reportJson,
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('EvaluateDocumentComparison error:', error);
    
    // Try to update comparison with error
    if (comparison_id) {
      try {
        const base44Client = base44 ?? createClientFromRequest(req);
        await base44Client.entities.DocumentComparison.update(comparison_id, {
          status: 'failed',
          error_message: err.message
        });
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
