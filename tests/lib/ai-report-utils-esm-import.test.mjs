import assert from 'node:assert/strict';
import test from 'node:test';

test('aiReportUtils loads under plain Node ESM', async () => {
  const module = await import('../../src/lib/aiReportUtils.js');

  assert.equal(typeof module.truncateTextAtNaturalBoundary, 'function');
  assert.equal(typeof module.getRunOpportunityReviewLabel, 'function');
});
