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

function extractTabsContentBlock(source, value) {
  const match = source.match(new RegExp(`<TabsContent value="${value}"[\\s\\S]*?<\\/TabsContent>`));
  assert.ok(match, `Expected to find TabsContent block for "${value}"`);
  return match[0];
}

test('proposal detail keeps outcome actions on the overview shell and out of the proposal tab', () => {
  const proposalDetail = readRepoFile('src/pages/ProposalDetail.jsx');
  const reportTab = extractTabsContentBlock(proposalDetail, 'report');
  const proposalTab = extractTabsContentBlock(proposalDetail, 'proposal');

  assert.match(reportTab, /Outcome row/);
  assert.match(reportTab, /getAgreementActionLabel\(outcome\)/);
  assert.match(reportTab, /CONTINUE_NEGOTIATING_LABEL/);
  assert.match(reportTab, /Mark as Lost/);
  assert.match(proposalDetail, /RequestAgreementConfirmDialog/);
  assert.match(proposalDetail, /shouldConfirmRequestAgreement\(outcome\)/);
  assert.match(reportTab, /!isClosed \?\s*\(/);

  assert.doesNotMatch(proposalTab, /getAgreementActionLabel\(outcome\)/);
  assert.doesNotMatch(proposalTab, /Mark as Lost/);
  assert.doesNotMatch(proposalTab, /Continue Negotiating/);
  assert.doesNotMatch(proposalTab, /Confirm Agreement/);
  assert.doesNotMatch(proposalTab, /Request Agreement/);
});

test('step-editing screens do not render proposal outcome controls', () => {
  const stepFiles = [
    'src/pages/RecipientEditStep2.jsx',
    'src/pages/RecipientEditStep3.jsx',
    'src/components/document-comparison/Step1AddSources.jsx',
    'src/components/document-comparison/Step2EditSources.jsx',
    'src/components/document-comparison/ComparisonEvaluationStep.jsx',
  ].map((relativePath) => readRepoFile(relativePath));

  const combined = stepFiles.join('\n');
  assert.doesNotMatch(combined, /Mark as Lost/);
  assert.doesNotMatch(combined, /Continue Negotiating/);
  assert.doesNotMatch(combined, /Confirm Agreement/);
  assert.doesNotMatch(combined, /Request Agreement/);
  assert.doesNotMatch(combined, /getAgreementActionLabel/);
});

test('step 1 add-sources includes counterparty name input and removes legacy untitled helper copy', () => {
  const step1AddSources = readRepoFile('src/components/document-comparison/Step1AddSources.jsx');

  assert.match(step1AddSources, /Comparison Title/);
  assert.match(step1AddSources, /Counterparty Name/);
  assert.match(step1AddSources, /data-testid="counterparty-name-input"/);
  assert.doesNotMatch(step1AddSources, /Optional — saves as "Untitled" if left blank\./);
});

test('shared report step 0 keeps opportunity closure controls on the overview shell', () => {
  const sharedReport = readRepoFile('src/pages/SharedReport.jsx');

  assert.match(sharedReport, /STEP 0 — Baseline overview/);
  assert.match(sharedReport, /getAgreementActionLabel\(parentOutcome\)/);
  assert.match(sharedReport, /CONTINUE_NEGOTIATING_LABEL/);
  assert.match(sharedReport, /Mark as Lost/);
  assert.match(sharedReport, /RequestAgreementConfirmDialog/);
  assert.match(sharedReport, /shouldConfirmRequestAgreement\(parentOutcome\)/);
});

test('document comparison detail keeps agreement controls on the overview shell with confirmation-first request flow', () => {
  const comparisonDetail = readRepoFile('src/pages/DocumentComparisonDetail.jsx');

  assert.match(comparisonDetail, /getAgreementActionLabel\(proposalOutcome\)/);
  assert.match(comparisonDetail, /CONTINUE_NEGOTIATING_LABEL/);
  assert.match(comparisonDetail, /Mark as Lost/);
  assert.match(comparisonDetail, /RequestAgreementConfirmDialog/);
  assert.match(comparisonDetail, /shouldConfirmRequestAgreement\(proposalOutcome\)/);
});

test('proposal list row menu keeps proposal-level outcome actions', () => {
  const proposalsPage = readRepoFile('src/pages/Proposals.jsx');

  assert.match(proposalsPage, /<DropdownMenuContent align="end" className="w-56">/);
  assert.match(proposalsPage, /getAgreementActionLabel\(outcome\)/);
  assert.match(proposalsPage, /CONTINUE_NEGOTIATING_LABEL/);
  assert.match(proposalsPage, /Mark as Lost/);
  assert.match(proposalsPage, /RequestAgreementConfirmDialog/);
  assert.match(proposalsPage, /shouldConfirmRequestAgreement\(outcome\)/);
  assert.match(proposalsPage, /Archive/);
  assert.match(proposalsPage, /Delete/);
});
