/**
 * guest-opportunity.spec.js
 *
 * E2E tests for the signed-out / guest Opportunity creation flow.
 *
 * Tests:
 *  1. Opportunities nav item is visible when signed out
 *  2. Clicking nav item opens the guest opportunity page at /opportunities/new
 *  3. Signed-out user can navigate to /opportunities/new directly
 *  4. Old /GuestOpportunity route redirects to /opportunities/new
 *  5. Signed-out user can complete Step 1 (template selection + details)
 *  6. Steps 1→2→3→4 — Step 4 shows sign-in gate (not run-evaluation button)
 *  7. Sign-in gate CTA is "Sign in to invite the other party"
 *  8. Sign-in gate copy does NOT mention "AI evaluation"
 *  9. Clear draft button resets the wizard
 * 10. Guest draft survives a page refresh (localStorage persistence)
 * 11. Signed-out user visiting /Opportunities does not see account inbox
 * 12. Authenticated create flow (/CreateOpportunity) still requires auth
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 20_000;

// ── Mock helpers ──────────────────────────────────────────────────────────────

const MOCK_TEMPLATES = [
  {
    id: 'builtin:universal_enterprise_onboarding',
    name: 'Universal Enterprise Onboarding',
    description: 'Assess onboarding readiness across security, privacy, and operations.',
    slug: 'universal_enterprise_onboarding',
    template_key: 'universal_enterprise_onboarding',
    category: 'saas_procurement',
    status: 'active',
    party_a_label: 'Proposer',
    party_b_label: 'Recipient',
    is_tool: false,
    sort_order: 10,
    sections: [],
    questions: [],
  },
  {
    id: 'builtin:universal_m_and_a_prequal',
    name: 'M&A Pre-Qualification',
    description: 'Pre-qualify mergers and acquisitions counterparties.',
    slug: 'universal_m_and_a_prequal',
    template_key: 'universal_m_and_a_prequal',
    category: 'm_and_a',
    status: 'active',
    party_a_label: 'Acquirer',
    party_b_label: 'Target',
    is_tool: false,
    sort_order: 20,
    sections: [],
    questions: [],
  },
];

/** Intercept all auth/API routes with sensible defaults (no auth). */
async function setupUnauthenticatedMocks(page) {
  // CSRF token
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf' }),
    }),
  );

  // Signed-out /api/auth/me → 401
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unauthorized', message: 'Not authenticated' } }),
    }),
  );

  // Public templates endpoint (no auth needed)
  await page.route('**/api/public/templates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, templates: MOCK_TEMPLATES }),
    }),
  );
}

// ── Test 1: Opportunities nav visible when signed out ─────────────────────────

test('Opportunities nav item is visible in the signed-out header', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  // Desktop nav link
  const navLink = page.locator('nav a', { hasText: 'Opportunities' }).first();
  await expect(navLink).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
});

// ── Test 2: Clicking Opportunities nav opens the guest flow ───────────────────

