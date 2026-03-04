import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT_MS = 20_000;

test('header updates immediately after Google sign-in without manual refresh', async ({ page }) => {
  const authenticatedUser = {
    id: 'auth_refresh_user',
    email: 'auth-refresh@example.com',
    name: 'Auth Refresh User',
  };

  let isAuthenticated = false;
  let meRequestCount = 0;

  await page.addInitScript(() => {
    let loginCallback = null;

    window.google = {
      accounts: {
        id: {
          initialize: (config) => {
            loginCallback = config?.callback || null;
          },
          renderButton: (container) => {
            if (!container) {
              return;
            }

            container.innerHTML = '';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Continue with Google';
            button.setAttribute('data-testid', 'mock-google-signin');
            button.addEventListener('click', () => {
              loginCallback?.({ credential: 'mock-google-id-token' });
            });
            container.appendChild(button);
          },
        },
      },
    };
  });

  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'csrf_test_token' }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    meRequestCount += 1;

    if (!isAuthenticated) {
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
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: authenticatedUser,
      }),
    });
  });

  await page.route('**/api/auth/google/verify', async (route) => {
    isAuthenticated = true;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: authenticatedUser,
        redirectTo: '/Dashboard',
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const googleButton = page.locator('[data-testid="mock-google-signin"]').first();
  await expect(googleButton).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByText(authenticatedUser.name)).toHaveCount(0);

  await googleButton.click();

  await expect(page.getByRole('button', { name: /auth refresh user/i })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect.poll(() => meRequestCount, { timeout: LOAD_TIMEOUT_MS }).toBeGreaterThanOrEqual(2);
});
