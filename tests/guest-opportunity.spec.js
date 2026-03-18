import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 20_000;

function buildAuthenticatedUser(overrides = {}) {
  return {
    id: 'guest-opportunity-auth-user',
    sub: 'guest-opportunity-auth-user',
    email: 'guest-opportunity-auth@example.com',
    name: 'Guest Opportunity Auth User',
    full_name: 'Guest Opportunity Auth User',
    role: 'user',
    plan_tier: 'starter',
    subscription_status: 'inactive',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancel_at_period_end: false,
    current_period_end: null,
    created_date: null,
    ...overrides,
  };
}

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

async function setupAuthenticatedMocks(page, overrides = {}) {
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf' }),
    }),
  );

  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: buildAuthenticatedUser(overrides) }),
    }),
  );
}

async function openGuestEditorFromOpportunity(page, title) {
  await page.goto(`${BASE_URL}/opportunities/new`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('e.g., Mutual NDA comparison')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await page.getByPlaceholder('e.g., Mutual NDA comparison').fill(title);
  await page.getByRole('button', { name: 'Continue to Editor' }).click();
  await expect(page.locator('[data-testid="doc-comparison-step-2"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
}

async function typeInEditor(page, selector, text) {
  const editor = page.locator(selector);
  await editor.click({ position: { x: 20, y: 20 } });
  await page.keyboard.type(text, { delay: 8 });
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

test('signed-in /DocumentComparisonCreate still opens the authenticated workflow', async ({ page }) => {
  await setupAuthenticatedMocks(page);
  await page.goto(`${BASE_URL}/DocumentComparisonCreate`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="doc-comparison-step-1"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="doc-comparison-signin-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="doc-comparison-guest-banner"]')).toHaveCount(0);
});

test('guest Step 2 AI assistance uses the public preview path, applies suggestions, and survives refresh', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);

  const accountWriteRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.startsWith('/api/document-comparisons') &&
      ['POST', 'PATCH', 'PUT'].includes(request.method().toUpperCase())
    ) {
      accountWriteRequests.push(`${request.method()} ${pathname}`);
    }
  });

  let guestCoachCalls = 0;
  await page.route('**/api/public/document-comparisons/coach', async (route) => {
    guestCoachCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        comparison_id: 'guest_preview_step2',
        cache_hash: `guest_coach_hash_${guestCoachCalls}`,
        cached: false,
        provider: 'mock',
        model: 'guest-coach-e2e-mock',
        prompt_version: 'coach-v1',
        coach: {
          version: 'coach-v1',
          summary: {
            overall: 'Suggested update ready.',
            top_priorities: ['Tighten the shared wording before running mediation.'],
          },
          suggestions: [
            {
              id: 'guest_suggestion_1',
              scope: 'shared',
              severity: 'info',
              title: 'Add a shared fallback',
              rationale: 'The shared document should reserve a fallback if implementation slips.',
              category: 'wording',
              proposed_change: {
                target: 'doc_b',
                op: 'append',
                text: 'Add a mutual indemnity fallback if implementation timelines slip.',
              },
              evidence: {
                shared_quotes: ['Current shared wording leaves implementation fallback undefined.'],
                confidential_quotes: [],
              },
            },
          ],
          concerns: [],
          questions: [],
          negotiation_moves: [],
          custom_feedback: '',
        },
        created_at: new Date().toISOString(),
        withheld_count: 0,
      }),
    });
  });

  await openGuestEditorFromOpportunity(page, `Guest assistance ${Date.now()}`);
  await expect(page.getByTestId('coach-custom-prompt-panel')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });

  await typeInEditor(
    page,
    '[data-testid="doc-b-editor"]',
    'Shared implementation scope currently has no fallback for a delayed delivery.',
  );
  await page.getByRole('button', { name: 'General Improvements' }).click();

  await expect.poll(() => guestCoachCalls, { timeout: LOAD_TIMEOUT_MS }).toBe(1);
  await expect(page.getByTestId('coach-response-feedback')).toContainText('Suggested update ready.', {
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByRole('button', { name: 'Review & Apply' })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });

  await page.getByRole('button', { name: 'Review & Apply' }).click();
  await expect(page.getByText('Review Suggested Change')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: 'Confirm & Apply' }).click();

  await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(
    'Add a mutual indemnity fallback if implementation timelines slip.',
    {
      timeout: LOAD_TIMEOUT_MS,
    },
  );
  await page.waitForTimeout(700);

  expect(accountWriteRequests).toHaveLength(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="doc-comparison-step-2"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByTestId('coach-response-feedback')).toContainText('Suggested update ready.', {
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(
    'Add a mutual indemnity fallback if implementation timelines slip.',
    {
      timeout: LOAD_TIMEOUT_MS,
    },
  );
});

