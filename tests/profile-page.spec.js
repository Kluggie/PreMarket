import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';
import { ensureMigrated } from './helpers/db.mjs';
import profileHandler from '../server/routes/account/profile.ts';
import directorySearchHandler from '../server/routes/directory/search.ts';
import { createMockReq, createMockRes } from './helpers/httpMock.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function callHandler(handler, reqOptions) {
  const req = createMockReq(reqOptions);
  const res = createMockRes();
  await handler(req, res);
  return res;
}

function buildAuthenticatedUser({ sub, email, name }) {
  return {
    id: sub,
    sub,
    email,
    name,
    full_name: name,
    role: 'user',
    plan_tier: 'starter',
    subscription_status: 'inactive',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancel_at_period_end: false,
    current_period_end: null,
    created_date: null,
  };
}

async function installStaticAssetMocks(page) {
  await page.route(
    (url) => {
      const pathname = new URL(url).pathname;
      return pathname === '/favicon.ico' || pathname === '/apple-touch-icon.png';
    },
    async (route) => {
      await route.fulfill({
        status: 204,
        body: '',
      });
    },
  );
}

async function installApiMocks(page, { sessionCookie, user }) {
  await page.route(
    (url) => {
      return new URL(url).pathname.startsWith('/api/');
    },
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      const method = request.method().toUpperCase();
      const headers = await request.allHeaders();

      if (sessionCookie && !headers.cookie) {
        headers.cookie = sessionCookie;
      }

      if (pathname === '/api/auth/csrf' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
        });
        return;
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        await route.fulfill({
          status: user ? 200 : 401,
          contentType: 'application/json',
          body: JSON.stringify(
            user
              ? { user: buildAuthenticatedUser(user) }
              : {
                  error: {
                    code: 'unauthorized',
                    message: 'Authentication required',
                  },
                },
          ),
        });
        return;
      }

      let handler = null;
      if (pathname === '/api/account/profile' && ['GET', 'PUT', 'PATCH'].includes(method)) {
        handler = profileHandler;
      } else if (pathname === '/api/directory/search' && method === 'GET') {
        handler = directorySearchHandler;
      }

      if (!handler) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'not_found',
              message: `No mocked handler for ${method} ${pathname}`,
            },
          }),
        });
        return;
      }

      const rawBody = request.postData();
      let body = undefined;

      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }

      const response = await callHandler(handler, {
        method,
        url: `${pathname}${url.search}`,
        query: Object.fromEntries(url.searchParams.entries()),
        headers,
        body,
      });

      await route.fulfill({
        status: response.statusCode,
        contentType: 'application/json',
        body: response.body || '{}',
      });
    },
  );
}

test.beforeAll(async () => {
  await ensureMigrated();
});

test('My Profile requires sign-in', async ({ page }) => {
  await installStaticAssetMocks(page);
  await installApiMocks(page, {
    sessionCookie: '',
    user: null,
  });

  await page.goto(`${BASE_URL}/profile`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'Sign in to PreMarket' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toHaveCount(0);
});

test('My Profile shows only Profile tab and social link edits save + persist', async ({ page }) => {
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
    if (
      message.type() === 'error' &&
      !message.text().includes('Failed to load resource: the server responded with a status of 404')
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error?.message || String(error));
  });

  await applySessionCookie(page.context(), sessionCookie);
  await installStaticAssetMocks(page);
  await installApiMocks(page, {
    sessionCookie,
    user: {
      sub: userId,
      email,
      name: 'Profile UI User',
    },
  });

  const seedProfileRes = await callHandler(profileHandler, {
    method: 'GET',
    url: '/api/account/profile',
    headers: { cookie: sessionCookie },
  });
  expect(seedProfileRes.statusCode).toBe(200);

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

test('My Profile explains incomplete public-directory opt-in and lists once display identity is configured', async ({ page }) => {
  const userId = uniqueId('profile_ui_directory_user');
  const email = `${userId}@example.com`;
  const publicName = `Directory ${uniqueId('Visible User')}`;
  const sessionCookie = makeSessionCookie({
    sub: userId,
    email,
    name: publicName,
  });

  await applySessionCookie(page.context(), sessionCookie);
  await installStaticAssetMocks(page);
  await installApiMocks(page, {
    sessionCookie,
    user: {
      sub: userId,
      email,
      name: publicName,
    },
  });

  const seedProfileRes = await callHandler(profileHandler, {
    method: 'GET',
    url: '/api/account/profile',
    headers: { cookie: sessionCookie },
  });
  expect(seedProfileRes.statusCode).toBe(200);

  await page.goto(`${BASE_URL}/profile`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 120_000 });

  const saveButton = page.getByTestId('saveButton');
  const publicDirectorySwitch = page.locator('#profile-public-directory');

  await publicDirectorySwitch.click();
  await expect(page.getByTestId('profilePublicDirectoryStatus')).toContainText('Not visible yet.');
  await expect(page.getByTestId('profilePublicDirectoryStatus')).toContainText(
    'Add a pseudonym or switch Privacy Mode to Public',
  );

  const firstSaveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/account/profile') && response.request().method() === 'PATCH';
  });
  await saveButton.click();
  const firstSaveResponse = await firstSaveResponsePromise;
  expect(firstSaveResponse.status()).toBe(200);

  await expect(page.getByText('No changes to save.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profilePublicDirectoryStatus')).toContainText('Not visible yet.');

  await page.goto(`${BASE_URL}/directory`, {
    waitUntil: 'domcontentloaded',
  });
  const searchInput = page.getByPlaceholder('Search by name or keywords...');
  await searchInput.fill(publicName);
  await expect(page.getByText('No public entries match these filters.')).toBeVisible({ timeout: 60_000 });

  await page.goto(`${BASE_URL}/profile`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 120_000 });

  await page.locator('#profile-privacy-mode').click();
  await page.getByRole('option', { name: 'Public' }).click();
  await expect(page.getByTestId('profilePublicDirectoryStatus')).toContainText(
    `Visible in the directory as ${publicName}.`,
  );

  const secondSaveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/account/profile') && response.request().method() === 'PATCH';
  });
  await saveButton.click();
  const secondSaveResponse = await secondSaveResponsePromise;
  expect(secondSaveResponse.status()).toBe(200);

  await expect(page.getByText('No changes to save.')).toBeVisible({ timeout: 30_000 });

  await page.goto(`${BASE_URL}/directory`, {
    waitUntil: 'domcontentloaded',
  });
  await searchInput.fill(publicName);
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(publicName)) })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(publicName)) })).toBeVisible({ timeout: 60_000 });

  await page.goto(`${BASE_URL}/profile`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 120_000 });

  await publicDirectorySwitch.click();
  const thirdSaveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/account/profile') && response.request().method() === 'PATCH';
  });
  await saveButton.click();
  const thirdSaveResponse = await thirdSaveResponsePromise;
  expect(thirdSaveResponse.status()).toBe(200);

  await page.goto(`${BASE_URL}/directory`, {
    waitUntil: 'domcontentloaded',
  });
  await searchInput.fill(publicName);
  await expect(page.getByText('No public entries match these filters.')).toBeVisible({ timeout: 60_000 });
});
