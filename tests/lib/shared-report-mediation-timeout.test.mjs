import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEvaluationRunForRequest,
  isGenerationFailureFallback,
  isRecentPendingEvaluationRun,
  isStalePendingEvaluationRun,
  MEDIATION_EVALUATION_STALE_MS,
} from '../../src/pages/shared-report/mediationEvaluationState.js';

const startedAt = Date.parse('2026-06-13T08:00:00.000Z');

test('only an explicitly marked generation failure enters the retry state', () => {
  assert.equal(
    isGenerationFailureFallback({
      generation_status: 'failed',
      retry_recommended: true,
      renderer_path: 'fallback',
    }),
    true,
  );
  assert.equal(
    isGenerationFailureFallback({
      renderer_path: 'fallback',
      narrative_valid: false,
      fit_level: 'unknown',
    }),
    false,
  );
  assert.equal(
    isGenerationFailureFallback({
      renderer_path: 'narrative',
      narrative_valid: true,
    }),
    false,
  );
});

test('a newly persisted pending run remains pollable while the original POST is in flight', () => {
  const run = {
    id: 'share_eval_new',
    revision_id: 'share_rev_current',
    status: 'pending',
    created_at: new Date(startedAt + 1_000).toISOString(),
  };

  assert.equal(
    isEvaluationRunForRequest(run, {
      priorEvaluationId: 'share_eval_old',
      requestStartedAt: startedAt,
      activeRevisionId: 'share_rev_current',
    }),
    true,
  );
  assert.equal(
    isRecentPendingEvaluationRun(run, {
      now: startedAt + 30_000,
      activeRevisionId: 'share_rev_current',
    }),
    true,
  );
});

test('a completed run saved after a delayed request is recognized as the latest request result', () => {
  const run = {
    id: 'share_eval_completed',
    revision_id: 'share_rev_current',
    status: 'success',
    public_report: { renderer_path: 'narrative' },
    created_at: new Date(startedAt + 2_000).toISOString(),
  };

  assert.equal(
    isEvaluationRunForRequest(run, {
      priorEvaluationId: 'share_eval_old',
      requestStartedAt: startedAt,
      activeRevisionId: 'share_rev_current',
    }),
    true,
  );
});

test('run recovery uses run identity and revision instead of browser/server clock comparison', () => {
  const serverClockBehindRun = {
    id: 'share_eval_clock_skew',
    revision_id: 'share_rev_current',
    status: 'success',
    public_report: { renderer_path: 'narrative' },
    created_at: new Date(startedAt - 10 * 60_000).toISOString(),
  };

  assert.equal(
    isEvaluationRunForRequest(serverClockBehindRun, {
      priorEvaluationId: 'share_eval_old',
      requestStartedAt: startedAt,
      activeRevisionId: 'share_rev_current',
    }),
    true,
  );
  assert.equal(
    isEvaluationRunForRequest(
      { ...serverClockBehindRun, revision_id: 'share_rev_other' },
      {
        activeEvaluationId: 'share_eval_clock_skew',
        priorEvaluationId: 'share_eval_old',
        activeRevisionId: 'share_rev_current',
      },
    ),
    false,
  );
});

test('stale pending runs stop polling and permit a retry instead of leaving the UI stuck', () => {
  const run = {
    id: 'share_eval_stale',
    revision_id: 'share_rev_current',
    status: 'pending',
    created_at: new Date(startedAt).toISOString(),
  };
  const now = startedAt + MEDIATION_EVALUATION_STALE_MS + 1;

  assert.equal(
    isRecentPendingEvaluationRun(run, {
      now,
      activeRevisionId: 'share_rev_current',
    }),
    false,
  );
  assert.equal(
    isStalePendingEvaluationRun(run, {
      now,
      activeRevisionId: 'share_rev_current',
      requestStartedAt: startedAt,
    }),
    true,
  );
});

test('polling ignores stale cached results and runs from another revision', () => {
  const oldRun = {
    id: 'share_eval_old',
    revision_id: 'share_rev_current',
    status: 'success',
    created_at: new Date(startedAt - 60_000).toISOString(),
  };
  const wrongRevisionRun = {
    id: 'share_eval_new',
    revision_id: 'share_rev_other',
    status: 'success',
    created_at: new Date(startedAt + 1_000).toISOString(),
  };

  assert.equal(
    isEvaluationRunForRequest(oldRun, {
      priorEvaluationId: 'share_eval_old',
      requestStartedAt: startedAt,
      activeRevisionId: 'share_rev_current',
    }),
    false,
  );
  assert.equal(
    isEvaluationRunForRequest(wrongRevisionRun, {
      priorEvaluationId: 'share_eval_old',
      requestStartedAt: startedAt,
      activeRevisionId: 'share_rev_current',
    }),
    false,
  );
});
