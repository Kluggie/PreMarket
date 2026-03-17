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

test('proposal detail defaults to the live proposal tab and exposes a version history tab', () => {
  const proposalDetail = readRepoFile('src/pages/ProposalDetail.jsx');

  assert.match(proposalDetail, /const \[activeTab, setActiveTab\] = useState\('proposal'\);/);
  assert.match(proposalDetail, /TabsTrigger value="proposal"/);
  assert.match(proposalDetail, /TabsTrigger value="history"/);
  assert.match(proposalDetail, /Version History/);
  assert.match(proposalDetail, /Latest first\. Historical versions stay read-only\./);
});

test('proposal detail keeps historical versions read-only while the live version remains editable', () => {
  const proposalDetail = readRepoFile('src/pages/ProposalDetail.jsx');

  assert.match(proposalDetail, /Historical versions are read-only\./);
  assert.match(proposalDetail, /disabled=\{isClosed \|\| viewingHistoricalVersion\}/);
  assert.match(proposalDetail, /shareMutation\.isPending[\s\S]*isClosed[\s\S]*viewingHistoricalVersion/);
  assert.match(proposalDetail, /switch back to the latest version to edit or share the live proposal/i);
  assert.match(proposalDetail, /Read-only snapshot/);
});
