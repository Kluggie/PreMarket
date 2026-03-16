import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('dashboard restores the old proposal metric row instead of inbox bucket cards', () => {
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');

  assert.match(dashboard, /label: 'Sent'/);
  assert.match(dashboard, /label: 'Received'/);
  assert.match(dashboard, /label: 'Mutual Interest'/);
  assert.match(dashboard, /const DASHBOARD_WON_LABEL = 'Won'/);
  assert.match(dashboard, /label: DASHBOARD_WON_LABEL/);
  assert.match(dashboard, /label: 'Lost'/);
  assert.match(dashboard, /summary\?\.sentCount/);
  assert.match(dashboard, /summary\?\.receivedCount/);
  assert.match(dashboard, /summary\?\.mutualInterestCount/);
  assert.match(dashboard, /summary\?\.wonCount/);
  assert.match(dashboard, /summary\?\.lostCount/);
  assert.match(dashboard, /md:grid-cols-5/);

  assert.doesNotMatch(dashboard, /label: 'Inbox'/);
  assert.doesNotMatch(dashboard, /label: 'Drafts'/);
  assert.doesNotMatch(dashboard, /label: 'Archived'/);
  assert.doesNotMatch(dashboard, /summary\?\.inboxCount/);
  assert.doesNotMatch(dashboard, /summary\?\.draftsCount/);
  assert.doesNotMatch(dashboard, /summary\?\.closedCount/);
  assert.doesNotMatch(dashboard, /summary\?\.archivedCount/);
  assert.doesNotMatch(dashboard, /Outcome Snapshot/);
});

test('dashboard keeps action buckets but drops inbox-only routing and mutual-interest action cards', () => {
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');

  assert.match(dashboard, /Needs your response/);
  assert.match(dashboard, /Drafts not sent/);
  assert.match(dashboard, /Waiting on other party/);
  assert.match(dashboard, /Needs review \/ verify/);
  assert.match(dashboard, /Opportunities\?tab=all&status=win_confirmation_requested/);

  assert.doesNotMatch(dashboard, /Mutual interest ready/);
  assert.doesNotMatch(dashboard, /Opportunities\?tab=inbox&inbox=win_confirmation_requested/);
});

test('dashboard chart returns to the visible legacy metric story', () => {
  const chart = readRepoFile('src/components/dashboard/ProposalsChart.jsx');

  assert.match(chart, /Opportunities Activity/);
  assert.match(chart, /Sent/);
  assert.match(chart, /Received/);
  assert.match(chart, /Mutual Interest/);
  assert.match(chart, /Won/);
  assert.match(chart, /Lost/);
  assert.match(chart, /Create your first opportunity to see analytics\./);

  assert.doesNotMatch(chart, /Thread Activity/);
  assert.doesNotMatch(chart, /New Threads/);
  assert.doesNotMatch(chart, /Active Rounds/);
  assert.doesNotMatch(chart, /Threads Closed/);
  assert.doesNotMatch(chart, /Threads Archived/);
});
