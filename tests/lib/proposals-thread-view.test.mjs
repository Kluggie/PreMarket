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

test('proposals page uses Inbox/Drafts/Closed/Archived as the top-level tabs', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');

  assert.match(proposalsPage, /TabsTrigger value="inbox"/);
  assert.match(proposalsPage, /TabsTrigger value="drafts"/);
  assert.match(proposalsPage, /TabsTrigger value="closed"/);
  assert.match(proposalsPage, /TabsTrigger value="archived"/);

  assert.doesNotMatch(proposalsPage, /TabsTrigger value="all"/);
  assert.doesNotMatch(proposalsPage, /TabsTrigger value="sent"/);
  assert.doesNotMatch(proposalsPage, /TabsTrigger value="received"/);
  assert.doesNotMatch(proposalsPage, /TabsTrigger value="mutual_interest"/);
  assert.match(proposalsPage, /Manage live opportunity threads across inbox, drafts, closed, and archived\./);
});

test('proposals page uses one canonical primary status chip and simplified filter labels', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');
  const threadContextUi = readRepoFile('src/lib/proposalThreadContextUi.js');

  assert.match(proposalsPage, /All states/);
  assert.match(proposalsPage, /All origins/);
  assert.match(proposalsPage, /Started by you/);
  assert.match(proposalsPage, /Started by counterparty/);
  assert.match(threadContextUi, /Our proposal/);
  assert.match(threadContextUi, /Their proposal/);
  assert.match(threadContextUi, /exchange/);
  assert.match(proposalsPage, /PrimaryStatusBadge/);
  assert.match(proposalsPage, /Needs Reply/);
  assert.match(proposalsPage, /Under Review/);
  assert.match(proposalsPage, /Waiting on Counterparty/);
  assert.match(proposalsPage, /Pending Win Confirmation/);
  assert.match(proposalsPage, /Closed: Won/);
  assert.match(proposalsPage, /Closed: Lost/);

  assert.doesNotMatch(proposalsPage, /DirectionBadge/);
  assert.doesNotMatch(proposalsPage, /ReviewBadge/);
  assert.doesNotMatch(proposalsPage, /MutualInterestBadge/);
  assert.doesNotMatch(proposalsPage, /Link \{sharedReportStatus/);
  assert.doesNotMatch(proposalsPage, /Waiting on Other Party/);
  assert.doesNotMatch(proposalsPage, /proposal\.template_name \|\| 'Custom Template'/);
  assert.doesNotMatch(threadContextUi, /Started by/);
  assert.doesNotMatch(threadContextUi, /Last update from/);
});
