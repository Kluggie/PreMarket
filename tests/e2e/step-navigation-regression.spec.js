import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const STEP_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 120_000;
const IMPORT_TIMEOUT_MS = 60_000;
const SAMPLE_DOCX_PATH = path.resolve(process.cwd(), 'tests/fixtures/documents/sample.docx');
const SAMPLE_PDF_PATH = path.resolve(process.cwd(), 'tests/fixtures/documents/sample.pdf');

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

function isCoreApiUrl(url) {
  return (
    url.includes('/api/document-comparisons') ||
    url.includes('/api/documents/extract') ||
    url.includes('/api/proposals')
  );
}

function setupRuntimeGuards(page) {
  const issues = {
    consoleErrors: [],
    pageErrors: [],
    apiFailures: [],
    requestFailures: [],
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return;
    }
    const text = String(msg.text() || '');
    if (text.includes('favicon.ico')) {
      return;
    }
    issues.consoleErrors.push(text);
  });

  page.on('pageerror', (error) => {
    issues.pageErrors.push(String(error?.message || error));
  });

  page.on('response', (response) => {
    const url = response.url();
    if (!isCoreApiUrl(url)) {
      return;
    }
    const status = response.status();
    if (status >= 500 || status === 404) {
      issues.apiFailures.push({
        url,
        status,
        method: response.request().method(),
      });
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!isCoreApiUrl(url)) {
      return;
    }
    const errorText = String(request.failure()?.errorText || '');
    if (/ERR_ABORTED|AbortError/i.test(errorText)) {
      return;
    }
    issues.requestFailures.push({
      url,
      method: request.method(),
      error: errorText || 'unknown request failure',
    });
  });

  return issues;
}

function assertNoConsoleErrors(issues) {
  expect(
    [...issues.consoleErrors, ...issues.pageErrors],
    `Console/page runtime errors detected:\n${JSON.stringify(
      {
        consoleErrors: issues.consoleErrors,
        pageErrors: issues.pageErrors,
      },
      null,
      2,
    )}`,
  ).toEqual([]);
}

function assertNoNetwork500s(issues) {
  expect(
    [...issues.apiFailures, ...issues.requestFailures],
    `Network/API failures detected:\n${JSON.stringify(
      {
        apiFailures: issues.apiFailures,
        requestFailures: issues.requestFailures,
      },
      null,
      2,
    )}`,
  ).toEqual([]);
}

async function assertNoReactErrorOverlay(page) {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('#vite-error-overlay')).toHaveCount(0);
}

async function authenticate(page, userId) {
  const cookie = parseCookie(
    makeSessionCookie({
      sub: userId,
      email: `${userId}@example.com`,
      name: 'Step Nav User',
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

  return `${cookie.name}=${cookie.value}`;
}

async function createComparisonDraft(request, authCookie, overrides = {}) {
  const response = await request.post(`${BASE_URL}/api/document-comparisons`, {
    headers: {
      cookie: authCookie,
    },
    data: {
      title: overrides.title || `Step Nav Draft ${uniqueId('seed')}`,
      draft_step: overrides.draftStep || 2,
      createProposal: true,
      doc_a_text: overrides.docAText || `CONF_${uniqueId('seed_a')}`,
      doc_b_text: overrides.docBText || `SHARED_${uniqueId('seed_b')}`,
      ...overrides.extra,
    },
  });

  expect(response.status()).toBe(201);
  const payload = await response.json();
  return payload.comparison;
}

function createExtractPayload(filename, mimeType = 'application/pdf') {
  const text = `EXTRACTED_CONTENT_${filename}`;
  return {
    ok: true,
    text,
    html: `<p>${text}</p>`,
    filename,
    mimeType,
  };
}

async function stubExtractRoute(page, options = {}) {
  const requests = [];
  const delayByFilename = options.delayByFilename || {};
  const pendingByFilename = options.pendingByFilename || {};

  await page.route('**/api/documents/extract', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const filename = String(payload?.filename || 'unknown');
    const mimeType = String(payload?.mimeType || 'application/pdf');
    requests.push({
      filename,
      mimeType,
      method: route.request().method(),
    });

    const pending = pendingByFilename[filename];
    if (pending && typeof pending.then === 'function') {
      await pending;
    } else {
      const delayMs = Number(delayByFilename[filename] ?? options.defaultDelayMs ?? 250);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createExtractPayload(filename, mimeType)),
    });
  });

  return { requests };
}

async function stubEvaluateFailureRoute(page) {
  await page.route('**/api/document-comparisons/**/evaluate', async (route) => {
    const idMatch = route.request().url().match(/\/api\/document-comparisons\/([^/?]+)\/evaluate/i);
    const comparisonId = idMatch?.[1] ? decodeURIComponent(idMatch[1]) : null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        comparison: comparisonId ? { id: comparisonId, status: 'evaluated' } : null,
        proposal: null,
        evaluationInputTrace: null,
      }),
    });
  });
}

