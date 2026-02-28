import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveComparisonUpdatedAtMs,
  resolveHydratedDraftStep,
  shouldHydrateComparisonDraft,
} from '../../src/pages/document-comparison/hydration.js';

test('hydration allows server state when no unsaved local edits exist', () => {
  const result = shouldHydrateComparisonDraft({
    hasLocalUnsavedEdit: false,
    localLastEditAt: Date.now(),
    serverUpdatedAtMs: Date.now() - 1000,
  });

  assert.equal(result, true);
});

test('hydration blocks stale server payload when local draft is newer and dirty', () => {
  const now = Date.now();
  const result = shouldHydrateComparisonDraft({
    hasLocalUnsavedEdit: true,
    localLastEditAt: now,
    serverUpdatedAtMs: now - 5000,
  });

  assert.equal(result, false);
});

test('hydration allows newer server payload even when local draft is dirty', () => {
  const now = Date.now();
  const result = shouldHydrateComparisonDraft({
    hasLocalUnsavedEdit: true,
    localLastEditAt: now - 5000,
    serverUpdatedAtMs: now,
  });

  assert.equal(result, true);
});

test('comparison updated timestamp resolves from snake_case and camelCase fields', () => {
  const updatedDate = '2026-01-15T12:30:00.000Z';
  const updatedAt = '2026-01-16T08:45:00.000Z';
  const resolved = resolveComparisonUpdatedAtMs({
    updated_date: updatedDate,
    updatedAt,
  });

  assert.equal(resolved, Date.parse(updatedAt));
});

test('hydrated step respects explicit route step when provided', () => {
  const resolved = resolveHydratedDraftStep({
    serverDraftStep: 2,
    routeStep: 1,
    localStep: 1,
    hasRouteStepParam: true,
    maxStep: 2,
  });

  assert.equal(resolved, 1);
});

test('hydrated step falls back to server draft step when route step is absent', () => {
  const resolved = resolveHydratedDraftStep({
    serverDraftStep: 2,
    routeStep: 1,
    localStep: 1,
    hasRouteStepParam: false,
    maxStep: 2,
  });

  assert.equal(resolved, 2);
});

test('hydrated step keeps in-flight local step when route step is stale', () => {
  const resolved = resolveHydratedDraftStep({
    serverDraftStep: 2,
    routeStep: 1,
    localStep: 2,
    hasRouteStepParam: true,
    maxStep: 2,
  });

  assert.equal(resolved, 2);
});