test('guest Step 3 AI mediation runs locally once, shows the preview, and survives refresh', async ({
  page,
}) => {
  await setupUnauthenticatedMocks(page);

  const accountWriteRequests = [];
  const authenticatedEvaluateRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    const method = request.method().toUpperCase();
    if (pathname.startsWith('/api/document-comparisons') && ['POST', 'PATCH', 'PUT'].includes(method)) {
      accountWriteRequests.push(`${method} ${pathname}`);
    }
    if (/^\/api\/document-comparisons\/[^/]+\/evaluate$/.test(pathname)) {
      authenticatedEvaluateRequests.push(`${method} ${pathname}`);
    }
  });

  let guestEvaluateCalls = 0;
  await page.route('**/api/public/document-comparisons/evaluate', async (route) => {
    guestEvaluateCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        comparison: {
          id: 'guest_preview_step3',
          status: 'evaluated',
          draft_step: 3,
          title: 'Guest preview evaluation',
          party_a_label: 'Confidential Information',
          party_b_label: 'Shared Information',
        },
        evaluation: {
          report_format: 'v2',
          fit_level: 'medium',
          confidence_0_1: 0.72,
          why: ['Shared scope aligns with the confidential constraints, but one liability item still needs review.'],
          missing: ['Clarify the remaining liability exception before sending the package.'],
          redactions: [],
          summary: {
            fit_level: 'medium',
            top_fit_reasons: [{ text: 'Implementation milestones line up.' }],
            top_blockers: [{ text: 'Liability exception is unresolved.' }],
            next_actions: ['Clarify the liability exception before another run.'],
          },
          sections: [],
          recommendation: 'Medium',
        },
        evaluation_result: {
          provider: 'mock',
          model: 'guest-evaluate-e2e-mock',
          recommendation: 'Medium',
          report: {
            report_format: 'v2',
            fit_level: 'medium',
            confidence_0_1: 0.72,
            why: ['Shared scope aligns with the confidential constraints, but one liability item still needs review.'],
            missing: ['Clarify the remaining liability exception before sending the package.'],
            redactions: [],
            summary: {
              fit_level: 'medium',
              top_fit_reasons: [{ text: 'Implementation milestones line up.' }],
              top_blockers: [{ text: 'Liability exception is unresolved.' }],
              next_actions: ['Clarify the liability exception before another run.'],
            },
            sections: [],
            recommendation: 'Medium',
          },
        },
        evaluation_input_trace: {
          comparison_id: 'guest_preview_step3',
          source: 'guest_preview',
        },
        request_id: 'guest_preview_request_1',
        attempt_count: 1,
      }),
    });
  });

  await openGuestEditorFromOpportunity(page, `Guest mediation ${Date.now()}`);
  await typeInEditor(
    page,
    '[data-testid="doc-a-editor"]',
    'Confidential requirements include pricing protections, staffing constraints, and internal launch milestones that must remain private.',
  );
  await typeInEditor(
    page,
    '[data-testid="doc-b-editor"]',
    'Shared scope covers onboarding, SLAs, implementation milestones, and shared escalation responsibilities across both teams.',
  );
  await page.getByTestId('step2-continue-button').click();

  await expect(page.locator('[data-testid="doc-comparison-step-3"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await page.getByTestId('step2-run-evaluation-button').click();

  await expect.poll(() => guestEvaluateCalls, { timeout: LOAD_TIMEOUT_MS }).toBe(1);
  await expect(page.getByTestId('guest-evaluation-preview-panel')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByTestId('guest-evaluation-preview-panel')).toContainText(
    'Shared scope aligns with the confidential constraints',
    {
      timeout: LOAD_TIMEOUT_MS,
    },
  );
  await expect(page.getByTestId('guest-evaluation-limit-alert')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByTestId('guest-evaluation-limit-signin')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });

  expect(accountWriteRequests).toHaveLength(0);
  expect(authenticatedEvaluateRequests).toHaveLength(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="doc-comparison-step-3"]')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByTestId('guest-evaluation-preview-panel')).toContainText(
    'Shared scope aligns with the confidential constraints',
    {
      timeout: LOAD_TIMEOUT_MS,
    },
  );
  await expect(page.getByTestId('guest-evaluation-limit-signin')).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
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
