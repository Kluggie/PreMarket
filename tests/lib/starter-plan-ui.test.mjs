import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_PLAN_LIMITS,
  formatBytes,
  formatCount,
  isStarterPlanTier,
  isStarterOpportunityLimitReached,
  normalizePlanTier,
  toRemaining,
} from '../../src/lib/starterPlanLimits.js';
import {
  getApiErrorCode,
  getStarterLimitErrorCopy,
} from '../../src/lib/starterLimitErrorCopy.js';

test('starter plan helpers normalize and format values', () => {
  assert.equal(normalizePlanTier(' Starter Plan '), 'starter_plan');
  assert.equal(normalizePlanTier('early-access'), 'early_access');
  assert.equal(normalizePlanTier('early access program'), 'early_access_program');
  assert.equal(isStarterPlanTier('starter'), true);
  assert.equal(isStarterPlanTier('free'), true);
  assert.equal(isStarterPlanTier('early_access'), false);
  assert.equal(isStarterPlanTier('early-access'), false);
  assert.equal(isStarterPlanTier('early access'), false);
  assert.equal(isStarterPlanTier('early_access_program'), false);
  assert.equal(isStarterPlanTier('early-access-program'), false);
  assert.equal(isStarterPlanTier('early access program'), false);
  assert.equal(isStarterPlanTier('professional'), false);
  assert.equal(isStarterPlanTier('enterprise'), false);
  assert.equal(isStarterPlanTier(''), false);
  assert.equal(isStarterPlanTier(null), false);
  assert.equal(isStarterPlanTier(undefined), false);

  assert.equal(formatCount(12345), '12,345');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(25 * 1024 * 1024), '25 MB');
  assert.equal(toRemaining(3, 5), 0);
  assert.equal(toRemaining(10, 4), 6);
});

test('starter error helper maps backend limit codes to user copy', () => {
  const opportunityLimitError = {
    code: 'starter_opportunities_monthly_limit_reached',
    body: {
      error: {
        code: 'starter_opportunities_monthly_limit_reached',
        plan: 'starter',
      },
    },
  };

  const uploadLimitError = {
    body: {
      error: {
        code: 'starter_upload_per_opportunity_limit_exceeded',
        plan: 'starter',
      },
    },
  };

  const evaluationLimitError = {
    body: {
      error: {
        failure_code: 'starter_ai_evaluations_monthly_limit_reached',
        plan: 'starter',
      },
    },
  };

  const nonStarterError = {
    body: {
      error: {
        code: 'starter_active_opportunities_limit_reached',
        plan: 'professional',
      },
    },
  };

  assert.equal(
    getApiErrorCode(opportunityLimitError),
    'starter_opportunities_monthly_limit_reached',
  );
  assert.equal(
    getStarterLimitErrorCopy(opportunityLimitError, 'create')?.includes(
      String(STARTER_PLAN_LIMITS.opportunitiesPerMonth),
    ),
    true,
  );
  assert.equal(
    getStarterLimitErrorCopy(uploadLimitError, 'upload')?.includes('25 MB'),
    true,
  );
  assert.equal(
    getStarterLimitErrorCopy(evaluationLimitError, 'evaluation')?.includes(
      String(STARTER_PLAN_LIMITS.aiEvaluationsPerMonth),
    ),
    true,
  );
  assert.equal(getStarterLimitErrorCopy(nonStarterError, 'create'), null);
  assert.equal(getStarterLimitErrorCopy({ code: 'validation_failed' }, 'create'), null);
});

test('starter opportunities monthly limit constant is 5', () => {
  assert.equal(STARTER_PLAN_LIMITS.opportunitiesPerMonth, 5,
    'monthly opportunities limit must be 5, not the legacy value of 3');
  assert.notEqual(STARTER_PLAN_LIMITS.opportunitiesPerMonth, 3,
    'stale legacy limit of 3 must not be used as the opportunities denominator');
});

test('isStarterOpportunityLimitReached detects monthly limit correctly', () => {
  const starterAt5 = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 5 }, limits: {} };
  const starterAt4 = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 4 }, limits: {} };
  const starterAt0 = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 0 }, limits: {} };
  const starterOver = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 7 }, limits: {} };
  const freeAt5   = { plan: 'free', usage: { opportunitiesCreatedThisMonth: 5 }, limits: {} };
  const proPlan   = { plan: 'professional', usage: { opportunitiesCreatedThisMonth: 5 }, limits: {} };

  // At the canonical limit (5) — should be blocked
  assert.equal(isStarterOpportunityLimitReached(starterAt5), true,
    'should be blocked at 5/5');

  // Over limit — should also be blocked
  assert.equal(isStarterOpportunityLimitReached(starterOver), true,
    'should be blocked when over limit');

  // Under limit — action allowed
  assert.equal(isStarterOpportunityLimitReached(starterAt4), false,
    'should NOT be blocked at 4/5');
  assert.equal(isStarterOpportunityLimitReached(starterAt0), false,
    'should NOT be blocked at 0/5');

  // free plan alias also counts as starter
  assert.equal(isStarterOpportunityLimitReached(freeAt5), true,
    'free plan alias should be treated same as starter');

  // Non-starter plans are never blocked by this helper
  assert.equal(isStarterOpportunityLimitReached(proPlan), false,
    'non-starter plans should never be blocked');

  // Edge cases
  assert.equal(isStarterOpportunityLimitReached(null), false, 'null input returns false');
  assert.equal(isStarterOpportunityLimitReached(undefined), false, 'undefined input returns false');
  assert.equal(isStarterOpportunityLimitReached({ plan: 'starter' }), false,
    'missing usage field should not throw — treated as 0 used');
  assert.equal(isStarterOpportunityLimitReached({ plan: 'starter', usage: {} }), false,
    'undefined opportunitiesCreatedThisMonth treated as 0');

  // Explicitly verify the denominator used is 5, not the legacy 3
  const atLegacyLimit = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 3 }, limits: {} };
  assert.equal(isStarterOpportunityLimitReached(atLegacyLimit), false,
    '3 used out of 5 should NOT be blocked — 3 is the legacy stale value');
});
