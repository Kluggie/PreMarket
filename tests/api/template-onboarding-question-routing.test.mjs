import assert from 'node:assert/strict';
import test from 'node:test';
import templatesHandler from '../../server/routes/templates/index.ts';
import { getEnabledModules, resolveTemplateKey } from '../../src/lib/templateOnboardingConfig.js';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

const ONBOARDING_CASES = [
  {
    templateKey: 'universal_enterprise_onboarding',
    variantKey: 'vendor_prequal',
    uniqueQuestionId: 'vendor_screening_priority_self',
    excludedQuestionId: 'data_categories_self',
  },
  {
    templateKey: 'universal_enterprise_onboarding',
    variantKey: 'saas_procurement',
    uniqueQuestionId: 'saas_contract_term_self',
    excludedQuestionId: 'rfp_submission_timeline_self',
  },
  {
    templateKey: 'universal_enterprise_onboarding',
    variantKey: 'private_rfp_prequal',
    uniqueQuestionId: 'rfp_submission_timeline_self',
    excludedQuestionId: 'saas_contract_term_self',
  },
  {
    templateKey: 'universal_enterprise_onboarding',
    variantKey: 'api_data_provider',
    uniqueQuestionId: 'data_categories_self',
    excludedQuestionId: 'vendor_screening_priority_self',
  },
  {
    templateKey: 'universal_finance_deal_prequal',
    variantKey: 'investor_fit',
    uniqueQuestionId: 'investor_thesis_self',
    excludedQuestionId: 'acquisition_strategy_self',
  },
  {
    templateKey: 'universal_finance_deal_prequal',
    variantKey: 'm_and_a_fit',
    uniqueQuestionId: 'acquisition_strategy_self',
    excludedQuestionId: 'collateral_available_self',
  },
  {
    templateKey: 'universal_finance_deal_prequal',
    variantKey: 'lending_fit',
    uniqueQuestionId: 'collateral_available_self',
    excludedQuestionId: 'investor_thesis_self',
  },
  {
    templateKey: 'universal_profile_matching',
    variantKey: 'job_fit',
    uniqueQuestionId: 'skills_self',
    excludedQuestionId: 'product_focus_self',
  },
  {
    templateKey: 'universal_profile_matching',
    variantKey: 'beta_access_fit',
    uniqueQuestionId: 'product_focus_self',
    excludedQuestionId: 'founder_background_self',
  },
  {
    templateKey: 'universal_profile_matching',
    variantKey: 'program_fit',
    uniqueQuestionId: 'founder_background_self',
    excludedQuestionId: 'impact_statement_self',
  },
  {
    templateKey: 'universal_profile_matching',
    variantKey: 'grant_fit',
    uniqueQuestionId: 'impact_statement_self',
    excludedQuestionId: 'skills_self',
  },
];

function normalizeParty(question) {
  if (question?.party) return question.party;
  if (question?.is_about_counterparty === true) return 'b';
  if (question?.applies_to_role === 'proposer') return 'a';
  if (question?.applies_to_role === 'recipient') return 'b';
  if (question?.applies_to_role === 'both') return 'both';
  return 'a';
}

function shouldIncludeQuestion(question, modules, variantKey) {
  if (!question?.module_key) return false;

  const presetVisible =
    question?.preset_visible && typeof question.preset_visible === 'object'
      ? question.preset_visible
      : null;

  if (presetVisible && Object.keys(presetVisible).length > 0) {
    if (presetVisible[variantKey] !== undefined) {
      return Boolean(presetVisible[variantKey]);
    }
    return false;
  }

  return modules.includes(question.module_key);
}

function getStep2QuestionIds(template, variantKey) {
  const templateKey = resolveTemplateKey(template);
  const modules = getEnabledModules(templateKey, variantKey);

  return (template?.questions || [])
    .filter((question) => {
      const roleType = question?.role_type || 'party_attribute';
      if (roleType === 'shared_fact') {
        return true;
      }

      const party = normalizeParty(question);
      if (party !== 'a' && party !== 'both') {
        return false;
      }

      return shouldIncludeQuestion(question, modules, variantKey);
    })
    .map((question) => question.id);
}

if (!hasDatabaseUrl()) {
  test('template onboarding question routing (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('step 2 question routing returns full onboarding-specific question banks', async () => {
    await ensureMigrated();
    await resetTables();

    const cookie = makeSessionCookie({ sub: 'routing_owner', email: 'routing_owner@example.com' });
    const req = createMockReq({
      method: 'GET',
      url: '/api/templates',
      headers: { cookie },
    });
    const res = createMockRes();

    await templatesHandler(req, res);
    assert.equal(res.statusCode, 200);

    const templates = res.jsonBody().templates || [];
    assert.equal(Array.isArray(templates), true);

    for (const onboardingCase of ONBOARDING_CASES) {
      const template = templates.find(
        (candidate) => resolveTemplateKey(candidate) === onboardingCase.templateKey,
      );
      assert.equal(Boolean(template), true, `Missing template ${onboardingCase.templateKey}`);

      const step2QuestionIds = getStep2QuestionIds(template, onboardingCase.variantKey);

      assert.equal(
        step2QuestionIds.length > 6,
        true,
        `${onboardingCase.templateKey}/${onboardingCase.variantKey} regressed to <= 6 questions`,
      );

      assert.equal(
        step2QuestionIds.includes(onboardingCase.uniqueQuestionId),
        true,
        `${onboardingCase.templateKey}/${onboardingCase.variantKey} missing expected unique question`,
      );

      assert.equal(
        step2QuestionIds.includes(onboardingCase.excludedQuestionId),
        false,
        `${onboardingCase.templateKey}/${onboardingCase.variantKey} leaked questions from another onboarding type`,
      );
    }
  });
}
