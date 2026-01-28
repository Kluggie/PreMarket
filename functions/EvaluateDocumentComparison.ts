import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let comparison_id;
  const correlationId = `eval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        error: 'Unauthorized', 
        ok: false,
        correlationId 
      }, { status: 401 });
    }

    const body = await req.json();
    comparison_id = body.comparison_id;
    
    if (!comparison_id) {
      return Response.json({ 
        error: 'comparison_id is required', 
        ok: false,
        message: 'Missing comparison ID',
        correlationId 
      }, { status: 400 });
    }

    // Load comparison record
    const comparisons = await base44.entities.DocumentComparison.filter({ id: comparison_id });
    const comparison = comparisons[0];
    
    if (!comparison) {
      return Response.json({ 
        error: 'Comparison not found', 
        ok: false,
        message: 'Comparison record not found in database',
        correlationId 
      }, { status: 404 });
    }
    
    if (!comparison.doc_a_plaintext || !comparison.doc_a_plaintext.trim()) {
      return Response.json({ 
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Document A has no text',
        message: `${comparison.party_a_label || 'Document A'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, { status: 400 });
    }
    
    if (!comparison.doc_b_plaintext || !comparison.doc_b_plaintext.trim()) {
      return Response.json({ 
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Document B has no text',
        message: `${comparison.party_b_label || 'Document B'} has no extracted text. Please add content in Step 2.`,
        correlationId
      }, { status: 400 });
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
      console.error('[EvaluateDocumentComparison] GenerateContent invoke error:', invokeError.message, 'correlationId:', correlationId);
      
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: invokeError.message
      });
      
      return Response.json({ 
        ok: false,
        errorCode: 'VERTEX_CALL_FAILED',
        error: invokeError.message,
        message: 'AI evaluation service failed. Please try again or contact support.',
        detailsSafe: 'The Vertex AI function could not be invoked',
        correlationId
      }, { status: 500 });
    }

    console.log('[EvaluateDocumentComparison] GenerateContent result:', result?.data?.ok ? 'success' : 'failed');

    if (!result || !result.data || !result.data.ok) {
      const errorMsg = result?.data?.error || 'AI generation failed';
      const errorDetails = result?.data?.raw?.error || '';
      console.error('[EvaluateDocumentComparison] GenerateContent failed:', errorMsg, 'correlationId:', correlationId);
      
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: errorMsg
      });
      
      return Response.json({ 
        ok: false,
        errorCode: 'VERTEX_GENERATION_FAILED',
        error: errorMsg,
        message: 'Vertex AI generation failed. Please try again or contact support.',
        detailsSafe: errorDetails ? `Vertex error: ${errorDetails}` : 'The AI model did not return a successful response',
        correlationId
      }, { status: 500 });
    }

    const outputText = result.data.outputText;
    if (!outputText) {
      console.error('[EvaluateDocumentComparison] Empty output from GenerateContent, correlationId:', correlationId);
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Empty AI output'
      });
      
      return Response.json({ 
        ok: false,
        errorCode: 'EMPTY_AI_OUTPUT',
        error: 'Empty AI output',
        message: 'AI returned empty response. Please try again.',
        detailsSafe: 'The Vertex AI model did not generate any content',
        correlationId
      }, { status: 500 });
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
      
      return Response.json({ 
        ok: false,
        errorCode: 'INVALID_JSON_OUTPUT',
        error: 'Invalid AI output format',
        message: 'AI returned invalid JSON format. Please try again.',
        detailsSafe: `Parse error: ${parseError.message}`,
        correlationId
      }, { status: 500 });
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
          return Response.json({ 
            ok: false,
            errorCode: 'CONFIDENTIAL_LEAK_DETECTED',
            error: 'Report blocked due to potential disclosure',
            message: 'Report blocked: confidential content detected in AI output. Please review highlights and try again.',
            detailsSafe: 'The AI included text from a confidential span in the report',
            correlationId
          }, { status: 400 });
        }
      }
    }

    // Update with successful report
    await base44.entities.DocumentComparison.update(comparison_id, {
      status: 'evaluated',
      evaluation_report_json: reportJson,
      model_name: 'gemini-2.0-flash-exp',
      prompt_version: 'v1.0',
      generated_at: new Date().toISOString()
    });

    return Response.json({
      ok: true,
      report: reportJson
    });

  } catch (error) {
    console.error('EvaluateDocumentComparison error:', error);
    
    // Try to update comparison with error
    if (comparison_id) {
      try {
        await base44.entities.DocumentComparison.update(comparison_id, {
          status: 'failed',
          error_message: error.message
        });
      } catch (updateError) {
        console.error('Failed to update comparison with error:', updateError);
      }
    }
    
    console.error('[EvaluateDocumentComparison] Unexpected error:', error.message, 'correlationId:', correlationId);
    console.error('[EvaluateDocumentComparison] Stack:', error.stack);
    
    return Response.json({ 
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      error: error.message,
      message: 'Evaluation failed with internal error. Please try again or contact support.',
      detailsSafe: error.message,
      correlationId
    }, { status: 500 });
  }
});