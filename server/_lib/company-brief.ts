import { createSign } from 'node:crypto';
import { ApiError } from './errors.js';
import { getVertexConfig, getVertexNotConfiguredError } from './integrations.js';

const MAX_SEARCH_QUERIES = 8;
const MAX_RESULTS_PER_QUERY = 3;
const MAX_SOURCE_COUNT = 12;
const MAX_SOURCE_EXCERPT_CHARS = 1800;
const MAX_MODEL_OUTPUT_CHARS = 32000;
const HALLUCINATION_PATTERN = /i\s+couldn['’]t\s+find\s+sources.*here\s+are\s+facts\s+anyway/i;

export type CompanyBriefLens =
  | 'risk_negotiation'
  | 'procurement'
  | 'partnership'
  | 'investment'
  | 'risk';

export type CompanyBriefSource = {
  id: number;
  title: string;
  url: string;
  snippet: string;
  extractedText: string;
};

export type CompanyBriefResult = {
  provider: 'vertex' | 'mock' | 'fallback';
  model: string;
  briefText: string;
  sources: CompanyBriefSource[];
  searches: string[];
  limited: boolean;
  citationCount: number;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeHtmlEntities(input: string) {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(input: string) {
  return decodeHtmlEntities(String(input || '').replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWebsite(website: string) {
  const raw = asText(website);
  if (!raw) {
    return '';
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeDomain(value: string) {
  const normalized = normalizeWebsite(value);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function normalizeLens(input: unknown): CompanyBriefLens {
  const value = asText(input).toLowerCase();
  if (value === 'procurement') return 'procurement';
  if (value === 'partnership') return 'partnership';
  if (value === 'investment') return 'investment';
  if (value === 'risk') return 'risk';
  return 'risk_negotiation';
}

function lensLabel(lens: CompanyBriefLens) {
  if (lens === 'procurement') return 'Procurement';
  if (lens === 'partnership') return 'Partnership';
  if (lens === 'investment') return 'Investment';
  if (lens === 'risk') return 'Risk';
  return 'Risk + Negotiation';
}

function normalizeUrlCandidate(value: string) {
  const raw = asText(value);
  if (!raw) {
    return '';
  }
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      const parsed = new URL(decoded);
      parsed.hash = '';
      return parsed.toString();
    }
  } catch {
    // ignore decode errors
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }
  return '';
}

function parseBingRssItems(xml: string) {
  const items: SearchResult[] = [];
  const itemMatches = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];
  itemMatches.forEach((entry) => {
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = entry.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = entry.match(/<description>([\s\S]*?)<\/description>/i);
    const title = stripHtml(titleMatch ? titleMatch[1] : '');
    const url = normalizeUrlCandidate(stripHtml(linkMatch ? linkMatch[1] : ''));
    const snippet = stripHtml(descMatch ? descMatch[1] : '');
    if (!url || !title) {
      return;
    }
    items.push({
      title: title.slice(0, 240),
      url,
      snippet: snippet.slice(0, 360),
    });
  });
  return items;
}

function buildSearchQueries(params: { companyName: string; website: string }) {
  const companyName = asText(params.companyName);
  const domain = normalizeDomain(params.website);
  const qualifier = [companyName, domain].filter(Boolean).join(' ').trim();
  const base = qualifier || companyName;

  const queries = [
    `${base} overview`,
    `${companyName} product`,
    `${companyName} pricing`,
    `${companyName} security SOC 2 ISO`,
    `${companyName} GDPR`,
    `${companyName} news`,
    `${companyName} funding`,
    `${companyName} competitors`,
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, MAX_SEARCH_QUERIES);
}

async function fetchWithTimeout(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        'User-Agent': 'PreMarket-CompanyBrief/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchQuery(query: string) {
  try {
    const endpoint = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(endpoint, 10000);
    if (!response.ok) {
      return [] as SearchResult[];
    }
    const xml = await response.text().catch(() => '');
    return parseBingRssItems(xml).slice(0, MAX_RESULTS_PER_QUERY);
  } catch {
    return [] as SearchResult[];
  }
}

function extractTitleFromHtml(html: string) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }
  return stripHtml(match[1]).slice(0, 220);
}

function extractTextFromHtml(html: string) {
  const withoutScripts = String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return stripHtml(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_SOURCE_EXCERPT_CHARS);
}

async function fetchSourceExcerpt(url: string) {
  try {
    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) {
      return { title: '', text: '' };
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const body = await response.text().catch(() => '');
    if (!body) {
      return { title: '', text: '' };
    }
    if (contentType.includes('text/html') || /<html[\s>]/i.test(body)) {
      return {
        title: extractTitleFromHtml(body),
        text: extractTextFromHtml(body),
      };
    }
    return {
      title: '',
      text: stripHtml(body).slice(0, MAX_SOURCE_EXCERPT_CHARS),
    };
  } catch {
    return { title: '', text: '' };
  }
}

async function collectPublicSources(params: {
  companyName: string;
  website: string;
  lens: CompanyBriefLens;
}) {
  const testOverride = (globalThis as any).__PREMARKET_TEST_COMPANY_BRIEF_RESEARCH__;
  if (typeof testOverride === 'function') {
    const mocked = await testOverride({
      companyName: params.companyName,
      website: params.website,
      lens: params.lens,
    });
    const mockedQueries = Array.isArray(mocked?.queries) ? mocked.queries.map((entry: unknown) => asText(entry)).filter(Boolean) : [];
    const mockedSourcesRaw = Array.isArray(mocked?.sources) ? mocked.sources : [];
    const mockedSources = mockedSourcesRaw
      .map((source: any, index: number) => ({
        id: index + 1,
        title: asText(source?.title) || `Source ${index + 1}`,
        url: normalizeUrlCandidate(asText(source?.url)),
        snippet: asText(source?.snippet),
        extractedText: asText(source?.extractedText || source?.excerpt || source?.snippet),
      }))
      .filter((source: CompanyBriefSource) => Boolean(source.url))
      .slice(0, MAX_SOURCE_COUNT);
    return {
      searches: mockedQueries.length ? mockedQueries : buildSearchQueries(params),
      sources: mockedSources,
    };
  }

  const searches = buildSearchQueries(params);
  const aggregated: SearchResult[] = [];
  for (const query of searches) {
    const queryResults = await searchQuery(query);
    aggregated.push(...queryResults);
  }

  const uniqueByUrl = new Map<string, SearchResult>();
  aggregated.forEach((entry) => {
    if (!entry.url || uniqueByUrl.has(entry.url)) {
      return;
    }
    uniqueByUrl.set(entry.url, entry);
  });

  const uniqueResults = [...uniqueByUrl.values()].slice(0, MAX_SOURCE_COUNT);
  const sources: CompanyBriefSource[] = [];
  for (let index = 0; index < uniqueResults.length; index += 1) {
    const entry = uniqueResults[index];
    const extracted = await fetchSourceExcerpt(entry.url);
    sources.push({
      id: index + 1,
      title: extracted.title || entry.title || `Source ${index + 1}`,
      url: entry.url,
      snippet: entry.snippet || extracted.text.slice(0, 220),
      extractedText: extracted.text || entry.snippet || '',
    });
  }

  return { searches, sources };
}

function buildEvidencePack(sources: CompanyBriefSource[]) {
  return sources
    .map(
      (source) =>
        `[${source.id}] ${source.title}\nURL: ${source.url}\nSnippet: ${
          source.snippet || '(none)'
        }\nExtract: ${source.extractedText || '(none)'}`,
    )
    .join('\n\n');
}

function buildSourceListMarkdown(sources: CompanyBriefSource[]) {
  if (!sources.length) {
    return '- No reliable sources found.';
  }
  return sources.map((source) => `- [${source.id}] ${source.title} — ${source.url}`).join('\n');
}

function countCitations(text: string) {
  const matches = String(text || '').match(/\[(\d+)\]/g) || [];
  return matches.length;
}

function hasRequiredSections(text: string) {
  const required = [
    'Company overview',
    'Products / offerings',
    'Customers / segments',
    'Business model',
    'Team / leadership',
    'Funding / financial signals',
    'Compliance / trust signals',
    'Recent news',
    'Controversies / red flags',
    'Competitors / alternatives',
    'Negotiation implications + questions to ask',
    'Sources',
  ];
  const normalized = String(text || '').toLowerCase();
  return required.every((heading) => normalized.includes(heading.toLowerCase()));
}

function buildFallbackBrief(params: {
  companyName: string;
  website: string;
  lens: CompanyBriefLens;
  sources: CompanyBriefSource[];
  searches: string[];
  limited: boolean;
}) {
  const sourceRefs = params.sources.map((source) => `[${source.id}]`);
  const primaryRef = sourceRefs[0] || '';
  const secondaryRef = sourceRefs[1] || primaryRef;
  const tertiaryRef = sourceRefs[2] || secondaryRef || primaryRef;
  const sourceHint = primaryRef ? ` ${primaryRef}` : '';

  const lines = [
    '## Company overview (what they do, who they sell to)',
    params.sources.length
      ? `- Fact: Public company descriptions were found in the collected sources.${sourceHint}`
      : '- Not found.',
    '',
    '## Products / offerings',
    params.sources.length
      ? `- Fact: Product or service information appears in public materials ${secondaryRef || primaryRef}.`
      : '- Not found.',
    '',
    '## Customers / segments (only if reliably sourced)',
    params.sources.length
      ? `- Fact: Public references to customer segments require direct verification from company sources ${tertiaryRef || secondaryRef || primaryRef}.`
      : '- Not found.',
    '',
    '## Business model (as stated publicly)',
    params.sources.length ? `- Fact: Public business-model indicators are available in collected sources ${primaryRef}.` : '- Not found.',
    '',
    '## Team / leadership (key execs if available)',
    params.sources.length ? `- Fact: Leadership details should be verified on official profile pages ${secondaryRef || primaryRef}.` : '- Not found.',
    '',
    '## Funding / financial signals (only if sourced; otherwise say "Not found")',
    params.sources.length ? `- Fact: Funding and financial claims were not confidently confirmed from the collected evidence ${primaryRef}.` : '- Not found.',
    '',
    '## Compliance / trust signals (SOC 2, ISO, GDPR, etc. only if explicitly stated)',
    params.sources.length ? `- Fact: Compliance assertions need explicit confirmation from trust/security pages ${secondaryRef || primaryRef}.` : '- Not found.',
    '',
    '## Recent news (last 12–18 months) with short summary per item',
    params.sources.length
      ? `- Fact: News coverage exists in the collected sources and should be reviewed for date recency ${tertiaryRef || secondaryRef || primaryRef}.`
      : '- Not found.',
    '',
    '## Controversies / red flags (only if sourced; use neutral language)',
    params.sources.length
      ? `- Fact: No high-confidence controversy claim is included without direct sourcing ${primaryRef}.`
      : '- Not found.',
    '',
    '## Competitors / alternatives (if inferable from sources)',
    params.sources.length
      ? `- Inference: Potential alternatives can be inferred from similar category pages and market listings ${secondaryRef || primaryRef}.`
      : '- Not found.',
    '',
    '## Negotiation implications + questions to ask (must clearly distinguish "inference" vs "fact")',
    params.sources.length
      ? `- Fact: Public materials provide baseline positioning details for diligence ${primaryRef}.\n- Inference: Ask for proof of compliance posture, pricing structure, renewal terms, and implementation constraints before committing ${secondaryRef || primaryRef}.`
      : '- Inference: Limited public info found; ask the counterparty for core company background, trust documentation, and references.',
    '',
    '## Sources',
    buildSourceListMarkdown(params.sources),
  ];

  if (params.limited) {
    lines.push('', '## Search coverage');
    params.searches.forEach((query) => {
      lines.push(`- ${query}`);
    });
  }

  if (params.companyName || params.website) {
    lines.unshift(
      `Company: ${params.companyName || 'unknown'}`,
      `Website: ${params.website || 'unknown'}`,
      `Lens: ${lensLabel(params.lens)}`,
      '',
    );
  }

  return lines.join('\n').slice(0, MAX_MODEL_OUTPUT_CHARS);
}

function buildCompanyBriefPrompt(params: {
  companyName: string;
  website: string;
  lens: CompanyBriefLens;
  sources: CompanyBriefSource[];
  searches: string[];
}) {
  return [
    'You are a senior deal consultant producing a sourced company brief.',
    'Use ONLY the evidence pack below. Do not guess, and do not invent facts.',
    'Every non-trivial factual claim must include citation markers like [1], [2], mapped to the evidence sources.',
    'If information is unavailable, write "Not found."',
    'If sources conflict, state the conflict neutrally.',
    'Distinguish clearly between Fact and Inference in "Negotiation implications + questions to ask".',
    'Output must be concise markdown headings with bullet points (no long paragraphs).',
    '',
    `Company name: ${params.companyName || 'unknown'}`,
    `Company website: ${params.website || 'unknown'}`,
    `Lens: ${lensLabel(params.lens)}`,
    '',
    'Required headings:',
    '## Company overview (what they do, who they sell to)',
    '## Products / offerings',
    '## Customers / segments (only if reliably sourced)',
    '## Business model (as stated publicly)',
    '## Team / leadership (key execs if available)',
    '## Funding / financial signals (only if sourced; otherwise say "Not found")',
    '## Compliance / trust signals (SOC 2, ISO, GDPR, etc. only if explicitly stated)',
    '## Recent news (last 12–18 months) with short summary per item',
    '## Controversies / red flags (only if sourced; use neutral language)',
    '## Competitors / alternatives (if inferable from sources)',
    '## Negotiation implications + questions to ask (must clearly distinguish "inference" vs "fact")',
    '## Sources',
    '',
    'Search queries used:',
    ...params.searches.map((query) => `- ${query}`),
    '',
    'Evidence pack:',
    buildEvidencePack(params.sources),
  ].join('\n');
}

function ensureSourcesSection(text: string, sources: CompanyBriefSource[]) {
  const normalized = asText(text);
  if (!normalized) {
    return '';
  }
  if (/##\s*Sources/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}\n\n## Sources\n${buildSourceListMarkdown(sources)}`.trim();
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

async function fetchGoogleAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64url');
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }
  const payloadJson = (await response.json().catch(() => ({}))) as { access_token?: string };
  const accessToken = asText(payloadJson.access_token);
  if (!accessToken) {
    throw new ApiError(502, 'vertex_auth_failed', 'Vertex AI access token was not returned');
  }
  return accessToken;
}

function extractModelText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = Array.isArray(candidates?.[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function callVertexCompanyBrief(prompt: string, preferredModel = '') {
  const testOverride = (globalThis as any).__PREMARKET_TEST_COMPANY_BRIEF_VERTEX_CALL__;
  if (typeof testOverride === 'function') {
    const response = await testOverride({ prompt, preferredModel });
    return {
      provider: 'mock' as const,
      model: asText(response?.model) || 'company-brief-test-model',
      text: asText(response?.text),
    };
  }

  const mockPayload = asText(process.env.VERTEX_COMPANY_BRIEF_MOCK_RESPONSE);
  if (mockPayload) {
    return {
      provider: 'mock' as const,
      model: 'company-brief-mock',
      text: mockPayload,
    };
  }

  const vertex = getVertexConfig();
  if (!vertex.ready || !vertex.credentials) {
    const config = getVertexNotConfiguredError();
    throw new ApiError(501, 'not_configured', config.message, config.details);
  }

  const accessToken = await fetchGoogleAccessToken(vertex.credentials);
  const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
  const location = asText(process.env.GCP_LOCATION) || vertex.location;
  const preferred =
    asText(preferredModel) || asText(process.env.VERTEX_COMPANY_BRIEF_MODEL) || asText(process.env.VERTEX_MODEL) || vertex.model;
  const modelCandidates = [preferred, 'gemini-2.0-flash-001', 'gemini-1.5-flash-002']
    .map((value) => asText(value))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  let lastStatus = 0;
  let lastMessage = '';

  for (const model of modelCandidates) {
    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 6000,
          temperature: 0.2,
          topP: 0.9,
        },
      }),
    });

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      return {
        provider: 'vertex' as const,
        model,
        text: extractModelText(payload),
      };
    }

    const details = await response.text().catch(() => '');
    lastStatus = response.status;
    lastMessage = details ? details.slice(0, 500) : '';
    const modelMissing = response.status === 404 && /publisher model/i.test(details);
    if (modelMissing) {
      continue;
    }

    throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
      upstreamStatus: response.status,
      upstreamMessage: lastMessage || null,
      triedModels: modelCandidates,
    });
  }

  throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
    upstreamStatus: lastStatus || 404,
    upstreamMessage: lastMessage || 'No accessible Vertex model found for this project',
    triedModels: modelCandidates,
  });
}

