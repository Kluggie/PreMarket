import { test, expect } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';
import { ensureMigrated, getDb } from './helpers/db.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';
const LOAD_TIMEOUT_MS = 120_000;
const E2E_FAST_AUTOSAVE_MS = 1_000;

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

async function waitForSharedReportWorkspaceReady(page) {
  const stepIndicator = page.getByTestId('doc-comparison-step-indicator');
  await expect(stepIndicator).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
}

async function openSharedReportWorkspace(page, token, { query = '' } = {}) {
  const encodedToken = encodeURIComponent(token);
  const workspaceRoutePattern = `**/api/shared-report/${encodedToken}/workspace*`;
  const preflightWorkspace = await page.request.get(`${BASE_URL}/api/shared-report/${encodedToken}/workspace`);
  expect(preflightWorkspace.status()).toBe(200);
  const preflightWorkspaceBody = await preflightWorkspace.text();
  const workspaceRoute = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: preflightWorkspaceBody,
    });
  };
  await page.route(workspaceRoutePattern, workspaceRoute);
  // `domcontentloaded` can hang in local dev when Vite module loading stalls.
  // Use a fast navigation commit, then assert the stable workspace shell.
  try {
    await page.goto(`${BASE_URL}/shared-report/${encodedToken}${query}`, {
      waitUntil: 'commit',
    });
    await waitForSharedReportWorkspaceReady(page);
  } finally {
    if (!page.isClosed()) {
      await page.unroute(workspaceRoutePattern, workspaceRoute).catch(() => {});
    }
  }
}

async function reloadSharedReportWorkspace(page, token) {
  await openSharedReportWorkspace(page, token);
}

async function expectComparisonStep(page, step) {
  const stepIndicator = page.getByTestId('doc-comparison-step-indicator');
  await expect(stepIndicator).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(stepIndicator).toContainText(new RegExp(`Step\\s+${step}\\s+of\\s+3`), {
    timeout: LOAD_TIMEOUT_MS,
  });
}

function extractPersistedDraftDocuments(workspaceBody) {
  const persistedEditorState = workspaceBody?.recipientDraft?.editor_state || {};
  return Array.isArray(persistedEditorState.documents) ? persistedEditorState.documents : [];
}

function includesHistoricalDraftDocumentId(documents) {
  return documents.some((doc) => {
    const id = String(doc?.id || '').toLowerCase();
    return (
      id.startsWith('shared-history-') ||
      id.startsWith('shared-history-baseline') ||
      id.startsWith('history-confidential-') ||
      id.startsWith('confidential-history-')
    );
  });
}

async function waitForWorkspaceDraftPredicate(request, token, recipientCookie, predicate, timeoutMs = LOAD_TIMEOUT_MS) {
  let matchedWorkspace = null;
  await expect.poll(
    async () => {
      const response = await request.get(`${BASE_URL}/api/shared-report/${encodeURIComponent(token)}/workspace`, {
        headers: { cookie: recipientCookie },
      });
      if (response.status() !== 200) {
        return false;
      }
      const workspaceBody = await response.json();
      matchedWorkspace = workspaceBody;
      return Boolean(predicate(workspaceBody));
    },
    {
      timeout: timeoutMs,
      intervals: [500, 1_000, 2_000],
    },
  ).toBe(true);
  return matchedWorkspace;
}

test.beforeAll(async () => {
  await ensureMigrated();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ autosaveMs }) => {
    window.__PM_E2E_AUTOSAVE_MS = autosaveMs;
  }, { autosaveMs: E2E_FAST_AUTOSAVE_MS });
});

