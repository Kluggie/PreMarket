import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Simple cache with 24hr expiry
const urlCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const rateLimitMap = new Map();
const RATE_LIMIT = 5; // 5 extractions per hour per user
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of urlCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      urlCache.delete(key);
    }
  }
}

function checkRateLimit(userId) {
  const now = Date.now();
  const userKey = userId || 'anonymous';
  
  if (!rateLimitMap.has(userKey)) {
    rateLimitMap.set(userKey, []);
  }
  
  const timestamps = rateLimitMap.get(userKey).filter(t => now - t < RATE_WINDOW);
  rateLimitMap.set(userKey, timestamps);
  
  if (timestamps.length >= RATE_LIMIT) {
    return false;
  }
  
  timestamps.push(now);
  rateLimitMap.set(userKey, timestamps);
  return true;
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PreMarket Profile Matcher (contact@premarket.com)'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      return null;
    }
    
    const html = await response.text();
    
    // Extract plain text (basic)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000); // Limit to 50k chars per page
    
    return text;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return null;
  }
}

async function fetchGitHubRepo(repoUrl, maxPages = 6) {
  const pages = [];
  const urlObj = new URL(repoUrl);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  
  if (pathParts.length < 2) {
    return pages;
  }
  
  const owner = pathParts[0];
  const repo = pathParts[1];
  const baseUrl = `https://github.com/${owner}/${repo}`;
  
  // Fetch main README
  const mainText = await fetchPage(baseUrl);
  if (mainText) {
    pages.push({ url: baseUrl, text: mainText.substring(0, 15000) });
  }
  
  if (pages.length >= maxPages) return pages;
  
  // Fetch releases
  const releasesText = await fetchPage(`${baseUrl}/releases`);
  if (releasesText) {
    pages.push({ url: `${baseUrl}/releases`, text: releasesText.substring(0, 10000) });
  }
  
  if (pages.length >= maxPages) return pages;
  
  // Fetch issues (first page)
  const issuesText = await fetchPage(`${baseUrl}/issues`);
  if (issuesText) {
    pages.push({ url: `${baseUrl}/issues`, text: issuesText.substring(0, 10000) });
  }
  
  if (pages.length >= maxPages) return pages;
  
  // Fetch pulls (first page)
  const pullsText = await fetchPage(`${baseUrl}/pulls`);
  if (pullsText) {
    pages.push({ url: `${baseUrl}/pulls`, text: pullsText.substring(0, 10000) });
  }
  
  return pages;
}

