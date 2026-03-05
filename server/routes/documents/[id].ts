/**
 * GET    /api/documents/:id/download  – serve the file to the client
 * PATCH  /api/documents/:id           – update document metadata owned by the current user
 * DELETE /api/documents/:id           – delete a document owned by the current user
 *
 * Download priority:
 *   1. content_bytes column (Postgres bytea – all new uploads)
 *   2. Disk fallback for legacy rows uploaded with DOCUMENTS_STORAGE_PROVIDER=disk
 *   3. Legacy 'db:...' storage_key prefix (base64-in-key from old implementation)
 */

import { and, eq } from 'drizzle-orm';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { getDb, schema } from '../../_lib/db/client.js';
import { ApiError } from '../../_lib/errors.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';
import { deleteFileFromDisk, readFileFromDisk } from './storage.js';

async function resolveFileBytes(doc: any): Promise<Buffer> {
  // Primary: content_bytes column (all new uploads)
  if (doc.contentBytes) {
    return Buffer.from(doc.contentBytes);
  }

  const key: string = String(doc.storageKey || '');

  // Legacy: base64-in-key hack (old 'db:...' format)
  if (key.startsWith('db:')) {
    const parts = key.split(':');
    const b64 = parts.slice(2).join(':');
    return Buffer.from(b64, 'base64');
  }

  // Legacy: disk storage
  if (key) {
    return readFileFromDisk(key);
  }

  throw new Error('No file content available');
}

function normalizeVisibility(value: unknown): 'confidential' | 'shared' | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'confidential' || normalized === 'shared') {
    return normalized;
  }
  return null;
}

export default async function handler(req: any, res: any, docId?: string) {
  const rawId = docId || String(req.query?.id || '').trim();

  const isDownload = String(req.url || '').includes('/download');
  const routeName = isDownload ? `/api/documents/${rawId}/download` : `/api/documents/${rawId}`;

  await withApiRoute(req, res, routeName, async (context) => {
    if (isDownload) {
      ensureMethod(req, ['GET']);
    } else {
      ensureMethod(req, ['DELETE', 'PATCH']);
    }

    const auth = await requireUser(req, res);
    if (!auth.ok) return;
    context.userId = auth.user.id;
    const userId = auth.user.id;
    const db = getDb();

    if (!rawId) {
      throw new ApiError(400, 'invalid_input', 'Document ID is required');
    }

    // Fetch and enforce ownership (exclude content_bytes from list queries – include it only for download)
    const baseSelect = {
      id: schema.userDocuments.id,
      filename: schema.userDocuments.filename,
      mimeType: schema.userDocuments.mimeType,
      sizeBytes: schema.userDocuments.sizeBytes,
      storageKey: schema.userDocuments.storageKey,
      visibility: schema.userDocuments.visibility,
      status: schema.userDocuments.status,
      statusReason: schema.userDocuments.statusReason,
      summaryText: schema.userDocuments.summaryText,
      errorMessage: schema.userDocuments.errorMessage,
      createdAt: schema.userDocuments.createdAt,
      updatedAt: schema.userDocuments.updatedAt,
    };
    const selectFields = isDownload
      ? { ...baseSelect, contentBytes: schema.userDocuments.contentBytes }
      : baseSelect;
    const rows = await db
      .select(selectFields)
      .from(schema.userDocuments)
      .where(
        and(
          eq(schema.userDocuments.id, rawId),
          eq(schema.userDocuments.userId, userId),
        ),
      )
      .limit(1);

    const doc = rows[0];
    if (!doc) {
      throw new ApiError(404, 'not_found', 'Document not found');
    }

    // -----------------------------------------------------------------------
    // GET .../download
    // -----------------------------------------------------------------------
    if (isDownload) {
      let fileBuffer: Buffer;
      try {
        fileBuffer = await resolveFileBytes(doc);
      } catch {
        throw new ApiError(500, 'storage_error', 'File could not be retrieved from storage');
      }

      const safeFilename = String(doc.filename || 'document').replace(/[^\w.\-]/g, '_');
      res.statusCode = 200;
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Length', String(fileBuffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.end(fileBuffer);
      return;
    }

    // -----------------------------------------------------------------------
    // PATCH /api/documents/:id
    // -----------------------------------------------------------------------
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const visibility = normalizeVisibility(body.visibility);
      if (!visibility) {
        throw new ApiError(400, 'invalid_input', 'visibility must be "shared" or "confidential"');
      }

      const updatedRows = await db
        .update(schema.userDocuments)
        .set({
          visibility,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.userDocuments.id, rawId),
            eq(schema.userDocuments.userId, userId),
          ),
        )
        .returning({
          id: schema.userDocuments.id,
          filename: schema.userDocuments.filename,
          mimeType: schema.userDocuments.mimeType,
          sizeBytes: schema.userDocuments.sizeBytes,
          status: schema.userDocuments.status,
          visibility: schema.userDocuments.visibility,
          statusReason: schema.userDocuments.statusReason,
          summaryText: schema.userDocuments.summaryText,
          errorMessage: schema.userDocuments.errorMessage,
          createdAt: schema.userDocuments.createdAt,
          updatedAt: schema.userDocuments.updatedAt,
        });
      const updated = updatedRows[0];
      if (!updated) {
        throw new ApiError(404, 'not_found', 'Document not found');
      }

      ok(res, 200, {
        document: {
          id: updated.id,
          filename: updated.filename,
          mime_type: updated.mimeType,
          size_bytes: updated.sizeBytes,
          status: updated.status,
          visibility: updated.visibility || 'confidential',
          status_reason: updated.statusReason || null,
          summary_text: updated.summaryText || null,
          error_message: updated.errorMessage || null,
          created_at: updated.createdAt,
          updated_at: updated.updatedAt,
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // DELETE /api/documents/:id
    // -----------------------------------------------------------------------

    // Best-effort disk cleanup for legacy rows
    if (doc.storageKey && !String(doc.storageKey).startsWith('db:')) {
      await deleteFileFromDisk(doc.storageKey).catch(() => null);
    }

    await db
      .delete(schema.userDocuments)
      .where(
        and(
          eq(schema.userDocuments.id, rawId),
          eq(schema.userDocuments.userId, userId),
        ),
      );

    ok(res, 200, { deleted: true });
  });
}
