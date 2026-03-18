import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGuestAiUsageState,
  resolveGuestComparisonHydrationStep,
  resolveGuestComparisonPersistedStep,
} from '../../src/pages/document-comparison/guestPreviewState.js';

test('guest hydration keeps the explicit route step instead of restoring a stale draft step', () => {
  const restoredStep = resolveGuestComparisonHydrationStep({
    draftStep: 2,
    routeStep: 3,
    hasStepParam: true,
  });

  assert.equal(restoredStep, 3);
});

test('guest hydration restores the saved draft step when the route has no explicit step yet', () => {
  const restoredStep = resolveGuestComparisonHydrationStep({
    draftStep: 2,
    routeStep: 1,
    hasStepParam: false,
  });

  assert.equal(restoredStep, 2);
});

test('guest persistence keeps the canonical in-memory step unless navigation explicitly forces a new one', () => {
  assert.equal(
    resolveGuestComparisonPersistedStep({
      requestedStep: 2,
      canonicalStep: 3,
    }),
    3,
  );

  assert.equal(
    resolveGuestComparisonPersistedStep({
      requestedStep: 3,
      canonicalStep: 2,
      forceStep: true,
    }),
    3,
  );
});

test('guest assistance usage stays separate from guest mediation usage', () => {
  assert.deepEqual(
    normalizeGuestAiUsageState({
      assistanceRequestsUsed: 2,
      mediationRunsUsed: 0,
    }),
    {
      assistanceRequestsUsed: 2,
      mediationRunsUsed: 0,
    },
  );

  assert.deepEqual(
    normalizeGuestAiUsageState({}, { mediationRunsUsed: 1 }),
    {
      assistanceRequestsUsed: 0,
      mediationRunsUsed: 1,
    },
  );
});
