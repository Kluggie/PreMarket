import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const STEP_LOAD_TIMEOUT_MS = 180_000;
const SAVE_RESPONSE_TIMEOUT_MS = 120_000;
const AUTOSAVE_WAIT_TIMEOUT_MS = 120_000;
const SAMPLE_PDF_PATH = resolve(process.cwd(), 'tests/fixtures/documents/sample.pdf');
const SAMPLE_DOCX_PATH = resolve(process.cwd(), 'tests/fixtures/documents/sample.docx');

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
  test.describe.configure({ timeout: 300_000 });

  test('Step 1 auto-imports selected files without requiring Import click', async ({ page }) => {
    await authenticate(page, uniqueId('auto_import'));
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
      timeout: STEP_LOAD_TIMEOUT_MS,
    });

    const extractRequests = [];
    await page.route('**/api/documents/extract', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      extractRequests.push(payload?.filename || 'unknown');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          text: `AUTO_IMPORT_${payload?.filename || 'unknown'}`,
          html: `<p>AUTO_IMPORT_${payload?.filename || 'unknown'}</p>`,
          filename: payload?.filename || 'unknown',
          mimeType: payload?.mimeType || 'application/pdf',
        }),
      });
    });

    const importButton = page.locator('[data-testid="import-button-a"]');
    const preview = page.locator('[data-testid="import-preview-a"]');

    await page.locator('[data-testid="import-file-input-a"]').setInputFiles(SAMPLE_PDF_PATH);
    await expect(importButton).toContainText('Importing...', { timeout: 20_000 });
    await expect(preview).toContainText('AUTO_IMPORT_sample.pdf', { timeout: STEP_LOAD_TIMEOUT_MS });
    await expect(page.getByText('Last imported: sample.pdf')).toBeVisible({ timeout: STEP_LOAD_TIMEOUT_MS });
    await expect(importButton).not.toContainText('Importing...', { timeout: STEP_LOAD_TIMEOUT_MS });
    expect(extractRequests).toHaveLength(1);
  });

  test('Step 1 keeps the latest selected file when selection changes mid-import', async ({ page }) => {
    await authenticate(page, uniqueId('auto_import_switch'));
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
      timeout: STEP_LOAD_TIMEOUT_MS,
    });

    const extractRequests = [];
    await page.route('**/api/documents/extract', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      const filename = payload?.filename || 'unknown';
      extractRequests.push(filename);
      const delayMs = filename.endsWith('.pdf') ? 1200 : 150;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          text: `AUTO_IMPORT_${filename}`,
          html: `<p>AUTO_IMPORT_${filename}</p>`,
          filename,
          mimeType: payload?.mimeType || 'application/pdf',
        }),
      });
    });

    const fileInput = page.locator('[data-testid="import-file-input-a"]');
    const preview = page.locator('[data-testid="import-preview-a"]');

    await fileInput.setInputFiles(SAMPLE_PDF_PATH);
    await expect(page.locator('[data-testid="import-button-a"]')).toContainText('Importing...', { timeout: 20_000 });
    await fileInput.setInputFiles(SAMPLE_DOCX_PATH);

    await expect(preview).toContainText('AUTO_IMPORT_sample.docx', { timeout: STEP_LOAD_TIMEOUT_MS });
    await page.waitForTimeout(1600);
    await expect(preview).toContainText('AUTO_IMPORT_sample.docx');
    await expect(preview).not.toContainText('AUTO_IMPORT_sample.pdf');
    await expect(page.getByText('Last imported: sample.docx')).toBeVisible({ timeout: STEP_LOAD_TIMEOUT_MS });
    expect(extractRequests).toEqual(['sample.pdf', 'sample.docx']);
  });

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
      { timeout: SAVE_RESPONSE_TIMEOUT_MS },
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
          timeout: AUTOSAVE_WAIT_TIMEOUT_MS,
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
      { timeout: SAVE_RESPONSE_TIMEOUT_MS },
    );
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await saveResponsePromise;

    const draftId = readDraftIdFromUrl(page.url());
    expect(draftId).toBeTruthy();

    await page.goto(`${BASE_URL}/Proposals`);
    await expect(page).toHaveURL(new RegExp(`${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/Proposals`), {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });

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

  test('custom prompt panel runs coach request with loading state and keyboard submit', async ({ page }) => {
    await authenticate(page, uniqueId('custom_prompt'));
    await openStep2FromStep1(page, `Custom Prompt ${uniqueId('title')}`);

    const coachRequests = [];
    await page.route('**/api/document-comparisons/**/coach', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      coachRequests.push(payload);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          comparison_id: payload.comparison_id || readDraftIdFromUrl(page.url()) || 'comparison_test',
          cache_hash: `coach_hash_${coachRequests.length}`,
          cached: false,
          provider: 'mock',
          model: 'custom-prompt-e2e-mock',
          prompt_version: 'coach-v1',
          coach: {
            version: 'coach-v1',
            summary: {
              overall: 'Custom feedback from test route.',
              top_priorities: [],
            },
            suggestions: [],
            concerns: [],
            questions: [],
            negotiation_moves: [],
            custom_feedback: 'Custom feedback from test route.',
          },
          created_at: new Date().toISOString(),
          withheld_count: 0,
        }),
      });
    });

    const panel = page.getByTestId('coach-custom-prompt-panel');
    const input = page.getByTestId('coach-custom-prompt-input');
    const runButton = page.getByTestId('coach-custom-prompt-run');

    await expect(panel).toBeVisible({ timeout: STEP_LOAD_TIMEOUT_MS });
    await expect(runButton).toBeDisabled();

    await input.fill('Highlight risks and negotiation gaps.');
    await expect(runButton).toBeEnabled();

    await runButton.click();
    await expect(runButton).toBeDisabled();
    await expect(runButton).toContainText('Running...');
    await expect
      .poll(() => coachRequests.length, { timeout: STEP_LOAD_TIMEOUT_MS })
      .toBe(1);
    expect(coachRequests[0]?.action).toBe('custom_prompt');
    expect(coachRequests[0]?.intent).toBe('custom_prompt');
    expect(coachRequests[0]?.promptText).toBe('Highlight risks and negotiation gaps.');
    expect(coachRequests[0]?.doc_a_text).toBeUndefined();
    expect(coachRequests[0]?.doc_b_text).toBeUndefined();
    await expect(page.getByTestId('coach-custom-prompt-feedback')).toContainText('Custom feedback from test route.', {
      timeout: STEP_LOAD_TIMEOUT_MS,
    });

    await input.fill('Run from keyboard');
    await input.press('Control+Enter');
    await expect
      .poll(() => coachRequests.length, { timeout: STEP_LOAD_TIMEOUT_MS })
      .toBe(2);
    expect(coachRequests[1]?.promptText).toBe('Run from keyboard');
  });

  test('company context saves once and negotiation action runs without reopening modal', async ({ page }) => {
    await authenticate(page, uniqueId('company_context'));
    await openStep2FromStep1(page, `Company Context ${uniqueId('title')}`);

    const companyContextRequests = [];
    await page.route('**/api/document-comparisons/**/company-context', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      companyContextRequests.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          comparison_id: readDraftIdFromUrl(page.url()) || 'comparison_test',
          company_context: {
            company_name: payload.companyName || 'Acme Industries',
            company_website: 'https://acme.test',
          },
          updated_at: new Date().toISOString(),
        }),
      });
    });

    const coachRequests = [];
    await page.route('**/api/document-comparisons/**/coach', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      coachRequests.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          comparison_id: readDraftIdFromUrl(page.url()) || 'comparison_test',
          cache_hash: `coach_hash_${coachRequests.length}`,
          cached: false,
          provider: 'mock',
          model: 'company-context-e2e-mock',
          prompt_version: 'coach-v1',
          coach: {
            version: 'coach-v1',
            summary: {
              overall: 'Negotiation output from test route.',
              top_priorities: [],
            },
            suggestions: [],
            concerns: [],
            questions: [],
            negotiation_moves: [],
          },
          created_at: new Date().toISOString(),
          withheld_count: 0,
        }),
      });
    });

    await page.getByTestId('company-context-edit-button').click();
    await expect(page.getByTestId('company-context-dialog')).toBeVisible({
      timeout: STEP_LOAD_TIMEOUT_MS,
    });
    await page.getByTestId('company-context-name-input').fill('Acme Industries');
    await page.getByTestId('company-context-website-input').fill('acme.test');
    await page.getByTestId('company-context-save-button').click();

    await expect
      .poll(() => companyContextRequests.length, { timeout: STEP_LOAD_TIMEOUT_MS })
      .toBe(1);
    expect(companyContextRequests[0]?.companyName).toBe('Acme Industries');
    await expect(page.getByTestId('company-context-dialog')).toHaveCount(0);
    await expect(page.getByTestId('company-context-name')).toContainText('Acme Industries');

    await page.getByRole('button', { name: 'Negotiation Strategy' }).click();
    await expect
      .poll(() => coachRequests.length, { timeout: STEP_LOAD_TIMEOUT_MS })
      .toBe(1);
    await expect(page.getByTestId('coach-response-feedback')).toContainText(
      'Negotiation output from test route.',
      {
        timeout: STEP_LOAD_TIMEOUT_MS,
      },
    );
    await expect(page.getByTestId('company-context-dialog')).toHaveCount(0);
  });
});
