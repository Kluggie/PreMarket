CREATE TABLE IF NOT EXISTS "contact_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "reason" text DEFAULT 'request' NOT NULL,
  "type" text DEFAULT 'general' NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "message" text NOT NULL,
  "email_attempted" boolean DEFAULT false NOT NULL,
  "email_sent" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND constraint_name = 'contact_requests_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "contact_requests"
      ADD CONSTRAINT "contact_requests_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_requests_user_idx" ON "contact_requests" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_requests_status_idx" ON "contact_requests" USING btree ("status", "created_at");
--> statement-breakpoint

-- Legacy table compatibility: older schemas keep a required "title" column.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'templates'
      AND column_name = 'title'
  ) THEN
    UPDATE templates
    SET
      name = COALESCE(NULLIF(name, ''), title),
      title = COALESCE(NULLIF(title, ''), name, 'Template')
    WHERE name IS NULL OR btrim(name) = '' OR title IS NULL OR btrim(title) = '';

    ALTER TABLE templates ALTER COLUMN title DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'template_questions'
      AND column_name = 'prompt'
  ) THEN
    UPDATE template_questions
    SET prompt = COALESCE(NULLIF(prompt, ''), label, question_key, 'Question')
    WHERE prompt IS NULL OR btrim(prompt) = '';

    ALTER TABLE template_questions ALTER COLUMN prompt DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

