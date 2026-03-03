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

test('Organization page saves social links and shows preview when public directory is enabled', async ({ page, request }) => {
  const userId = uniqueId('org_ui_user');
  const email = `${userId}@example.com`;
  const sessionCookie = makeSessionCookie({
    sub: userId,
    email,
    name: 'Org UI User',
  });

  await applySessionCookie(page.context(), sessionCookie);

  const createSeedOrgRes = await request.post(`${BASE_URL}/api/account/organizations`, {
    headers: { cookie: sessionCookie },
    data: {
      organization: {
        name: 'Org UI Seed',
        type: 'startup',
        industry: 'Technology',
        location: 'Austin, USA',
        is_public_directory: false,
      },
    },
  });
  expect(createSeedOrgRes.status()).toBe(201);

  await page.goto(`${BASE_URL}/organization`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Display Name (Pseudonym)')).toHaveCount(0);

  const saveButton = page.getByTestId('organizationSaveButton');
  await expect(saveButton).toBeDisabled();
  await expect(page.getByText('No changes to save.')).toBeVisible();

  const socialLinkedInInput = page.locator('#organization-social-linkedin');
  await expect(socialLinkedInInput).toBeVisible();

  const linkedInValue = `linkedin.com/company/${uniqueId('orgprofile')}`;
  await socialLinkedInInput.fill(`  ${linkedInValue}  `);

  const publicDirectorySwitch = page.locator('#organization-public-directory');
  await publicDirectorySwitch.click();
  await expect(page.getByTestId('organizationDirectoryPreview')).toBeVisible();

  await expect(saveButton).toBeEnabled();

  const saveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/account/organizations/') && response.request().method() === 'PATCH';
  });
  await saveButton.click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);

  await expect(page.getByText('No changes to save.')).toBeVisible({ timeout: 30_000 });
  await expect(saveButton).toBeDisabled();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#organization-social-linkedin')).toHaveValue(`https://${linkedInValue}`, { timeout: 60_000 });
  await expect(page.getByTestId('organizationDirectoryPreview')).toBeVisible();
});
