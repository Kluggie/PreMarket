import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { mapEvaluationRunView } from '../../server/routes/shared-report/_shared.ts';

const SHARED_REPORT_PATH = path.resolve(
  process.cwd(),
  'src/pages/SharedReport.jsx',
);

const PROPOSER_PATH = path.resolve(
  process.cwd(),
  'src/pages/DocumentComparisonCreate.jsx',
);

const SHARED_REPORTS_CLIENT_PATH = path.resolve(
  process.cwd(),
  'src/api/sharedReportsClient.js',
);

const VERCEL_CONFIG_PATH = path.resolve(
  process.cwd(),
  'vercel.json',
);

const SHARED_REPORT_EVALUATE_ROUTE_PATH = path.resolve(
  process.cwd(),
  'server/routes/shared-report/[token]/evaluate.ts',
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
  assert.ok(
    reviewPkgBlock.includes('reviewContextEstimate={reviewContextEstimate}'),
    'Review package must receive the workspace reviewContextEstimate for later-round AI load accounting',
  );
});

test('recipient Step 3 review package keeps send-back available before any extra AI review runs', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  const reviewPkgStart = source.indexOf('<Step3ReviewPackage');
  assert.ok(reviewPkgStart >= 0);

  const reviewPkgBlock = source.slice(reviewPkgStart, reviewPkgStart + 3200);

  assert.ok(
    reviewPkgBlock.includes('actionSlot={'),
    'Review package must provide a custom recipient action slot',
  );
  assert.ok(
    reviewPkgBlock.includes('onClick={sendToCounterparty}'),
    'Review package must expose sendToCounterparty before any extra AI review runs',
  );
  assert.ok(
    reviewPkgBlock.includes('getRecipientExtraAiReviewActionLabel'),
    'Review package must label the optional recipient AI action as an extra AI review',
  );
});

test('recipient extra AI review warns about owner credits and surfaces disabled plus per-round cap copy', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const routeSource = await readFile(SHARED_REPORT_EVALUATE_ROUTE_PATH, 'utf8');

  assert.ok(
    source.includes("This will run an extra AI review using the opportunity owner's AI mediation review credits."),
    'Recipient-triggered extra review must warn that owner credits will be used',
  );
  assert.ok(
    source.includes('recipient_ai_review_not_enabled'),
    'SharedReport must map the recipient AI review enablement code',
  );
  assert.ok(
    source.includes('The owner has not enabled extra AI review for this link. You can still edit and send your response.'),
    'SharedReport must surface the disabled-by-owner copy while keeping send-back available',
  );
  assert.ok(
    source.includes('recipient_rereview_limit_reached'),
    'SharedReport must map the per-round recipient re-review cap code',
  );
  assert.ok(
    source.includes(
      'An extra AI review has already been generated for this round. You can still edit and send your response, or ask the opportunity owner to review the next update.',
    ),
    'SharedReport must surface the per-round recipient re-review cap copy',
  );
  assert.ok(routeSource.includes('Cache hit = exact same inputs already have a saved successful AI result'));
  assert.ok(routeSource.includes('Cache miss = inputs changed or no saved result exists'));
});

test('recipient Run AI Mediation client calls shared-report evaluate with POST', async () => {
  const source = await readFile(SHARED_REPORTS_CLIENT_PATH, 'utf8');
  const start = source.indexOf('async evaluateRecipient(token');
  assert.ok(start >= 0, 'Expected sharedReportsClient.evaluateRecipient');

  const block = source.slice(start, start + 450);
  assert.ok(
    block.includes('/api/shared-report/${encodeToken(token)}/evaluate'),
    'evaluateRecipient must call the shared-report evaluate endpoint',
  );
  assert.ok(
    block.includes("method: 'POST'"),
    'evaluateRecipient must use POST, not GET',
  );
  assert.ok(
    source.slice(start, start + 1200).includes('Promise.race'),
    'evaluateRecipient must bound the synchronous browser wait while allowing the server request to continue',
  );
});

