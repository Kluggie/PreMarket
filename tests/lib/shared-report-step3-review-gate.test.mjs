import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SHARED_REPORT_PATH = path.resolve(
  process.cwd(),
  'src/pages/SharedReport.jsx',
);

const PROPOSER_PATH = path.resolve(
  process.cwd(),
  'src/pages/DocumentComparisonCreate.jsx',
);

// ─────────────────────────────────────────────────────────────────
//  Core requirement: Step 2 must NOT run AI mediation directly
// ─────────────────────────────────────────────────────────────────

test('recipient Step 2 onContinue navigates to Step 3 instead of running evaluation', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  // The old pattern ran evaluation directly from Step 2.
  assert.ok(
    !source.includes('onContinue={runEvaluationFromStep2}'),
    'Step 2 must not use runEvaluationFromStep2 — evaluation must only be triggered from Step 3 review',
  );

  // Step 2 should navigate to Step 3 via jumpStep(3).
  const step2Section = source.indexOf('STEP 2');
  assert.ok(step2Section >= 0, 'Expected STEP 2 section marker in SharedReport');

  const step3Section = source.indexOf('STEP 3', step2Section);
  assert.ok(step3Section >= 0, 'Expected STEP 3 section marker after STEP 2');

  const step2Block = source.slice(step2Section, step3Section);
  assert.ok(
    step2Block.includes('jumpStep(3)'),
    'Step 2 onContinue must navigate to Step 3 via jumpStep(3)',
  );
});

test('recipient Step 2 does not have evaluation-specific disabled logic', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const step2Section = source.indexOf('STEP 2');
  const step3Section = source.indexOf('STEP 3', step2Section);
  const step2Block = source.slice(step2Section, step3Section);

  // The old pattern had canReevaluate and evaluateMutation.isPending as continue gates.
  assert.ok(
    !step2Block.includes('canReevaluate'),
    'Step 2 continue button must not gate on canReevaluate — that belongs on Step 3',
  );
  assert.ok(
    !step2Block.includes('evaluateMutation.isPending'),
    'Step 2 continue button must not gate on evaluateMutation.isPending',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Core requirement: Step 3 must show Review Package before results
// ─────────────────────────────────────────────────────────────────

test('recipient Step 3 conditionally renders Step3ReviewPackage (pre-mediation) and ComparisonEvaluationStep (post-mediation)', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  // Step3ReviewPackage must be imported.
  assert.ok(
    source.includes("import Step3ReviewPackage from"),
    'SharedReport must import Step3ReviewPackage component',
  );

  // Step 3 section should contain both components.
  const step3Section = source.indexOf('STEP 3');
  assert.ok(step3Section >= 0, 'Expected STEP 3 section marker');

  const step3Block = source.slice(step3Section);
  assert.ok(
    step3Block.includes('<Step3ReviewPackage'),
    'Step 3 must render Step3ReviewPackage for pre-mediation review',
  );
  assert.ok(
    step3Block.includes('<ComparisonEvaluationStep'),
    'Step 3 must render ComparisonEvaluationStep for post-mediation results',
  );
});

test('recipient Step 3 review package receives current round bundle data', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const reviewPkgStart = source.indexOf('<Step3ReviewPackage');
  assert.ok(reviewPkgStart >= 0, 'Expected Step3ReviewPackage in render');

  const reviewPkgBlock = source.slice(reviewPkgStart, reviewPkgStart + 800);

  // Must use allDisplayDocuments (current round documents).
  assert.ok(
    reviewPkgBlock.includes('documents={allDisplayDocuments}'),
    'Review package must receive allDisplayDocuments for the current round',
  );

  // Must use step3Bundles (compiled bundles for current round).
  assert.ok(
    reviewPkgBlock.includes('step3Bundles.confidential'),
    'Review package must use step3Bundles.confidential (current round data)',
  );
  assert.ok(
    reviewPkgBlock.includes('step3Bundles.shared'),
    'Review package must use step3Bundles.shared (current round data)',
  );
});

test('recipient Step 3 review package has Run AI Mediation action', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const reviewPkgStart = source.indexOf('<Step3ReviewPackage');
  assert.ok(reviewPkgStart >= 0);

  const reviewPkgBlock = source.slice(reviewPkgStart, reviewPkgStart + 800);

  assert.ok(
    reviewPkgBlock.includes('onRunEvaluation={runEvaluationFromReview}'),
    'Review package must wire onRunEvaluation to runEvaluationFromReview',
  );
});

// ─────────────────────────────────────────────────────────────────
//  showStep3Results state management
// ─────────────────────────────────────────────────────────────────

