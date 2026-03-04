import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 30_000;

async function getRootFontSize(page) {
  return page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '0'));
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

function heroHeading(page) {
  return page.locator('section').first().locator('h1');
}

test('desktop landing uses 90% root scale and remains overflow-safe', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await expect(heroHeading(page)).toContainText('AI Negotiation', {
    timeout: LOAD_TIMEOUT_MS,
  });

  const rootFontSize = await getRootFontSize(page);
  expect(rootFontSize).toBeGreaterThan(14.2);
  expect(rootFontSize).toBeLessThan(14.6);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  await context.close();
});

test('mobile landing keeps default root scale for readability', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await expect(heroHeading(page)).toContainText('AI Negotiation', {
    timeout: LOAD_TIMEOUT_MS,
  });

  const rootFontSize = await getRootFontSize(page);
  expect(rootFontSize).toBeGreaterThan(15.8);
  expect(rootFontSize).toBeLessThan(16.2);
  expect(await hasHorizontalOverflow(page)).toBe(false);

  await context.close();
});
