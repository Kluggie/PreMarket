import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch the Universal Enterprise Onboarding template
    const templates = await base44.asServiceRole.entities.Template.filter({
      slug: 'universal_enterprise_onboarding'
    });

    if (templates.length === 0) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    const template = templates[0];
    const questions = template.questions || [];

    // Options fixes
    const optionsFixes = {
      'update_frequency_self': ['Real-time', 'Hourly', 'Daily', 'Weekly', 'Monthly'],
      'min_update_frequency_counterparty': ['Real-time', 'Hourly', 'Daily', 'Weekly', 'Monthly'],
      'licensing_clarity_self': ['Clear license', 'Some restrictions', 'Unclear/Negotiable'],
      'licensing_constraints_counterparty': ['Clear license', 'Some restrictions', 'Unclear/Negotiable']
    };

    // Sensitive fields that need confidentiality controls
    const sensitiveFields = [
      'pricing_model_self',
      'contracting_readiness_self',
      'insurance_available_self',
      'references_available_self',
      'case_studies_available_self',
      'trust_center_url_self',
      'soc2_iso_evidence_self',
      'pentest_summary_self',
      'dpa_template_self',
      'incident_notification_self',
      'uptime_target_self'
    ];

    // Required fields (all presets)
    const requiredFields = [
      'org_type_self',
      'org_size_self',
      'industry_self',
      'operating_regions_self',
      'website_self',
      'deployment_model_self',
      'support_model_self',
      'mfa_enforced_self',
      'encrypt_transit_self',
      'encrypt_rest_self',
      'data_residency_self',
      'dpa_available_self'
    ];

    // API data questions that should only be required for api_data_provider preset
    const apiDataRequiredFields = [
      'data_categories_self',
      'update_frequency_self',
      'delivery_method_self',
      'licensing_clarity_self'
    ];

    // Module key mappings based on question IDs
    const moduleMap = {
      // org_profile
      'org_type_self': 'org_profile',
      'org_size_self': 'org_profile',
      'industry_self': 'org_profile',
      'operating_regions_self': 'org_profile',
      'website_self': 'org_profile',
      'org_type_counterparty': 'org_profile',
      'org_size_counterparty': 'org_profile',
      'region_constraints_counterparty': 'org_profile',
      
      // security_compliance
      'mfa_enforced_self': 'security_compliance',
      'sso_supported_self': 'security_compliance',
      'encrypt_transit_self': 'security_compliance',
      'encrypt_rest_self': 'security_compliance',
      'soc2_status_self': 'security_compliance',
      'iso27001_self': 'security_compliance',
      'pentest_freq_self': 'security_compliance',
      'trust_center_url_self': 'security_compliance',
      'soc2_iso_evidence_self': 'security_compliance',
      'pentest_summary_self': 'security_compliance',
      'min_soc2_counterparty': 'security_compliance',
      'require_sso_counterparty': 'security_compliance',
      'require_encrypt_rest_counterparty': 'security_compliance',
      'require_pentest_counterparty': 'security_compliance',
      
      // privacy_data_handling
      'data_types_self': 'privacy_data_handling',
      'data_residency_self': 'privacy_data_handling',
      'retention_policy_self': 'privacy_data_handling',
      'dpa_available_self': 'privacy_data_handling',
      'dpa_template_self': 'privacy_data_handling',
      'data_residency_req_counterparty': 'privacy_data_handling',
      'dpa_required_counterparty': 'privacy_data_handling',
      
      // operations_sla
      'uptime_target_self': 'operations_sla',
      'support_model_self': 'operations_sla',
      'incident_notification_self': 'operations_sla',
      'min_uptime_counterparty': 'operations_sla',
      'required_support_counterparty': 'operations_sla',
      'required_incident_notify_counterparty': 'operations_sla',
      
      // implementation_it
      'deployment_model_self': 'implementation_it',
      'integration_methods_self': 'implementation_it',
      'onboarding_time_self': 'implementation_it',
      'preferred_deployment_counterparty': 'implementation_it',
      'must_have_integrations_counterparty': 'implementation_it',
      'target_onboarding_counterparty': 'implementation_it',
      
      // legal_commercial
      'pricing_model_self': 'legal_commercial',
      'contracting_readiness_self': 'legal_commercial',
      'insurance_available_self': 'legal_commercial',
      'preferred_pricing_counterparty': 'legal_commercial',
      'contract_requirement_counterparty': 'legal_commercial',
      'requires_insurance_counterparty': 'legal_commercial',
      
      // references
      'references_available_self': 'references',
      'case_studies_available_self': 'references',
      'will_require_refs_counterparty': 'references',
      
      // api_data
      'data_categories_self': 'api_data',
      'update_frequency_self': 'api_data',
      'delivery_method_self': 'api_data',
      'licensing_clarity_self': 'api_data',
      'required_data_categories_counterparty': 'api_data',
      'min_update_frequency_counterparty': 'api_data',
      'required_delivery_methods_counterparty': 'api_data',
      'licensing_constraints_counterparty': 'api_data'
    };

    // Update questions with module_key, fix options, set confidentiality controls and required flags
    const updatedQuestions = questions.map(q => {
      const moduleKey = moduleMap[q.id];
      if (!moduleKey) {
        console.warn(`No module mapping for question: ${q.id}`);
      }
      
      const updated = {
        ...q,
        module_key: moduleKey || 'org_profile' // default fallback
      };
      
      // Fix options if needed
      if (optionsFixes[q.id]) {
        updated.allowed_values = optionsFixes[q.id];
      }

      // Set confidentiality controls for sensitive fields
      if (sensitiveFields.includes(q.id)) {
        updated.supports_visibility = true;
        updated.visibility_default = 'partial';
      }

      // Set required flag for core required fields
      if (requiredFields.includes(q.id)) {
        updated.required = true;
      }

      // Set preset-specific required for api_data fields
      if (apiDataRequiredFields.includes(q.id)) {
        updated.preset_required = {
          ...updated.preset_required,
          api_data_provider: true
        };
      }
      
      return updated;
    });

    // Update the template
    await base44.asServiceRole.entities.Template.update(template.id, {
      questions: updatedQuestions
    });

    const breakdown = updatedQuestions.reduce((acc, q) => {
      acc[q.module_key] = (acc[q.module_key] || 0) + 1;
      return acc;
    }, {});

    // Count how many api_data questions there are
    const apiDataQuestions = updatedQuestions.filter(q => q.module_key === 'api_data');

    return Response.json({
      success: true,
      message: 'Module keys added and options fixed',
      questionsUpdated: updatedQuestions.length,
      breakdown,
      apiDataCount: apiDataQuestions.length,
      apiDataQuestions: apiDataQuestions.map(q => ({ id: q.id, label: q.label })),
      optionsFixed: Object.keys(optionsFixes)
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error:', error);
    return Response.json({ error: err.message }, { status: 500 });
  }
});