test('showStep3Results controls which Step 3 view is active', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  assert.ok(
    source.includes('showStep3Results'),
    'SharedReport must use showStep3Results state to toggle between review and results',
  );

  // showStep3Results must be set to true on evaluation success.
  const evalOnSuccess = source.indexOf("toast.success('AI mediation review ready')");
  assert.ok(evalOnSuccess >= 0, 'Expected evaluation success toast');
  const nearSuccess = source.slice(Math.max(0, evalOnSuccess - 300), evalOnSuccess);
  assert.ok(
    nearSuccess.includes('setShowStep3Results(true)'),
    'evaluateMutation.onSuccess must set showStep3Results to true',
  );
});

test('navigating forward from Step 2 to Step 3 resets showStep3Results to false', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const jumpStepFn = source.indexOf('const jumpStep');
  assert.ok(jumpStepFn >= 0, 'Expected jumpStep function');

  // Find the jumpStep function body.
  const jumpStepBlock = source.slice(jumpStepFn, jumpStepFn + 1200);

  assert.ok(
    jumpStepBlock.includes('setShowStep3Results(false)'),
    'jumpStep must reset showStep3Results when navigating forward to Step 3',
  );
});

test('"Edit again" from results resets showStep3Results and goes back to Step 2', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  // The Edit again button must both reset showStep3Results and go to step 2.
  assert.ok(
    source.includes('setShowStep3Results(false); setStep(2)'),
    'Edit again must reset showStep3Results and navigate to Step 2',
  );
});

// ─────────────────────────────────────────────────────────────────
//  No bypass: runEvaluationFromStep2 must not exist
// ─────────────────────────────────────────────────────────────────

