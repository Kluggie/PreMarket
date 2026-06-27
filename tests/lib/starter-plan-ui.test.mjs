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

  const activeLimitError = {
    body: {
      error: {
        code: 'starter_active_opportunities_limit_reached',
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
    getStarterLimitErrorCopy(opportunityLimitError, 'create'),
    "You've reached the Starter limit of 1 opportunity this month. Archiving does not reset monthly usage.",
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
  assert.equal(
    getStarterLimitErrorCopy(activeLimitError, 'create'),
    "You've reached the Starter limit of 1 active opportunity. Closing an opportunity frees the active slot; archiving only hides it from your main view.",
  );
  assert.equal(getStarterLimitErrorCopy(nonStarterError, 'create'), null);
  assert.equal(getStarterLimitErrorCopy({ code: 'validation_failed' }, 'create'), null);
});

test('review-credit error helper maps paid plan exhaustion copy', () => {
  const professionalError = {
    body: {
      error: {
        code: 'ai_mediation_reviews_monthly_limit_reached',
        plan: 'professional',
        limit: 20,
      },
    },
  };
  const teamError = {
    body: {
      error: {
        code: 'ai_mediation_reviews_monthly_limit_reached',
        plan: 'team',
        limit: 100,
      },
    },
  };

  assert.equal(
    getStarterLimitErrorCopy(professionalError, 'evaluation'),
    "You've used your 20 AI mediation reviews for this month. Contact us for additional review credits or upgrade your plan.",
  );
  assert.equal(
    getStarterLimitErrorCopy(teamError, 'evaluation'),
    'Your team has used its 100 AI mediation reviews for this month. Contact us for additional review credits.',
  );
});

test('starter pricing limits match the review-credit model', () => {
  assert.equal(STARTER_PLAN_LIMITS.opportunitiesPerMonth, 1,
    'Starter must allow 1 opportunity per month');
  assert.equal(STARTER_PLAN_LIMITS.activeOpportunities, 1,
    'Starter must allow 1 active opportunity at once');
  assert.equal(STARTER_PLAN_LIMITS.aiEvaluationsPerMonth, 3,
    'Starter must include 3 AI mediation reviews per month total');
});

test('isStarterOpportunityLimitReached detects monthly limit correctly', () => {
  const starterAt1 = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 1 }, limits: {} };
  const starterAt0 = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 0 }, limits: {} };
  const starterOver = { plan: 'starter', usage: { opportunitiesCreatedThisMonth: 2 }, limits: {} };
  const freeAt1   = { plan: 'free', usage: { opportunitiesCreatedThisMonth: 1 }, limits: {} };
  const proPlan   = { plan: 'professional', usage: { opportunitiesCreatedThisMonth: 1 }, limits: {} };

  // At the canonical limit (1) — should be blocked
  assert.equal(isStarterOpportunityLimitReached(starterAt1), true,
    'should be blocked at 1/1');

  // Over limit — should also be blocked
  assert.equal(isStarterOpportunityLimitReached(starterOver), true,
    'should be blocked when over limit');

  // Under limit — action allowed
  assert.equal(isStarterOpportunityLimitReached(starterAt0), false,
    'should NOT be blocked at 0/1');

  // free plan alias also counts as starter
  assert.equal(isStarterOpportunityLimitReached(freeAt1), true,
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
});