test('recipient Run AI Mediation settles the click handler on route failure', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const mutationStart = source.indexOf('const evaluateMutation = useMutation');
  assert.ok(mutationStart >= 0, 'Expected evaluateMutation');
  const mutationBlock = source.slice(mutationStart, mutationStart + 5000);
  assert.ok(
    mutationBlock.includes('onError:'),
    'evaluateMutation must keep a user-facing error handler',
  );

  const start = source.indexOf('const runEvaluationFromReview = async');
  assert.ok(start >= 0, 'Expected runEvaluationFromReview handler');

  const block = source.slice(start, start + 900);
  assert.ok(
    block.includes('await evaluateMutation.mutateAsync()'),
    'Run Mediation must trigger the evaluate mutation',
  );
  assert.ok(
    block.includes('try {') && block.includes('catch'),
    'Run Mediation must catch route failures after the mutation error handler shows the error',
  );
});

test('recipient Run AI Mediation shows a specific timeout error and Vercel allows the API function to finish', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const helperStart = source.indexOf('function toFriendlyEvaluateError');
  assert.ok(helperStart >= 0, 'Expected toFriendlyEvaluateError');
  const helperBlock = source.slice(helperStart, helperStart + 850);
  assert.ok(
    helperBlock.includes("Number(error?.status || 0) === 504"),
    'Shared report should recognize gateway timeouts',
  );
  assert.ok(
    helperBlock.includes('The extra AI review took too long to complete'),
    'Shared report should show an extra-review-specific timeout message',
  );

  const vercelConfig = JSON.parse(await readFile(VERCEL_CONFIG_PATH, 'utf8'));
  assert.equal(
    vercelConfig?.functions?.['api/index.ts']?.maxDuration,
    300,
    'The consolidated API function must allow long-running mediation requests to finish',
  );
});

test('recipient Run AI Mediation polls the persisted run and recovers a delayed saved result', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');
  const mutationStart = source.indexOf('const evaluateMutation = useMutation');
  const mutationBlock = source.slice(mutationStart, mutationStart + 7000);

  assert.ok(
    mutationBlock.includes('MEDIATION_EVALUATION_CLIENT_WAIT_MS'),
    'The browser wait must be bounded independently of the server function duration',
  );
  assert.ok(
    mutationBlock.includes('workspaceQuery.refetch()'),
    'A failed or delayed POST must check the persisted evaluation run',
  );
  assert.ok(
    mutationBlock.includes("asText(run?.status).toLowerCase() === 'success'"),
    'A saved successful run must recover the result even when the original response was lost',
  );
  assert.ok(
    source.includes('MEDIATION_EVALUATION_POLL_INTERVAL_MS'),
    'The shared report must poll while a persisted mediation run is pending',
  );
  assert.ok(
    source.includes('refetchInterval: (query) =>'),
    'Workspace polling must be owned by React Query so completed runs update component state automatically',
  );
  assert.ok(
    source.includes('refetchIntervalInBackground: true'),
    'Workspace polling must continue while the tab is backgrounded',
  );
  assert.ok(
    source.includes('activeEvaluationId'),
    'The recovery path must bind to the persisted evaluation run ID once observed',
  );
  assert.ok(
    source.includes('isStalePendingEvaluationRun'),
    'A stale pending run must clear the loading state and permit retry',
  );
  assert.ok(
    source.includes('evaluateMutation.isPending && !evaluationRequestHandled'),
    'A recovered saved result must clear the visible loading state even if the original POST is unresolved',
  );
});

