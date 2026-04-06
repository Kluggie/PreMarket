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

test('Review surfaces stay stage-aware across proposer-only and bilateral flows', () => {
  const files = {
    copyHelpers: readRepoFile('src/lib/aiReportUtils.js'),
    step3Package: readRepoFile('src/components/document-comparison/Step3ReviewPackage.jsx'),
    comparisonTabs: readRepoFile('src/components/document-comparison/ComparisonDetailTabs.jsx'),
    proposalDetail: readRepoFile('src/pages/ProposalDetail.jsx'),
    comparisonDetail: readRepoFile('src/pages/DocumentComparisonDetail.jsx'),
    sharedReport: readRepoFile('src/pages/SharedReport.jsx'),
    comparisonPdfRoute: readRepoFile('server/routes/document-comparisons/[id]/download-pdf.ts'),
    sharedPdfRoute: readRepoFile('server/routes/shared-report/[token]/download-pdf.ts'),
  };

  assert.match(files.copyHelpers, /Run AI Mediation/);
  assert.match(files.copyHelpers, /Run Shared Intake Summary/);
  assert.match(files.step3Package, /RUN_AI_MEDIATION_LABEL/);
  assert.match(files.comparisonTabs, /AI Mediation Review in progress/);
  assert.match(files.comparisonTabs, /reviewLabel\} in progress/);
  assert.match(files.comparisonTabs, /Based only on the currently submitted materials/);
  assert.match(files.comparisonTabs, /Open Questions/);
  assert.match(files.proposalDetail, /Download \$\{reviewLabel\} JSON/);
  assert.match(files.comparisonDetail, /No \$\{reviewLabel\} yet/);
  assert.match(files.sharedReport, /baselineReviewLabelForDownloads/);
  assert.match(files.sharedReport, /label: `\$\{baselineReviewLabelForDownloads\} PDF`/);
  assert.match(files.sharedReport, /Step 3: \$\{MEDIATION_REVIEW_LABEL\}/);
  assert.match(files.comparisonPdfRoute, /MEDIATION_REVIEW_TITLE/);
  assert.match(files.comparisonPdfRoute, /PRE_SEND_REVIEW_TITLE/);
  assert.match(files.comparisonPdfRoute, /Submission Summary/);
  assert.match(files.comparisonPdfRoute, /Open Questions/);
  assert.match(files.comparisonPdfRoute, /Review Type/);
  assert.match(files.comparisonPdfRoute, /One side's materials|current submitted materials/);
  assert.match(files.comparisonPdfRoute, /Shared Intake Scope/);
  assert.match(files.comparisonPdfRoute, /Missing or Redacted Information/);
  assert.match(files.sharedPdfRoute, /PRE_SEND_REVIEW_TITLE/);
  assert.match(files.sharedPdfRoute, /Submission Summary/);
  assert.match(files.sharedPdfRoute, /Open Questions/);
  assert.match(files.sharedPdfRoute, /Review Type/);
  assert.match(files.sharedPdfRoute, /One side's materials|current submitted materials/);
  assert.match(files.sharedPdfRoute, /Shared Intake Scope/);
  assert.match(files.sharedPdfRoute, /Missing or Redacted Information/);

  const proposerOnlySurfaces = [
    files.copyHelpers,
    files.comparisonTabs,
    files.comparisonPdfRoute,
    files.sharedPdfRoute,
  ].join('\n');
  const combined = Object.values(files).join('\n');
  assert.match(proposerOnlySurfaces, /Shared Intake Summary/);
  assert.match(proposerOnlySurfaces, /Based only on the currently submitted materials/);
  assert.doesNotMatch(proposerOnlySurfaces, /\bPre-send Review\b/);
  assert.doesNotMatch(proposerOnlySurfaces, /\bInitial Review\b/);
  assert.doesNotMatch(proposerOnlySurfaces, /\bsender-side\b/i);
  assert.doesNotMatch(proposerOnlySurfaces, /\bbefore sending\b/i);
  assert.doesNotMatch(combined, /\bAI Report\b/);
  assert.doesNotMatch(combined, /\bRun Evaluation\b/);
  assert.doesNotMatch(combined, /\bRe-run Evaluation\b/);
});
