import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized', ok: false }, { status: 401 });
    }

    const { urlA, urlB } = await req.json();
    
    if (!urlA && !urlB) {
      return Response.json({ 
        error: 'At least one URL is required',
        ok: false 
      }, { status: 400 });
    }

    const correlationId = `extract_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const results = { ok: true, textA: '', textB: '', sources: [], correlationId };

    // Fetch URL A
    if (urlA) {
      try {
        const response = await fetch(urlA, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PreMarket/1.0)'
          }
        });
        
        if (response.ok) {
          const html = await response.text();
          
          // Use AI to extract main content
          const result = await base44.integrations.Core.InvokeLLM({
            prompt: `Extract the main text content from this webpage, removing navigation, ads, and boilerplate.

URL: ${urlA}

HTML (truncated):
${html.substring(0, 100000)}

Return only the main readable content as plain text. Be comprehensive but clean.`,
            add_context_from_internet: false
          });
          
          results.textA = result || '';
          results.sources.push({ url: urlA, status: 'success' });
        } else {
          results.sources.push({ 
            url: urlA, 
            status: 'failed',
            error: `HTTP ${response.status}: ${response.statusText}`
          });
        }
      } catch (error) {
        results.sources.push({ 
          url: urlA, 
          status: 'failed',
          error: error.message
        });
      }
    }

    // Fetch URL B
    if (urlB) {
      try {
        const response = await fetch(urlB, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PreMarket/1.0)'
          }
        });
        
        if (response.ok) {
          const html = await response.text();
          
          const result = await base44.integrations.Core.InvokeLLM({
            prompt: `Extract the main text content from this webpage, removing navigation, ads, and boilerplate.

URL: ${urlB}

HTML (truncated):
${html.substring(0, 100000)}

Return only the main readable content as plain text. Be comprehensive but clean.`,
            add_context_from_internet: false
          });
          
          results.textB = result || '';
          results.sources.push({ url: urlB, status: 'success' });
        } else {
          results.sources.push({ 
            url: urlB, 
            status: 'failed',
            error: `HTTP ${response.status}: ${response.statusText}`
          });
        }
      } catch (error) {
        results.sources.push({ 
          url: urlB, 
          status: 'failed',
          error: error.message
        });
      }
    }

    // Check if any extraction succeeded
    const anySuccess = results.sources.some(s => s.status === 'success');
    if (!anySuccess) {
      return Response.json({
        ok: false,
        error: 'Failed to extract text from any URL',
        sources: results.sources,
        correlationId
      }, { status: 400 });
    }

    return Response.json(results);

  } catch (error) {
    console.error('ExtractFromUrls error:', error);
    return Response.json({ 
      error: error.message,
      ok: false,
      correlationId: `error_${Date.now()}`
    }, { status: 500 });
  }
});