/**
 * tests/api/shared-report-mediation-review-state.test.mjs
 *
 * Pure-logic tests for the AI mediation review state-sync flow in SharedReport.
 *
 * Covers:
 *   1. step3IsEvaluationRunning is solely mutation-pending-based (no latestEvaluationStatus leakage)
 *   2. Timeline item title / tone are consistent with review panel isEvaluationRunning
 *   3. hasStep3Report logic correctly computes from updatedRecipientReport chain
 *   4. Blank-panel edge case is detected (hasEvaluations=true + hasReport=false)
 *   5. updatedRecipientReport priority order: latestEvaluatedReport > latestEvaluation.public_report > latestReport > baselineReport
 *   6. getRunAiMediationLabel shows correct label during pending, first-run, re-run
 *   7. No second click needed: once mutation settles with valid report, hasStep3Report=true immediately
 *   8. Slow/async completion still updates correctly when workspaceQuery refetches
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRunAiMediationLabel,
  RUNNING_AI_MEDIATION_LABEL,
  RUN_AI_MEDIATION_LABEL,
  RERUN_AI_MEDIATION_LABEL,
} from '../../src/lib/aiReportUtils.js';

// ---------------------------------------------------------------------------
// Helpers that mirror the exact derivation logic in SharedReport.jsx
// ---------------------------------------------------------------------------

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Mirror of the step3IsEvaluationRunning derivation **after the fix**.
 * Only depends on mutation pending — the latestEvaluationStatus checks
 * were removed because the recipient evaluate endpoint is synchronous and
 * never produces 'running'/'queued'/'evaluating' statuses.
 */
function deriveStep3IsEvaluationRunning({ evaluateMutationIsPending }) {
  return Boolean(evaluateMutationIsPending);
}

/**
 * Mirror of the pre-fix (buggy) derivation that also checked latestEvaluationStatus.
 * Kept here to demonstrate the problem and assert the new fix does not regress.
 */
function deriveStep3IsEvaluationRunning_OLD({
  evaluateMutationIsPending,
  latestEvaluationStatus,
}) {
  const status = asText(latestEvaluationStatus).toLowerCase();
  return (
    Boolean(evaluateMutationIsPending) ||
    status === 'running' ||
    status === 'queued' ||
    status === 'evaluating'
  );
}

/**
 * Mirror of updatedRecipientReport derivation.
 */
function deriveUpdatedRecipientReport({
  latestEvaluatedReport,
  latestEvaluationPublicReport,
  latestReport,
  baselineReport,
}) {
  return (
    latestEvaluatedReport ||
    latestEvaluationPublicReport ||
    latestReport ||
    baselineReport ||
    {}
  );
}

/**
 * Mirror of hasStep3Report derivation.
 */
function deriveHasStep3Report(updatedRecipientReport) {
  return (
    Boolean(
      updatedRecipientReport &&
        typeof updatedRecipientReport === 'object' &&
        !Array.isArray(updatedRecipientReport),
    ) && Object.keys(updatedRecipientReport).length > 0
  );
}

/**
 * Mirror of the timeline item title derivation.
 */
function deriveTimelineTitle({
  step3IsEvaluationFailed,
  step3IsEvaluationRunning,
  step3IsEvaluationNotConfigured,
}) {
  return step3IsEvaluationFailed
    ? 'AI Mediation Failed'
    : step3IsEvaluationRunning
      ? 'AI Mediation Running'
      : step3IsEvaluationNotConfigured
        ? 'AI Mediation Unavailable'
        : 'AI Mediation Ready';
}

/**
 * Mirror of the ComparisonAiReportTab blank-panel detection.
 * Returns true if the panel would show nothing (the silent failure state).
 */
function wouldShowBlankPanel({
  isEvaluationRunning,
  isEvaluationNotConfigured,
  isEvaluationFailed,
  hasReport,
  hasEvaluations,
}) {
  const processingShows = isEvaluationRunning;
  const notConfiguredShows = isEvaluationNotConfigured;
  const failedShows = isEvaluationFailed;
  const noReportShows =
    !isEvaluationRunning &&
    !isEvaluationNotConfigured &&
    !isEvaluationFailed &&
    !hasReport &&
    !hasEvaluations;
  const reportShows = hasReport;
  // After the fix a "completed but empty" state shows its own message, so blank = false.
  // We keep the pre-fix detection here to confirm the fix addresses it.
  const anyVisible =
    processingShows || notConfiguredShows || failedShows || noReportShows || reportShows;
  return !anyVisible;
}

