import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractTitleFromHtml(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }

  const title = decodeHtmlEntities(String(match[1] || '').replace(/\s+/g, ' ').trim());
  return title || null;
}

function extractTextFromHtml(html: string) {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

  const withLineBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const stripped = withLineBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeExtractedText(text: string) {
  const normalized = String(text || '').replace(/\u0000/g, '').trim();
  if (!normalized) {
    return '';
  }

  const maxLength = 120000;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength);
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
        Accept: 'text/plain,text/markdown,text/html,application/xhtml+xml,*/*;q=0.8',
        'User-Agent': 'PreMarket-DocumentComparison/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/document-comparisons/extract-url', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    if (String(process.env.URL_EXTRACTION_DISABLED || '').trim() === '1') {
      throw new ApiError(501, 'not_configured', 'URL extraction is not configured');
    }

    const body = await readJsonBody(req);
    const targetUrl = asText(body.url);
    if (!targetUrl) {
      throw new ApiError(400, 'invalid_input', 'url is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new ApiError(400, 'invalid_input', 'url must be a valid absolute URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ApiError(400, 'invalid_input', 'Only http and https URLs are supported');
    }

    let upstream: Response;
    try {
      upstream = await fetchWithTimeout(parsed.toString());
    } catch (error: any) {
      throw new ApiError(
        502,
        'extract_failed',
        error?.name === 'AbortError' ? 'URL extraction timed out' : 'Failed to fetch URL',
      );
    }

    if (!upstream.ok) {
      throw new ApiError(502, 'extract_failed', `URL responded with status ${upstream.status}`);
    }

    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    const rawText = await upstream.text().catch(() => '');

    let extractedText = '';
    let title = null;

    if (contentType.includes('text/html') || /<html[\s>]/i.test(rawText)) {
      title = extractTitleFromHtml(rawText);
      extractedText = extractTextFromHtml(rawText);
    } else if (
      contentType.includes('text/plain') ||
      contentType.includes('text/markdown') ||
      contentType.includes('application/json') ||
      contentType.includes('application/xml') ||
      contentType.includes('text/xml')
    ) {
      extractedText = rawText;
    } else {
      throw new ApiError(501, 'not_configured', `Unsupported content type for extraction: ${contentType || 'unknown'}`);
    }

    const normalized = normalizeExtractedText(extractedText);
    if (!normalized) {
      throw new ApiError(422, 'extract_failed', 'No readable text could be extracted from URL');
    }

    ok(res, 200, {
      ok: true,
      text: normalized,
      title,
    });
  });
}
