import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { comparisonId } = await req.json();
    
    if (!comparisonId) {
      return Response.json({ error: 'Missing comparisonId' }, { status: 400 });
    }

    // Load comparison
    const comparisons = await base44.entities.DocumentComparison.filter({ id: comparisonId });
    const comparison = comparisons[0];
    
    if (!comparison) {
      return Response.json({ error: 'Comparison not found' }, { status: 404 });
    }

    const report = comparison.evaluation_report_json;
    
    if (!report) {
      return Response.json({ error: 'No evaluation report available' }, { status: 400 });
    }

    // Create download package
    const downloadData = {
      comparison_id: comparisonId,
      title: comparison.title,
      party_a_label: comparison.party_a_label,
      party_b_label: comparison.party_b_label,
      created_date: comparison.created_date,
      generated_at: comparison.generated_at,
      model_name: comparison.model_name,
      report: report,
      metadata: {
        doc_a_source: comparison.doc_a_source,
        doc_b_source: comparison.doc_b_source,
        doc_a_chars: comparison.doc_a_plaintext?.length || 0,
        doc_b_chars: comparison.doc_b_plaintext?.length || 0,
        confidential_spans_a: comparison.doc_a_spans_json?.filter(s => s.level === 'confidential').length || 0,
        confidential_spans_b: comparison.doc_b_spans_json?.filter(s => s.level === 'confidential').length || 0,
        partial_spans_a: comparison.doc_a_spans_json?.filter(s => s.level === 'partial').length || 0,
        partial_spans_b: comparison.doc_b_spans_json?.filter(s => s.level === 'partial').length || 0
      }
    };

    const jsonString = JSON.stringify(downloadData, null, 2);

    return new Response(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="comparison-report-${comparisonId}.json"`
      }
    });

  } catch (error) {
    console.error('[DownloadComparisonJSON] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});