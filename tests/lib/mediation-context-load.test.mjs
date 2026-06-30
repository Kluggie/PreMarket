import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildBundleOnlyContextEstimate,
  buildMediationContextEstimate,
  MEDIATION_CONTEXT_CHARS_PER_TOKEN,
  MEDIATION_PROMPT_OVERHEAD_BASE_TOKENS,
  MEDIATION_REVIEW_EFFECTIVE_INPUT_BUDGET_TOKENS,
} from '../../src/lib/mediationContextLoad.js';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  PROMPT_TOKEN_HARD_CEILING,
} from '../../server/_lib/evaluation-context-budget.ts';

const step3PackageSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/document-comparison/Step3ReviewPackage.jsx'),
  'utf8',
);
const sharedReportWorkspaceSource = readFileSync(
  path.resolve(process.cwd(), 'server/routes/shared-report/[token].ts'),
  'utf8',
);
const sharedReportEvaluateSource = readFileSync(
  path.resolve(process.cwd(), 'server/routes/shared-report/[token]/evaluate.ts'),
  'utf8',
);

test('shared context estimator keeps token heuristics aligned with the evaluator budget helpers', () => {
  assert.equal(MEDIATION_CONTEXT_CHARS_PER_TOKEN, CHARS_PER_TOKEN_ESTIMATE);
  assert.equal(MEDIATION_REVIEW_EFFECTIVE_INPUT_BUDGET_TOKENS, PROMPT_TOKEN_HARD_CEILING);
});

test('single short first-round proposal remains Very Light', () => {
  const estimate = buildBundleOnlyContextEstimate({
    sharedText: 'Pilot summary with scope, timing, and referral ownership.',
    confidentialText: 'Internal note: pricing flexibility exists within the current range.',
  });

  assert.equal(estimate.capacityLabel, 'Very Light');
  assert.equal(estimate.initialProposalContextIncluded, false);
  assert.equal(estimate.priorRoundsConsidered, 0);
  assert.equal(estimate.includedPriorRounds, 0);
  assert.equal(estimate.previousReviewsConsidered, 0);
  assert.equal(estimate.retrievedChunkCount, 0);
  assert.equal(estimate.omittedDueToCapacityCount, 0);
});

test('baseline context is tracked separately from post-baseline prior rounds', () => {
  const estimate = buildMediationContextEstimate({
    visibleSharedText: 'Initial proposer package with scope and milestones.',
    visibleConfidentialText: 'Recipient private note for the current turn.',
    directSharedText: 'Initial proposer package with scope and milestones.',
    directConfidentialText: 'Recipient private note for the current turn.',
    initialProposalContextIncluded: true,
    priorRoundsConsidered: 0,
    previousReviewsConsidered: 0,
  });

  assert.equal(estimate.initialProposalContextIncluded, true);
  assert.equal(estimate.priorRoundsConsidered, 0);
  assert.equal(estimate.includedPriorRounds, 0);
  assert.equal(estimate.previousReviewsConsidered, 0);
  assert.equal(estimate.promptOverheadTokens, MEDIATION_PROMPT_OVERHEAD_BASE_TOKENS);
});

test('later-round load does not rely only on the visible current bundle size', () => {
  const firstRound = buildBundleOnlyContextEstimate({
    sharedText: 'Shared pilot summary with scope and timing.',
    confidentialText: 'Private commercial fallback note.',
  });
  const laterRound = buildMediationContextEstimate({
    visibleSharedText: 'Round 4 delta: parties narrowed approval ownership and acceptance timing.',
    visibleConfidentialText: 'Round 4 internal note keeps one fallback position private.',
    directSharedTokens: 180,
    directConfidentialTokens: 140,
    priorRoundTokens: 1_150,
    retrievedChunkCount: 6,
    retrievedContextTokens: 720,
    summaryMemoryTokens: 360,
    promptOverheadTokens: 900,
    initialProposalContextIncluded: true,
    priorRoundsConsidered: 4,
    previousReviewsConsidered: 3,
    estimatorMode: 'test_later_round',
  });

  assert.equal(firstRound.capacityLabel, 'Very Light');
  assert.notEqual(laterRound.capacityLabel, 'Very Light');
  assert.equal(laterRound.capacityLabel, 'Light');
  assert.equal(laterRound.currentBundleEstimatedTokens < laterRound.totalEstimatedInputTokens, true);
  assert.equal(laterRound.initialProposalContextIncluded, true);
  assert.equal(laterRound.priorRoundsConsidered, 4);
  assert.equal(laterRound.includedPriorRounds, 4);
  assert.equal(laterRound.previousReviewsConsidered, 3);
});

