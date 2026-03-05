/**
 * GET  /api/documents        – list the current user's documents + quota info
 * POST /api/documents/upload – upload a new document (JSON body with base64 file)
 *
 * Quota:
 *   MAX_FILES        = 5
 *   MAX_TOTAL_BYTES  = 10 MB
 *   MAX_FILE_BYTES   = 5 MB
 *
 * Accepted types (both MIME and extension must be in the whitelist):
 *   PDF, DOCX, XLSX, PPTX, TXT, MD
 *
 * Rate limit: 10 upload attempts per user per minute (in-memory).
 */

import { asc, eq, sql } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { newId } from '../../_lib/ids.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import {
  buildStorageKey,
  getStorageProvider,
  storeFileToDisk,
} from './storage.js';
import { extractDocumentText, generateSummary } from './text-extraction.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_FILE_BYTES  = 5 * 1024 * 1024;    // 5 MB
const EXTRACTED_TEXT_CAP = 200 * 1024;       // 200 KB (approx chars for UTF-8)
const PROCESSING_TIMEOUT_MS = 15_000;        // 15 s hard limit for extraction

// Accepted MIME types *and* extensions — both must be present and valid.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // .pptx
  'text/plain',
  'text/markdown',
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md']);

// ---------------------------------------------------------------------------
// In-memory upload rate limiter: 10 uploads per user per 60s window
// ---------------------------------------------------------------------------
const _uploadTimestamps = new Map<string, number[]>();

