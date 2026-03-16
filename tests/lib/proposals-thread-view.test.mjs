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

test('proposals page keeps row-level tags and a compact actionable status dropdown without inbox chips', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');

  assert.match(proposalsPage, /All states/);
  assert.match(proposalsPage, /Needs Reply/);
  assert.match(proposalsPage, /Waiting/);
  assert.match(proposalsPage, /Pending Win/);

  assert.match(proposalsPage, /Sent/);
  assert.match(proposalsPage, /Received/);
  assert.match(proposalsPage, /Under Review/);
  assert.match(proposalsPage, /AI Review/);
  assert.match(proposalsPage, /Mutual Interest/);
  assert.match(proposalsPage, /Won/);
  assert.match(proposalsPage, /Lost/);

  assert.doesNotMatch(proposalsPage, /Needs Your Response/);
  assert.doesNotMatch(proposalsPage, /Waiting on Other Party/);
  assert.doesNotMatch(proposalsPage, /Win Confirmation Requested/);
  assert.doesNotMatch(proposalsPage, /handleInboxFilterChange/);
  assert.doesNotMatch(proposalsPage, /normalizedInboxFilter/);
  assert.doesNotMatch(proposalsPage, /activeTab === 'inbox' \? \(/);
});
