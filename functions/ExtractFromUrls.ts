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

    const extractFromUrl = async (url, label) => {
      const isLinkedIn = url.includes('linkedin.com');
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PreMarket/1.0)'
          }
        });
        
        if (!response.ok) {
          return {
            status: 'failed',
            url,
            errorCode: isLinkedIn ? 'LINKEDIN_BLOCKED' : 'FETCH_FAILED',
            message: isLinkedIn 
              ? 'LinkedIn blocks automated extraction. Please paste text or upload a file instead.'
              : `HTTP ${response.status}: ${response.statusText}`,
            statusCode: response.status,
            extractedText: ''
          };
        }
        
        const html = await response.text();
        
        if (!html || html.length < 100) {
          return {
            status: 'failed',
            url,
            errorCode: 'EMPTY_RESPONSE',
            message: 'URL returned empty or very short content',
            statusCode: response.status,
            extractedText: ''
          };
        }
        
        // Use AI to extract main content
        const result = await base44.integrations.Core.InvokeLLM({
          prompt: `Extract the main text content from this webpage, removing navigation, ads, and boilerplate.

URL: ${url}

HTML (truncated):
${html.substring(0, 100000)}

Return only the main readable content as plain text. Be comprehensive but clean.`,
          add_context_from_internet: false
        });
        
        const extractedText = result || '';
        
        if (!extractedText || extractedText.length < 50) {
          return {
            status: 'failed',
            url,
            errorCode: isLinkedIn ? 'LINKEDIN_BLOCKED' : 'PARSE_FAILED',
            message: isLinkedIn
              ? 'LinkedIn blocks automated extraction. Please paste text or upload a file instead.'
              : 'Could not extract meaningful text from this page',
            statusCode: response.status,
            extractedText: ''
          };
        }
        
        return {
          status: 'success',
          url,
          extractedText
        };
        
      } catch (error) {
        return {
          status: 'failed',
          url,
          errorCode: isLinkedIn ? 'LINKEDIN_BLOCKED' : 'FETCH_FAILED',
          message: isLinkedIn
            ? 'LinkedIn blocks automated extraction. Please paste text or upload a file instead.'
            : error.message,
          statusCode: null,
          extractedText: ''
        };
      }
    };

    // Extract URL A
    if (urlA) {
      const resultA = await extractFromUrl(urlA, 'A');
      if (resultA.status === 'success') {
        results.textA = resultA.extractedText;
        results.sources.push({ url: urlA, status: 'success' });
      } else {
        results.sources.push({
          url: urlA,
          status: 'failed',
          errorCode: resultA.errorCode,
          message: resultA.message,
          statusCode: resultA.statusCode
        });
      }
    }

    // Extract URL B
    if (urlB) {
      const resultB = await extractFromUrl(urlB, 'B');
      if (resultB.status === 'success') {
        results.textB = resultB.extractedText;
        results.sources.push({ url: urlB, status: 'success' });
      } else {
        results.sources.push({
          url: urlB,
          status: 'failed',
          errorCode: resultB.errorCode,
          message: resultB.message,
          statusCode: resultB.statusCode
        });
      }
    }

    // Check if any extraction succeeded
    const anySuccess = results.sources.some(s => s.status === 'success');
    if (!anySuccess) {
      return Response.json({
        ok: false,
        error: 'Failed to extract text from all provided URLs',
        sources: results.sources,
        correlationId
      }, { status: 200 }); // Return 200 so frontend can handle gracefully
    }

    return Response.json(results);

  } catch (error) {
    console.error('ExtractFromUrls error:', error);
    const correlationId = `error_${Date.now()}`;
    return Response.json({ 
      error: error.message,
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: 'Internal server error during extraction',
      correlationId
    }, { status: 500 });
  }
});