function checkUploadRateLimit(userId: string): void {
  const NOW = Date.now();
  const WINDOW = 60_000;
  const LIMIT = 10;
  const ts = (_uploadTimestamps.get(userId) || []).filter((t) => NOW - t < WINDOW);
  if (ts.length >= LIMIT) {
    throw new ApiError(
      429,
      'rate_limited',
      'Too many upload attempts. Please wait a minute before trying again.',
    );
  }
  ts.push(NOW);
  _uploadTimestamps.set(userId, ts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function asText(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

function getExtension(filename: string) {
  const lower = String(filename || '').toLowerCase();
  const parts = lower.split('.');
  return parts.length > 1 ? parts.pop()! : '';
}

function mapDocRow(row: any) {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    status: row.status,
    summary_text: row.summaryText || null,
    error_message: row.errorMessage || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function getCurrentUsage(db: any, userId: string) {
  const rows = await db
    .select({
      fileCount: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(size_bytes), 0)::bigint`,
    })
    .from(schema.userDocuments)
    .where(eq(schema.userDocuments.userId, userId));

  const row = rows[0] || { fileCount: 0, totalBytes: 0 };
  return {
    fileCount: Number(row.fileCount || 0),
    totalBytes: Number(row.totalBytes || 0),
  };
}

// ---------------------------------------------------------------------------
// Synchronous document processing (extraction + summarization)
// Returns { status, extractedText, summaryText, errorMessage }
// ---------------------------------------------------------------------------
type ProcessResult = {
  status: 'ready' | 'not_supported' | 'failed';
  extractedText: string | null;
  summaryText: string | null;
  errorMessage: string | null;
};

async function processDocumentSync(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ProcessResult> {
  const extraction = await extractDocumentText(buffer, mimeType, filename);

  if (!extraction.supported) {
    return { status: 'not_supported', extractedText: null, summaryText: null, errorMessage: null };
  }

  const rawText = extraction.text;
  if (!rawText) {
    return {
      status: 'not_supported',
      extractedText: null,
      summaryText: null,
      errorMessage: 'Text extraction produced no content',
    };
  }

  // Cap extracted text at 200 KB
  const extractedText = rawText.slice(0, EXTRACTED_TEXT_CAP);

  // Best-effort summarization; returns null if AI is unavailable
  const summaryText = await generateSummary(rawText, filename).catch(() => null);

  return { status: 'ready', extractedText, summaryText, errorMessage: null };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: any, res: any) {
  const isUpload = String(req.url || '').includes('/upload');
  const routeName = isUpload ? '/api/documents/upload' : '/api/documents';

  await withApiRoute(req, res, routeName, async (context) => {
    if (isUpload) {
      ensureMethod(req, ['POST']);
    } else {
      ensureMethod(req, ['GET']);
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) return;
    context.userId = auth.user.id;
    const userId = auth.user.id;
    const db = getDb();

    // -----------------------------------------------------------------------
    // GET /api/documents – list
    // -----------------------------------------------------------------------
    if (!isUpload) {
      const docs = await db
        .select({
          id: schema.userDocuments.id,
          filename: schema.userDocuments.filename,
          mimeType: schema.userDocuments.mimeType,
          sizeBytes: schema.userDocuments.sizeBytes,
          status: schema.userDocuments.status,
          summaryText: schema.userDocuments.summaryText,
          errorMessage: schema.userDocuments.errorMessage,
          createdAt: schema.userDocuments.createdAt,
          updatedAt: schema.userDocuments.updatedAt,
        })
        .from(schema.userDocuments)
        .where(eq(schema.userDocuments.userId, userId))
        .orderBy(asc(schema.userDocuments.createdAt));

      const { fileCount, totalBytes } = await getCurrentUsage(db, userId);

      ok(res, 200, {
        documents: docs.map(mapDocRow),
        usage: {
          file_count: fileCount,
          total_bytes: totalBytes,
          max_files: MAX_FILES,
          max_total_bytes: MAX_TOTAL_BYTES,
          max_file_bytes: MAX_FILE_BYTES,
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // POST /api/documents/upload
    // -----------------------------------------------------------------------

    // Rate limit check (before any expensive work)
    checkUploadRateLimit(userId);

    const body = await readJsonBody(req);

    const filename = asText(body.filename || body.file_name || body.name || 'document');
    const mimeType = asText(body.mimeType || body.mime_type || body.type || '');
    const fileBase64Raw = asText(body.fileBase64 || body.file_base64 || body.base64 || '');

    if (!filename) {
      throw new ApiError(400, 'invalid_input', 'filename is required');
    }

    // Strict type validation: BOTH extension AND mime type must be in their respective whitelists.
    const ext = getExtension(filename);
    const mimeNorm = mimeType.toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ApiError(
        400,
        'invalid_file_type',
        `Unsupported file type ".${ext || '?'}". Allowed extensions: PDF, DOCX, XLSX, PPTX, TXT, MD.`,
      );
    }

    // If a MIME type was provided (browsers always include it), it must also be allowed.
    if (mimeNorm && mimeNorm !== 'application/octet-stream' && !ALLOWED_MIME_TYPES.has(mimeNorm)) {
      throw new ApiError(
        400,
        'invalid_file_type',
        `Unsupported MIME type "${mimeType}". Allowed types: PDF, DOCX, XLSX, PPTX, TXT, MD.`,
      );
    }

    if (!fileBase64Raw) {
      throw new ApiError(400, 'invalid_input', 'fileBase64 is required');
    }

    // Strip data-URL prefix if present
    const commaIdx = fileBase64Raw.indexOf(',');
    const encoded = fileBase64Raw.startsWith('data:') && commaIdx >= 0
      ? fileBase64Raw.slice(commaIdx + 1)
      : fileBase64Raw;
    const normalized = encoded.replace(/\s+/g, '');

    if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
      throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(normalized, 'base64');
    } catch {
      throw new ApiError(400, 'invalid_input', 'fileBase64 must be valid base64');
    }

    if (!buffer.length) {
      throw new ApiError(400, 'invalid_input', 'Decoded file payload was empty');
    }

    // Per-file size check
    if (buffer.length > MAX_FILE_BYTES) {
      throw new ApiError(
        413,
        'file_too_large',
        `File exceeds the per-file limit of ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }

    // Quota check (before storing)
    const { fileCount, totalBytes } = await getCurrentUsage(db, userId);

    if (fileCount >= MAX_FILES) {
      throw new ApiError(
        422,
        'quota_exceeded',
        `You have reached the maximum of ${MAX_FILES} files. Delete a file before uploading another.`,
      );
    }

    if (totalBytes + buffer.length > MAX_TOTAL_BYTES) {
      const remainingMB = ((MAX_TOTAL_BYTES - totalBytes) / (1024 * 1024)).toFixed(1);
      throw new ApiError(
        422,
        'quota_exceeded',
        `Upload would exceed your 10 MB storage limit. You have ${remainingMB} MB remaining.`,
      );
    }

    const docId = newId('doc');
    const resolvedMime = mimeType || 'application/octet-stream';

    // Disk-provider: write to filesystem
    let storageKey: string | null = null;
    if (getStorageProvider() === 'disk') {
      storageKey = buildStorageKey(userId, docId, filename);
      await storeFileToDisk(storageKey, buffer);
    }
    // DB provider: bytes go in content_bytes column (inserted below)

    // Insert row immediately (processing happens synchronously below with a timeout)
    await db.insert(schema.userDocuments).values({
      id: docId,
      userId,
      uploaderUserId: userId,
      filename,
      mimeType: resolvedMime,
      sizeBytes: buffer.length,
      storageKey,
      contentBytes: getStorageProvider() === 'db' ? buffer : null,
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // ---------------------------------------------------------------------------
    // Best-effort synchronous processing within PROCESSING_TIMEOUT_MS
    // If extraction/summarization completes in time → status=ready
    // If it times out                               → status remains 'processing'
    // ---------------------------------------------------------------------------
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PROCESSING_TIMEOUT_MS),
    );

    const processResult = await Promise.race([
      processDocumentSync(buffer, filename, resolvedMime).catch((err: any) => ({
        status: 'failed' as const,
        extractedText: null,
        summaryText: null,
        errorMessage: String(err?.message || 'Processing failed').slice(0, 500),
      })),
      timeoutPromise,
    ]);

    let finalStatus = 'processing';
    let summaryText: string | null = null;

    if (processResult !== null) {
      // Processing finished within the time limit
      finalStatus = processResult.status;
      summaryText = processResult.summaryText;
      await db
        .update(schema.userDocuments)
        .set({
          status: processResult.status,
          extractedText: processResult.extractedText,
          summaryText: processResult.summaryText,
          summaryUpdatedAt: processResult.summaryText ? new Date() : null,
          errorMessage: processResult.errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(schema.userDocuments.id, docId));
    }
    // else: timed out — row stays as 'processing'; no further update needed

    ok(res, 201, {
      document: {
        id: docId,
        filename,
        mime_type: resolvedMime,
        size_bytes: buffer.length,
        status: finalStatus,
        summary_text: summaryText,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  });
}
