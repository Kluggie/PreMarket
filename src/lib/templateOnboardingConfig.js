export const TEMPLATE_ONBOARDING_CONFIG = {
  universal_enterprise_onboarding: {
    valueSource: 'preset',
    options: [
      {
        key: 'vendor_prequal',
        label: 'Vendor Pre-Qualification',
        modules: [
          'org_profile',
          'security_compliance',
          'privacy_data_handling',
          'operations_sla',
          'implementation_it',
          'legal_commercial',
          'references',
          'vendor_specific',
        ],
      },
      {
        key: 'saas_procurement',
        label: 'SaaS Procurement',
        modules: [
          'org_profile',
          'security_compliance',
          'privacy_data_handling',
          'operations_sla',
          'implementation_it',
          'legal_commercial',
          'references',
          'saas_specific',
        ],
      },
      {
        key: 'private_rfp_prequal',
        label: 'Private RFP Pre-Qualification',
        modules: [
          'org_profile',
          'security_compliance',
          'privacy_data_handling',
          'operations_sla',
          'implementation_it',
          'legal_commercial',
          'references',
          'rfp_specific',
        ],
      },
      {
        key: 'api_data_provider',
        label: 'API / Data Provider Matching',
        modules: [
          'org_profile',
          'security_compliance',
          'privacy_data_handling',
          'operations_sla',
          'implementation_it',
          'legal_commercial',
          'references',
          'saas_specific',
          'api_data',
        ],
      },
    ],
  },
  universal_finance_deal_prequal: {
    valueSource: 'mode',
    options: [
      {
        key: 'investor_fit',
        value: 'Investor Fit',
        label: 'Investor Fit',
        modules: ['mode_selector', 'common_core', 'investor_fit'],
      },
      {
        key: 'm_and_a_fit',
        value: 'M&A Fit',
        label: 'M&A Fit',
        modules: ['mode_selector', 'common_core', 'm_and_a_fit'],
      },
      {
        key: 'lending_fit',
        value: 'Lending Fit',
        label: 'Lending Fit',
        modules: ['mode_selector', 'common_core', 'lending_fit'],
      },
    ],
  },
  universal_profile_matching: {
    valueSource: 'mode',
    options: [
      {
        key: 'job_fit',
        value: 'Job Fit',
        label: 'Job Match',
        modules: ['mode_selector', 'shared_core', 'job_fit'],
      },
      {
        key: 'beta_access_fit',
        value: 'Beta Access Fit',
        label: 'Beta Access Match',
        modules: ['mode_selector', 'shared_core', 'beta_access_fit'],
      },
      {
        key: 'program_fit',
        value: 'Program/Accelerator Fit',
        label: 'Program/Accelerator Match',
        modules: ['mode_selector', 'shared_core', 'program_fit'],
      },
      {
        key: 'grant_fit',
        value: 'Grant/Scholarship Fit',
        label: 'Grant/Scholarship Match',
        modules: ['mode_selector', 'shared_core', 'grant_fit'],
      },
    ],
  },
};

export const TEMPLATE_KEY_BY_NAME = {
  'Universal Enterprise Onboarding': 'universal_enterprise_onboarding',
  'Universal Finance Deal Pre-Qual': 'universal_finance_deal_prequal',
  'Universal Profile Matching': 'universal_profile_matching',
};

export function resolveTemplateKey(template) {
  const candidate = String(template?.slug || template?.template_key || '').trim().toLowerCase();
  if (TEMPLATE_ONBOARDING_CONFIG[candidate]) {
    return candidate;
  }

  return TEMPLATE_KEY_BY_NAME[String(template?.name || '').trim()] || '';
}

export function getModeOption(templateKey, modeValue) {
  const config = TEMPLATE_ONBOARDING_CONFIG[templateKey];
  if (!config || config.valueSource !== 'mode') {
    return null;
  }

  return config.options.find((option) => option.value === modeValue) || null;
}

export function getEnabledModules(templateKey, variantKey) {
  const config = TEMPLATE_ONBOARDING_CONFIG[templateKey];
  if (!config) {
    return [];
  }

  if (!variantKey) {
    return config.valueSource === 'mode' ? ['mode_selector'] : [];
  }

  const selectedOption = config.options.find((option) => option.key === variantKey) || null;
  return Array.isArray(selectedOption?.modules) ? selectedOption.modules : [];
}
