import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PLAN_FEATURES, PLAN_LIMITS } from '../../src/lib/planFeatures.js';
import { PLAN_AI_ASSISTANCE_LIMITS } from '../../server/_lib/starter-entitlements.ts';

const pricingSource = readFileSync(new URL('../../src/pages/Pricing.jsx', import.meta.url), 'utf8');
const billingSource = readFileSync(new URL('../../src/pages/Billing.jsx', import.meta.url), 'utf8');
const allFeatureText = Object.values(PLAN_FEATURES)
  .flat()
  .map((feature) => feature.text)
  .join('\n');
const pricingAndFeatures = `${pricingSource}\n${allFeatureText}`;

test('pricing page uses review-credit language without unlimited fixed-plan AI reviews', () => {
  assert.match(pricingAndFeatures, /AI mediation reviews/);
  assert.doesNotMatch(allFeatureText, /AI evaluations/);
  assert.doesNotMatch(pricingAndFeatures, /Unlimited AI evaluations/);
  assert.doesNotMatch(pricingAndFeatures, /Unlimited AI mediation reviews/);
  assert.doesNotMatch(pricingAndFeatures, /3 AI mediation reviews per round/);
});

test('pricing page shows only the public Starter, Professional, and Enterprise plan cards', () => {
  for (const planName of ['Starter', 'Professional', 'Enterprise']) {
    assert.match(pricingSource, new RegExp(`name: '${planName}'`));
  }

  assert.doesNotMatch(pricingSource, /name: 'Team'/);
  assert.match(pricingSource, /price: 'A\$0'/);
  assert.match(pricingSource, /price: 'A\$49\.99'/);
  assert.match(pricingSource, /price: 'Custom'/);
  assert.doesNotMatch(pricingSource, /A\$199\.99/);
  assert.doesNotMatch(pricingSource, /100 AI mediation reviews\/month/);
  assert.doesNotMatch(pricingSource, /3-5 users/);
  assert.doesNotMatch(pricingSource, /Shared workspace/);
});

test('plan limit config keeps Team internally while public pricing hides it', () => {
  assert.equal(PLAN_LIMITS.starter.opportunitiesPerMonth, 1);
  assert.equal(PLAN_LIMITS.starter.activeOpportunities, 1);
  assert.equal(PLAN_LIMITS.starter.aiEvaluationsPerMonth, 3);
  assert.equal(PLAN_LIMITS.professional.aiEvaluationsPerMonth, 20);
  assert.equal(PLAN_LIMITS.team.aiEvaluationsPerMonth, 100);
  assert.equal(PLAN_LIMITS.enterprise.aiEvaluationsPerMonth, 'custom');
  assert.equal(PLAN_AI_ASSISTANCE_LIMITS.starter, 20);
  assert.equal(PLAN_AI_ASSISTANCE_LIMITS.professional, 200);
  assert.ok(PLAN_AI_ASSISTANCE_LIMITS.professional > PLAN_AI_ASSISTANCE_LIMITS.starter);

  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '1 opportunity per month'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '1 active opportunity at once'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === '3 AI mediation reviews per month'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === 'Basic Step 2 suggestion tools'));
  assert.ok(PLAN_FEATURES.starter.some((feature) => feature.text === 'Upgrade for additional review capacity'));
  assert.ok(PLAN_FEATURES.professional.some((feature) => feature.text === '20 AI mediation reviews per month'));
  assert.ok(PLAN_FEATURES.professional.some((feature) => feature.text === 'Expanded Step 2 suggestion capacity'));
  assert.equal(PLAN_FEATURES.professional.some((feature) => feature.text === 'Step 2 suggestion tools'), false);
  assert.ok(PLAN_FEATURES.team.some((feature) => feature.text === '100 AI mediation reviews/month for the team account'));
  assert.ok(PLAN_FEATURES.team.some((feature) => feature.text === 'Team setup for 3-5 users'));
  assert.ok(PLAN_FEATURES.team.some((feature) => feature.text === 'Shared workspace setup'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Custom AI mediation review volume'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Advanced privacy and security review'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Custom onboarding and workflow setup'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Admin controls and usage oversight'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Advanced reporting and data analytics'));
  assert.ok(PLAN_FEATURES.enterprise.some((feature) => feature.text === 'Priority support and response targets'));
});

test('billing page has no public Team self-serve price or upgrade path', () => {
  assert.doesNotMatch(billingSource, /A\$199\.99/);
  assert.doesNotMatch(billingSource, /Upgrade to Team/);
  assert.doesNotMatch(billingSource, /View Team/);
  assert.match(billingSource, /Team account/);
});

test('pricing page preserves collaboration and non-automatic top-up copy', () => {
  assert.match(pricingSource, /invited counterparties can participate in shared opportunities for free/i);
  assert.match(allFeatureText, /Invited counterparties participate for free/);
  assert.match(allFeatureText, /Invite counterparties for free/);
  assert.match(allFeatureText, /Additional review credits on request/);
  assert.match(allFeatureText, /Discounted extra review credits/);
  assert.doesNotMatch(pricingAndFeatures, /A\$3 per additional review/);
  assert.doesNotMatch(pricingAndFeatures, /Upgrade required for more review capacity/);
});

test('trial offer maps to Professional review credits without unlimited AI review copy', () => {
  assert.match(pricingSource, /Limited-time offer: 30 days of Professional free for the first 50 users/);
  assert.match(pricingSource, /20 AI mediation review credits/);
  assert.match(pricingSource, /Access expires automatically after 30 days/);
  assert.doesNotMatch(pricingSource, /unlimited AI/i);
  assert.doesNotMatch(pricingSource, /Free Professional/);
  assert.doesNotMatch(pricingSource, /Free forever Professional/);
});
