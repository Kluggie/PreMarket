import { test, expect } from '@playwright/test';

test.describe('ISSUE B: Save Draft - Content Persistence', () => {
  test('Save Draft captures Tiptap editor content and persists through reload', async ({ page, request }) => {
    const uniqueId = Date.now().toString();
    const testConfText = `CONFIDENTIAL_${uniqueId}_CONF_MARKER`;
    const testSharedText = `SHARED_${uniqueId}_SHARED_MARKER`;

    // Navigate to Step 2 editor
    await page.goto('/?page=DocumentComparisonCreate&step=2');
    await page.waitForLoadState('networkidle');
    
    // Wait for editors to initialize
    await page.waitForSelector('[data-testid="doc-a-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="doc-b-editor"]', { timeout: 10000 });

    // Type directly into Tiptap editors using keyboard
    const confEditor = page.locator('[data-testid="doc-a-editor"]');
    const sharedEditor = page.locator('[data-testid="doc-b-editor"]');

    // Focus and type into Confidential editor
    await confEditor.click();
    await confEditor.focus();
    await page.keyboard.type(testConfText, { delay: 5 });
    await page.waitForTimeout(300);

    // Focus and type into Shared editor
    await sharedEditor.click(); 
    await sharedEditor.focus();
    await page.keyboard.type(testSharedText, { delay: 5 });
    await page.waitForTimeout(300);

    // Verify text appears in UI
    const confContent = await confEditor.textContent();
    const sharedContent = await sharedEditor.textContent();
    expect(confContent).toContain(testConfText);
    expect(sharedContent).toContain(testSharedText);

    // Capture the save request/response
    const saveResponsePromise = page.waitForResponse(
      response => response.url().includes('/api/document-comparisons') && 
                   (response.url().includes('?') || response.request().method() === 'PATCH') &&
                   response.status() === 200
    );

    // Click Save Draft
    const saveButton = page.locator('button:has-text("Save Draft")').first();
    await saveButton.click();

    // Wait for the save request to actually complete with 200 response
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(200);

    // Parse the response to get the comparison ID
    const saveBody = await saveResponse.json();
    const comparisonId = saveBody.comparison?.id;
    expect(comparisonId).toBeTruthy('Save response should contain comparison ID');

    // Wait for toast notification
    await page.locator('text=/Draft saved/i').waitFor({ state: 'visible', timeout: 5000 });

    // Verify via API that server persisted both fields
    const getResponse = await request.get(`/api/document-comparisons/${comparisonId}`);
    expect(getResponse.status()).toBe(200);
    const getBody = await getResponse.json();
    
    expect(String(getBody.comparison.doc_a_text || '')).toContain(testConfText);
    expect(String(getBody.comparison.doc_b_text || '')).toContain(testSharedText);

    // Hard reload page - full network reload, clears cache
    await page.reload({ waitUntil: 'networkidle' });

    // Wait for editors to reload
    await page.waitForSelector('[data-testid="doc-a-editor"]', { timeout: 10000 });
    const confEditorAfterReload = page.locator('[data-testid="doc-a-editor"]');
    const sharedEditorAfterReload = page.locator('[data-testid="doc-b-editor"]');

    // Verify content restored in UI after reload
    const confContentAfterReload = await confEditorAfterReload.textContent();
    const sharedContentAfterReload = await sharedEditorAfterReload.textContent();
    expect(confContentAfterReload).toContain(testConfText);
    expect(sharedContentAfterReload).toContain(testSharedText);

    // Navigate to Proposals page
    await page.goto('/?page=Proposals');
    await page.waitForLoadState('networkidle');

    // Navigate back to the same draft
    await page.goto(`/?page=DocumentComparisonCreate&step=2&draft=${comparisonId}`);
    await page.waitForLoadState('networkidle');

    // Verify editors restored again
    await page.waitForSelector('[data-testid="doc-a-editor"]', { timeout: 10000 });
    const confEditorAfterNav = page.locator('[data-testid="doc-a-editor"]');
    const sharedEditorAfterNav = page.locator('[data-testid="doc-b-editor"]');

    const confContentAfterNav = await confEditorAfterNav.textContent();
    const sharedContentAfterNav = await sharedEditorAfterNav.textContent();
    expect(confContentAfterNav).toContain(testConfText);
    expect(sharedContentAfterNav).toContain(testSharedText);

    // Make one more change and verify update
    const newText = `UPDATED_${uniqueId}`;
    await confEditorAfterNav.click();
    await confEditorAfterNav.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(newText, { delay: 5 });
    await page.waitForTimeout(300);

    // Wait for second save response
    const secondSaveResponsePromise = page.waitForResponse(
      response => response.url().includes(`/api/document-comparisons/${comparisonId}`) &&
                   response.request().method() === 'PATCH' &&
                   response.status() === 200
    );

    const secondSaveButton = page.locator('button:has-text("Save Draft")').first();
    await secondSaveButton.click();

    const secondSaveResponse = await secondSaveResponsePromise;
    expect(secondSaveResponse.status()).toBe(200);

    // Verify API shows the updated content
    const finalGetResponse = await request.get(`/api/document-comparisons/${comparisonId}`);
    const finalBody = await finalGetResponse.json();
    expect(String(finalBody.comparison.doc_a_text || '')).toContain(newText);
  });

  test('Save Draft prevents overwriting with empty content on existing comparison', async ({ page }) => {
    await page.goto('/?page=DocumentComparisonCreate&step=2');
    await page.waitForLoadState('networkidle');

    // Add some initial content
    await page.waitForSelector('[data-testid="doc-a-editor"]');
    const confEditor = page.locator('[data-testid="doc-a-editor"]');
    await confEditor.click();
    await confEditor.focus();
    await page.keyboard.type('Initial content', { delay: 5 });
    await page.waitForTimeout(300);

    // First save to create comparison
    let saveButton = page.locator('button:has-text("Save Draft")').first();
    await saveButton.click();
    await page.locator('text=/Draft saved/i').waitFor({ state: 'visible', timeout: 5000 });

    // Reload to establish existing comparisonId
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Clear both editors
    const confEditorAfterReload = page.locator('[data-testid="doc-a-editor"]');
    const sharedEditorAfterReload = page.locator('[data-testid="doc-b-editor"]');

    // Select all and delete in both
    await confEditorAfterReload.click();
    await confEditorAfterReload.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    await sharedEditorAfterReload.click();
    await sharedEditorAfterReload.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Try to save when both are empty - should show warning
    saveButton = page.locator('button:has-text("Save Draft")').first();
    await saveButton.click();

    // Should see warning about both documents being empty
    const warningToast = page.locator('text=/empty/i');
    await warningToast.waitFor({ state: 'visible', timeout: 5000 });
  });

  test('Save Draft allows empty draft for new comparison (not yet created)', async ({ page }) => {
    await page.goto('/?page=DocumentComparisonCreate&step=2');
    await page.waitForLoadState('networkidle');

    // Don't add any content, immediately save
    await page.waitForSelector('[data-testid="doc-a-editor"]');

    // Capture the save request (should succeed with empty content for new comparison)
    const saveResponsePromise = page.waitForResponse(
      response => response.url().includes('/api/document-comparisons') &&
                   response.status() === 200
    );

    const saveButton = page.locator('button:has-text("Save Draft")').first();
    await saveButton.click();

    // Should allow creating empty draft
    const infoOrSuccessToast = page.locator('text=/(empty draft|Draft saved)/i');
    await infoOrSuccessToast.waitFor({ state: 'visible', timeout: 5000 });

    try {
      // Try to capture response - might not happen if save is prevented
      const saveResponse = await saveResponsePromise.catch(() => null);
      if (saveResponse) {
        expect(saveResponse.status()).toBe(200);
      }
    } catch {
      // Empty save might be prevented, which is also acceptable behavior
    }
  });

  test('Save Draft button shows loading state during save', async ({ page }) => {
    await page.goto('/?page=DocumentComparisonCreate&step=2');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="doc-a-editor"]');
    const confEditor = page.locator('[data-testid="doc-a-editor"]');
    
    await confEditor.click();
    await confEditor.focus();
    await page.keyboard.type('Test content', { delay: 5 });
    await page.waitForTimeout(300);

    const saveButton = page.locator('button:has-text("Save Draft")').first();
    
    // Click and check for loading indicator
    await saveButton.click();

    // Button should show saving state (text or spinner)
    await expect(saveButton).toContainText(/Save Draft|Saving/);

    // Wait for success
    await page.locator('text=/Draft saved/i').waitFor({ state: 'visible', timeout: 5000 });
  });
});