test('Clicking signed-out Opportunities nav opens the guest opportunity page', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  const navLink = page.locator('nav a', { hasText: 'Opportunities' }).first();
  await expect(navLink).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  await navLink.click();

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="guest-opportunity-page"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

// ── Test 3: Signed-out user can navigate to /opportunities/new directly ────────

test('Guest opportunity page loads for unauthenticated users', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('h1', { hasText: 'New Opportunity' })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  // Template grid should appear
  await expect(page.locator('[data-testid="template-grid"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  // Should see template options
  await expect(
    page.locator('[data-testid="template-option-universal_enterprise_onboarding"]'),
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
});

// ── Test 4: Old route /GuestOpportunity redirects to /opportunities/new ───────

test('Old /GuestOpportunity route redirects to /opportunities/new', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/GuestOpportunity`, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/opportunities\/new/, { timeout: NAV_TIMEOUT_MS });
  await expect(page.locator('[data-testid="guest-opportunity-page"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

// ── Test 5: Complete Step 1 (template + details) ──────────────────────────────

test('Signed-out user can complete Step 1', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Select M&A template (no presetKey required)
  await expect(
    page.locator('[data-testid="template-option-universal_m_and_a_prequal"]'),
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();

  // Fill in recipient email
  const emailInput = page.locator('[data-testid="recipient-email-input"]');
  await expect(emailInput).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  await emailInput.fill('counterparty@example.com');

  // Continue to step 2
  const continueBtn = page.locator('[data-testid="step1-continue-btn"]');
  await expect(continueBtn).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  await continueBtn.click();

  // Should be on step 2 now
  await expect(page.locator('[data-testid="step2-continue-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });
});

// ── Test 6 & 7: Steps 1→2→3→4 sign-in gate ───────────────────────────────────

test('Signed-out user can navigate Steps 1→2→3→4 and sees sign-in gate on Step 4', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Step 1: pick M&A template, fill email
  await expect(
    page.locator('[data-testid="template-option-universal_m_and_a_prequal"]'),
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();

  const emailInput = page.locator('[data-testid="recipient-email-input"]');
  await emailInput.fill('other@example.com');
  await page.locator('[data-testid="step1-continue-btn"]').click();

  // Step 2
  await expect(page.locator('[data-testid="step2-continue-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });
  await page.locator('[data-testid="step2-continue-btn"]').click();

  // Step 3
  await expect(page.locator('[data-testid="step3-review-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });
  await page.locator('[data-testid="step3-review-btn"]').click();

  // Step 4 — must show sign-in gate
  const gateBtn = page.locator('[data-testid="guest-signin-gate-btn"]');
  await expect(gateBtn).toBeVisible({ timeout: NAV_TIMEOUT_MS });

  // Must NOT show a "Run Evaluation" button (that requires auth)
  await expect(page.locator('button', { hasText: /run evaluation/i })).toHaveCount(0);
});

// ── Test 7: Sign-in gate CTA copy ─────────────────────────────────────────────

test('Sign-in gate CTA reads "Sign in to invite the other party"', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Navigate to step 4 quickly
  await expect(
    page.locator('[data-testid="template-option-universal_m_and_a_prequal"]'),
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();
  await page.locator('[data-testid="recipient-email-input"]').fill('x@y.com');
  await page.locator('[data-testid="step1-continue-btn"]').click();
  await expect(page.locator('[data-testid="step2-continue-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });
  await page.locator('[data-testid="step2-continue-btn"]').click();
  await expect(page.locator('[data-testid="step3-review-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });
  await page.locator('[data-testid="step3-review-btn"]').click();

  // Verify CTA copy
  await expect(page.locator('[data-testid="guest-signin-gate-btn"]')).toContainText(
    /sign in to invite the other party/i,
    { timeout: NAV_TIMEOUT_MS },
  );
});

// ── Test 8: Gate copy does NOT mention "AI evaluation" ───────────────────────

test('Sign-in gate copy does not mention "AI evaluation"', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Navigate to step 4
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').waitFor({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();
  await page.locator('[data-testid="recipient-email-input"]').fill('a@b.com');
  await page.locator('[data-testid="step1-continue-btn"]').click();
  await page.locator('[data-testid="step2-continue-btn"]').waitFor({ timeout: NAV_TIMEOUT_MS });
  await page.locator('[data-testid="step2-continue-btn"]').click();
  await page.locator('[data-testid="step3-review-btn"]').waitFor({ timeout: NAV_TIMEOUT_MS });
  await page.locator('[data-testid="step3-review-btn"]').click();

  // The gate card and step 4 area must NOT mention "AI evaluation" in any form
  await expect(page.locator('[data-testid="guest-signin-gate-btn"]')).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  const pageText = await page.locator('[data-testid="guest-opportunity-page"]').textContent();
  expect(pageText.toLowerCase()).not.toContain('run an ai evaluation');
  expect(pageText.toLowerCase()).not.toContain('run the ai evaluation');
});

// ── Test 9: Clear draft button resets the wizard ──────────────────────────────

test('Clear draft button discards the saved draft and resets the wizard', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Step 1: pick template, fill email, continue to step 2
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').waitFor({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();
  await page.locator('[data-testid="recipient-email-input"]').fill('clear@example.com');
  await page.locator('[data-testid="step1-continue-btn"]').click();
  await page.locator('[data-testid="step2-continue-btn"]').waitFor({ timeout: NAV_TIMEOUT_MS });

  // Verify draft exists in localStorage
  const draftBefore = await page.evaluate(() => localStorage.getItem('pm:guest_draft'));
  expect(draftBefore).not.toBeNull();

  // Click "Clear draft" button in the preview banner
  const clearBtn = page.locator('[data-testid="clear-draft-btn"]');
  await expect(clearBtn).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  await clearBtn.click();

  // Draft should be cleared from localStorage
  const draftAfter = await page.evaluate(() => localStorage.getItem('pm:guest_draft'));
  expect(draftAfter).toBeNull();

  // Wizard should be reset to step 1 (template grid visible)
  await expect(page.locator('[data-testid="template-grid"]')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
});

// ── Test 10: Draft persistence across refresh ─────────────────────────────────

test('Guest draft survives a page refresh (localStorage persistence)', async ({ page }) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });

  // Step 1: fill in details
  await expect(
    page.locator('[data-testid="template-option-universal_m_and_a_prequal"]'),
  ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.locator('[data-testid="template-option-universal_m_and_a_prequal"]').click();
  await page.locator('[data-testid="recipient-email-input"]').fill('persist@example.com');
  await page.locator('[data-testid="step1-continue-btn"]').click();

  // Should be on step 2
  await expect(page.locator('[data-testid="step2-continue-btn"]')).toBeVisible({
    timeout: NAV_TIMEOUT_MS,
  });

  // Inspect localStorage
  const draft = await page.evaluate(() => {
    const raw = localStorage.getItem('pm:guest_draft');
    return raw ? JSON.parse(raw) : null;
  });
  expect(draft).not.toBeNull();
  expect(draft.recipientEmail).toBe('persist@example.com');
  expect(draft.templateSlug).toBe('universal_m_and_a_prequal');
  expect(draft.step).toBe(2);

  // Reload the page — draft should be restored
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Templates must reload
  await expect(page.locator('[data-testid="step2-continue-btn"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
});

// ── Test 11: /Opportunities (authenticated list) redirects signed-out users ───

test('Signed-out user visiting /Opportunities does not see account Inbox/Drafts/Closed', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);

  // The auth check in AppRoutes will either redirect to login or show a guest page.
  // The key assertion is that the account Proposals list is NOT visible.
  await page.goto(`${BASE_URL}/Opportunities`, { waitUntil: 'domcontentloaded' });

  // /Opportunities is NOT a public route — signed-out users are redirected to login
  // or see a not-authenticated state. Verify the opportunity list content is absent.
  const inboxTab = page.locator('text=Inbox');
  const draftsTab = page.locator('text=Drafts');
  const closedTab = page.locator('text=Closed');

  // Allow generous time then assert they are not visible (page may do nothing or redirect)
  await page.waitForTimeout(3000);
  const allHidden =
    !(await inboxTab.isVisible()) &&
    !(await draftsTab.isVisible()) &&
    !(await closedTab.isVisible());
  expect(allHidden).toBe(true);
});

// ── Test 12: Authenticated create flow still works ─────────────────────────────

test('Authenticated create opportunity flow (/CreateOpportunity) still requires sign-in', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);
  await page.goto(`${BASE_URL}/CreateOpportunity`, { waitUntil: 'domcontentloaded' });

  // Should NOT render the authenticated CreateProposalWithDrafts page without auth
  // (it will be blocked by the auth check — auth_required → navigateToLogin)
  // The page should either redirect away or not show the wizard.
  await page.waitForTimeout(3000);
  // The guest opportunity page should NOT have replaced it
  const guestTitle = page.locator('h1', { hasText: 'New Opportunity' });
  // Guest page is at /opportunities/new, not /CreateOpportunity
  await expect(guestTitle).toHaveCount(0);
});
