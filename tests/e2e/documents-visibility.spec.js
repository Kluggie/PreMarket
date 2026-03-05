import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const SAMPLE_PDF_PATH = path.resolve(process.cwd(), 'tests/fixtures/documents/sample.pdf');
const RUN_DOCUMENTS_VISIBILITY_E2E =
  String(process.env.RUN_DOCUMENTS_VISIBILITY_E2E || '').trim() === '1';

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseCookie(rawCookie) {
  const separator = String(rawCookie || '').indexOf('=');
  if (separator <= 0) {
    throw new Error('Invalid auth cookie');
  }
  return {
    name: rawCookie.slice(0, separator),
    value: rawCookie.slice(separator + 1),
  };
}

async function authenticate(page, userId) {
  const cookie = parseCookie(
    makeSessionCookie({
      sub: userId,
      email: `${userId}@example.com`,
      name: 'Documents User',
    }),
  );

  await page.context().addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function mockAuthApi(page, userId) {
  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: userId,
          email: `${userId}@example.com`,
          full_name: 'Documents Test User',
        },
      }),
    });
  });
}

function buildUsage(documents) {
  const totalBytes = documents.reduce((sum, doc) => sum + Number(doc.size_bytes || 0), 0);
  return {
    file_count: documents.length,
    total_bytes: totalBytes,
    max_files: 5,
    max_total_bytes: 10 * 1024 * 1024,
    max_file_bytes: 5 * 1024 * 1024,
  };
}

async function mockDocumentsApi(page, state) {
  await page.route('**/api/documents**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const now = new Date().toISOString();

    if (url.pathname === '/api/documents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          documents: state.documents,
          usage: buildUsage(state.documents),
        }),
      });
      return;
    }

    if (url.pathname === '/api/documents/upload' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const filename = String(payload?.filename || 'uploaded.pdf');
      const mimeType = String(payload?.mimeType || 'application/pdf');
      const doc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filename,
        mime_type: mimeType,
        size_bytes: 1024,
        status: 'ready',
        visibility: 'confidential',
        status_reason: null,
        summary_text: '- mock summary',
        error_message: null,
        created_at: now,
        updated_at: now,
      };
      state.documents.push(doc);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, document: doc }),
      });
      return;
    }

    const patchMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (patchMatch && method === 'PATCH') {
      const id = decodeURIComponent(patchMatch[1]);
      const payload = JSON.parse(request.postData() || '{}');
      state.patchCalls.push({ id, visibility: payload?.visibility || null });
      const target = state.documents.find((doc) => doc.id === id);
      if (!target) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Document not found' } }),
        });
        return;
      }
      target.visibility = payload?.visibility === 'shared' ? 'shared' : 'confidential';
      target.updated_at = now;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, document: target }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Not found' } }),
    });
  });
}

const describeDocumentsVisibility = RUN_DOCUMENTS_VISIBILITY_E2E
  ? test.describe
  : test.describe.skip;

describeDocumentsVisibility('Documents visibility controls', () => {
  test('upload, mark shared, and refresh keeps shared visibility', async ({ page }) => {
    const userId = uniqueId('docs_visibility_shared');
    await authenticate(page, userId);
    await mockAuthApi(page, userId);
    const state = { documents: [], patchCalls: [] };
    await mockDocumentsApi(page, state);

    await page.goto(`${BASE_URL}/documents`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF_PATH);
    await expect(page.getByText('sample.pdf')).toBeVisible();

    const sharedButton = page.getByRole('button', { name: 'Shared' }).first();
    await sharedButton.click();

    await expect
      .poll(() => state.patchCalls.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(sharedButton).toHaveClass(/bg-blue-600/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('sample.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shared' }).first()).toHaveClass(/bg-blue-600/);
  });

  test('confidential visibility does not trigger any shared-report endpoint requests', async ({ page }) => {
    const userId = uniqueId('docs_visibility_conf');
    await authenticate(page, userId);
    await mockAuthApi(page, userId);
    const state = { documents: [], patchCalls: [] };
    await mockDocumentsApi(page, state);

    const sharedEndpointRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/shared-reports') || url.includes('/api/shared-links')) {
        sharedEndpointRequests.push({ url, method: request.method() });
      }
    });

    await page.goto(`${BASE_URL}/documents`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF_PATH);
    await expect(page.getByText('sample.pdf')).toBeVisible();

    const confidentialButton = page.getByRole('button', { name: 'Confidential' }).first();
    await confidentialButton.click();
    await expect(confidentialButton).toHaveClass(/bg-slate-800/);
    await expect
      .poll(() => sharedEndpointRequests.length, { timeout: 2_000 })
      .toBe(0);
  });
});
