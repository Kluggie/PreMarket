import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';
import { ensureMigrated } from './helpers/db.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 120_000;

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createComparison(request, ownerCookie, input) {
  const response = await request.post(`${BASE_URL}/api/document-comparisons`, {
    headers: {
      cookie: ownerCookie,
    },
    data: {
      title: input.title,
      createProposal: true,
      docAText: input.docAText,
      docBText: input.docBText,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  return payload.comparison;
}

async function createSharedReportLink(request, ownerCookie, comparisonId, recipientEmail) {
  const response = await request.post(`${BASE_URL}/api/sharedReports`, {
    headers: {
      cookie: ownerCookie,
    },
    data: {
      comparisonId,
      recipientEmail,
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 25,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  return payload;
}

async function typeInEditor(page, selector, text) {
  const editor = page.locator(selector);
  await editor.click({ position: { x: 24, y: 24 } });
  await page.keyboard.type(text, { delay: 6 });
}

test.beforeAll(async () => {
  await ensureMigrated();
});

test.describe('Shared Report Recipient Draft', () => {
  test('Step 0 -> Step 1 -> Step 2 prefill + save draft + reload persistence', async ({ page, request }) => {
    const ownerId = uniqueId('recipient_owner');
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const proposerSharedMarker = `PROPOSER_SHARED_X_${uniqueId('baseline')}`;
    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Step Flow ${uniqueId('title')}`,
      docAText: 'Proposer confidential baseline text that must never be displayed to recipient.',
      docBText: `Shared baseline visible to recipient. ${proposerSharedMarker}. Additional text to ensure realistic baseline.`,
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const sharedMarker = uniqueId('shared_marker');
    const confidentialMarker = uniqueId('confidential_marker');
    const workspaceUrlFragment = `/api/shared-report/${encodeURIComponent(token)}/workspace`;

    await page.goto(`${BASE_URL}/shared-report/${encodeURIComponent(token)}`, {
      waitUntil: 'domcontentloaded',
    });

    const workspaceResponse = await page.waitForResponse(
      (response) =>
        response.url().includes(workspaceUrlFragment) &&
        response.request().method() === 'GET',
      { timeout: LOAD_TIMEOUT_MS },
    );
    expect(workspaceResponse.status()).toBe(200);

    await expect(page.getByText('Step 0: Overview')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.locator('pre')).toContainText(proposerSharedMarker, { timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Edit Proposal' }).click();
    await expect(page.getByText('Step 1: Upload and Import')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expect(page.getByText('Step 2: Editor')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.locator('[data-testid="doc-b-editor"]')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    // Prompt 2 prefill requirement: shared editor defaults to proposer baseline when no draft exists.
    await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(proposerSharedMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });

    await typeInEditor(page, '[data-testid="doc-b-editor"]', ` ${sharedMarker}`);
    await typeInEditor(page, '[data-testid="doc-a-editor"]', ` ${confidentialMarker}`);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/shared-report/${encodeURIComponent(token)}/draft`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      { timeout: LOAD_TIMEOUT_MS },
    );
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await saveResponsePromise;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForResponse(
      (response) =>
        response.url().includes(workspaceUrlFragment) &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: LOAD_TIMEOUT_MS },
    );

    await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(sharedMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(confidentialMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Run Evaluation transitions to Step 3 once and workspace refetch does not bounce back to Step 2', async ({
    page,
    request,
  }) => {
    const ownerId = uniqueId('recipient_eval_owner');
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Evaluate Flow ${uniqueId('title')}`,
      docAText: 'Proposer confidential baseline for evaluate-step transition checks.',
      docBText: `Shared baseline for evaluate transition checks ${uniqueId('shared')}.`,
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );
    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const encodedToken = encodeURIComponent(token);
    const workspaceUrlFragment = `/api/shared-report/${encodedToken}/workspace`;
    const evaluateUrlFragment = `/api/shared-report/${encodedToken}/evaluate`;

    await page.goto(`${BASE_URL}/shared-report/${encodedToken}`, { waitUntil: 'domcontentloaded' });
    await page.waitForResponse(
      (response) =>
        response.url().includes(workspaceUrlFragment) &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: LOAD_TIMEOUT_MS },
    );

    await page.getByRole('button', { name: 'Edit Proposal' }).click();
    await expect(page.getByText('Step 1: Upload and Import')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expect(page.getByText('Step 2: Editor')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    let evaluateCallCount = 0;
    let workspaceRefetchCountAfterEvaluate = 0;
    let evaluateStarted = false;

    page.on('response', (response) => {
      if (
        evaluateStarted &&
        response.url().includes(workspaceUrlFragment) &&
        response.request().method() === 'GET'
      ) {
        workspaceRefetchCountAfterEvaluate += 1;
      }
    });

    await page.route(`**${evaluateUrlFragment}`, async (route) => {
      evaluateCallCount += 1;
      evaluateStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          evaluation_id: `eval_${uniqueId('mock')}`,
          evaluation: {
            status: 'success',
            public_report: {
              recommendation: 'review',
              executive_summary: 'Mock recipient-safe evaluation result.',
              sections: [
                {
                  heading: 'Summary',
                  bullets: ['Mock evaluation completed for transition test.'],
                },
              ],
            },
            evaluation_result: {},
          },
        }),
      });
    });

    await page.getByRole('button', { name: 'Run Evaluation' }).click();

    await expect(page.getByText('Step 3: Evaluation')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: 'Evaluating...' })).toBeDisabled({
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(page.getByRole('button', { name: 'Re-run Evaluation' })).toBeEnabled({
      timeout: LOAD_TIMEOUT_MS,
    });

    await expect.poll(() => evaluateCallCount, { timeout: LOAD_TIMEOUT_MS }).toBe(1);
    await expect.poll(() => workspaceRefetchCountAfterEvaluate, { timeout: LOAD_TIMEOUT_MS }).toBeGreaterThan(0);

    await expect(page.getByText('Step 3: Evaluation')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText('Step 2: Editor')).toHaveCount(0);
    await expect(page.getByText('Mock recipient-safe evaluation result.')).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
  });
});
