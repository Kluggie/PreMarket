import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SHARED_REPORT_PAGE_PATH = path.resolve(
  process.cwd(),
  'src/pages/SharedReport.jsx',
);

test('shared report Step 0 metadata card uses a single unified 2-column grid with Sent-by/Status on left and Sent-to/Downloads on right', async () => {
  const source = await readFile(SHARED_REPORT_PAGE_PATH, 'utf8');

  assert.ok(
    !source.includes('OpportunityActionGroups'),
    'Step 0 card should not rely on detached action-group layout helper for this alignment-critical block',
  );

  const cardAnchor = source.indexOf('<CardContent className="pt-0 space-y-4">');
  assert.ok(cardAnchor >= 0, 'Expected shared metadata card content block');

  // The step-0 branch must open a single unified grid that wraps all four sections.
  // The grid class is expected to be the first grid encountered after the card anchor
  // inside the step===0 ternary.
  const step0BranchIndex = source.indexOf('step === 0', cardAnchor);
  assert.ok(step0BranchIndex >= 0, 'Expected step===0 conditional inside card content');

  const unifiedGridIndex = source.indexOf('grid gap-6 sm:grid-cols-2', step0BranchIndex);
  assert.ok(
    unifiedGridIndex >= 0,
    'Expected a single unified "grid gap-6 sm:grid-cols-2" wrapper for the step-0 card layout',
  );

  // Left column must contain Sent by then Status (in that order, as they both
  // appear inside the left column div before the right column div opens).
  const sentByIndex = source.indexOf('Sent by', unifiedGridIndex);
  const statusLabelIndex = source.indexOf('Status', unifiedGridIndex);
  const sentToIndex = source.indexOf('Sent to', unifiedGridIndex);
  const downloadsLabelIndex = source.indexOf('Downloads', unifiedGridIndex);

  assert.ok(sentByIndex >= 0, 'Expected Sent by label in unified grid');
  assert.ok(statusLabelIndex >= 0, 'Expected Status block in unified grid');
  assert.ok(sentToIndex >= 0, 'Expected Sent to label in unified grid');
  assert.ok(downloadsLabelIndex >= 0, 'Expected Downloads block in unified grid');

  // Left column ordering: Sent by < Status < Sent to (right column starts after)
  assert.ok(sentByIndex < statusLabelIndex, 'Sent by must appear before Status in the left column');
  assert.ok(statusLabelIndex < sentToIndex, 'Status must appear before Sent to (right column)');
  assert.ok(sentToIndex < downloadsLabelIndex, 'Sent to must appear before Downloads in document order');

  // Action button groups must be co-located in the same unified grid
  const statusButtonsIndex = source.indexOf('renderActionButtons(step0StatusActions)', unifiedGridIndex);
  const downloadButtonsIndex = source.indexOf('renderActionButtons(step0DownloadActions)', unifiedGridIndex);
  assert.ok(statusButtonsIndex >= 0, 'Expected status actions in left column of unified grid');
  assert.ok(downloadButtonsIndex >= 0, 'Expected download actions in right column of unified grid');
  assert.ok(statusButtonsIndex < downloadButtonsIndex, 'Status actions must appear before download actions in document order');

  // Confirm there is NO separate border-t / pt-4 wrapper div that would split
  // the bottom row into its own detached grid (the old two-grid approach).
  const borderTIndex = source.indexOf('border-t border-slate-200 pt-4', unifiedGridIndex);
  assert.ok(
    borderTIndex < 0 || borderTIndex > downloadsLabelIndex,
    'The Downloads section must not be inside a separate border-t wrapper that would detach it from the Sent-to column',
  );
});