test('prior-round summaries increase estimated context load', () => {
  const withoutSummary = buildMediationContextEstimate({
    visibleSharedText: 'Current shared update.',
    visibleConfidentialText: 'Current private note.',
    directSharedText: 'Current shared update.',
    directConfidentialText: 'Current private note.',
  });
  const withSummary = buildMediationContextEstimate({
    visibleSharedText: 'Current shared update.',
    visibleConfidentialText: 'Current private note.',
    directSharedText: 'Current shared update.',
    directConfidentialText: 'Current private note.',
    summaryMemoryText: 'Prior round summary: attribution remains open; approval rights narrowed.',
    priorRoundsConsidered: 2,
    previousReviewsConsidered: 1,
  });

  assert.equal(withSummary.summaryMemoryTokens > withoutSummary.summaryMemoryTokens, true);
  assert.equal(withSummary.totalEstimatedInputTokens > withoutSummary.totalEstimatedInputTokens, true);
});

test('retrieved history chunks increase estimated context load', () => {
  const withoutRetrieval = buildMediationContextEstimate({
    visibleSharedText: 'Current shared update.',
    visibleConfidentialText: 'Current private note.',
    directSharedText: 'Current shared update.',
    directConfidentialText: 'Current private note.',
  });
  const withRetrieval = buildMediationContextEstimate({
    visibleSharedText: 'Current shared update.',
    visibleConfidentialText: 'Current private note.',
    directSharedText: 'Current shared update.',
    directConfidentialText: 'Current private note.',
    retrievedChunkCount: 5,
    retrievedContextTokens: 640,
  });

  assert.equal(withRetrieval.retrievedChunkCount, 5);
  assert.equal(withRetrieval.totalEstimatedInputTokens > withoutRetrieval.totalEstimatedInputTokens, true);
});

test('omissions are surfaced explicitly when capacity trimming is expected', () => {
  const estimate = buildMediationContextEstimate({
    visibleSharedText: 'Current shared update.',
    visibleConfidentialText: 'Current private note.',
    directSharedText: 'Current shared update.',
    directConfidentialText: 'Current private note.',
    omittedDueToCapacity: [
      '1 retrieved chunk omitted',
      '480 confidential chars trimmed',
    ],
  });

  assert.equal(estimate.omittedDueToCapacityCount, 2);
  assert.match(estimate.omittedDueToCapacity.join(' | '), /retrieved chunk omitted/);
  assert.match(estimate.omittedDueToCapacity.join(' | '), /confidential chars trimmed/);
});

test('Step 3 UI distinguishes baseline proposal context from post-baseline history', () => {
  assert.match(step3PackageSource, /Current bundle size/);
  assert.match(step3PackageSource, /Initial proposal context/);
  assert.match(step3PackageSource, /AI context load/);
  assert.match(step3PackageSource, /Prior rounds considered/);
  assert.match(step3PackageSource, /Previous AI reviews/);
  assert.match(step3PackageSource, /Estimated AI context load/);
  assert.match(step3PackageSource, /retrieved context chunk/);
  assert.match(step3PackageSource, /No post-baseline round history is currently included/);
  assert.match(step3PackageSource, /No previous AI mediation reviews are currently included/);
  assert.doesNotMatch(step3PackageSource, /Retrieved context chunks/);
  assert.doesNotMatch(step3PackageSource, /No retrieved supporting context is currently estimated/);
  assert.match(step3PackageSource, /Omitted due to capacity/);
});

test('shared-report workspace and evaluate routes expose equivalent context accounting fields', () => {
  assert.match(sharedReportWorkspaceSource, /review_context_estimate/);
  assert.match(sharedReportWorkspaceSource, /workspace_review_context_estimate/);
  assert.match(sharedReportWorkspaceSource, /initialProposalContextIncluded/);
  assert.match(sharedReportWorkspaceSource, /priorRoundsConsidered/);
  assert.match(sharedReportWorkspaceSource, /previousReviewsConsidered/);
  assert.match(sharedReportEvaluateSource, /context_estimate/);
  assert.match(sharedReportEvaluateSource, /review_context_estimate/);
  assert.match(sharedReportEvaluateSource, /initialProposalContextIncluded/);
  assert.match(sharedReportEvaluateSource, /priorRoundsConsidered/);
  assert.match(sharedReportEvaluateSource, /previousReviewsConsidered/);
});