test.describe('Shared Report Recipient Draft', () => {
  test('Step 0 -> Step 1 -> Step 2 prefill + save draft + reload persistence', async ({ page, request }) => {
    test.slow();

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
    await openSharedReportWorkspace(page, token);

    await expectComparisonStep(page, 0);
    await expect(page.getByText(proposerSharedMarker)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expectComparisonStep(page, 1);

    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expectComparisonStep(page, 2);
    const activeEditor = page.locator('[data-testid="active-doc-editor"]');
    await expect(activeEditor).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    // Prompt 2 prefill requirement: shared editor defaults to proposer baseline when no draft exists.
    await expect(activeEditor).toContainText(proposerSharedMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.getByRole('button', { name: 'My New Shared Contribution' }).click();
    await typeInEditor(page, '[data-testid="active-doc-editor"]', ` ${sharedMarker}`);

    await page.getByRole('button', { name: /^My Confidential Notes$/ }).click();
    await typeInEditor(page, '[data-testid="active-doc-editor"]', ` ${confidentialMarker}`);

    await page.getByTestId('step2-save-draft-button').click();
    await waitForWorkspaceDraftPredicate(
      request,
      token,
      recipientCookie,
      (workspaceBody) => {
        const serializedDocs = JSON.stringify(extractPersistedDraftDocuments(workspaceBody));
        return serializedDocs.includes(sharedMarker) && serializedDocs.includes(confidentialMarker);
      },
    );

    await reloadSharedReportWorkspace(page, token);
    await expectComparisonStep(page, 2);

    await page.getByRole('button', { name: 'My New Shared Contribution' }).click();
    await expect(activeEditor).toContainText(sharedMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
    await page.getByRole('button', { name: /^My Confidential Notes$/ }).click();
    await expect(activeEditor).toContainText(confidentialMarker, {
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Step 2 recipient suggestions support threaded history, switching, continuation, and reload restore', async ({ page, request }) => {
    test.slow();

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

    await openSharedReportWorkspace(page, token);
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

    await page.getByTestId('step2-save-draft-button').click();
    await waitForWorkspaceDraftPredicate(
      request,
      token,
      recipientCookie,
      (workspaceBody) => {
        const editorState = workspaceBody?.recipientDraft?.editor_state || {};
        return JSON.stringify(editorState).includes('Second pass on first thread');
      },
    );

    await reloadSharedReportWorkspace(page, token);
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
    await openSharedReportWorkspace(page, token);

    await expectComparisonStep(page, 0);
    await expect(page.getByText('Sign in to edit and respond.')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expect(page.getByText('Sign in to PreMarket')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    const recipientCookie = makeStableEmailCookie(recipientEmail);
    await applySessionCookie(page.context(), recipientCookie);

    await openSharedReportWorkspace(page, token);
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

    await openSharedReportWorkspace(page, token, { query: '?step=2' });

    await expectComparisonStep(page, 0);
    await expect(page.getByText('Sign in to edit and respond.')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.locator('[data-testid="doc-a-editor"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="doc-b-editor"]')).toHaveCount(0);
  });

  test('Recipient proposals inbox tab shows shared report and opens token route', async ({ page, request }) => {
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

    await page.goto(`${BASE_URL}/Proposals?tab=inbox`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('tab', { name: /^Inbox/ }).click();
    await expect(page.getByText(proposalTitle)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });

    await page.getByRole('button', { name: new RegExp(`${proposalTitle}.*Needs Reply`) }).click();
    await expect(page).toHaveURL(new RegExp(`/shared-report/${encodeURIComponent(token)}`), {
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Shared report Step 0 shows cumulative bilateral history with round and author labels after multi-round send-back', async ({ page, request }) => {
    test.slow();

    const ownerId = uniqueId('history_owner');
    const recipientEmail = `${uniqueId('history_recipient')}@example.com`;
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });
    const recipientCookie = makeStableEmailCookie(recipientEmail);

    const proposerRound1 = `PROPOSER_UI_ROUND_1_${uniqueId('marker')}`;
    const recipientRound2 = `RECIPIENT_UI_ROUND_2_${uniqueId('marker')}`;
    const proposerRound3 = `PROPOSER_UI_ROUND_3_${uniqueId('marker')}`;
    const recipientPrivateRound2 = `RECIPIENT_UI_PRIVATE_ROUND_2_${uniqueId('marker')}`;
    const proposerPrivateRound3 = `PROPOSER_UI_PRIVATE_ROUND_3_${uniqueId('marker')}`;

    const comparison = await createComparison(request, ownerCookie, {
      title: `Shared History UI ${uniqueId('title')}`,
      docAText: 'Owner private baseline.',
      docBText: `Owner shared baseline ${proposerRound1}`,
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      recipientEmail,
    );

    const initialToken = sharedLink.token;
    expect(initialToken).toBeTruthy();

    const round2Save = await request.post(`${BASE_URL}/api/shared-report/${encodeURIComponent(initialToken)}/draft`, {
      headers: { cookie: recipientCookie },
      data: {
        shared_payload: { label: 'Shared Information', text: `Recipient reply ${recipientRound2}` },
        recipient_confidential_payload: { label: 'Confidential Information', notes: recipientPrivateRound2 },
        workflow_step: 2,
      },
    });
    expect(round2Save.status()).toBe(200);

    const round2Send = await request.post(`${BASE_URL}/api/shared-report/${encodeURIComponent(initialToken)}/send-back`, {
      headers: { cookie: recipientCookie },
      data: {},
    });
    expect(round2Send.status()).toBe(200);

    const db = getDb();
    const round2LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token <> ${initialToken}
          order by created_at desc
          limit 1`,
    );
    const round2Token = String(round2LinkRows.rows[0]?.token || '');
    expect(round2Token).toBeTruthy();

    const round3Save = await request.post(`${BASE_URL}/api/shared-report/${encodeURIComponent(round2Token)}/draft`, {
      headers: { cookie: ownerCookie },
      data: {
        shared_payload: { label: 'Shared Information', text: `Owner follow-up ${proposerRound3}` },
        recipient_confidential_payload: { label: 'Confidential Information', notes: proposerPrivateRound3 },
        workflow_step: 2,
      },
    });
    expect(round3Save.status()).toBe(200);

    const round3Send = await request.post(`${BASE_URL}/api/shared-report/${encodeURIComponent(round2Token)}/send-back`, {
      headers: { cookie: ownerCookie },
      data: {},
    });
    expect(round3Send.status()).toBe(200);

    const round3LinkRows = await db.execute(
      sql`select token
          from shared_links
          where proposal_id = ${comparison.proposal_id}
            and token not in (${initialToken}, ${round2Token})
          order by created_at desc
          limit 1`,
    );
    const round3Token = String(round3LinkRows.rows[0]?.token || '');
    expect(round3Token).toBeTruthy();

    const draftEndpointFragment = `/api/shared-report/${encodeURIComponent(round3Token)}/draft`;
    const draftRequestBodies = [];
    page.on('request', (requestEvent) => {
      if (requestEvent.method() !== 'POST') {
        return;
      }
      if (!requestEvent.url().includes(draftEndpointFragment)) {
        return;
      }
      try {
        draftRequestBodies.push(JSON.parse(requestEvent.postData() || '{}'));
      } catch {
        draftRequestBodies.push({});
      }
    });

    await applySessionCookie(page.context(), recipientCookie);
    await openSharedReportWorkspace(page, round3Token);

    await expectComparisonStep(page, 0);
    await expect(page.getByText('Round 1 - Shared by Proposer')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText('Round 2 - Shared by Recipient')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText('Round 3 - Shared by Proposer')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText(proposerRound1)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText(recipientRound2)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText(proposerRound3)).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: 'Edit Opportunity' })).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.getByRole('button', { name: 'Edit Opportunity' }).click();
    await expectComparisonStep(page, 1);
    await expect(page.getByText('Round 2 - My Confidential Notes')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(page.getByText('Previous Round', { exact: true }).first()).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    await expect(page.getByText('Read-only', { exact: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    await expect(
      page.locator('[data-doc-id]', { hasText: 'Round 1 - Shared by Proposer' }).first().getByRole('button', {
        name: 'Remove document',
      }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Continue to Editor' }).click();
    await expectComparisonStep(page, 2);

    await page.getByRole('button', { name: /Round 2 - My Confidential Notes/ }).click();
    await expect(page.getByText('Previous round content is view-only and cannot be changed.')).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    const activeEditor = page.locator('[data-testid="active-doc-editor"]');
    await expect(activeEditor).toContainText(recipientPrivateRound2, { timeout: LOAD_TIMEOUT_MS });
    const immutableEditMarker = `IMMUTABLE_EDIT_${uniqueId('marker')}`;
    await activeEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(immutableEditMarker);
    await expect(activeEditor).not.toContainText(immutableEditMarker, { timeout: 1_500 });
    await expect.poll(() => draftRequestBodies.length, { timeout: 3_500, intervals: [250, 500, 1_000] }).toBe(0);

    await page.getByRole('button', { name: /^My Confidential Notes$/ }).click();
    const currentRoundEditMarker = `CURRENT_EDIT_${uniqueId('marker')}`;
    const draftRequestCountBeforeCurrentEdit = draftRequestBodies.length;
    await activeEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(currentRoundEditMarker);
    await expect(activeEditor).toContainText(currentRoundEditMarker, { timeout: LOAD_TIMEOUT_MS });
    await expect.poll(() => draftRequestBodies.length, { timeout: LOAD_TIMEOUT_MS }).toBeGreaterThan(
      draftRequestCountBeforeCurrentEdit,
    );
    expect(draftRequestBodies.length).toBeGreaterThan(0);

    const latestDraftBody = draftRequestBodies[draftRequestBodies.length - 1] || {};
    const latestEditorState = latestDraftBody.editor_state || latestDraftBody.editorState || {};
    const latestDraftDocs = Array.isArray(latestEditorState.documents) ? latestEditorState.documents : [];
    expect(latestDraftDocs.length).toBeGreaterThan(0);
    expect(includesHistoricalDraftDocumentId(latestDraftDocs)).toBeFalsy();

    const workspaceAfterAutosaveBody = await waitForWorkspaceDraftPredicate(
      request,
      round3Token,
      recipientCookie,
      (workspaceBody) => {
        const serializedDocs = JSON.stringify(extractPersistedDraftDocuments(workspaceBody));
        return serializedDocs.includes(currentRoundEditMarker);
      },
    );
    const persistedDocs = extractPersistedDraftDocuments(workspaceAfterAutosaveBody);
    expect(persistedDocs.length).toBeGreaterThan(0);
    expect(includesHistoricalDraftDocumentId(persistedDocs)).toBeFalsy();
    expect(JSON.stringify(persistedDocs)).not.toContain(immutableEditMarker);
    expect(JSON.stringify(persistedDocs)).toContain(currentRoundEditMarker);

    const verifyPage = await page.context().newPage();
    try {
      await openSharedReportWorkspace(verifyPage, round3Token);
      await expectComparisonStep(verifyPage, 2);
      await verifyPage.getByRole('button', { name: /Round 2 - My Confidential Notes/ }).click();
      await expect(
        verifyPage.getByText('Previous round content is view-only and cannot be changed.'),
      ).toBeVisible({
        timeout: LOAD_TIMEOUT_MS,
      });
      await verifyPage.getByRole('button', { name: /^My Confidential Notes$/ }).click();
      const verifyEditor = verifyPage.locator('[data-testid="active-doc-editor"]');
      await expect(verifyEditor).toContainText(currentRoundEditMarker, { timeout: LOAD_TIMEOUT_MS });
    } finally {
      if (!verifyPage.isClosed()) {
        await verifyPage.close();
      }
    }
  });
});
