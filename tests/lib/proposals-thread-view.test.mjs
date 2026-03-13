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
});

test('proposals page keeps inbox sub-filters, latest-version badge, and updated empty states', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');

  assert.match(proposalsPage, /Needs Your Response/);
  assert.match(proposalsPage, /Waiting on Other Party/);
  assert.match(proposalsPage, /Win Confirmation Requested/);
  assert.match(proposalsPage, /Latest Version/);

  assert.match(proposalsPage, /No draft proposals yet\./);
  assert.match(proposalsPage, /Create your first proposal to get started\./);
  assert.match(proposalsPage, /No active proposals in your inbox\./);
  assert.match(proposalsPage, /Sent and received negotiation threads will appear here\./);
  assert.match(proposalsPage, /No closed proposals yet\./);
  assert.match(proposalsPage, /No archived proposals\./);
});