-- Canonicalize duplicate user+slug rows before adding uniqueness.
WITH ranked_templates AS (
  SELECT
    id,
    user_id,
    slug,
    row_number() OVER (
      PARTITION BY user_id, lower(slug)
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM templates
  WHERE slug IS NOT NULL AND btrim(slug) <> ''
)
UPDATE templates t
SET
  slug = t.slug || '--archived-' || substr(t.id, 1, 8),
  status = CASE
    WHEN lower(coalesce(t.status, '')) IN ('active', 'published') THEN 'archived'
    ELSE coalesce(t.status, 'archived')
  END,
  updated_at = now()
FROM ranked_templates r
WHERE t.id = r.id
  AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "templates_user_slug_unique" ON "templates" USING btree ("user_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_slug_idx" ON "templates" USING btree ("slug");
--> statement-breakpoint

-- Hide legacy fallback templates that do not exist in Recipient Side5 as active defaults.
UPDATE templates
SET status = 'archived', updated_at = now()
WHERE slug IN ('universal_ma_prequal', 'universal_recruiting_prequal')
   OR name IN ('M&A Pre-Qualification', 'Talent Acquisition Pre-Qualification');
--> statement-breakpoint

WITH canonical_template_values AS (
  SELECT
    u.id AS user_id,
    v.slug,
    v.name,
    v.description,
    v.category,
    v.status,
    v.party_a_label,
    v.party_b_label,
    v.sort_order,
    v.metadata
  FROM users u
  CROSS JOIN (
    VALUES
      (
        'universal_enterprise_onboarding',
        'Universal Enterprise Onboarding',
        'Enterprise onboarding pre-qualification for security, privacy, operations, and commercial readiness.',
        'saas_procurement',
        'active',
        'Proposer',
        'Recipient',
        10,
        '{"template_key":"universal_enterprise_onboarding"}'::jsonb
      ),
      (
        'universal_finance_deal_prequal',
        'Universal Finance Deal Pre-Qual',
        'Shared pre-qualification for Investor Fit, M&A Fit, and Lending Fit workflows.',
        'investment',
        'active',
        'Proposer',
        'Party B (Recipient)',
        20,
        '{"template_key":"universal_finance_deal_prequal"}'::jsonb
      ),
      (
        'universal_profile_matching',
        'Universal Profile Matching',
        'Match profiles against requirements across jobs, beta access, programs, and grants.',
        'beta_access',
        'active',
        'Profile Owner',
        'Requirements Owner',
        30,
        '{"template_key":"universal_profile_matching"}'::jsonb
      )
  ) AS v(
    slug,
    name,
    description,
    category,
    status,
    party_a_label,
    party_b_label,
    sort_order,
    metadata
  )
),
upsert_templates AS (
  INSERT INTO templates (
    id,
    user_id,
    name,
    description,
    slug,
    category,
    status,
    party_a_label,
    party_b_label,
    is_tool,
    view_count,
    sort_order,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    'template_' || md5(user_id || ':' || slug),
    user_id,
    name,
    description,
    slug,
    category,
    status,
    party_a_label,
    party_b_label,
    false,
    0,
    sort_order,
    metadata,
    now(),
    now()
  FROM canonical_template_values
  ON CONFLICT (user_id, slug) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    status = EXCLUDED.status,
    party_a_label = EXCLUDED.party_a_label,
    party_b_label = EXCLUDED.party_b_label,
    is_tool = EXCLUDED.is_tool,
    sort_order = EXCLUDED.sort_order,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING id, user_id, slug
),
canonical_templates AS (
  SELECT id, user_id, slug
  FROM templates
  WHERE slug IN (
    'universal_enterprise_onboarding',
    'universal_finance_deal_prequal',
    'universal_profile_matching'
  )
)
DELETE FROM template_questions
WHERE template_id IN (SELECT id FROM canonical_templates);
--> statement-breakpoint

WITH canonical_templates AS (
  SELECT id
  FROM templates
  WHERE slug IN (
    'universal_enterprise_onboarding',
    'universal_finance_deal_prequal',
    'universal_profile_matching'
  )
)
DELETE FROM template_sections
WHERE template_id IN (SELECT id FROM canonical_templates);
--> statement-breakpoint

WITH canonical_templates AS (
  SELECT id, user_id, slug
  FROM templates
  WHERE slug IN (
    'universal_enterprise_onboarding',
    'universal_finance_deal_prequal',
    'universal_profile_matching'
  )
),
section_values AS (
  SELECT
    t.id AS template_id,
    t.user_id,
    sv.section_key,
    sv.title,
    sv.sort_order
  FROM canonical_templates t
  JOIN (
    VALUES
      ('universal_enterprise_onboarding', 'org_profile', 'Organization Profile', 10),
      ('universal_enterprise_onboarding', 'security_compliance', 'Security & Compliance', 20),
      ('universal_enterprise_onboarding', 'legal_commercial', 'Legal & Commercial', 30),
      ('universal_finance_deal_prequal', 'mode_selector', 'Deal Mode', 10),
      ('universal_finance_deal_prequal', 'common_core', 'Common Core', 20),
      ('universal_finance_deal_prequal', 'investor_fit', 'Investor Fit', 30),
      ('universal_finance_deal_prequal', 'm_and_a_fit', 'M&A Fit', 40),
      ('universal_finance_deal_prequal', 'lending_fit', 'Lending Fit', 50),
      ('universal_profile_matching', 'mode_selector', 'Matching Mode', 10),
      ('universal_profile_matching', 'shared_core', 'Shared Core', 20),
      ('universal_profile_matching', 'job_fit', 'Job Fit', 30),
      ('universal_profile_matching', 'beta_access_fit', 'Beta Access Fit', 40),
      ('universal_profile_matching', 'program_fit', 'Program/Accelerator Fit', 50),
      ('universal_profile_matching', 'grant_fit', 'Grant/Scholarship Fit', 60)
  ) AS sv(slug, section_key, title, sort_order)
    ON sv.slug = t.slug
)
INSERT INTO template_sections (
  id,
  template_id,
  user_id,
  section_key,
  title,
  description,
  sort_order,
  created_at,
  updated_at
)
SELECT
  'section_' || md5(template_id || ':' || section_key),
  template_id,
  user_id,
  section_key,
  title,
  NULL,
  sort_order,
  now(),
  now()
FROM section_values;
--> statement-breakpoint

WITH canonical_templates AS (
  SELECT id AS template_id, user_id, slug
  FROM templates
  WHERE slug IN (
    'universal_enterprise_onboarding',
    'universal_finance_deal_prequal',
    'universal_profile_matching'
  )
),
section_ids AS (
  SELECT
    s.template_id,
    s.section_key,
    s.id AS section_id
  FROM template_sections s
  WHERE s.template_id IN (SELECT template_id FROM canonical_templates)
),
question_values AS (
  SELECT
    t.template_id,
    t.user_id,
    q.section_key,
    q.question_key,
    q.label,
    q.description,
    q.field_type,
    q.value_type,
    q.required,
    q.visibility_default,
    q.sort_order,
    q.options,
    q.metadata
  FROM canonical_templates t
  JOIN (
    VALUES
      -- universal_enterprise_onboarding
      ('universal_enterprise_onboarding', 'org_profile', 'org_type_self', 'Organization Type', 'What best describes your organization?', 'select', 'text', true, 'full', 10, '["Startup","SMB","Mid-Market","Enterprise"]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"org_profile","role_type":"party_attribute","supports_visibility":false}'::jsonb),
      ('universal_enterprise_onboarding', 'org_profile', 'org_size_self', 'Organization Size', 'Headcount or company size band.', 'select', 'text', true, 'full', 20, '["1-10","11-50","51-200","201-1000","1000+"]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"org_profile","role_type":"party_attribute","supports_visibility":false}'::jsonb),
      ('universal_enterprise_onboarding', 'org_profile', 'website_self', 'Website', 'Primary website URL.', 'url', 'text', true, 'full', 30, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"org_profile","role_type":"party_attribute","supports_visibility":false}'::jsonb),
      ('universal_enterprise_onboarding', 'org_profile', 'org_type_counterparty', 'Required Counterparty Type', 'Preferred recipient organization profile.', 'select', 'text', false, 'full', 40, '["Startup","SMB","Mid-Market","Enterprise","No preference"]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"org_profile","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false}'::jsonb),
      ('universal_enterprise_onboarding', 'security_compliance', 'mfa_enforced_self', 'MFA Enforced', 'Is MFA enforced for privileged access?', 'boolean', 'text', true, 'full', 50, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"security_compliance","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_enterprise_onboarding', 'security_compliance', 'soc2_status_self', 'SOC 2 Status', 'Most recent SOC 2 posture.', 'select', 'text', true, 'full', 60, '["Not started","In progress","Type I","Type II"]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"security_compliance","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_enterprise_onboarding', 'security_compliance', 'min_soc2_counterparty', 'Minimum SOC 2 Requirement', 'Minimum acceptable counterparty posture.', 'select', 'text', false, 'full', 70, '["None","In progress","Type I","Type II"]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"security_compliance","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false}'::jsonb),
      ('universal_enterprise_onboarding', 'legal_commercial', 'pricing_model_self', 'Pricing Model', 'Describe your commercial model.', 'select', 'text', false, 'partial', 80, '["Subscription","Usage-based","Hybrid","Enterprise contract"]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"legal_commercial","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_enterprise_onboarding', 'legal_commercial', 'preferred_pricing_counterparty', 'Preferred Counterparty Pricing', 'Preferred pricing model from the recipient.', 'select', 'text', false, 'full', 90, '["Subscription","Usage-based","Hybrid","Any"]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"legal_commercial","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false}'::jsonb),

      -- universal_finance_deal_prequal
      ('universal_finance_deal_prequal', 'mode_selector', 'mode', 'Deal Mode', 'Select the deal mode for this proposal.', 'select', 'text', true, 'full', 10, '["Investor Fit","M&A Fit","Lending Fit"]'::jsonb, '{"party":"a","applies_to_role":"both","module_key":"mode_selector","role_type":"shared_fact","supports_visibility":false}'::jsonb),
      ('universal_finance_deal_prequal', 'common_core', 'deal_stage_self', 'Deal Stage', 'Current stage of the opportunity.', 'select', 'text', true, 'full', 20, '["Sourcing","Diligence","Negotiation","Closing"]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"common_core","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_finance_deal_prequal', 'common_core', 'check_size_self', 'Target Check Size', 'Typical check or deal size.', 'text', 'text', true, 'partial', 30, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"common_core","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_finance_deal_prequal', 'common_core', 'preferred_check_size_counterparty', 'Counterparty Size Requirement', 'Preferred size expectation for the recipient.', 'text', 'text', false, 'full', 40, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"common_core","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false}'::jsonb),
      ('universal_finance_deal_prequal', 'investor_fit', 'investor_thesis_self', 'Investor Thesis', 'What investment thesis drives interest?', 'textarea', 'text', false, 'full', 50, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"investor_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"investor_fit":true}}'::jsonb),
      ('universal_finance_deal_prequal', 'investor_fit', 'target_sector_counterparty', 'Target Sector Requirement', 'What sector focus does the recipient require?', 'text', 'text', false, 'full', 60, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"investor_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"investor_fit":true}}'::jsonb),
      ('universal_finance_deal_prequal', 'm_and_a_fit', 'acquisition_strategy_self', 'Acquisition Strategy', 'Strategic rationale for acquisition.', 'textarea', 'text', false, 'full', 70, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"m_and_a_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"m_and_a_fit":true}}'::jsonb),
      ('universal_finance_deal_prequal', 'm_and_a_fit', 'target_revenue_counterparty', 'Target Revenue Requirement', 'Revenue profile required by recipient.', 'text', 'text', false, 'full', 80, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"m_and_a_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"m_and_a_fit":true}}'::jsonb),
      ('universal_finance_deal_prequal', 'lending_fit', 'collateral_available_self', 'Collateral Available', 'Can you provide qualifying collateral?', 'boolean', 'text', false, 'full', 90, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"lending_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"lending_fit":true}}'::jsonb),
      ('universal_finance_deal_prequal', 'lending_fit', 'minimum_interest_rate_counterparty', 'Maximum Interest Requirement', 'Recipient rate expectation or ceiling.', 'text', 'text', false, 'full', 100, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"lending_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"lending_fit":true}}'::jsonb),

      -- universal_profile_matching
      ('universal_profile_matching', 'mode_selector', 'mode', 'Profile Matching Mode', 'Select the matching mode for this evaluation.', 'select', 'text', true, 'full', 10, '["Job Fit","Beta Access Fit","Program/Accelerator Fit","Grant/Scholarship Fit"]'::jsonb, '{"party":"a","applies_to_role":"both","module_key":"mode_selector","role_type":"shared_fact","supports_visibility":false}'::jsonb),
      ('universal_profile_matching', 'shared_core', 'profile_headline_self', 'Profile Summary', 'Concise summary of your profile.', 'textarea', 'text', true, 'full', 20, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"shared_core","role_type":"party_attribute","supports_visibility":true}'::jsonb),
      ('universal_profile_matching', 'shared_core', 'requirements_summary_counterparty', 'Requirements Summary', 'High-level requirements from recipient.', 'textarea', 'text', false, 'full', 30, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"shared_core","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false}'::jsonb),
      ('universal_profile_matching', 'job_fit', 'skills_self', 'Core Skills', 'List your strongest skills.', 'textarea', 'text', false, 'full', 40, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"job_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"job_fit":true}}'::jsonb),
      ('universal_profile_matching', 'job_fit', 'required_skills_counterparty', 'Required Skills', 'Recipient-required skills.', 'textarea', 'text', false, 'full', 50, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"job_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"job_fit":true}}'::jsonb),
      ('universal_profile_matching', 'beta_access_fit', 'product_focus_self', 'Product Focus', 'What product or domain do you focus on?', 'text', 'text', false, 'full', 60, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"beta_access_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"beta_access_fit":true}}'::jsonb),
      ('universal_profile_matching', 'beta_access_fit', 'ideal_tester_profile_counterparty', 'Ideal Tester Profile', 'Recipient description of ideal tester/user profile.', 'textarea', 'text', false, 'full', 70, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"beta_access_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"beta_access_fit":true}}'::jsonb),
      ('universal_profile_matching', 'program_fit', 'founder_background_self', 'Founder/Operator Background', 'Relevant background and accomplishments.', 'textarea', 'text', false, 'full', 80, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"program_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"program_fit":true}}'::jsonb),
      ('universal_profile_matching', 'program_fit', 'program_stage_counterparty', 'Program Stage Requirement', 'Required stage for admitted profiles.', 'select', 'text', false, 'full', 90, '["Idea","MVP","Growth","Scale"]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"program_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"program_fit":true}}'::jsonb),
      ('universal_profile_matching', 'grant_fit', 'impact_statement_self', 'Impact Statement', 'Describe expected impact and outcomes.', 'textarea', 'text', false, 'full', 100, '[]'::jsonb, '{"party":"a","applies_to_role":"proposer","module_key":"grant_fit","role_type":"party_attribute","supports_visibility":true,"preset_required":{"grant_fit":true}}'::jsonb),
      ('universal_profile_matching', 'grant_fit', 'eligibility_requirements_counterparty', 'Eligibility Requirements', 'Recipient eligibility and evidence requirements.', 'textarea', 'text', false, 'full', 110, '[]'::jsonb, '{"party":"b","applies_to_role":"recipient","module_key":"grant_fit","role_type":"counterparty_observation","is_about_counterparty":true,"supports_visibility":false,"preset_required":{"grant_fit":true}}'::jsonb)
  ) AS q(
    slug,
    section_key,
    question_key,
    label,
    description,
    field_type,
    value_type,
    required,
    visibility_default,
    sort_order,
    options,
    metadata
  )
    ON q.slug = t.slug
)
INSERT INTO template_questions (
  id,
  template_id,
  section_id,
  user_id,
  question_key,
  label,
  description,
  field_type,
  value_type,
  required,
  visibility_default,
  sort_order,
  options,
  metadata,
  created_at,
  updated_at
)
SELECT
  'question_' || md5(q.template_id || ':' || q.question_key),
  q.template_id,
  s.section_id,
  q.user_id,
  q.question_key,
  q.label,
  q.description,
  q.field_type,
  q.value_type,
  q.required,
  q.visibility_default,
  q.sort_order,
  q.options,
  q.metadata,
  now(),
  now()
FROM question_values q
JOIN section_ids s
  ON s.template_id = q.template_id
 AND s.section_key = q.section_key;
