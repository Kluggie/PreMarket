import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPrivateModePlanEligible,
  PRIVATE_MODE_ELIGIBILITY_COPY,
} from '../../src/lib/privateModeEligibility.js';

test('Private Mode UI eligibility: Early Access, Professional, Enterprise are eligible', () => {
  assert.equal(isPrivateModePlanEligible('early_access'), true);
  assert.equal(isPrivateModePlanEligible('early access'), true);
  assert.equal(isPrivateModePlanEligible('early_access_program'), true);
  assert.equal(isPrivateModePlanEligible('professional'), true);
  assert.equal(isPrivateModePlanEligible('enterprise'), true);
});

test('Private Mode UI eligibility: Starter and unknown plans are not eligible', () => {
  assert.equal(isPrivateModePlanEligible('starter'), false);
  assert.equal(isPrivateModePlanEligible('free'), false);
  assert.equal(isPrivateModePlanEligible('trial'), false);
  assert.equal(isPrivateModePlanEligible(''), false);
});

test('Private Mode UI copy includes Early Access terminology', () => {
  assert.equal(
    PRIVATE_MODE_ELIGIBILITY_COPY,
    'Available on Early Access, Professional, and Enterprise plans',
  );
});
