import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';
import { ensureMigrated } from './helpers/db.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function applySessionCookie(context, rawCookie) {
  const separatorIndex = String(rawCookie || '').indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error('Invalid session cookie format');
  }

  await context.addCookies([
    {
      name: rawCookie.slice(0, separatorIndex),
      value: rawCookie.slice(separatorIndex + 1),
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

test.beforeAll(async () => {
  await ensureMigrated();
});

test('My Profile requires sign-in', async ({ page }) => {
  await page.goto(`${BASE_URL}/profile`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'Sign in to PreMarket' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toHaveCount(0);
});

test('My Profile shows only Profile tab and social link edits save + persist', async ({ page, request }) => {
  const userId = uniqueId('profile_ui_user');
  const email = `${userId}@example.com`;
  const consoleErrors = [];
  const pageErrors = [];
  const sessionCookie = makeSessionCookie({
    sub: userId,
    email,
    name: 'Profile UI User',
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error?.message || String(error));
  });

  await applySessionCookie(page.context(), sessionCookie);
  const seedProfileRes = await request.get(`${BASE_URL}/api/account/profile`, {
    headers: { cookie: sessionCookie },
  });
  expect(seedProfileRes.status()).toBe(200);

  await page.goto(`${BASE_URL}/profile?tab=privacy#social-links`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Privacy' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Social Links' })).toHaveCount(0);

  const saveButton = page.getByTestId('saveButton');
  await expect(saveButton).toBeDisabled();
  await expect(page.getByText('No changes to save.')).toBeVisible();

  await expect(page.locator('#profile-social-linkedin')).toBeVisible();
  await expect(page.locator('#profile-social-twitter')).toBeVisible();
  await expect(page.locator('#profile-social-github')).toBeVisible();
  await expect(page.locator('#profile-social-crunchbase')).toBeVisible();

  const linkedinUrl = `https://linkedin.com/in/${uniqueId('profile_linkedin')}`;
  const linkedinInput = page.locator('#profile-social-linkedin');
  await linkedinInput.fill(`  ${linkedinUrl}  `);

  await expect(saveButton).toBeEnabled();

  const saveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/account/profile') && response.request().method() === 'PATCH';
  });
  await saveButton.click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);

  await expect(page.getByText('No changes to save.')).toBeVisible({ timeout: 30_000 });
  await expect(saveButton).toBeDisabled({ timeout: 30_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#profile-social-linkedin')).toHaveValue(linkedinUrl, { timeout: 60_000 });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
