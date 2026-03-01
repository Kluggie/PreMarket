import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      maxUses: 10,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  return payload;
}

test.describe('Shared Report Recipient Draft', () => {
  test('open link, save draft, reload keeps recipient changes', async ({ page, request }) => {
    const ownerId = uniqueId('shared_report_owner');
    const ownerCookie = makeSessionCookie({
      sub: ownerId,
      email: `${ownerId}@example.com`,
      name: 'Shared Owner',
    });

    const comparison = await createComparison(request, ownerCookie, {
      title: `Recipient Draft ${uniqueId('title')}`,
      docAText: 'Confidential source details that must stay private.',
      docBText: 'Shared source details that recipient can edit.',
    });
    const sharedLink = await createSharedReportLink(
      request,
      ownerCookie,
      comparison.id,
      'recipient@example.com',
    );

    const token = sharedLink.token;
    expect(token).toBeTruthy();

    const sharedMarker = uniqueId('shared_marker');
    const confidentialMarker = uniqueId('confidential_marker');
    const apiEvents = [];
    const workspaceUrlFragment = `/api/shared-report/${encodeURIComponent(token)}`;

    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/shared-report/')) return;
      let bodyPreview = '';
      try {
        bodyPreview = (await response.text()).slice(0, 500);
      } catch {
        bodyPreview = '<unreadable>';
      }
      const event = {
        method: response.request().method(),
        status: response.status(),
        url,
        bodyPreview,
      };
      apiEvents.push(event);
      console.log(`[shared-report-api] ${event.status} ${event.method} ${event.url} ${event.bodyPreview}`);
    });
    page.on('requestfailed', (requestEvent) => {
      const url = requestEvent.url();
      if (!url.includes('/api/shared-report/')) return;
      const event = {
        method: requestEvent.method(),
        status: 'request_failed',
        url,
        bodyPreview: requestEvent.failure()?.errorText || 'unknown_request_failure',
      };
      apiEvents.push(event);
      console.log(`[shared-report-api] request_failed ${event.method} ${event.url} ${event.bodyPreview}`);
    });

    await page.goto(`${BASE_URL}/shared-report/${encodeURIComponent(token)}`, {
      waitUntil: 'domcontentloaded',
    });
    function findSuccessfulWorkspaceGetEvent() {
      for (let i = apiEvents.length - 1; i >= 0; i -= 1) {
        const event = apiEvents[i];
        if (
          event &&
          event.method === 'GET' &&
          event.status === 200 &&
          typeof event.url === 'string' &&
          event.url.includes(workspaceUrlFragment)
        ) {
          return event;
        }
      }
      return null;
    }

    async function waitForWorkspaceGet(label) {
      const existing = findSuccessfulWorkspaceGetEvent();
      if (existing) {
        return;
      }
      const workspaceResponse = await page
        .waitForResponse(
          (response) =>
            response.url().includes(workspaceUrlFragment) &&
            response.request().method() === 'GET',
          { timeout: 30_000 },
        )
        .catch(() => null);
      if (!workspaceResponse) {
        throw new Error(`${label}: no workspace GET response observed. API events: ${JSON.stringify(apiEvents)}`);
      }
      if (workspaceResponse.status() !== 200) {
        let bodyPreview = '';
        try {
          bodyPreview = (await workspaceResponse.text()).slice(0, 500);
        } catch {
          bodyPreview = '<unreadable>';
        }
        throw new Error(
          `${label}: workspace GET failed ${workspaceResponse.status()} ${workspaceResponse.url()} ${bodyPreview}`,
        );
      }
    }

    await waitForWorkspaceGet('initial load');
    const textareas = page.locator('textarea');
    await expect(textareas).toHaveCount(2, { timeout: 30_000 });

    await expect(page.getByText('Shared Information').first()).toBeVisible();
    await expect(page.getByText('Confidential Information').first()).toBeVisible();
    await expect(page.getByText('AI Report').first()).toBeVisible();

    await textareas
      .nth(0)
      .fill(JSON.stringify({ label: 'Shared Information', text: `Updated ${sharedMarker}` }, null, 2));
    await textareas
      .nth(1)
      .fill(
        JSON.stringify(
          { label: 'Confidential Information', notes: `Private ${confidentialMarker}` },
          null,
          2,
        ),
      );

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`${workspaceUrlFragment}/draft`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await saveResponsePromise;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspaceGet('reload');
    const reloadedTextareas = page.locator('textarea');
    await expect(reloadedTextareas).toHaveCount(2, { timeout: 30_000 });
    await expect(reloadedTextareas.nth(0)).toContainText(sharedMarker, { timeout: 30_000 });
    await expect(reloadedTextareas.nth(1)).toContainText(confidentialMarker, { timeout: 30_000 });
  });
});
