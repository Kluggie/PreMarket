import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import documentsIndexHandler from '../../server/routes/documents/index.ts';
import documentsIdHandler from '../../server/routes/documents/[id].ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables, getDb } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

// Use db storage provider so no filesystem writes are needed in CI
process.env.DOCUMENTS_STORAGE_PROVIDER = 'db';

// Tiny valid files for testing
const TINY_TXT_B64 = Buffer.from('Hello, this is a test document.').toString('base64');
const TINY_PDF_B64 = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type /Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type /Pages/Kids [3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type /Page/MediaBox [0 0 3 3]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
  '0000000058 00000 n\n0000000115 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF',
).toString('base64');

function makeAuthCookie(sub, email) {
  return makeSessionCookie({ sub, email, name: 'Test User' });
}

async function seedUser(db, userId, email) {
  await db.execute(
    sql`INSERT INTO users (id, email, full_name, role, created_at, updated_at)
        VALUES (${userId}, ${email}, 'Test User', 'user', now(), now())
        ON CONFLICT (id) DO NOTHING`,
  );
}

/**
 * Seed documents WITHOUT file bytes (content_bytes = null, storage_key = null).
 * Suitable for quota/ownership tests that don't need to download file content.
 */
async function seedDocuments(db, userId, count, sizeBytes) {
  for (let i = 0; i < count; i++) {
    const docId = `test_doc_${userId}_${i}`;
    await db.execute(
      sql`INSERT INTO user_documents
          (id, user_id, uploader_user_id, filename, mime_type, size_bytes,
           storage_key, content_bytes, status, created_at, updated_at)
          VALUES
          (${docId}, ${userId}, ${userId},
           ${'test' + i + '.txt'}, ${'text/plain'}, ${sizeBytes},
           NULL, NULL, ${'ready'}, now(), now())
          ON CONFLICT (id) DO NOTHING`,
    );
  }
}

