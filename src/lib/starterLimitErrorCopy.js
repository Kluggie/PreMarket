import {
  STARTER_PLAN_LIMITS,
  formatBytes,
  formatCount,
  isStarterPlanTier,
} from './starterPlanLimits.js';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getApiErrorCode(error) {
  return asText(
    error?.body?.error?.failure_code ||
      error?.body?.error?.code ||
      error?.body?.code ||
      error?.code,
  );
}

export function getStarterLimitErrorCopy(error, context = 'general') {
  const code = getApiErrorCode(error);
  if (!code.startsWith('starter_')) {
    return null;
  }

  const planFromPayload = asText(error?.body?.error?.plan || error?.body?.plan || 'starter');
  if (!isStarterPlanTier(planFromPayload)) {
    return null;
  }

  if (code === 'starter_opportunities_monthly_limit_reached') {
    return `Starter allows ${formatCount(STARTER_PLAN_LIMITS.opportunitiesPerMonth)} new opportunities per month. You can create another next month or upgrade your plan.`;
  }

  if (code === 'starter_active_opportunities_limit_reached') {
    return `Starter allows ${formatCount(STARTER_PLAN_LIMITS.activeOpportunities)} active opportunities at once. Close or archive one, then try again.`;
  }

  if (code === 'starter_ai_evaluations_monthly_limit_reached') {
    if (context === 'evaluation') {
      return `Starter includes ${formatCount(STARTER_PLAN_LIMITS.aiEvaluationsPerMonth)} AI evaluations per month. This opportunity is saved; run AI mediation again next month or upgrade.`;
    }
    return `Starter includes ${formatCount(STARTER_PLAN_LIMITS.aiEvaluationsPerMonth)} AI evaluations per month. Try again next month or upgrade your plan.`;
  }

  if (code === 'starter_upload_per_opportunity_limit_exceeded') {
    return `Starter allows up to ${formatBytes(STARTER_PLAN_LIMITS.uploadBytesPerOpportunity)} of uploads per opportunity. Remove a file or upload a smaller file.`;
  }

  if (code === 'starter_upload_monthly_limit_exceeded') {
    return `Starter includes ${formatBytes(STARTER_PLAN_LIMITS.uploadBytesPerMonth)} of uploads per month. Try again next month or upgrade your plan.`;
  }

  return null;
}