async function assertStep(page, expectedStep) {
  await expect(page.getByTestId('doc-comparison-step-indicator')).toContainText(
    `Step ${expectedStep} of 3`,
    { timeout: STEP_TIMEOUT_MS },
  );

  if (expectedStep === 1) {
    await expect(page.getByTestId('doc-comparison-step-1')).toHaveCount(1, {
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.getByTestId('doc-comparison-step-2')).toHaveCount(0, {
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.getByText('Step 1: Upload and Import')).toHaveCount(1, {
      timeout: STEP_TIMEOUT_MS,
    });
    return;
  }

  if (expectedStep === 2) {
    await expect(page.getByTestId('doc-comparison-step-2')).toHaveCount(1, {
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.getByTestId('doc-comparison-step-1')).toHaveCount(0, {
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.getByText('Step 1: Upload and Import')).toHaveCount(0, {
      timeout: STEP_TIMEOUT_MS,
    });
  }
}

async function getCurrentStep(page) {
  const text = await page.getByTestId('doc-comparison-step-indicator').textContent();
  const match = String(text || '').match(/Step\s+(\d+)\s+of\s+3/i);
  if (!match) {
    throw new Error(`Unable to determine current step from indicator: "${text || ''}"`);
  }
  return Number(match[1]);
}

async function waitForEditors(page) {
  await expect(page.locator('[data-testid="doc-a-editor"]')).toBeVisible({ timeout: STEP_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-b-editor"]')).toBeVisible({ timeout: STEP_TIMEOUT_MS });
}

async function next(page) {
  const current = await getCurrentStep(page);
  if (current === 1) {
    await page.getByTestId('step1-continue-button').click();
    await assertStep(page, 2);
    await waitForEditors(page);
    return;
  }

  if (current === 2) {
    await page.getByTestId('step2-run-evaluation-button').click();
    const confirmButton = page.getByRole('button', { name: 'Save and run evaluation' });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }
    await page.waitForURL(/\/DocumentComparisonDetail\?id=/, { timeout: STEP_TIMEOUT_MS });
    return;
  }

  throw new Error(`Unsupported next() transition from step ${current}`);
}

async function back(page) {
  const current = await getCurrentStep(page);
  if (current === 2) {
    await page.getByTestId('step2-back-button').click();
    await assertStep(page, 1);
    return;
  }
  if (current === 1) {
    return;
  }
  throw new Error(`Unsupported back() transition from step ${current}`);
}

async function gotoStep(page, targetStep) {
  const normalizedTarget = Number(targetStep);
  if (normalizedTarget !== 1 && normalizedTarget !== 2) {
    throw new Error(`gotoStep only supports 1 or 2, received ${targetStep}`);
  }

  let current = await getCurrentStep(page);
  while (current !== normalizedTarget) {
    if (current < normalizedTarget) {
      await next(page);
    } else {
      await back(page);
    }
    current = await getCurrentStep(page);
  }
}

async function refreshPage(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertNoReactErrorOverlay(page);
}

async function save(page) {
  const step = await getCurrentStep(page);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/document-comparisons') &&
      ['POST', 'PATCH'].includes(response.request().method()) &&
      response.status() >= 200 &&
      response.status() < 300,
    { timeout: SAVE_TIMEOUT_MS },
  );

  if (step === 1) {
    await page.getByTestId('step1-save-draft-button').click();
  } else if (step === 2) {
    await page.getByTestId('step2-save-draft-button').click();
  } else {
    throw new Error(`Unsupported save() on step ${step}`);
  }

  await responsePromise;
  await expect(page.getByTestId('doc-comparison-save-status')).toContainText('Saved', {
    timeout: STEP_TIMEOUT_MS,
  });
}

async function fillMinimalValidFieldsForStep(page, step, input = {}) {
  if (step === 1) {
    const title = input.title || `Step Nav ${uniqueId('title')}`;
    await page.getByTestId('comparison-title-input').fill(title);
    return { title };
  }

  if (step === 2) {
    const docAText = input.docAText || `CONF_EDIT_${uniqueId('doc_a')}`;
    const docBText = input.docBText || `SHARED_EDIT_${uniqueId('doc_b')}`;

    await page.locator('[data-testid="doc-a-editor"]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(` ${docAText}`, { delay: 6 });

    await page.locator('[data-testid="doc-b-editor"]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(` ${docBText}`, { delay: 6 });

    return { docAText, docBText };
  }

  throw new Error(`Unsupported fillMinimalValidFieldsForStep(${step})`);
}

async function uploadAndImport(page, filePath, side = 'a') {
  await page.getByTestId(`import-file-input-${side}`).setInputFiles(filePath);
  await expect(page.getByTestId(`import-button-${side}`)).toContainText('Importing...', {
    timeout: IMPORT_TIMEOUT_MS,
  });
}

async function assertPreviewContains(page, text, side = 'a') {
  await expect(page.getByTestId(`import-preview-${side}`)).toContainText(text, {
    timeout: IMPORT_TIMEOUT_MS,
  });
}

async function assertLastImported(page, filename, side = 'a') {
  await expect(page.getByTestId(`last-imported-${side}`)).toContainText(filename, {
    timeout: IMPORT_TIMEOUT_MS,
  });
}

test.describe('Step Navigation Torture Test - Document Comparison Wizard', () => {
  test.describe.configure({ timeout: 420_000 });

  test('A) forward-only navigation with refresh at each step', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('forward_refresh'));
    await stubEvaluateFailureRoute(page);

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertNoReactErrorOverlay(page);
    await assertStep(page, 1);

    const { title } = await fillMinimalValidFieldsForStep(page, 1);
    await save(page);
    await next(page);

    await refreshPage(page);
    await assertStep(page, 2);
    await waitForEditors(page);

    const step2Edits = await fillMinimalValidFieldsForStep(page, 2);
    await save(page);

    await next(page);
    await expect(page.getByRole('button', { name: 'Edit Proposal' })).toBeVisible({
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.locator('h1')).toContainText(title, { timeout: STEP_TIMEOUT_MS });

    await refreshPage(page);
    await expect(page.getByRole('button', { name: 'Edit Proposal' })).toBeVisible({
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.locator('h1')).toContainText(title, { timeout: STEP_TIMEOUT_MS });
    await expect(page.getByText(step2Edits.docAText)).toHaveCount(0);

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('B) back/forward loop with saved edits remains stable', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('back_forward_loop'));

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);
    await fillMinimalValidFieldsForStep(page, 1, {
      title: `Loop Stability ${uniqueId('title')}`,
    });
    await next(page);

    const marker = `LOOP_MARKER_${uniqueId('marker')}`;
    await page.locator('[data-testid="doc-b-editor"]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(` ${marker}`, { delay: 6 });
    await save(page);

    for (let i = 0; i < 3; i += 1) {
      await back(page);
      await assertStep(page, 1);
      await next(page);
      await assertStep(page, 2);
      await waitForEditors(page);
      await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(marker, {
        timeout: STEP_TIMEOUT_MS,
      });
      await expect(page.locator('[data-testid="doc-a-editor"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="doc-b-editor"]')).toHaveCount(1);
    }

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('C) upload/import survives navigation and refresh (DOCX then PDF)', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('upload_nav_refresh'));
    await stubExtractRoute(page, { defaultDelayMs: 300 });

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);

    await uploadAndImport(page, SAMPLE_DOCX_PATH, 'a');
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.docx', 'a');
    await assertLastImported(page, 'sample.docx', 'a');

    await next(page);
    await back(page);
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.docx', 'a');
    await assertLastImported(page, 'sample.docx', 'a');

    await refreshPage(page);
    await assertStep(page, 1);
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.docx', 'a');
    await assertLastImported(page, 'sample.docx', 'a');

    await uploadAndImport(page, SAMPLE_PDF_PATH, 'a');
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'a');
    await expect(page.getByTestId('import-preview-a')).not.toContainText('EXTRACTED_CONTENT_sample.docx');
    await assertLastImported(page, 'sample.pdf', 'a');

    await next(page);
    await back(page);
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'a');
    await assertLastImported(page, 'sample.pdf', 'a');

    await refreshPage(page);
    await assertStep(page, 1);
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'a');
    await assertLastImported(page, 'sample.pdf', 'a');

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('D) mid-import navigation does not crash and does not get stuck loading', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('mid_import_nav'));

    let releaseSlowImport;
    const slowImportGate = new Promise((resolve) => {
      releaseSlowImport = resolve;
    });
    await stubExtractRoute(page, {
      pendingByFilename: {
        'sample.pdf': slowImportGate,
      },
      defaultDelayMs: 200,
    });

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);

    await uploadAndImport(page, SAMPLE_PDF_PATH, 'a');
    await next(page);
    await assertStep(page, 2);
    await waitForEditors(page);

    releaseSlowImport();

    await back(page);
    await assertStep(page, 1);
    await expect(page.getByTestId('import-button-a')).not.toContainText('Importing...', {
      timeout: IMPORT_TIMEOUT_MS,
    });
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'a');
    await assertLastImported(page, 'sample.pdf', 'a');

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('E) multiple file selections keep only latest preview/import metadata', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('multi_file_select'));
    await stubExtractRoute(page, { defaultDelayMs: 250 });

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);

    await uploadAndImport(page, SAMPLE_DOCX_PATH, 'b');
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.docx', 'b');
    await assertLastImported(page, 'sample.docx', 'b');

    await uploadAndImport(page, SAMPLE_PDF_PATH, 'b');
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'b');
    await expect(page.getByTestId('import-preview-b')).not.toContainText('EXTRACTED_CONTENT_sample.docx');
    await assertLastImported(page, 'sample.pdf', 'b');

    await next(page);
    await back(page);
    await refreshPage(page);
    await assertStep(page, 1);
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.pdf', 'b');
    await assertLastImported(page, 'sample.pdf', 'b');

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('F) mixed editing + upload + back/forward keeps latest saved state', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('mixed_flow'));
    await stubExtractRoute(page, { defaultDelayMs: 250 });
    await stubEvaluateFailureRoute(page);

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);

    await fillMinimalValidFieldsForStep(page, 1, {
      title: `Mixed Flow ${uniqueId('title')}`,
    });
    await uploadAndImport(page, SAMPLE_DOCX_PATH, 'a');
    await assertPreviewContains(page, 'EXTRACTED_CONTENT_sample.docx', 'a');
    await next(page);

    const firstEdit = `FIRST_EDIT_${uniqueId('doc')}`;
    await page.locator('[data-testid="doc-a-editor"]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(` ${firstEdit}`, { delay: 6 });
    await save(page);

    await back(page);
    await next(page);
    await waitForEditors(page);

    const secondEdit = `SECOND_EDIT_${uniqueId('doc')}`;
    await page.locator('[data-testid="doc-a-editor"]').click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(` ${secondEdit}`, { delay: 6 });
    await save(page);

    await next(page);
    await expect(page.getByRole('button', { name: 'Edit Proposal' })).toBeVisible({
      timeout: STEP_TIMEOUT_MS,
    });

    await page.getByRole('button', { name: 'Edit Proposal' }).click();
    await assertStep(page, 2);
    await waitForEditors(page);
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(firstEdit, {
      timeout: STEP_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(secondEdit, {
      timeout: STEP_TIMEOUT_MS,
    });

    await refreshPage(page);
    await assertStep(page, 2);
    await waitForEditors(page);
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(secondEdit, {
      timeout: STEP_TIMEOUT_MS,
    });

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('G) deep link step query is stable across refresh (and clamps step=3 to step 2)', async ({ page, request }) => {
    const issues = setupRuntimeGuards(page);
    const authCookie = await authenticate(page, uniqueId('deep_link'));
    const comparison = await createComparisonDraft(request, authCookie, {
      title: `Deep Link Draft ${uniqueId('title')}`,
      draftStep: 2,
      docAText: `DEEPLINK_CONF_${uniqueId('a')}`,
      docBText: `DEEPLINK_SHARED_${uniqueId('b')}`,
    });

    const draftId = encodeURIComponent(String(comparison.id));
    await page.goto(`${BASE_URL}/DocumentComparisonCreate?draft=${draftId}&step=2`, {
      waitUntil: 'domcontentloaded',
    });
    await assertStep(page, 2);
    await waitForEditors(page);
    await refreshPage(page);
    await assertStep(page, 2);

    await page.goto(`${BASE_URL}/DocumentComparisonCreate?draft=${draftId}&step=3`, {
      waitUntil: 'domcontentloaded',
    });
    await assertStep(page, 2);
    await expect(page.getByTestId('doc-comparison-step-indicator')).toContainText('Step 2 of 3');
    await refreshPage(page);
    await assertStep(page, 2);

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });

  test('H) hard refresh during step transition lands in a valid state', async ({ page }) => {
    const issues = setupRuntimeGuards(page);
    await authenticate(page, uniqueId('hard_refresh_transition'));

    await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });
    await assertStep(page, 1);
    await fillMinimalValidFieldsForStep(page, 1, {
      title: `Hard Refresh ${uniqueId('title')}`,
    });

    await Promise.all([
      page.waitForURL(/\/DocumentComparisonCreate\?.*step=2/, { timeout: STEP_TIMEOUT_MS }),
      page.getByTestId('step1-continue-button').click(),
    ]);

    await refreshPage(page);
    await assertStep(page, 2);
    await waitForEditors(page);

    await gotoStep(page, 1);
    await assertStep(page, 1);
    await gotoStep(page, 2);
    await assertStep(page, 2);

    assertNoConsoleErrors(issues);
    assertNoNetwork500s(issues);
  });
});
