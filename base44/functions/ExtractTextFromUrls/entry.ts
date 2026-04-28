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

    const extractText = async (url) => {
      if (!url) return null;
      
      // Validate URL
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Only HTTP/HTTPS URLs are supported');
        }
      } catch (e) {
        throw new Error(`Invalid URL: ${e.message}`);
      }

      // Fetch URL
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PreMarket Document Comparison Bot/1.0'
        },
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch (${response.status})`);
      }

      const html = await response.text();
      
      // Basic HTML cleanup - remove scripts, styles, nav
      let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      // Cap at 50k chars
      const MAX_LENGTH = 50000;
      const truncated = text.length > MAX_LENGTH;
      if (truncated) {
        text = text.substring(0, MAX_LENGTH);
      }

      return { text, truncated };
    };

    const results = await Promise.all([
      urlA ? extractText(urlA) : Promise.resolve(null),
      urlB ? extractText(urlB) : Promise.resolve(null)
    ]);

    return Response.json({
      ok: true,
      textA: results[0]?.text || '',
      textB: results[1]?.text || '',
      meta: {
        truncatedA: results[0]?.truncated || false,
        truncatedB: results[1]?.truncated || false
      }
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return Response.json({ 
      error: err.message,
      ok: false
    }, { status: 500 });
  }
});