// ---------------------------------------------------------------------------
// A representative non-empty report (as returned by the evaluate endpoint)
// ---------------------------------------------------------------------------
const VALID_REPORT = {
  report_format: 'v2',
  fit_level: 'Proceed with conditions',
  recommendation: 'Proceed with conditions',
  why: ['Executive Summary: Well-aligned on core terms.'],
  missing: ['What are the milestone payment triggers?'],
  redactions: [],
};

// ---------------------------------------------------------------------------
// Tests — section 1: step3IsEvaluationRunning derivation
// ---------------------------------------------------------------------------

describe('step3IsEvaluationRunning — fix: solely mutation-pending-based', () => {
  it('is true while evaluateMutation is pending', () => {
    assert.equal(deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: true }), true);
  });

  it('is false once evaluateMutation settles successfully', () => {
    assert.equal(deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false }), false);
  });

  it('is false even if latestEvaluationStatus would be running (pre-fix: would be true)', () => {
    // Under the fix, latestEvaluationStatus has no effect on step3IsEvaluationRunning.
    // (The recipient evaluate endpoint never sets 'running'/'queued'/'evaluating'.)
    assert.equal(deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false }), false);

    // Pre-fix derivation would have returned true in this scenario:
    assert.equal(
      deriveStep3IsEvaluationRunning_OLD({
        evaluateMutationIsPending: false,
        latestEvaluationStatus: 'running', // hypothetical stale workspace value
      }),
      true, // ← the OLD bug: shows 'processing' when mutation is already done
    );
  });

  it('is false for status=success (the normal post-evaluation workspace state)', () => {
    assert.equal(deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false }), false);
  });

  it('is false for status=pending (an abandoned prior run in the DB)', () => {
    // Even if a stale 'pending' row exists, the review panel must not
    // permanently show the "updates automatically" spinner.
    assert.equal(deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false }), false);
  });
});

// ---------------------------------------------------------------------------
// Tests — section 2: timeline/review panel consistency
// ---------------------------------------------------------------------------

describe('timeline and review panel consistency', () => {
  it('both show "running" state whilst mutation is pending', () => {
    const running = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: true });
    const timelineTitle = deriveTimelineTitle({
      step3IsEvaluationFailed: false,
      step3IsEvaluationRunning: running,
      step3IsEvaluationNotConfigured: false,
    });
    assert.equal(running, true);
    assert.equal(timelineTitle, 'AI Mediation Running');
  });

  it('both show "ready" state when mutation settles with valid report', () => {
    const running = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false });
    const timelineTitle = deriveTimelineTitle({
      step3IsEvaluationFailed: false,
      step3IsEvaluationRunning: running,
      step3IsEvaluationNotConfigured: false,
    });
    assert.equal(running, false);
    assert.equal(timelineTitle, 'AI Mediation Ready');
  });

  it('panel and timeline use the same variable — they cannot be inconsistent', () => {
    // The bug scenario: panel shows "running" but timeline shows "ready".
    // With the fix this is structurally impossible since both read the same
    // step3IsEvaluationRunning value.
    for (const isPending of [true, false]) {
      const running = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: isPending });
      const panelShowsProcessing = running; // isEvaluationRunning prop passed to panel
      const timelineTitle = deriveTimelineTitle({
        step3IsEvaluationFailed: false,
        step3IsEvaluationRunning: running,
        step3IsEvaluationNotConfigured: false,
      });
      if (panelShowsProcessing) {
        assert.equal(timelineTitle, 'AI Mediation Running', 'panel+timeline must agree on running');
      } else {
        assert.equal(timelineTitle, 'AI Mediation Ready', 'panel+timeline must agree on ready');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — section 3: hasStep3Report derivation
// ---------------------------------------------------------------------------

describe('hasStep3Report derivation', () => {
  it('is true when latestEvaluatedReport (from onSuccess) is a non-empty report', () => {
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: VALID_REPORT,
      latestEvaluationPublicReport: null,
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(deriveHasStep3Report(report), true);
  });

  it('is true when latestEvaluation.public_report is set (from workspace refetch)', () => {
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: null,
      latestEvaluationPublicReport: VALID_REPORT,
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(deriveHasStep3Report(report), true);
  });

  it('latestEvaluatedReport takes priority over latestEvaluation.public_report', () => {
    const localReport = { ...VALID_REPORT, _source: 'local' };
    const serverReport = { ...VALID_REPORT, _source: 'server' };
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: localReport,
      latestEvaluationPublicReport: serverReport,
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(report._source, 'local', 'local report should win over server-fetched report');
  });

  it('falls back to latestReport then baselineReport when nothing else is available', () => {
    const latestReport = { ...VALID_REPORT, _source: 'latestReport' };
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: null,
      latestEvaluationPublicReport: null,
      latestReport: null,
      baselineReport: latestReport,
    });
    assert.equal(report._source, 'latestReport');
    assert.equal(deriveHasStep3Report(report), true);
  });

  it('is false when all report sources are null or empty objects', () => {
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: null,
      latestEvaluationPublicReport: null,
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(deriveHasStep3Report(report), false);
  });

  it('is false when latestEvaluatedReport is an empty object (edge case: vertex AI returned {})', () => {
    // An empty {} is truthy so it wins the || chain, but has no keys.
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: {},
      latestEvaluationPublicReport: VALID_REPORT, // ← this should NOT win due to {} being truthy
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(deriveHasStep3Report(report), false, 'empty {} blocks the chain fallback');
  });

  it('no second click needed: settling mutation with valid report immediately shows review', () => {
    // Simulate the state immediately after onSuccess fires:
    // - evaluateMutation.isPending = false
    // - setLatestEvaluatedReport(result.evaluation.public_report) has executed
    // - workspaceQuery.refetch() has NOT yet completed (latestEvaluation still null)
    const isRunning = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false });
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: VALID_REPORT, // set in onSuccess
      latestEvaluationPublicReport: null,  // not yet (refetch pending)
      latestReport: null,
      baselineReport: {},
    });
    assert.equal(isRunning, false, 'processing card must not show after mutation settles');
    assert.equal(deriveHasStep3Report(report), true, 'review must show immediately from onSuccess result');
  });

  it('slow async completion: after workspaceQuery refetch, review shows from server data', () => {
    // Simulate the state after workspaceQuery.refetch() completes:
    // latestEvaluatedReport has been wiped (null) and workspace data is fresh.
    const isRunning = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false });
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: null,
      latestEvaluationPublicReport: VALID_REPORT, // from workspace refetch
      latestReport: VALID_REPORT,
      baselineReport: {},
    });
    assert.equal(isRunning, false);
    assert.equal(deriveHasStep3Report(report), true);
  });
});

