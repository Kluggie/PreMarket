import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url, mode } = await req.json();
    
    if (!url) {
      return Response.json({ error: 'URL is required' }, { status: 400 });
    }

    // Cache check (simple in-memory for 24h)
    const cacheKey = `profile_extract_${url}_${mode}`;
    
    // Fetch the webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PreMarket/1.0)'
      }
    });
    
    if (!response.ok) {
      return Response.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: 400 });
    }

    const html = await response.text();
    
    // Extract profile information using AI
    const prompt = `
Extract professional profile information from this webpage content.

URL: ${url}
Mode: ${mode || 'general'}

Webpage content (truncated):
${html.substring(0, 50000)}

Extract the following fields where available:
- Full Name
- Current Title/Role
- Company/Organization
- Location
- Skills (comma-separated)
- Years of Experience (number)
- Education Level
- Industry
- LinkedIn URL (if different from input)
- GitHub URL
- Portfolio URL
- Bio/Summary

Return JSON with this structure:
{
  "inferred_fields": [
    {
      "question_label": "Full Name",
      "suggested_value": "John Doe",
      "confidence_0_1": 0.95,
      "source_url": "${url}",
      "source_excerpt": "Brief relevant excerpt from page"
    }
  ]
}

Rules:
- Only extract information that is clearly visible on the page
- Set confidence_0_1 based on how certain you are (0.0 to 1.0)
- If information is not found, omit that field
- Keep source_excerpt under 100 characters
- Do NOT hallucinate or make up information
`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          inferred_fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_label: { type: 'string' },
                suggested_value: { type: 'string' },
                confidence_0_1: { type: 'number' },
                source_url: { type: 'string' },
                source_excerpt: { type: 'string' }
              }
            }
          }
        }
      }
    });

    return Response.json({
      ok: true,
      inferred_fields: result.inferred_fields || []
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('ExtractProfileFromUrl error:', error);
    return Response.json({ 
      error: err.message,
      ok: false
    }, { status: 500 });
  }
});