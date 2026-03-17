import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_PLAN_LIMITS,
  formatBytes,
  formatCount,
  isStarterPlanTier,
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