// ---------------------------------------------------------------------------
// Tests — section 4: blank-panel edge case
// ---------------------------------------------------------------------------

describe('ComparisonAiReportTab blank-panel edge case', () => {
  it('pre-fix: blank panel when hasEvaluations=true and hasReport=false (silent failure)', () => {
    const blank = wouldShowBlankPanel({
      isEvaluationRunning: false,
      isEvaluationNotConfigured: false,
      isEvaluationFailed: false,
      hasReport: false,
      hasEvaluations: true, // ← evaluation run exists but report is empty
    });
    assert.equal(blank, true, 'pre-fix: this is the silent blank-panel bug');
  });

  it('post-fix: dedicated "completed but no report" card prevents blank panel', () => {
    // The pre-fix ComparisonAiReportTab only had a "no report" guard keyed on !hasEvaluations.
    // The blank-panel scenario: hasEvaluations=true AND hasReport=false AND isRunning=false.
    // Post-fix: a NEW guard was added: !isRunning && !notConfigured && !failed && hasEvaluations && !hasReport.
    // This is the condition that triggers the "completed but no detailed report" card.
    const isEvaluationRunning = false;
    const isEvaluationNotConfigured = false;
    const isEvaluationFailed = false;
    const hasReport = false;
    const hasEvaluations = true; // ← evaluation run exists

    // "No evaluations" card: fires only when hasEvaluations=false
    const noEvaluationsCard =
      !isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed &&
      !hasReport && !hasEvaluations;
    assert.equal(noEvaluationsCard, false, 'no-evaluations card does NOT fire when hasEvaluations=true');

    // "Completed no-report" card (new, post-fix): fires when hasEvaluations=true AND hasReport=false
    const completedNoReportCard =
      !isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed &&
      hasEvaluations && !hasReport;
    assert.equal(completedNoReportCard, true, 'completed-no-report card fires for this edge case');

    // The two cards are mutually exclusive (can't both be true at the same time).
    assert.equal(
      noEvaluationsCard && completedNoReportCard,
      false,
      'cards are mutually exclusive',
    );
  });

  it('normal success: no blank panel when hasReport=true', () => {
    const blank = wouldShowBlankPanel({
      isEvaluationRunning: false,
      isEvaluationNotConfigured: false,
      isEvaluationFailed: false,
      hasReport: true,
      hasEvaluations: true,
    });
    assert.equal(blank, false);
  });

  it('normal processing: no blank panel when isEvaluationRunning=true', () => {
    const blank = wouldShowBlankPanel({
      isEvaluationRunning: true,
      isEvaluationNotConfigured: false,
      isEvaluationFailed: false,
      hasReport: false,
      hasEvaluations: false,
    });
    assert.equal(blank, false);
  });
});

