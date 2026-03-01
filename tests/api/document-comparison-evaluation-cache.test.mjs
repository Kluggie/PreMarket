import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildComparisonQueryPayload,
  buildOptimisticEvaluationHistoryEntry,
  defaultOwnerPermissions,
  mergeEvaluationHistoryWithOptimistic,
} from '../../src/pages/document-comparison/evaluationCache.js';

test('buildComparisonQueryPayload normalizes proposal and permissions for immediate cache hydration', () => {
  const payload = buildComparisonQueryPayload({
    comparison: {
      id: 'cmp_1',
      proposal_id: 'prop_1',
      title: 'Comparison',
    },
    proposal: {
      id: 'prop_1',
      title: 'Proposal',
    },
    permissions: null,
  });

  assert.equal(payload.comparison.id, 'cmp_1');
  assert.equal(payload.proposal.id, 'prop_1');
  assert.equal(payload.proposal.document_comparison_id, 'cmp_1');
  assert.deepEqual(payload.permissions, defaultOwnerPermissions());
});

test('buildOptimisticEvaluationHistoryEntry includes persisted input fingerprint fields', () => {
  const entry = buildOptimisticEvaluationHistoryEntry({
    comparison: {
      id: 'cmp_2',
      proposal_id: 'prop_2',
      updated_at: '2026-02-27T12:00:00.000Z',
      evaluation_result: {
        score: 88,
        summary: 'Grounded output',
        provider: 'mock',
        model: 'vertex-mock',
        input_trace: {
          shared_hash: 'old_shared',
          confidential_hash: 'old_conf',
          shared_length: 120,
          confidential_length: 220,
        },
      },
    },
    proposalId: 'prop_2',
    evaluationInputTrace: {
      shared_hash: 'abc123shared',
      confidential_hash: 'def456conf',
      shared_length: 145,
      confidential_length: 233,
      input_version: 7,
    },
  });

  assert.equal(entry.status, 'completed');
  assert.equal(entry.proposal_id, 'prop_2');
  assert.equal(entry.input_shared_hash, 'abc123shared');
  assert.equal(entry.input_conf_hash, 'def456conf');
  assert.equal(entry.input_shared_len, 145);
  assert.equal(entry.input_conf_len, 233);
  assert.equal(entry.input_version, 7);
  assert.equal(entry.result.input_trace.shared_hash, 'abc123shared');
  assert.equal(entry.evaluation_provider, 'fallback');
  assert.equal(entry.evaluation_model, 'vertex-mock');
  assert.equal(entry.evaluation_provider_reason, 'vertex_mock_enabled');
});

test('mergeEvaluationHistoryWithOptimistic keeps newest optimistic entry at top', () => {
  const existing = [
    { id: 'optimistic-old', status: 'completed' },
    { id: 'eval_real_1', status: 'completed' },
  ];
  const optimistic = {
    id: 'optimistic-new',
    status: 'completed',
  };

  const merged = mergeEvaluationHistoryWithOptimistic(existing, optimistic);
  assert.equal(Array.isArray(merged), true);
  assert.equal(merged[0].id, 'optimistic-new');
  assert.equal(merged.some((entry) => entry.id === 'optimistic-old'), false);
  assert.equal(merged.some((entry) => entry.id === 'eval_real_1'), true);
});
