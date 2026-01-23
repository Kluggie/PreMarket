import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { comparison_id } = await req.json();
    
    if (!comparison_id) {
      return Response.json({ error: 'comparison_id is required' }, { status: 400 });
    }

    // Load comparison record
    const comparisons = await base44.entities.DocumentComparison.filter({ id: comparison_id });
    const comparison = comparisons[0];
    
    if (!comparison) {
      return Response.json({ error: 'Comparison not found' }, { status: 404 });
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

    // Call GenerateContent
    const result = await base44.asServiceRole.functions.invoke('GenerateContent', {
      systemPrompt,
      userContent,
      requireJsonOutput: true,
      modelName: 'gemini-2.0-flash-exp'
    });

    if (!result.data.ok) {
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: result.data.error || 'AI generation failed'
      });
      return Response.json({ 
        success: false, 
        error: result.data.error || 'AI generation failed' 
      }, { status: 500 });
    }

    // Parse output
    let reportJson;
    try {
      reportJson = JSON.parse(result.data.outputText);
    } catch (error) {
      await base44.entities.DocumentComparison.update(comparison_id, {
        status: 'failed',
        error_message: 'Failed to parse AI output as JSON'
      });
      return Response.json({ 
        success: false, 
        error: 'Invalid AI output format' 
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
          return Response.json({ 
            success: false, 
            error: 'Report blocked due to potential disclosure' 
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
      success: true,
      report: reportJson
    });

  } catch (error) {
    console.error('EvaluateDocumentComparison error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});