if (!hasDatabaseUrl()) {
  test('documents API (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  // -------------------------------------------------------------------------
  test('documents API: upload within limits succeeds', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_1';
    const email = 'doctest1@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: authCookie },
      body: {
        filename: 'test.txt',
        mimeType: 'text/plain',
        fileBase64: TINY_TXT_B64,
      },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 201, `Expected 201 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, true);
    assert.equal(typeof body.document, 'object');
    assert.equal(body.document.filename, 'test.txt');
    // Status is 'ready' or 'processing' depending on AI availability
    assert.ok(['ready', 'not_supported', 'processing'].includes(body.document.status));
  });

  // -------------------------------------------------------------------------
  test('documents API: list returns documents and usage', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_list';
    const email = 'doclist@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);
    await seedDocuments(db, userId, 2, 1024);

    const req = createMockReq({
      method: 'GET',
      url: '/api/documents',
      headers: { cookie: authCookie },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, true);
    assert.equal(Array.isArray(body.documents), true);
    assert.equal(body.documents.length, 2);
    assert.equal(body.usage.file_count, 2);
  });

  // -------------------------------------------------------------------------
  test('documents API: upload blocked when per-file size > 5 MB', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_perfile';
    const email = 'docperfile@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);

    // 5 MB + 1 byte — exceeds per-file limit
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString('base64');

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: authCookie },
      body: {
        filename: 'toobig.txt',
        mimeType: 'text/plain',
        fileBase64: oversized,
      },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 413, `Expected 413 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'file_too_large');
  });

  // -------------------------------------------------------------------------
  test('documents API: upload blocked when file count >= 5', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_quota_count';
    const email = 'docquotacount@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);
    await seedDocuments(db, userId, 5, 1024);

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: authCookie },
      body: {
        filename: 'sixth.txt',
        mimeType: 'text/plain',
        fileBase64: TINY_TXT_B64,
      },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 422, `Expected 422 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'quota_exceeded');
  });

  // -------------------------------------------------------------------------
  test('documents API: upload blocked when total bytes would exceed 10 MB', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_quota_size';
    const email = 'docquotasize@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);
    // Seed 2 files totalling 9.9 MB
    const nearlyFull = Math.floor(9.9 * 1024 * 1024);
    await seedDocuments(db, userId, 2, Math.floor(nearlyFull / 2));

    // 200 KB that would tip over 10 MB
    const largePayload = Buffer.alloc(200 * 1024, 65).toString('base64');

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: authCookie },
      body: {
        filename: 'toolarge.txt',
        mimeType: 'text/plain',
        fileBase64: largePayload,
      },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 422, `Expected 422 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'quota_exceeded');
  });

  // -------------------------------------------------------------------------
  test('documents API: unsupported file type is rejected', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'doc_test_user_type';
    const email = 'doctype@example.com';
    const authCookie = makeAuthCookie(userId, email);
    const db = getDb();
    await seedUser(db, userId, email);

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: authCookie },
      body: {
        filename: 'malware.exe',
        mimeType: 'application/octet-stream',
        fileBase64: TINY_TXT_B64,
      },
    });
    const res = createMockRes();
    await documentsIndexHandler(req, res);

    assert.equal(res.statusCode, 400, `Expected 400 but got ${res.statusCode}: ${res.body}`);
    const body = res.jsonBody();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid_file_type');
  });

  // -------------------------------------------------------------------------
  test('documents API: non-owner cannot download another user\'s document', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerUserId = 'doc_owner_user';
    const ownerEmail = 'docowner@example.com';
    const otherUserId = 'doc_other_user';
    const otherEmail = 'docother@example.com';
    const db = getDb();
    await seedUser(db, ownerUserId, ownerEmail);
    await seedUser(db, otherUserId, otherEmail);
    await seedDocuments(db, ownerUserId, 1, 1024);

    const rows = await db.execute(
      sql`SELECT id FROM user_documents WHERE user_id = ${ownerUserId} LIMIT 1`,
    );
    const docId = rows.rows?.[0]?.id || rows[0]?.id;
    assert.ok(docId, 'Expected a document to exist for the owner');

    const otherCookie = makeAuthCookie(otherUserId, otherEmail);
    const downloadReq = createMockReq({
      method: 'GET',
      url: `/api/documents/${docId}/download`,
      headers: { cookie: otherCookie },
    });
    const downloadRes = createMockRes();
    await documentsIdHandler(downloadReq, downloadRes, docId);

    assert.equal(downloadRes.statusCode, 404, `Expected 404 but got ${downloadRes.statusCode}`);
  });

  // -------------------------------------------------------------------------
  test('documents API: non-owner cannot delete another user\'s document', async () => {
    await ensureMigrated();
    await resetTables();

    const ownerUserId = 'doc_del_owner';
    const ownerEmail = 'deldocowner@example.com';
    const otherUserId = 'doc_del_other';
    const otherEmail = 'deldocother@example.com';
    const db = getDb();
    await seedUser(db, ownerUserId, ownerEmail);
    await seedUser(db, otherUserId, otherEmail);
    await seedDocuments(db, ownerUserId, 1, 512);

    const rows = await db.execute(
      sql`SELECT id FROM user_documents WHERE user_id = ${ownerUserId} LIMIT 1`,
    );
    const docId = rows.rows?.[0]?.id || rows[0]?.id;
    assert.ok(docId, 'Expected a document to exist for the owner');

    const otherCookie = makeAuthCookie(otherUserId, otherEmail);
    const deleteReq = createMockReq({
      method: 'DELETE',
      url: `/api/documents/${docId}`,
      headers: { cookie: otherCookie },
    });
    const deleteRes = createMockRes();
    await documentsIdHandler(deleteReq, deleteRes, docId);

    assert.equal(deleteRes.statusCode, 404, `Expected 404 but got ${deleteRes.statusCode}`);

    // Verify doc is still in DB
    const remaining = await db.execute(
      sql`SELECT id FROM user_documents WHERE id = ${docId}`,
    );
    const count = remaining.rows?.length ?? remaining.length ?? 0;
    assert.equal(count, 1, 'Document should still exist after failed delete by non-owner');
  });
}
