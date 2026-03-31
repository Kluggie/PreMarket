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

test('opportunities row badges/icons and shared-report banner are wired to the shared thread-status resolver', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');
  const sharedReportPage = readRepoFile('src/pages/SharedReport.jsx');

  assert.match(proposalsPage, /getProposalThreadUiState/);
  assert.match(proposalsPage, /function resolvePrimaryStatus\(proposal\)/);
  assert.match(proposalsPage, /const threadState = getProposalThreadUiState\(proposal\)/);
  assert.match(proposalsPage, /function getRowIcon\(proposal\)/);

  assert.match(sharedReportPage, /buildSharedReportStatusBanner/);
  assert.match(sharedReportPage, /const sharedReportStatusBanner = useMemo/);
  assert.match(sharedReportPage, /<AlertDescription>\{sharedReportStatusBanner\.text\}<\/AlertDescription>/);

  assert.doesNotMatch(
    sharedReportPage,
    /Boolean\(latestSentRevision && asText\(latestSentRevision\.status\)\.toLowerCase\(\) === 'sent'\) && !hasActiveDraft/,
  );
});
