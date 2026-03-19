import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';
import { ensureMigrated } from './helpers/db.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 120_000;

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeStableEmailCookie(email, name = 'Recipient User') {
  const normalized = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return makeSessionCookie({
    sub: `e2e_${normalized || 'user'}`,
    email,
    name,
  });
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

async function expectComparisonStep(page, step) {
  await expect(page.getByRole('heading', { name: 'Document Comparison' })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect(page.getByText(`Step ${step} of 3`)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
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
    const recipientEmail = `${uniqueId('recipient')}@example.com`;
    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Step Flow ${uniqueId('title')}`,
      docAText: 'Proposer confidential baseline text that must never be displayed to recipient.',
      docBText: `Shared baseline visible to recipient. ${proposerSharedMarker}. Additional text to ensure realistic baseline.`,
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      recipientEmail,
    );

    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const recipientCookie = makeStableEmailCookie(recipientEmail);
    await applySessionCookie(page.context(), recipientCookie);

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

    await expectComparisonStep(page, 0);
    await expect(page.locator('pre')).toContainText(proposerSharedMarker, { timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expectComparisonStep(page, 1);

    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expectComparisonStep(page, 2);
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

    await expect(page.locator('[data-testid="doc-b-editor"]')).toContainText(sharedMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toContainText(confidentialMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Step 2 recipient suggestions support threaded history, switching, continuation, and reload restore', async ({ page, request }) => {
    const ownerId = uniqueId('recipient_thread_owner');
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const recipientEmail = `${uniqueId('recipient_thread')}@example.com`;
    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Threaded Suggestions ${uniqueId('title')}`,
      docAText: 'Recipient-private notes remain private.',
      docBText: 'Shared baseline visible to recipient and proposer.',
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      recipientEmail,
    );
    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const recipientCookie = makeStableEmailCookie(recipientEmail);
    await applySessionCookie(page.context(), recipientCookie);

    const coachBodies = [];
    await page.route(`**/api/shared-report/${encodeURIComponent(token)}/coach`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      coachBodies.push(body);
      const promptText = String(body.promptText || '').trim();
      const responseText = promptText
        ? `Custom response for ${promptText}`
        : body.intent === 'risks'
          ? 'Risk response for thread one.'
          : 'Suggestions ready.';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          comparison_id: comparison.id,
          cache_hash: `hash_${coachBodies.length}`,
          cached: false,
          provider: 'mock',
          model: 'shared-report-thread-e2e',
          withheld_count: 0,
          coach: {
            version: 'coach-v1',
            summary: { overall: responseText },
            custom_feedback: responseText,
            suggestions: [
              {
                id: `suggestion_${coachBodies.length}`,
                severity: 'info',
                scope: 'shared',
                title: 'Shared wording suggestion',
                rationale: 'Keep the shared summary concise.',
                proposed_change: {
                  target: 'doc_b',
                  op: 'append',
                  text: `Added clause ${coachBodies.length}.`,
                },
                evidence: {
                  shared_quotes: ['Shared baseline visible to recipient and proposer.'],
                },
              },
            ],
          },
        }),
      });
    });

    await page.goto(`${BASE_URL}/shared-report/${encodeURIComponent(token)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expectComparisonStep(page, 0);
    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expectComparisonStep(page, 1);
    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expectComparisonStep(page, 2);

    await page.getByRole('button', { name: 'Risks & Gaps' }).click();
    await expect(page.getByTestId('coach-response-feedback')).toContainText('Risk response for thread one.', {
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.getByTestId('start-new-thread').click();
    await expect(page.getByTestId('coach-response-feedback')).toHaveCount(0);
    await expect(page.getByTestId('suggestion-thread-bar')).toContainText('New thread');

    const customPromptInput = page.getByTestId('coach-custom-prompt-input');
    await customPromptInput.fill('Thread two follow-up');
    await page.getByTestId('coach-custom-prompt-run').click();
    await expect(page.getByTestId('coach-custom-prompt-feedback')).toContainText(
      'Custom response for Thread two follow-up',
      { timeout: LOAD_TIMEOUT_MS },
    );
    await expect(page.getByTestId('suggestion-thread-bar')).toContainText('Thread two follow-up');

    const threadHistoryPanel = page.getByTestId('thread-history-panel');
    await page.getByTestId('toggle-thread-history').click();
    await expect(threadHistoryPanel.getByRole('button', { name: 'Risks & Gaps' })).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(threadHistoryPanel.getByRole('button', { name: 'Thread two follow-up' })).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    await threadHistoryPanel.getByRole('button', { name: 'Risks & Gaps' }).click();
    await expect(page.getByTestId('suggestion-thread-bar')).toContainText('Risks & Gaps');
    await expect(page.getByTestId('coach-response-feedback')).toContainText('Risk response for thread one.', {
      timeout: LOAD_TIMEOUT_MS,
    });

    await customPromptInput.fill('Second pass on first thread');
    await page.getByTestId('coach-custom-prompt-run').click();
    await expect(page.getByTestId('coach-custom-prompt-feedback')).toContainText(
      'Custom response for Second pass on first thread',
      { timeout: LOAD_TIMEOUT_MS },
    );
    await expect(page.getByTestId('suggestion-thread-bar')).toContainText('Risks & Gaps');

    expect(coachBodies).toHaveLength(3);
    expect(Array.isArray(coachBodies[1]?.threadHistory)).toBe(true);
    expect(coachBodies[1].threadHistory).toHaveLength(1);
    expect(Array.isArray(coachBodies[2]?.threadHistory)).toBe(true);
    expect(
      coachBodies[2].threadHistory.some((entry) => String(entry.content || '').includes('Risk response for thread one.')),
    ).toBe(true);

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
    await expectComparisonStep(page, 2);
    await expect(page.getByTestId('coach-custom-prompt-feedback')).toContainText(
      'Custom response for Second pass on first thread',
      { timeout: LOAD_TIMEOUT_MS },
    );

    await page.getByTestId('toggle-thread-history').click();
    await expect(threadHistoryPanel.getByRole('button', { name: 'Risks & Gaps' })).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(threadHistoryPanel.getByRole('button', { name: 'Thread two follow-up' })).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Anonymous recipient can view Step 0 but must sign in before editing', async ({ page, request }) => {
    const ownerId = uniqueId('recipient_owner_gate');
    const recipientEmail = `${uniqueId('recipient_gate')}@example.com`;
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Auth Gate ${uniqueId('title')}`,
      docAText: 'Proposer private baseline.',
      docBText: 'Shared baseline visible publicly.',
    });
    const sharedLink = await createSharedReportLink(request, ownerCookie, comparison.id, recipientEmail);
    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const sharedReportUrl = `${BASE_URL}/shared-report/${encodeURIComponent(token)}`;
    await page.goto(sharedReportUrl, { waitUntil: 'domcontentloaded' });

    await expectComparisonStep(page, 0);
    await expect(page.getByText('Sign in to edit and respond.')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expect(page.getByText('Sign in to PreMarket')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    const recipientCookie = makeStableEmailCookie(recipientEmail);
    await applySessionCookie(page.context(), recipientCookie);

    await page.goto(sharedReportUrl, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/shared-report/${encodeURIComponent(token)}`), {
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(page.getByRole('button', { name: 'Edit Opportunity' })).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  });

  test('Deep link step query is clamped to Step 0 while logged out', async ({ page, request }) => {
    const ownerId = uniqueId('recipient_owner_deeplink');
    const recipientEmail = `${uniqueId('recipient_deeplink')}@example.com`;
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Deep Link Guard ${uniqueId('title')}`,
      docAText: 'Proposer private baseline.',
      docBText: 'Shared baseline visible publicly.',
    });
    const sharedLink = await createSharedReportLink(request, ownerCookie, comparison.id, recipientEmail);
    const token = sharedLink.token;
    expect(token).toBeTruthy();

    await page.goto(`${BASE_URL}/shared-report/${encodeURIComponent(token)}?step=2`, {
      waitUntil: 'domcontentloaded',
    });

    await expectComparisonStep(page, 0);
    await expect(page.getByText('Sign in to edit and respond.')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="doc-b-editor"]')).toHaveCount(0);
  });

  test('Recipient proposals received tab shows shared report and opens token route', async ({ page, request }) => {
    const ownerId = uniqueId('received_owner');
    const recipientEmail = `${uniqueId('received_recipient')}@example.com`;
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const proposalTitle = `Received Shared Report ${uniqueId('title')}`;
    const comparison = await createComparison(request, ownerCookie, {
      title: proposalTitle,
      docAText: 'Owner private baseline.',
      docBText: 'Shared baseline for received list integration.',
    });
    const sharedLink = await createSharedReportLink(request, ownerCookie, comparison.id, recipientEmail);
    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const recipientCookie = makeStableEmailCookie(recipientEmail);
    await applySessionCookie(page.context(), recipientCookie);

    await page.goto(`${BASE_URL}/Proposals?tab=received`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('tab', { name: /^Received/ }).click();
    await expect(page.getByText(proposalTitle)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: new RegExp(proposalTitle) }).click();
    await expect(page).toHaveURL(new RegExp(`/shared-report/${encodeURIComponent(token)}`), {
      timeout: LOAD_TIMEOUT_MS,
    });
  });
});
