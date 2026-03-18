import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 20_000;

async function setupUnauthenticatedMocks(page) {
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf' }),
    }),
  );

  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unauthorized', message: 'Not authenticated' } }),
    }),
  );
}

test('Clicking signed-out Opportunities nav opens /opportunities/new DocumentComparison workflow', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  const navLink = page.locator('nav a', { hasText: 'Opportunities' }).first();
  await expect(navLink).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await navLink.click();

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('h1', { hasText: 'AI Negotiator' })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

test('/opportunities/new no longer shows Select Template or old template cards', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('text=Select Template')).toHaveCount(0);
  await expect(page.locator('text=Universal Enterprise Onboarding')).toHaveCount(0);
  await expect(page.locator('text=Universal Finance Deal Pre-Qual')).toHaveCount(0);
  await expect(page.locator('text=Universal Profile Matching')).toHaveCount(0);
});

test('/opportunities/new guest mode shows local banner and sign-in gate action', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="doc-comparison-guest-banner"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="doc-comparison-guest-signin"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

test('Old /GuestOpportunity redirects to /opportunities/new DocumentComparison workflow', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/GuestOpportunity`, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

test('/DocumentComparisonCreate still shows sign-in gate for signed-out users', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="doc-comparison-signin-btn"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toHaveCount(0);
});

test('/DocumentComparisonCreate sign-in gate keeps "Try as guest" link to /opportunities/new', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });

  const guestLink = page.locator('a', { hasText: /try as guest/i });
  await expect(guestLink).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(guestLink).toHaveAttribute('href', /\/opportunities\/new/);
});

test('Landing "Start Free" routes signed-out users to /opportunities/new DocumentComparison workflow', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  const startBtn = page.locator('button', { hasText: /start free/i }).first();
  await expect(startBtn).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await startBtn.click();

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

test('Landing "Try AI Deal Mediator" routes signed-out users to /opportunities/new DocumentComparison workflow', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  const mediatorLink = page.locator('a', { hasText: /try ai deal mediator/i }).first();
  await expect(mediatorLink).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await mediatorLink.click();

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});