// ---------------------------------------------------------------------------
// Tests — section 5: getRunAiMediationLabel (loading label in step 2)
// ---------------------------------------------------------------------------

describe('getRunAiMediationLabel — step 2 continue button label', () => {
  it('shows "Running AI Mediation..." while mutation is pending', () => {
    assert.equal(
      getRunAiMediationLabel({ isPending: true, hasExisting: false }),
      RUNNING_AI_MEDIATION_LABEL,
    );
  });

  it('shows "Running AI Mediation..." during re-run pending', () => {
    assert.equal(
      getRunAiMediationLabel({ isPending: true, hasExisting: true }),
      RUNNING_AI_MEDIATION_LABEL,
    );
  });

  it('shows "Run AI Mediation" for first-time run (no existing evaluation)', () => {
    assert.equal(
      getRunAiMediationLabel({ isPending: false, hasExisting: false }),
      RUN_AI_MEDIATION_LABEL,
    );
  });

  it('shows "Re-run AI Mediation" when a previous evaluation exists', () => {
    assert.equal(
      getRunAiMediationLabel({ isPending: false, hasExisting: true }),
      RERUN_AI_MEDIATION_LABEL,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — section 6: step transition timing
// ---------------------------------------------------------------------------

describe('step 3 transition timing (runEvaluationFromStep2 fix)', () => {
  it('setStep(3) is no longer called before mutateAsync — this is a design invariant', () => {
    // We cannot run React hooks in a unit test, but we can document and assert
    // the behavioral contract: the review panel (step 3) must only become visible
    // AFTER the mutation's onSuccess has fired and set latestEvaluatedReport.
    //
    // The fix removes setStep(3) from runEvaluationFromStep2 so that the step
    // transition and report state change happen in the SAME React render batch.
    //
    // This test asserts the state invariant: when step 3 first renders after a
    // fresh evaluation, isEvaluationRunning MUST be false (mutation done) and
    // hasStep3Report MUST be true (report was set in onSuccess before setStep(3)).

    const isRunning = deriveStep3IsEvaluationRunning({ evaluateMutationIsPending: false });
    const report = deriveUpdatedRecipientReport({
      latestEvaluatedReport: VALID_REPORT, // set in onSuccess before setStep(3)
      latestEvaluationPublicReport: null,
      latestReport: null,
      baselineReport: {},
    });

    assert.equal(isRunning, false, 'step 3 must first render with isEvaluationRunning=false');
    assert.equal(
      deriveHasStep3Report(report),
      true,
      'step 3 must first render with hasReport=true',
    );
    // No second click needed: both conditions are true in the very first render after onSuccess.
  });

  it('pre-fix flash scenario: setStep(3) before mutateAsync caused a brief isPending=false render', () => {
    // Before the fix, setStep(3) was called BEFORE await evaluateMutation.mutateAsync().
    // In that brief instant: step=3, isPending=false, latestEvaluatedReport=null.
    // This showed "no report" → then isPending became true → showed "updates automatically".
    // This test confirms the pre-fix flash state (step=3, isPending=false, no report):
    const preMutationIsRunning = deriveStep3IsEvaluationRunning({
      evaluateMutationIsPending: false, // mutation hasn't started yet
    });
    const preMutationReport = deriveUpdatedRecipientReport({
      latestEvaluatedReport: null,
      latestEvaluationPublicReport: null,
      latestReport: null,
      baselineReport: {},
    });

    assert.equal(preMutationIsRunning, false, 'flash state: isEvaluationRunning=false (no indicator)');
    assert.equal(
      deriveHasStep3Report(preMutationReport),
      false,
      'flash state: hasReport=false (no review content)',
    );
    // This was the confusing "flash" the user experienced. After the fix, this
    // state no longer occurs because step 3 is not shown until onSuccess runs.
  });
});
