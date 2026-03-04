import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 30_000;

test('Products nav label is shown and templates render with skeleton first', async ({ page }) => {
  let templatesRequestCount = 0;

  await page.route(/\/api\/auth\/csrf(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'csrf_test_token' }),
    });
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'unauthorized',
          message: 'Not authenticated',
        },
      }),
    });
  });

  await page.route(/\/api\/templates(?:\?.*)?$/, async (route) => {
    templatesRequestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        templates: [
          {
            id: 'template_mock_1',
            name: 'Universal Product Template',
            description: 'Template used in UI loading test.',
            category: 'custom',
            status: 'active',
            party_a_label: 'Party A',
            party_b_label: 'Party B',
          },
        ],
      }),
    });
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  const productsNavLink = page.locator('header').getByRole('link', { name: 'Products' });
  await expect(productsNavLink).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

  await productsNavLink.click();
  await expect(page).toHaveURL(/\/templates$/i, { timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

  const skeletonCards = page.locator('[data-testid="products-templates-skeleton-card"]');
  await expect(skeletonCards.first()).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByText('Universal Product Template')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(skeletonCards).toHaveCount(0);
  await expect.poll(() => templatesRequestCount).toBeGreaterThan(0);

  await expect(page.getByText('Active', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Proposer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Recipient', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Party B (Recipient)', { exact: true })).toHaveCount(0);

  const gridHasMinHeightClass = await page
    .locator('[data-testid="products-templates-grid"]')
    .evaluate((el) => String(el.className || '').includes('min-h-[28rem]'));
  expect(gridHasMinHeightClass).toBe(false);
});