async function fetchWebsite(mainUrl, maxPages = 6) {
  const pages = [];
  const urlObj = new URL(mainUrl);
  const domain = urlObj.hostname;
  
  // Fetch main page
  const mainText = await fetchPage(mainUrl);
  if (mainText) {
    pages.push({ url: mainUrl, text: mainText.substring(0, 15000) });
  }
  
  if (pages.length >= maxPages) return pages;
  
  // Relevant paths to check
  const relevantPaths = [
    '/docs', '/documentation', '/security', '/trust', '/pricing',
    '/careers', '/jobs', '/program', '/apply', '/about'
  ];
  
  for (const path of relevantPaths) {
    if (pages.length >= maxPages) break;
    
    const targetUrl = `${urlObj.protocol}//${domain}${path}`;
    if (targetUrl === mainUrl) continue;
    
    const text = await fetchPage(targetUrl);
    if (text && text.length > 500) {
      pages.push({ url: targetUrl, text: text.substring(0, 10000) });
    }
  }
  
  return pages;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { url, mode, maxPages = 6 } = await req.json();
    
    if (!url || !mode) {
      return Response.json({ error: 'Missing url or mode' }, { status: 400 });
    }
    
    // Rate limiting
    if (!checkRateLimit(user.id)) {
      return Response.json({ 
        error: 'Rate limit exceeded. Please try again in an hour.',
        ok: false 
      }, { status: 429 });
    }
    
    // Clean up expired cache
    cleanupCache();
    
    // Check cache
    const cacheKey = `${url}:${mode}`;
    if (urlCache.has(cacheKey)) {
      const cached = urlCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return Response.json(cached.data);
      }
    }
    
    // Fetch pages
    let pages = [];
    if (url.includes('github.com')) {
      pages = await fetchGitHubRepo(url, maxPages);
    } else {
      pages = await fetchWebsite(url, maxPages);
    }
    
    if (pages.length === 0) {
      return Response.json({ 
        ok: false, 
        error: 'Could not fetch any content from the provided URL' 
      });
    }
    
    // Build combined text
    const combinedText = pages.map((p, i) => 
      `=== SOURCE ${i + 1}: ${p.url} ===\n${p.text}\n`
    ).join('\n\n');
    
    // Build prompt based on mode
    const modeInstructions = {
      'Job Fit': 'Extract job requirements including: role title(s), seniority level, tech stack, location constraints, work authorization needs, compensation range, required years of experience, and key responsibilities.',
      'Beta Access Fit': 'Extract beta program requirements including: intended use cases, supported platforms/environments, user sophistication level, expected feedback commitment, NDA requirements, and target organization types.',
      'Program/Accelerator Fit': 'Extract program requirements including: program type, target stage, geography constraints, time commitment, equity/terms expectations, and application requirements.',
      'Grant/Scholarship Fit': 'Extract grant requirements including: eligible applicant types, funding ranges, eligible regions, fields/disciplines, deliverables timeline, and application criteria.'
    };
    
    const prompt = `You are extracting structured requirements from web pages for a "${mode}" matching use case.

STRICT RULES:
1. Output ONLY valid JSON matching the schema below
2. Do NOT hallucinate - if information is not present, use "Unknown" or omit
3. Cite source_excerpt (short quote) and source_url for each inferred field
4. Confidence is 0-1 (0.9+ only if explicitly stated, 0.5-0.8 if inferred, <0.5 if guessed)

${modeInstructions[mode] || 'Extract all relevant requirements for profile matching.'}

SOURCE CONTENT:
${combinedText.substring(0, 40000)}

OUTPUT JSON SCHEMA:
{
  "inferred_fields": [
    {
      "question_label": "string (e.g., 'Target Role Title(s)')",
      "suggested_value": "string",
      "confidence": 0.0,
      "source_excerpt": "string (short quote)",
      "source_url": "string"
    }
  ],
  "notes": ["string (brief observations)"]
}

Return ONLY the JSON, no markdown, no extra text.`;
    
    // Call Vertex AI
    const result = await base44.asServiceRole.functions.invoke('GenerateContent', {
      projectId: 'premarket-484606',
      location: 'global',
      model: 'gemini-3-flash-preview',
      text: prompt,
      temperature: 0.1,
      maxOutputTokens: 4000
    });
    
    if (!result.data || !result.data.ok) {
      return Response.json({ 
        ok: false, 
        error: 'AI extraction failed',
        raw_sources: pages.map(p => ({ url: p.url, text_excerpt: p.text.substring(0, 500) }))
      });
    }
    
    // Parse JSON output
    let parsed;
    try {
      let jsonText = result.data.outputText || '';
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }
      
      parsed = JSON.parse(jsonText);
      
      if (!parsed.inferred_fields || !Array.isArray(parsed.inferred_fields)) {
        throw new Error('Invalid structure');
      }
    } catch (parseError) {
      return Response.json({ 
        ok: false, 
        error: `Failed to parse AI output: ${parseError.message}`,
        raw_output: result.data.outputText,
        raw_sources: pages.map(p => ({ url: p.url, text_excerpt: p.text.substring(0, 500) }))
      });
    }
    
    const response = {
      ok: true,
      inferred_fields: parsed.inferred_fields || [],
      notes: parsed.notes || [],
      raw_sources: pages.map(p => ({ url: p.url, text_excerpt: p.text.substring(0, 500) }))
    };
    
    // Cache result
    urlCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });
    
    return Response.json(response);
    
  } catch (error) {
    console.error('ExtractRequirementsFromUrl error:', error);
    return Response.json({
      ok: false,
      error: error.message
    }, { status: 500 });
  }
});