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

test('Step 3 mediation surfaces use mediation-oriented terminology', () => {
  const files = {
    copyHelpers: readRepoFile('src/lib/aiReportUtils.js'),
    step3Package: readRepoFile('src/components/document-comparison/Step3ReviewPackage.jsx'),
    comparisonTabs: readRepoFile('src/components/document-comparison/ComparisonDetailTabs.jsx'),
    proposalDetail: readRepoFile('src/pages/ProposalDetail.jsx'),
    comparisonDetail: readRepoFile('src/pages/DocumentComparisonDetail.jsx'),
    sharedReport: readRepoFile('src/pages/SharedReport.jsx'),
    comparisonPdfRoute: readRepoFile('server/routes/document-comparisons/[id]/download-pdf.ts'),
  };

  assert.match(files.copyHelpers, /Run AI Mediation/);
  assert.match(files.step3Package, /RUN_AI_MEDIATION_LABEL/);
  assert.match(files.comparisonTabs, /MEDIATION_REVIEW_LABEL/);
  assert.match(files.comparisonTabs, /Open Questions/);
  assert.match(files.proposalDetail, /Download AI Mediation Review PDF/);
  assert.match(files.proposalDetail, /Download AI Mediation Review JSON/);
  assert.match(files.comparisonDetail, /Run AI Mediation to generate it/);
  assert.match(files.sharedReport, /Download AI Mediation Review PDF/);
  assert.match(files.sharedReport, /Step 3: \$\{MEDIATION_REVIEW_LABEL\}/);
  assert.match(files.comparisonPdfRoute, /MEDIATION_REVIEW_TITLE/);

  const combined = Object.values(files).join('\n');
  assert.doesNotMatch(combined, /\bAI Report\b/);
  assert.doesNotMatch(combined, /\bRun Evaluation\b/);
  assert.doesNotMatch(combined, /\bRe-run Evaluation\b/);
});