export async function generateCompanyBrief(params: {
  companyName: string;
  website?: string;
  lens?: unknown;
}) {
  const companyName = asText(params.companyName);
  const website = normalizeWebsite(asText(params.website));
  const lens = normalizeLens(params.lens);

  const research = await collectPublicSources({
    companyName,
    website,
    lens,
  });
  const sources = research.sources.slice(0, MAX_SOURCE_COUNT);
  const searches = research.searches.slice(0, MAX_SEARCH_QUERIES);
  const limited = sources.length < 3;

  if (!sources.length) {
    const limitedBrief = buildFallbackBrief({
      companyName,
      website,
      lens,
      sources,
      searches,
      limited: true,
    });
    return {
      provider: 'fallback' as const,
      model: 'company-brief-fallback',
      briefText: limitedBrief,
      sources,
      searches,
      limited: true,
      citationCount: countCitations(limitedBrief),
    };
  }

  const prompt = buildCompanyBriefPrompt({
    companyName,
    website,
    lens,
    sources,
    searches,
  });
  const generated = await callVertexCompanyBrief(prompt, process.env.VERTEX_COMPANY_BRIEF_MODEL || process.env.VERTEX_MODEL || '');
  let briefText = asText(generated.text).slice(0, MAX_MODEL_OUTPUT_CHARS);

  if (
    !briefText ||
    HALLUCINATION_PATTERN.test(briefText) ||
    !hasRequiredSections(briefText) ||
    countCitations(briefText) < Math.min(3, sources.length)
  ) {
    briefText = buildFallbackBrief({
      companyName,
      website,
      lens,
      sources,
      searches,
      limited,
    });
  }

  briefText = ensureSourcesSection(briefText, sources);
  return {
    provider: generated.provider,
    model: generated.model || 'company-brief-model',
    briefText,
    sources,
    searches,
    limited,
    citationCount: countCitations(briefText),
  };
}
