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

test('proposal outcome user-facing copy stays on agreement terminology', () => {
  const files = {
    helpers: readRepoFile('src/lib/proposalOutcomeUi.js'),
    confirmationDialog: readRepoFile('src/components/proposal/RequestAgreementConfirmDialog.jsx'),
    proposalDetail: readRepoFile('src/pages/ProposalDetail.jsx'),
    proposals: readRepoFile('src/pages/Proposals.jsx'),
    dashboard: readRepoFile('src/pages/Dashboard.jsx'),
    notifications: readRepoFile('server/routes/proposals/[id]/outcome.ts'),
  };

  const combined = Object.values(files).join('\n');

  assert.match(files.helpers, /Agreement Requested/);
  assert.match(files.helpers, /Request Agreement/);
  assert.match(files.helpers, /Confirm Agreement/);
  assert.match(files.helpers, /Continue Negotiating/);
  assert.match(files.helpers, /Agreed/);
  assert.match(files.confirmationDialog, /Request agreement\?/);
  assert.match(files.confirmationDialog, /action cannot be undone\./i);
  assert.match(files.notifications, /Agreement Requested/);
  assert.match(files.notifications, /Agreed/);
  assert.match(files.notifications, /Continue Negotiating/);

  assert.doesNotMatch(combined, /Confirm Terms/);
  assert.doesNotMatch(combined, /Terms agreed/);
  assert.doesNotMatch(combined, /Mark as Won/);
  assert.doesNotMatch(combined, /Confirm Win/);
  assert.doesNotMatch(combined, /Outcome action must be "won", "lost", or "continue"\./);
});
