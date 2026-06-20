import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PLAN_FEATURES, PLAN_LIMITS } from '../../src/lib/planFeatures.js';

const pricingSource = readFileSync(new URL('../../src/pages/Pricing.jsx', import.meta.url), 'utf8');
const allFeatureText = Object.values(PLAN_FEATURES)
  .flat()
  .map((feature) => feature.text)
  .join('\n');
const pricingAndFeatures = `${pricingSource}\n${allFeatureText}`;

test('pricing page uses review-credit language without unlimited fixed-plan AI reviews', () => {
  assert.match(pricingAndFeatures, /AI mediation reviews/);
  assert.doesNotMatch(pricingAndFeatures, /Unlimited AI evaluations/);
  assert.doesNotMatch(pricingAndFeatures, /Unlimited AI mediation reviews/);
  assert.doesNotMatch(pricingAndFeatures, /3 AI mediation reviews per round/);
});

test('pricing page shows the four requested plan cards and prices', () => {
  for (const planName of ['Starter', 'Professional', 'Team', 'Enterprise']) {
    assert.match(pricingSource, new RegExp(`name: '${planName}'`));
  }

  assert.match(pricingSource, /price: 'A\$0'/);
  assert.match(pricingSource, /price: 'A\$49\.99'/);
  assert.match(pricingSource, /price: 'A\$199\.99'/);
  assert.match(pricingSource, /price: 'Custom'/);
});

test('plan limit config matches visible pricing limits', () => {
  assert.equal(PLAN_LIMITS.starter.opportunitiesPerMonth, 1);
  assert.equal(PLAN_LIMITS.starter.activeOpportunities, 1);
  assert.equal(PLAN_LIMITS.starter.aiEvaluationsPerMonth, 3);
  assert.equal(PLAN_LIMITS.professional.aiEvaluationsPerMonth, 20);
  assert.equal(PLAN_LIMITS.team.aiEvaluationsPerMonth, 100);
  assert.equal(PLAN_LIMITS.enterprise.aiEvaluationsPerMonth, 'custom');

  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '1 opportunity per month'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '1 active opportunity at once'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '3 AI mediation reviews per month'));
  assert.ok(PLAN_FEATURES.professional.some((feature) => feature.text === '20 AI mediation reviews per month'));
  assert.ok(PLAN_FEATURES.team.some((feature) => feature.text === '100 AI mediation reviews per month'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Custom AI mediation review volume'));
});

test('pricing page preserves collaboration and non-automatic top-up copy', () => {
  assert.match(pricingSource, /invited counterparties can participate in shared opportunities for free/i);
  assert.match(allFeatureText, /Invited counterparties participate for free/);
  assert.match(allFeatureText, /Invite counterparties for free/);
  assert.match(allFeatureText, /Additional review credits on request/);
  assert.match(allFeatureText, /Discounted extra review credits/);
  assert.doesNotMatch(pricingAndFeatures, /A\$3 per additional review/);
});

test('trial offer maps to Professional review credits without unlimited AI review copy', () => {
  assert.match(pricingSource, /30 days of Professional free/);
  assert.match(pricingSource, /20 AI mediation review credits/);
  assert.doesNotMatch(pricingSource, /unlimited AI/i);
});
