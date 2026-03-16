import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  assertStarterMonthlyUploadAllowed,
  recordStarterUploadUsage,
} from '../../_lib/starter-entitlements.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBase64File(rawValue: unknown) {
  const value = asText(rawValue);
  if (!value) {
    throw new ApiError(400, 'invalid_input', 'fileBase64 is required');
  }

  const commaIndex = value.indexOf(',');
  const encoded = value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  const normalized = encoded.replace(/\s+/g, '');
  if (!normalized) {
    throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(normalized, 'base64');
  } catch {
    throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
  }

  const normalizedWithoutPadding = normalized.replace(/=+$/g, '');
  const roundTrip = buffer.toString('base64').replace(/=+$/g, '');
  if (!buffer.length || normalizedWithoutPadding !== roundTrip) {
    throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
  }

  if (!buffer.length) {
    throw new ApiError(400, 'invalid_input', 'Decoded file payload was empty');
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new ApiError(
      413,
      'payload_too_large',
      `File is too large. Maximum supported size is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB.`,
    );
  }

  return buffer;
}

function getExtension(filename: string) {
  const lower = String(filename || '').toLowerCase();
  if (!lower.includes('.')) return '';
  return lower.split('.').pop() || '';
}

function inferFileType(filename: string, mimeType: string) {
  const extension = getExtension(filename);
  const mime = String(mimeType || '').toLowerCase();

  if (
    extension === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }

  if (extension === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }

  return 'unsupported';
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

function extractTextFromHtml(html: string) {
  const withoutScripts = String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  const withLineBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n');

  const stripped = withLineBreaks.replace(/<[^>]+>/g, ' ');
  return normalizeText(decodeHtmlEntities(stripped));
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '<p></p>';
  }

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

async function extractDocx(buffer: Buffer) {
  const mammothModule: any = await import('mammoth');
  const mammoth = mammothModule?.default || mammothModule;
  const result = await mammoth.convertToHtml({ buffer });
  const html = String(result?.value || '').trim();
  const text = extractTextFromHtml(html);

  if (!html && !text) {
    throw new ApiError(422, 'extract_failed', 'No readable content was extracted from DOCX');
  }

  return {
    html: html || textToHtml(text),
    text,
  };
}

async function extractPdf(buffer: Buffer) {
  let PDFParse: any;
  try {
    const module: any = await import('pdf-parse');
    PDFParse = module?.PDFParse;
  } catch {
    throw new ApiError(501, 'not_configured', 'PDF extraction dependency is unavailable on this server');
  }

  if (typeof PDFParse !== 'function') {
    throw new ApiError(501, 'not_configured', 'PDF extraction dependency is unavailable on this server');
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const text = normalizeText(parsed?.text);
    if (!text) {
      throw new ApiError(
        400,
        'extract_failed',
        'Could not extract text from PDF. The file may be scanned/image-only or corrupted.',
      );
    }

    return {
      text,
    };
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      400,
      'extract_failed',
      'Could not extract text from PDF. The file may be scanned/image-only or corrupted.',
      { cause: String(error?.message || '') },
    );
  } finally {
    await parser.destroy().catch(() => null);
  }
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/documents/extract', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const body = await readJsonBody(req);
    const db = getDb();

    const filename = asText(body.filename || body.file_name || body.name || 'document');
    const mimeType = asText(body.mimeType || body.mime_type || body.type || 'application/octet-stream');
    const fileType = inferFileType(filename, mimeType);

    if (!ALLOWED_MIME_TYPES.has(String(mimeType || '').toLowerCase()) || fileType === 'unsupported') {
      throw new ApiError(
        400,
        'invalid_file_type',
        'Unsupported file type. Please upload a DOCX (.docx) or PDF (.pdf) file.',
      );
    }

    const buffer = decodeBase64File(body.fileBase64 || body.file_base64 || body.base64);

    await assertStarterMonthlyUploadAllowed(db, {
      userId: auth.user.id,
      incomingBytes: buffer.length,
    });

    if (fileType === 'docx') {
      const extracted = await extractDocx(buffer);
      await recordStarterUploadUsage(db, {
        userId: auth.user.id,
        bytes: buffer.length,
        metadata: {
          source: 'documents_extract',
        },
      });
      ok(res, 200, {
        ok: true,
        filename,
        mimeType,
        html: extracted.html,
        text: extracted.text,
      });
      return;
    }

    const extracted = await extractPdf(buffer);
    await recordStarterUploadUsage(db, {
      userId: auth.user.id,
      bytes: buffer.length,
      metadata: {
        source: 'documents_extract',
      },
    });
    ok(res, 200, {
      ok: true,
      filename,
      mimeType,
      text: extracted.text,
    });
  });
}
