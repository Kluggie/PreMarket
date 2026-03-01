import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const STEP_LOAD_TIMEOUT_MS = 90_000;

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

function readDraftIdFromUrl(url) {
  const parsed = new URL(url);
  return parsed.searchParams.get('draft') || '';
}

async function authenticate(page, userId) {
  const cookie = parseCookie(
    makeSessionCookie({
      sub: userId,
      email: `${userId}@example.com`,
      name: 'Playwright User',
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

async function openStep2FromStep1(page, title) {
  await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
    timeout: STEP_LOAD_TIMEOUT_MS,
  });
  await page.getByPlaceholder('e.g., Mutual NDA comparison').fill(title);

  await page.getByRole('button', { name: 'Continue to Editor' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible({ timeout: STEP_LOAD_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-a-editor"]')).toBeVisible({
    timeout: STEP_LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="doc-b-editor"]')).toBeVisible({
    timeout: STEP_LOAD_TIMEOUT_MS,
  });
}

async function typeInEditor(page, selector, text) {
  const editor = page.locator(selector);
  await editor.click({ position: { x: 20, y: 20 } });
  await page.keyboard.type(text, { delay: 8 });
}

test.describe('Document Comparison Draft Persistence', () => {
  test('manual save persists Step 2 content across refresh', async ({ page }) => {
    await authenticate(page, uniqueId('manual'));
    const confidentialText = `CONF_${uniqueId('manual_conf')}`;
    const sharedText = `SHARED_${uniqueId('manual_shared')}`;

    await openStep2FromStep1(page, `Manual Save ${uniqueId('title')}`);
    await typeInEditor(page, '[data-testid="doc-a-editor"]', confidentialText);
    await typeInEditor(page, '[data-testid="doc-b-editor"]', sharedText);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'Save Draft' }).click();
    await saveResponsePromise;
    await expect(page.getByText(/Saved|All changes saved/i)).toBeVisible({ timeout: 20_000 });

    const draftId = readDraftIdFromUrl(page.url());
    expect(draftId).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(confidentialText, {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(sharedText, {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
  });

  test('autosave persists Step 2 content after debounce', async ({ page }) => {
    await authenticate(page, uniqueId('autosave'));
    const autosaveText = `AUTOSAVE_${uniqueId('docb')}`;
    const saveResponses = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/document-comparisons')) {
        saveResponses.push({
          method: response.request().method(),
          status: response.status(),
          url: response.url(),
        });
      }
    });

    await openStep2FromStep1(page, `Autosave ${uniqueId('title')}`);

    await typeInEditor(page, '[data-testid="doc-b-editor"]', autosaveText);
    await expect
      .poll(
        () =>
          saveResponses.some(
            (response) =>
              response.method === 'PATCH' &&
              response.status === 200 &&
              response.url.includes('/api/document-comparisons/'),
          ),
        {
          timeout: 35_000,
          message: `Expected autosave PATCH 200. Seen responses: ${JSON.stringify(saveResponses)}`,
        },
      )
      .toBe(true);
    await expect(page.getByText(/Saved|All changes saved/i)).toBeVisible({ timeout: STEP_LOAD_TIMEOUT_MS });

    const draftId = readDraftIdFromUrl(page.url());
    expect(draftId).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(autosaveText, {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
  });

  test('saved draft persists when navigating away and back', async ({ page }) => {
    await authenticate(page, uniqueId('navback'));
    const persistedText = `NAV_${uniqueId('persisted')}`;

    await openStep2FromStep1(page, `Navigation ${uniqueId('title')}`);
    await typeInEditor(page, '[data-testid="doc-a-editor"]', persistedText);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await saveResponsePromise;

    const draftId = readDraftIdFromUrl(page.url());
    expect(draftId).toBeTruthy();

    await page.goto(`${BASE_URL}/Proposals`);
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible({ timeout: 20_000 });

    await page.goto(`${BASE_URL}/DocumentComparisonCreate?draft=${encodeURIComponent(draftId)}&step=2`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(persistedText, {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
  });

  test('Step 1 blocks transition to Step 2 when draft create fails', async ({ page }) => {
    await authenticate(page, uniqueId('create_fail'));
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
      timeout: STEP_LOAD_TIMEOUT_MS,
    });

    await page.route('**/api/document-comparisons', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: {
              code: 'forced_create_failure',
              message: 'Simulated create failure for e2e',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByPlaceholder('e.g., Mutual NDA comparison').fill(`Failure guard ${uniqueId('title')}`);
    await page.getByRole('button', { name: 'Continue to Editor' }).click();

    await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toHaveCount(0);
    await expect(page.getByText(/couldn't open editor yet|simulated create failure/i)).toBeVisible({
      timeout: 20_000,
    });
    expect(readDraftIdFromUrl(page.url())).toBe('');
  });
});
