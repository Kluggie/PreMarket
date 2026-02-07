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

    // Create inputs package
    const inputsData = {
      comparison_id: comparisonId,
      title: comparison.title,
      created_date: comparison.created_date,
      party_a: {
        label: comparison.party_a_label,
        source: comparison.doc_a_source,
        text: comparison.doc_a_plaintext,
        files: comparison.doc_a_files || [],
        highlights: {
          confidential: comparison.doc_a_spans_json?.filter(s => s.level === 'confidential') || [],
          partial: comparison.doc_a_spans_json?.filter(s => s.level === 'partial') || []
        }
      },
      party_b: {
        label: comparison.party_b_label,
        source: comparison.doc_b_source,
        text: comparison.doc_b_plaintext,
        files: comparison.doc_b_files || [],
        highlights: {
          confidential: comparison.doc_b_spans_json?.filter(s => s.level === 'confidential') || [],
          partial: comparison.doc_b_spans_json?.filter(s => s.level === 'partial') || []
        }
      }
    };

    const jsonString = JSON.stringify(inputsData, null, 2);

    return new Response(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="comparison-inputs-${comparisonId}.json"`
      }
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[DownloadComparisonInputs] Error:', error);
    return Response.json({ error: err.message }, { status: 500 });
  }
});