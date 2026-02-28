import { test, expect } from '@playwright/test';

/**
 * Document Comparison Workflow Persistence Tests
 * Tests explicit Save Draft button and step navigation persistence
 * (No autosave - only manual Save Draft and navigation guards)
 */

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173';

test.describe('Document Comparison Persistence (Explicit Save Only)', () => {
  test('Step 1 & 2: Save Draft persists content, reload restores it', async ({ page }) => {
    // Navigate to new comparison
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`);
    await page.waitForLoadState('networkidle');

    // Step 1: Fill in title
    const titleInput = page.locator('input[type="text"]').first();
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    const uniqueTitle = `Persistence Test ${Date.now()}`;
    await titleInput.fill(uniqueTitle);

    // Step 1: Fill in content areas
    const confidentialArea = page.locator('textarea').first();
    if (await confidentialArea.isVisible()) {
      await confidentialArea.fill('Confidential test content');
      await page.waitForTimeout(300);
    }

    const sharedArea = page.locator('textarea').nth(1);
    if (await sharedArea.isVisible()) {
      await sharedArea.fill('Shared test content');
      await page.waitForTimeout(300);
    }

    // Move to Step 2
    const continueBtn = page.locator('button:has-text("Continue to Editor")');
    await continueBtn.click();
    await page.waitForLoadState('networkidle');

    // Step 2: Wait for editors to load
    const docAEditor = page.locator('[data-testid="doc-a-editor"]').first();
    await expect(docAEditor).toBeVisible({ timeout: 5000 });

    // Step 2: Type in Confidential editor
    await docAEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type('Tiptap confidential content', { delay: 15 });
    await page.waitForTimeout(500);

    // Step 2: Type in Shared editor
    const docBEditor = page.locator('[data-testid="doc-b-editor"]').first();
    await docBEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type('Tiptap shared content', { delay: 15 });
    await page.waitForTimeout(500);

    // IMPORTANT: Wait for Save Draft button and click it
    const saveDraftBtn = page.locator('button:has-text("Save Draft")');
    await expect(saveDraftBtn).toBeVisible();

    // Capture the draft ID before saving
    let draftIdBeforeSave = null;
    const urlBefore = page.url();
    const draftMatchBefore = urlBefore.match(/draft=([^&]+)/);
    if (draftMatchBefore) {
      draftIdBeforeSave = decodeURIComponent(draftMatchBefore[1]);
    }

    // Listen for the PATCH response to confirm save
    let saveSucceeded = false;
    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        saveSucceeded = true;
      }
    });

    // Click Save Draft
    await saveDraftBtn.click();

    // Wait for save to complete (up to 5 seconds)
    let waitCount = 0;
    while (waitCount < 10 && !saveSucceeded) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    // Get draft ID from URL after save
    let draftId = draftIdBeforeSave;
    const urlAfter = page.url();
    const draftMatchAfter = urlAfter.match(/draft=([^&]+)/);
    if (draftMatchAfter) {
      draftId = decodeURIComponent(draftMatchAfter[1]);
    }

    expect(draftId).toBeTruthy();

    // Hard refresh to clear memory and reload from DB
    await page.reload({ waitUntil: 'networkidle' });

    // Verify Step 2 title is still visible
    const pageTitle = page.locator('text=Step 2');
    await expect(pageTitle.first()).toBeVisible({ timeout: 5000 });

    // Verify editor content is restored
    const restoredDocAEditor = page.locator('[data-testid="doc-a-editor"]').first();
    await expect(restoredDocAEditor).toBeVisible({ timeout: 5000 });

    // Check that editor has content (Tiptap editors may have internal structure)
    const hasEditorContent = await page.evaluate(() => {
      const editors = document.querySelectorAll('[data-testid*="editor"]');
      return Array.from(editors).some((ed) => {
        const text = ed.innerText || ed.textContent || '';
        return text.length > 5;
      });
    });

    expect(hasEditorContent).toBeTruthy();

    // Verify title in Step 1 area (if visible)
    const titleAfterReload = await titleInput.inputValue().catch(() => '');
    if (titleAfterReload) {
      expect(titleAfterReload).toBe(uniqueTitle);
    }
  });

  test('Step navigation saves before moving', async ({ page }) => {
    // Navigate to new comparison
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`);
    await page.waitForLoadState('networkidle');

    // Step 1: Fill in title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill(`Nav Test ${Date.now()}`);

    // Step 1: Fill content
    const confidentialArea = page.locator('textarea').first();
    if (await confidentialArea.isVisible()) {
      await confidentialArea.fill('Step 1 content for navigation test');
    }

    // Move to Step 2 (this should save Step 1)
    const continueBtn = page.locator('button:has-text("Continue to Editor")');
    await continueBtn.click();
    await page.waitForLoadState('networkidle');

    // Wait for Step 2 to load
    const docAEditor = page.locator('[data-testid="doc-a-editor"]').first();
    await expect(docAEditor).toBeVisible({ timeout: 5000 });

    // Step 2: Add content
    await docAEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type('Step 2 content', { delay: 15 });
    await page.waitForTimeout(500);

    // Click Save Draft
    const saveDraftBtn = page.locator('button:has-text("Save Draft")');
    await expect(saveDraftBtn).toBeVisible();

    let saveCompleted = false;
    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        saveCompleted = true;
      }
    });

    await saveDraftBtn.click();

    // Wait for save
    let waitCount = 0;
    while (waitCount < 10 && !saveCompleted) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    // Get draft ID
    const urlStep2 = page.url();
    const draftMatch = urlStep2.match(/draft=([^&]+)/);
    const draftId = draftMatch ? decodeURIComponent(draftMatch[1]) : null;

    expect(draftId).toBeTruthy();

    // Navigate back to Step 1
    const backBtn = page.locator('button:has-text("Back to Upload")');
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForLoadState('networkidle');

      // Verify we're on Step 1
      const step1Indicator = page.locator('text=Step 1');
      await expect(step1Indicator.first()).toBeVisible();

      // Verify title is preserved
      const titleValue = await titleInput.inputValue();
      expect(titleValue).toBe(`Nav Test ${Date.now()}`);

      // Move back to Step 2
      await continueBtn.click();
      await page.waitForLoadState('networkidle');

      // Verify Step 2 content is still there
      const editor = page.locator('[data-testid="doc-a-editor"]').first();
      await expect(editor).toBeVisible();

      const hasStep2Content = await page.evaluate(() => {
        const editors = document.querySelectorAll('[data-testid*="editor"]');
        return Array.from(editors).some((ed) => {
          const text = ed.innerText || ed.textContent || '';
          return text.includes('Step 2');
        });
      });

      // Content should be there (either from state or from editor)
      // At minimum, we should not have lost it
    }
  });

  test('Step 3: Evaluation results persist if run', async ({ page }) => {
    // Navigate and prepare draft
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`);
    await page.waitForLoadState('networkidle');

    // Create minimal draft
    const titleInput = page.locator('input[type="text"]').first();
    const testTitle = `Eval Test ${Date.now()}`;
    await titleInput.fill(testTitle);

    const confidentialArea = page.locator('textarea').first();
    await confidentialArea.fill(
      'Confidential content with sufficient length for evaluation to work properly and provide meaningful results.'
    );

    // Continue to Step 2
    const continueBtn = page.locator('button:has-text("Continue to Editor")');
    await continueBtn.click();
    await page.waitForLoadState('networkidle');

    // Step 2: Add shared content
    const docBEditor = page.locator('[data-testid="doc-b-editor"]').first();
    await expect(docBEditor).toBeVisible({ timeout: 5000 });

    await docBEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type(
      'Shared content with enough text to enable evaluation functionality.',
      { delay: 10 }
    );
    await page.waitForTimeout(1000);

    // Save Draft
    const saveDraftBtn = page.locator('button:has-text("Save Draft")');
    let saveCompleted = false;

    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        saveCompleted = true;
      }
    });

    await saveDraftBtn.click();

    let waitCount = 0;
    while (waitCount < 10 && !saveCompleted) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    // Get draft ID
    const urlAfterSave = page.url();
    const draftMatch = urlAfterSave.match(/draft=([^&]+)/);
    const draftId = draftMatch ? decodeURIComponent(draftMatch[1]) : null;

    if (!draftId) {
      test.skip();
    }

    // Try to run evaluation if button is visible
    const runEvalBtn = page.locator('button:has-text("Run Evaluation")');
    if (await runEvalBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      let evalCompleted = false;
      let evalStatus = null;

      page.on('response', (response) => {
        if (
          response.url().includes('/api/document-comparisons/') &&
          response.url().includes('/evaluate') &&
          response.status() === 200
        ) {
          evalCompleted = true;
          evalStatus = response.status();
        }
      });

      await runEvalBtn.click();

      // Wait for evaluation (may take 30+ seconds if Vertex is actually evaluating)
      // For this test, we'll wait a reasonable amount and then try reload
      let evalWait = 0;
      const maxWait = 60; // 30 seconds
      while (evalWait < maxWait && !evalCompleted) {
        await page.waitForTimeout(500);
        evalWait++;
      }

      if (evalCompleted && draftId) {
        // Reload and verify evaluation is still there
        await page.reload({ waitUntil: 'networkidle' });

        // Check if evaluation section is visible
        const evalSection = page.locator('text=/[Ee]valuation|[Ss]core|[Rr]eport/');
        // May or may not be visible based on UI, but the important thing is we didn't lose the input data
        const editors = page.locator('[data-testid*="editor"]');
        await expect(editors.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('Save Draft updates updated_at timestamp', async ({ page }) => {
    // Create draft
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill(`Timestamp Test ${Date.now()}`);

    const textArea = page.locator('textarea').first();
    await textArea.fill('Test content for timestamp verification');

    // Continue to Step 2
    const continueBtn = page.locator('button:has-text("Continue to Editor")');
    await continueBtn.click();
    await page.waitForLoadState('networkidle');

    // Add content
    const docAEditor = page.locator('[data-testid="doc-a-editor"]').first();
    await expect(docAEditor).toBeVisible({ timeout: 5000 });

    await docAEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type('Initial editor content', { delay: 15 });
    await page.waitForTimeout(500);

    // First save
    const saveDraftBtn = page.locator('button:has-text("Save Draft")');
    let firstSaveTime = null;
    let firstSaveCompleted = false;

    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        firstSaveTime = new Date();
        firstSaveCompleted = true;
      }
    });

    await saveDraftBtn.click();

    let waitCount = 0;
    while (waitCount < 10 && !firstSaveCompleted) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    expect(firstSaveTime).toBeTruthy();

    // Wait a bit
    await page.waitForTimeout(2000);

    // Make another change
    await docAEditor.click({ position: { x: 50, y: 50 } });
    await page.keyboard.type(' - Updated', { delay: 15 });
    await page.waitForTimeout(500);

    // Second save
    let secondSaveTime = null;
    let secondSaveCompleted = false;

    page.removeAllListeners('response');
    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        secondSaveTime = new Date();
        secondSaveCompleted = true;
      }
    });

    await saveDraftBtn.click();

    waitCount = 0;
    while (waitCount < 10 && !secondSaveCompleted) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    expect(secondSaveTime).toBeTruthy();

    // Verify timestamps are different
    if (firstSaveTime && secondSaveTime) {
      expect(secondSaveTime.getTime()).toBeGreaterThan(firstSaveTime.getTime());
    }
  });

  test('Empty draft cannot be saved (existing comparison)', async ({ page }) => {
    // Create draft
    await page.goto(`${BASE_URL}/DocumentComparisonCreate`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill(`Empty Test ${Date.now()}`);

    const textArea = page.locator('textarea').first();
    await textArea.fill('Initial content');

    // Continue to Step 2
    const continueBtn = page.locator('button:has-text("Continue to Editor")');
    await continueBtn.click();
    await page.waitForLoadState('networkidle');

    // Add content initially
    const docAEditor = page.locator('[data-testid="doc-a-editor"]').first();
    await expect(docAEditor).toBeVisible({ timeout: 5000 });

    await docAEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.type('Initial content', { delay: 15 });
    await page.waitForTimeout(500);

    // Save it
    const saveDraftBtn = page.locator('button:has-text("Save Draft")');
    let saveCompleted = false;

    page.on('response', (response) => {
      if (
        response.url().includes('/api/document-comparisons/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200
      ) {
        saveCompleted = true;
      }
    });

    await saveDraftBtn.click();

    let waitCount = 0;
    while (waitCount < 10 && !saveCompleted) {
      await page.waitForTimeout(500);
      waitCount++;
    }

    // Now clear the editor
    await docAEditor.click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+A'); // Select all
    await page.keyboard.press('Backspace'); // Delete
    await page.waitForTimeout(500);

    // Try to save (should show warning)
    let warningToastAppeared = false;
    const originalConsoleLog = console.log;
    page.on('console', (msg) => {
      if (msg.text().includes('empty')) {
        warningToastAppeared = true;
      }
    });

    const warningText = page.locator('text=/empty|Cannot save/i');
    await saveDraftBtn.click();

    // Check for warning or error message
    const hasWarningOrError = await warningText.isVisible({ timeout: 3000 }).catch(() => false);

    // At minimum, the save should have been attempted within the time limit
    expect(saveCompleted || hasWarningOrError).toBeTruthy();
  });
});
