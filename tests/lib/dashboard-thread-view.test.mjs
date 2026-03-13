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

test('dashboard primary proposal stats use Inbox/Drafts/Closed/Archived', () => {
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');

  assert.match(dashboard, /label: 'Inbox'/);
  assert.match(dashboard, /label: 'Drafts'/);
  assert.match(dashboard, /label: 'Closed'/);
  assert.match(dashboard, /label: 'Archived'/);
  assert.match(dashboard, /summary\?\.inboxCount/);
  assert.match(dashboard, /summary\?\.draftsCount/);
  assert.match(dashboard, /summary\?\.closedCount/);
  assert.match(dashboard, /summary\?\.archivedCount/);

  assert.doesNotMatch(dashboard, /label: 'Proposals Sent'/);
  assert.doesNotMatch(dashboard, /label: 'Proposals Received'/);
  assert.doesNotMatch(dashboard, /summary\?\.sentCount/);
  assert.doesNotMatch(dashboard, /summary\?\.receivedCount/);
  assert.doesNotMatch(dashboard, /summary\?\.mutualInterestCount/);
});

test('dashboard action area keeps Inbox routing and removes mutual-interest action buckets', () => {
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');

  assert.match(dashboard, /Needs your response/);
  assert.match(dashboard, /Drafts not sent/);
  assert.match(dashboard, /Waiting on other party/);
  assert.match(dashboard, /Needs review \/ verify/);
  assert.match(dashboard, /Proposals\?tab=inbox&inbox=win_confirmation_requested/);
  assert.doesNotMatch(dashboard, /Mutual interest ready/);
});

test('dashboard chart uses thread-based activity labels and empty-state copy', () => {
  const chart = readRepoFile('src/components/dashboard/ProposalsChart.jsx');

  assert.match(chart, /Thread Activity/);
  assert.match(chart, /New Threads/);
  assert.match(chart, /Active Rounds/);
  assert.match(chart, /Threads Closed/);
  assert.match(chart, /Threads Archived/);
  assert.match(chart, /No proposal activity yet\./);
  assert.match(chart, /New threads, live negotiation rounds, closures, and archived activity will appear here\./);

  assert.doesNotMatch(chart, /No sent proposal activity yet\./);
  assert.doesNotMatch(chart, /Mutual Interest/);
});
