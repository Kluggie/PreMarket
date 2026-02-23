import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import documentExtractHandler from '../../server/routes/documents/extract.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

const DOCX_FIXTURE = resolve('tests/fixtures/documents/sample.docx');
const PDF_FIXTURE = resolve('tests/fixtures/documents/sample.pdf');
const TOO_LARGE_BASE64 = Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString('base64');

if (!hasDatabaseUrl()) {
  test('document extract API (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('document extract API handles DOCX and PDF base64 uploads', async () => {
    await ensureMigrated();
    await resetTables();

    const authCookie = makeSessionCookie({
      sub: 'doc_extract_user',
      email: 'extract@example.com',
    });

    const docxPayload = readFileSync(DOCX_FIXTURE).toString('base64');
    const docxReq = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie: authCookie },
      body: {
        filename: 'sample.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBase64: docxPayload,
      },
    });
    const docxRes = createMockRes();
    await documentExtractHandler(docxReq, docxRes);

    assert.equal(docxRes.statusCode, 200);
    const docxBody = docxRes.jsonBody();
    assert.equal(docxBody.ok, true);
    assert.equal(typeof docxBody.html, 'string');
    assert.equal(typeof docxBody.text, 'string');
    assert.equal(docxBody.text.includes('Confidential clause heading'), true);
    assert.equal(docxBody.text.includes('Shared payment terms paragraph'), true);

    const pdfPayload = readFileSync(PDF_FIXTURE).toString('base64');
    const pdfReq = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie: authCookie },
      body: {
        filename: 'sample.pdf',
        mimeType: 'application/pdf',
        fileBase64: pdfPayload,
      },
    });
    const pdfRes = createMockRes();
    await documentExtractHandler(pdfReq, pdfRes);

    assert.equal(pdfRes.statusCode, 200);
    const pdfBody = pdfRes.jsonBody();
    assert.equal(pdfBody.ok, true);
    assert.equal(typeof pdfBody.text, 'string');
    assert.equal(pdfBody.text.includes('Shared PDF import text line'), true);

    const invalidMimeReq = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie: authCookie },
      body: {
        filename: 'sample.docx',
        mimeType: 'text/plain',
        fileBase64: docxPayload,
      },
    });
    const invalidMimeRes = createMockRes();
    await documentExtractHandler(invalidMimeReq, invalidMimeRes);
    assert.equal(invalidMimeRes.statusCode, 400);
    assert.equal(invalidMimeRes.jsonBody().error.code, 'invalid_file_type');

    const invalidBase64Req = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie: authCookie },
      body: {
        filename: 'sample.pdf',
        mimeType: 'application/pdf',
        fileBase64: '*not-valid-base64*',
      },
    });
    const invalidBase64Res = createMockRes();
    await documentExtractHandler(invalidBase64Req, invalidBase64Res);
    assert.equal(invalidBase64Res.statusCode, 400);
    assert.equal(invalidBase64Res.jsonBody().error.code, 'invalid_input');

    const tooLargeReq = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie: authCookie },
      body: {
        filename: 'large.pdf',
        mimeType: 'application/pdf',
        fileBase64: TOO_LARGE_BASE64,
      },
    });
    const tooLargeRes = createMockRes();
    await documentExtractHandler(tooLargeReq, tooLargeRes);
    assert.equal(tooLargeRes.statusCode, 413);
    assert.equal(tooLargeRes.jsonBody().error.code, 'payload_too_large');
  });
}