test('runEvaluationFromStep2 function is fully removed', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  assert.ok(
    !source.includes('runEvaluationFromStep2'),
    'runEvaluationFromStep2 must be completely removed — all evaluation triggers go through Step 3 review',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Proposer flow unchanged: Step 3 still uses Step3ReviewPackage
// ─────────────────────────────────────────────────────────────────

test('proposer flow still uses Step3ReviewPackage at Step 3', async () => {
  const source = await readFile(PROPOSER_PATH, 'utf8');

  assert.ok(
    source.includes("import Step3ReviewPackage from"),
    'Proposer (DocumentComparisonCreate) must still import Step3ReviewPackage',
  );

  const step3Section = source.indexOf('step === 3');
  assert.ok(step3Section >= 0, 'Expected step === 3 in proposer flow');

  const step3Block = source.slice(step3Section, step3Section + 1000);
  assert.ok(
    step3Block.includes('<Step3ReviewPackage'),
    'Proposer Step 3 must still render Step3ReviewPackage',
  );
});

test('proposer Step 2 continues to Step 3 via jumpStep(3)', async () => {
  const source = await readFile(PROPOSER_PATH, 'utf8');

  const step2Section = source.lastIndexOf('<Step2EditSources');
  assert.ok(step2Section >= 0, 'Expected Step2EditSources JSX element in proposer');

  const step2Block = source.slice(step2Section, step2Section + 2000);
  assert.ok(
    step2Block.includes('onContinue={() => jumpStep(3)}'),
    'Proposer Step 2 must navigate to Step 3 via jumpStep(3)',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Resume behavior: hydration at Step 3 must be lineage-aware
// ─────────────────────────────────────────────────────────────────

test('hydration at Step 3 checks evaluation revision_id against active draft', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  assert.ok(hydrationBlock >= 0, 'Expected stepHydrated guard');

  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1200);

  // Must check hydratedStep === 3 and set showStep3Results based on lineage.
  assert.ok(
    nearHydration.includes('hydratedStep === 3'),
    'Hydration must handle resume at Step 3',
  );
  assert.ok(
    nearHydration.includes('setShowStep3Results'),
    'Hydration at Step 3 must set showStep3Results based on lineage-aware evaluation check',
  );

  // Must use revision_id for lineage matching.
  assert.ok(
    nearHydration.includes('revision_id'),
    'Hydration must check evaluation revision_id for lineage matching',
  );

  // Must compare against the active draft or sent revision ID.
  assert.ok(
    nearHydration.includes('recipientDraft?.id') || nearHydration.includes('recipientDraft.id'),
    'Hydration must compare evaluation revision_id against recipientDraft.id',
  );
  assert.ok(
    nearHydration.includes('latestSentRevision?.id') || nearHydration.includes('latestSentRevision.id'),
    'Hydration must also consider latestSentRevision.id as a valid lineage match',
  );
});

test('hydration does NOT use latestReport fallback for showStep3Results decision', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  const stepHydratedEnd = source.indexOf('setStepHydrated(true)', hydrationBlock);
  const hydrationScope = source.slice(hydrationBlock, stepHydratedEnd + 200);

  // The old bug: latestReport falls back to baselineAiReport (proposer eval),
  // so it was always truthy and would incorrectly show results.
  assert.ok(
    !hydrationScope.includes("workspaceQuery.data?.latestReport"),
    'Hydration must NOT use latestReport to decide showStep3Results — it falls back to baseline/proposer report',
  );
});

// ─────────────────────────────────────────────────────────────────
//  jumpStep saves draft when navigating to Step 3
// ─────────────────────────────────────────────────────────────────

test('jumpStep saves dirty draft when navigating from Step 2 to Step 3', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const jumpStepFn = source.indexOf('const jumpStep');
  const jumpStepBlock = source.slice(jumpStepFn, jumpStepFn + 800);

  assert.ok(
    jumpStepBlock.includes('bounded === 3') && jumpStepBlock.includes('draftDirty'),
    'jumpStep must handle saving dirty drafts when navigating to Step 3',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Both flows use consistent 3-step total
// ─────────────────────────────────────────────────────────────────

test('both proposer and recipient use TOTAL_WORKFLOW_STEPS = 3', async () => {
  const recipientSource = await readFile(SHARED_REPORT_PATH, 'utf8');
  const proposerSource = await readFile(PROPOSER_PATH, 'utf8');

  assert.ok(
    recipientSource.includes('TOTAL_WORKFLOW_STEPS = 3'),
    'Recipient flow must use 3 total workflow steps',
  );
  assert.ok(
    proposerSource.includes('TOTAL_WORKFLOW_STEPS = 3'),
    'Proposer flow must use 3 total workflow steps',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Lineage-aware Step 3 resume scenarios
// ─────────────────────────────────────────────────────────────────

test('lineage check: current draft with matching evaluation => results mode', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1200);

  // The lineage logic must compare evalRevisionId to activeDraftId.
  // When evalRevisionId === activeDraftId, setShowStep3Results(true).
  assert.ok(
    nearHydration.includes('evalRevisionId === activeDraftId'),
    'Lineage check must compare evalRevisionId to activeDraftId for exact match',
  );

  // The result must be true only when BOTH sides are non-null and matching.
  assert.ok(
    nearHydration.includes('Boolean(evalRevisionId)') && nearHydration.includes('Boolean(activeDraftId)'),
    'Lineage check must require both evalRevisionId and activeDraftId to be truthy',
  );
});

test('lineage check: evaluation with non-matching revision_id => review package mode', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1200);

  // If evalRevisionId does not match activeDraftId, the flag must be false,
  // which means Review Package is shown, not results.
  // This is implicitly guaranteed by the strict equality check:
  // evaluationBelongsToCurrentDraft = ... evalRevisionId === activeDraftId ...
  assert.ok(
    nearHydration.includes('evaluationBelongsToCurrentDraft'),
    'Lineage check result must be stored in a clearly named boolean',
  );
  assert.ok(
    nearHydration.includes('setShowStep3Results(evaluationBelongsToCurrentDraft)'),
    'showStep3Results must be set to the lineage match result — false when revision mismatch',
  );
});

test('lineage check: null evaluation => review package mode (no false positive from baseline)', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1200);

  // When latestEvaluation is null, evalRevisionId will be null.
  // Boolean(null) is false so evaluationBelongsToCurrentDraft must be false.
  // This prevents the baseline proposer report from triggering results mode.
  assert.ok(
    nearHydration.includes("latestEvaluation?.revision_id"),
    'Must read revision_id from latestEvaluation (null-safe)',
  );
  assert.ok(
    !nearHydration.includes('baselineAiReport') && !nearHydration.includes('baselineReport'),
    'Lineage check must not reference baseline reports — they belong to a different party/round',
  );
});

test('lineage check: activeDraftId considers both recipientDraft and latestSentRevision', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const hydrationBlock = source.indexOf('if (!stepHydrated)');
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1200);

  // The active draft ID must fall back to latestSentRevision if there is no
  // current draft (e.g. after sending, the draft status becomes 'sent' and
  // getCurrentRecipientDraft returns null).
  assert.ok(
    nearHydration.includes('recipientDraft?.id || latestSentRevision?.id'),
    'activeDraftId must try recipientDraft.id first then fall back to latestSentRevision.id',
  );
});