test('shared-report mediation bounds quality repair work and records timeout diagnostics', async () => {
  const source = await readFile(SHARED_REPORT_EVALUATE_ROUTE_PATH, 'utf8');

  assert.ok(
    source.includes('maxQualityRepairCalls: 1'),
    'Shared-report mediation must allow at most one quality repair provider call',
  );
  assert.ok(
    source.includes('executionDeadlineMs: routeStartedAt + SHARED_REPORT_EVALUATION_BUDGET_MS'),
    'The evaluator must receive a deadline below the serverless function duration',
  );
  assert.ok(source.includes('modelElapsedMs'));
  assert.ok(source.includes('runtimePhaseElapsedMs'));
  assert.ok(source.includes('narrativeWordCount'));
  assert.ok(source.includes('responseReceived'));
  assert.ok(source.includes('rawTextLength'));
  assert.ok(source.includes('schemaMissingKeys'));
  assert.ok(source.includes('schemaInvalidFields'));
  assert.ok(source.includes('failureReason: failure.code'));
});

test('generation-service fallback returns to the existing retry screen instead of showing a substantive report', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  assert.ok(source.includes('isGenerationFailureFallback'));
  assert.ok(source.includes('setShowStep3Results(!generationFailed)'));
  assert.ok(source.includes('Extra AI review could not be completed. Please retry.'));
  assert.ok(source.includes('No substantive mediation result was produced. Please retry.'));
});

test('recipient workspace strips internal evaluation diagnostics from the public run view', () => {
  const view = mapEvaluationRunView({
    id: 'share_eval_diagnostics',
    revisionId: 'share_rev_diagnostics',
    actorRole: 'recipient',
    status: 'success',
    resultPublicReport: {
      renderer_path: 'fallback',
      narrative_valid: false,
      generation_status: 'failed',
      retry_recommended: true,
    },
    resultJson: {
      evaluation_result: {
        report: {
          renderer_path: 'fallback',
          narrative_valid: false,
        },
      },
      evaluation_diagnostics: {
        provider: 'openai',
        model: 'gpt-5.5',
        routeElapsedMs: 253_281,
        modelElapsedMs: 247_000,
        modelCallCount: 3,
        failurePhase: 'schema_validation',
        failureKind: 'schema_validation_failed',
        providerStatus: 429,
        providerCode: 'insufficient_quota',
        confidentialPrompt: 'do not expose',
      },
    },
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:01.000Z'),
  });

  assert.equal(view.public_report.renderer_path, 'fallback');
  assert.equal(view.result_json.evaluation_result.report.renderer_path, 'fallback');
  assert.equal('evaluation_diagnostics' in view.result_json, false);
  assert.deepEqual(view.runtime_diagnostics, {
    evaluation_id: 'share_eval_diagnostics',
    run_status: 'success',
    provider: 'openai',
    model: 'gpt-5.5',
    route_duration_ms: 253_281,
    model_duration_ms: 247_000,
    model_call_count: 3,
    failure_phase: 'schema_validation',
    failure_reason: 'schema_validation_failed',
    renderer_path: 'fallback',
    narrative_valid: false,
    generation_status: 'failed',
    retry_recommended: true,
  });
  assert.equal('providerStatus' in view.runtime_diagnostics, false);
  assert.equal('confidentialPrompt' in view.runtime_diagnostics, false);
});

test('shared-report browser logs safe mediation runtime diagnostics for production debugging', async () => {
  const source = await readFile(SHARED_REPORT_PATH, 'utf8');

  assert.ok(source.includes('[SharedReport] mediation evaluation runtime'));
  assert.ok(source.includes('run.runtime_diagnostics || {}'));
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

  // Valid evaluation results show the report, while a generation failure
  // returns to the existing retry screen.
  const evalOnSuccess = source.indexOf("toast.success('Extra AI review ready')");
  assert.ok(evalOnSuccess >= 0, 'Expected evaluation success toast');
  assert.ok(
    source.includes('setShowStep3Results(!generationFailed)'),
    'evaluateMutation.onSuccess must show results only when generation succeeded',
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
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1800);

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
  const nearHydration = source.slice(hydrationBlock, hydrationBlock + 1800);

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
    'showStep3Results must be set to the lineage and generation-success result',
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
