import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SHARED_REPORT_PAGE_PATH = path.resolve(
  process.cwd(),
  'src/pages/SharedReport.jsx',
);

test('shared report Step 0 metadata card keeps sent-by/status and sent-to/downloads in the same 2-column grid structure', async () => {
  const source = await readFile(SHARED_REPORT_PAGE_PATH, 'utf8');

  assert.ok(
    !source.includes('OpportunityActionGroups'),
    'Step 0 card should not rely on detached action-group layout helper for this alignment-critical block',
  );

  const cardAnchor = source.indexOf('<CardContent className="pt-0 space-y-4">');
  assert.ok(cardAnchor >= 0, 'Expected shared metadata card content block');

  const sentByIndex = source.indexOf('Sent by', cardAnchor);
  const sentToIndex = source.indexOf('Sent to', cardAnchor);
  const bottomGridIndex = source.indexOf('grid gap-4 sm:grid-cols-2 sm:gap-6', sentToIndex);
  const statusLabelIndex = source.indexOf('Status', bottomGridIndex);
  const downloadsLabelIndex = source.indexOf('Downloads', bottomGridIndex);

  assert.ok(sentByIndex >= 0, 'Expected Sent by label in metadata card');
  assert.ok(sentToIndex >= 0, 'Expected Sent to label in metadata card');
  assert.ok(bottomGridIndex >= 0, 'Expected explicit 2-column grid for bottom status/downloads row');
  assert.ok(statusLabelIndex >= 0, 'Expected Status block inside bottom 2-column grid');
  assert.ok(downloadsLabelIndex >= 0, 'Expected Downloads block inside bottom 2-column grid');

  const statusButtonsIndex = source.indexOf('renderActionButtons(step0StatusActions)', bottomGridIndex);
  const downloadButtonsIndex = source.indexOf('renderActionButtons(step0DownloadActions)', bottomGridIndex);
  assert.ok(statusButtonsIndex >= 0, 'Expected status actions in left bottom column');
  assert.ok(downloadButtonsIndex >= 0, 'Expected download actions in right bottom column');
  assert.ok(statusButtonsIndex < downloadButtonsIndex, 'Expected left column actions before right column actions');
});
