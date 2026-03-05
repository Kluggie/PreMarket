import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// bytea column type for storing binary file content in Postgres
const bytea = customType({ dataType() { return 'bytea'; } });

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    fullName: text('full_name'),
    picture: text('picture'),
    role: text('role').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => ({
    usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
    usersCreatedAtIdx: index('users_created_at_idx').on(table.createdAt),
  }),
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    pseudonym: text('pseudonym'),
    userType: text('user_type').notNull().default('individual'),
    title: text('title'),
    tagline: text('tagline'),
    industry: text('industry'),
    location: text('location'),
    bio: text('bio'),
    website: text('website'),
    privacyMode: text('privacy_mode').notNull().default('pseudonymous'),
    socialLinks: jsonb('social_links').notNull().default(sql`'{}'::jsonb`),
    socialLinksAiConsent: boolean('social_links_ai_consent').notNull().default(false),
    notificationSettings: jsonb('notification_settings').notNull().default(sql`'{}'::jsonb`),
    emailVerified: boolean('email_verified').notNull().default(false),
    documentVerified: boolean('document_verified').notNull().default(false),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userProfilesUserUnique: uniqueIndex('user_profiles_user_unique').on(table.userId),
    userProfilesEmailUnique: uniqueIndex('user_profiles_email_unique').on(table.userEmail),
    userProfilesPrivacyIdx: index('user_profiles_privacy_idx').on(table.privacyMode, table.updatedAt),
    userProfilesIndustryIdx: index('user_profiles_industry_idx').on(table.industry, table.updatedAt),
    userProfilesLocationIdx: index('user_profiles_location_idx').on(table.location, table.updatedAt),
  }),
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailVerificationTokensHashUnique: uniqueIndex('email_verification_tokens_hash_unique').on(
      table.tokenHash,
    ),
    emailVerificationTokensUserIdx: index('email_verification_tokens_user_idx').on(
      table.userId,
      table.createdAt,
    ),
    emailVerificationTokensStatusIdx: index('email_verification_tokens_status_idx').on(
      table.status,
      table.expiresAt,
    ),
    emailVerificationTokensExpiryIdx: index('email_verification_tokens_expiry_idx').on(
      table.expiresAt,
    ),
  }),
);

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    pseudonym: text('pseudonym'),
    type: text('type').notNull().default('startup'),
    tagline: text('tagline'),
    industry: text('industry'),
    location: text('location'),
    website: text('website'),
    bio: text('bio'),
    isPublicDirectory: boolean('is_public_directory').notNull().default(false),
    socialLinks: jsonb('social_links').notNull().default(sql`'{}'::jsonb`),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationsPublicIdx: index('organizations_public_idx').on(table.isPublicDirectory, table.updatedAt),
    organizationsTypeIdx: index('organizations_type_idx').on(table.type, table.updatedAt),
    organizationsIndustryIdx: index('organizations_industry_idx').on(table.industry, table.updatedAt),
    organizationsLocationIdx: index('organizations_location_idx').on(table.location, table.updatedAt),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    membershipsUserOrgUnique: uniqueIndex('memberships_user_org_unique').on(
      table.userId,
      table.organizationId,
    ),
    membershipsUserIdx: index('memberships_user_idx').on(table.userId, table.updatedAt),
    membershipsUserEmailIdx: index('memberships_user_email_idx').on(table.userEmail, table.updatedAt),
    membershipsOrgIdx: index('memberships_org_idx').on(table.organizationId, table.updatedAt),
  }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    auditLogsEntityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    auditLogsUserIdx: index('audit_logs_user_idx').on(table.userId, table.createdAt),
  }),
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    deviceLabel: text('device_label'),
    mfaPassedAt: timestamp('mfa_passed_at', { withTimezone: true }),
  },
  (table) => ({
    authSessionsUserIdx: index('auth_sessions_user_idx').on(table.userId, table.lastSeenAt),
    authSessionsActiveIdx: index('auth_sessions_active_idx').on(table.userId, table.revokedAt, table.lastSeenAt),
    authSessionsRevokedIdx: index('auth_sessions_revoked_idx').on(table.revokedAt),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    auditEventsUserIdx: index('audit_events_user_idx').on(table.userId, table.createdAt),
    auditEventsOrgIdx: index('audit_events_org_idx').on(table.orgId, table.createdAt),
    auditEventsTypeIdx: index('audit_events_type_idx').on(table.eventType, table.createdAt),
  }),
);

export const userMfa = pgTable(
  'user_mfa',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    backupCodesHashed: jsonb('backup_codes_hashed').notNull().default(sql`'[]'::jsonb`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userMfaEnabledIdx: index('user_mfa_enabled_idx').on(table.enabledAt),
    userMfaUpdatedIdx: index('user_mfa_updated_idx').on(table.updatedAt),
  }),
);

export const proposals = pgTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    templateId: text('template_id'),
    templateName: text('template_name'),
    proposalType: text('proposal_type').notNull().default('standard'),
    draftStep: integer('draft_step').notNull().default(1),
    sourceProposalId: text('source_proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    documentComparisonId: text('document_comparison_id'),
    partyAEmail: text('party_a_email'),
    partyBEmail: text('party_b_email'),
    summary: text('summary'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    lastSharedAt: timestamp('last_shared_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proposalsUserCreatedIdx: index('proposals_user_created_idx').on(table.userId, table.createdAt),
    proposalsStatusIdx: index('proposals_status_idx').on(table.status),
    proposalsTypeIdx: index('proposals_type_idx').on(table.proposalType, table.createdAt),
    proposalsDraftStepIdx: index('proposals_draft_step_idx').on(table.draftStep, table.updatedAt),
    proposalsSourceProposalIdx: index('proposals_source_proposal_idx').on(
      table.sourceProposalId,
      table.createdAt,
    ),
    proposalsDocumentComparisonIdx: index('proposals_document_comparison_idx').on(
      table.documentComparisonId,
    ),
    proposalsPartyAEmailIdx: index('proposals_party_a_email_idx').on(table.partyAEmail, table.createdAt),
    proposalsPartyBEmailIdx: index('proposals_party_b_email_idx').on(table.partyBEmail, table.createdAt),
    proposalsArchivedAtIdx: index('proposals_archived_at_idx').on(table.archivedAt),
    proposalsClosedAtIdx: index('proposals_closed_at_idx').on(table.closedAt),
  }),
);

export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug'),
    category: text('category').notNull().default('custom'),
    status: text('status').notNull().default('active'),
    partyALabel: text('party_a_label').notNull().default('Party A'),
    partyBLabel: text('party_b_label').notNull().default('Party B'),
    isTool: boolean('is_tool').notNull().default(false),
    viewCount: integer('view_count').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templatesUserIdx: index('templates_user_idx').on(table.userId, table.createdAt),
    templatesUserSlugUnique: uniqueIndex('templates_user_slug_unique').on(table.userId, table.slug),
    templatesSlugIdx: index('templates_slug_idx').on(table.slug),
    templatesStatusIdx: index('templates_status_idx').on(table.status),
    templatesCategoryIdx: index('templates_category_idx').on(table.category),
  }),
);

export const contactRequests = pgTable(
  'contact_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    reason: text('reason').notNull().default('request'),
    type: text('type').notNull().default('general'),
    status: text('status').notNull().default('new'),
    message: text('message').notNull(),
    emailAttempted: boolean('email_attempted').notNull().default(false),
    emailSent: boolean('email_sent').notNull().default(false),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contactRequestsUserIdx: index('contact_requests_user_idx').on(table.userId, table.createdAt),
    contactRequestsStatusIdx: index('contact_requests_status_idx').on(table.status, table.createdAt),
  }),
);

export const betaApplications = pgTable(
  'beta_applications',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    status: text('status').notNull().default('applied'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    betaApplicationsEmailUnique: uniqueIndex('beta_applications_email_unique').on(table.email),
    betaApplicationsStatusIdx: index('beta_applications_status_idx').on(table.status, table.createdAt),
    betaApplicationsUserIdx: index('beta_applications_user_idx').on(table.userId, table.createdAt),
  }),
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().default('general'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    actionUrl: text('action_url'),
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    notificationsUserCreatedIdx: index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    notificationsUserReadIdx: index('notifications_user_read_idx').on(table.userId, table.readAt),
    notificationsUserDismissedIdx: index('notifications_user_dismissed_idx').on(
      table.userId,
      table.dismissedAt,
    ),
    notificationsEventTypeIdx: index('notifications_event_type_idx').on(
      table.eventType,
      table.createdAt,
    ),
    notificationsUserDedupeUnique: uniqueIndex('notifications_user_dedupe_unique').on(
      table.userId,
      table.dedupeKey,
    ),
  }),
);

export const emailDedupes = pgTable(
  'email_dedupes',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    category: text('category').notNull(),
    toEmail: text('to_email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailDedupesKeyUnique: uniqueIndex('email_dedupes_key_unique').on(table.dedupeKey),
    emailDedupesCategoryIdx: index('email_dedupes_category_idx').on(table.category, table.createdAt),
  }),
);

export const templateSections = pgTable(
  'template_sections',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sectionKey: text('section_key'),
    title: text('title').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateSectionsTemplateIdx: index('template_sections_template_idx').on(
      table.templateId,
      table.sortOrder,
    ),
    templateSectionsUserIdx: index('template_sections_user_idx').on(table.userId, table.createdAt),
  }),
);

export const templateQuestions = pgTable(
  'template_questions',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    sectionId: text('section_id').references(() => templateSections.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionKey: text('question_key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    fieldType: text('field_type').notNull().default('text'),
    valueType: text('value_type').notNull().default('text'),
    required: boolean('required').notNull().default(false),
    visibilityDefault: text('visibility_default').notNull().default('full'),
    sortOrder: integer('sort_order').notNull().default(0),
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateQuestionsTemplateIdx: index('template_questions_template_idx').on(
      table.templateId,
      table.sortOrder,
    ),
    templateQuestionsSectionIdx: index('template_questions_section_idx').on(
      table.sectionId,
      table.sortOrder,
    ),
    templateQuestionsUserIdx: index('template_questions_user_idx').on(table.userId, table.createdAt),
    templateQuestionsTemplateKeyUnique: uniqueIndex('template_questions_template_key_unique').on(
      table.templateId,
      table.questionKey,
    ),
  }),
);

export const proposalResponses = pgTable(
  'proposal_responses',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    sectionId: text('section_id'),
    value: text('value'),
    valueType: text('value_type').notNull().default('text'),
    rangeMin: text('range_min'),
    rangeMax: text('range_max'),
    visibility: text('visibility').notNull().default('full'),
    claimType: text('claim_type'),
    enteredByParty: text('entered_by_party'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proposalResponsesProposalIdx: index('proposal_responses_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    proposalResponsesUserIdx: index('proposal_responses_user_idx').on(table.userId, table.createdAt),
    proposalResponsesClaimTypeIdx: index('proposal_responses_claim_type_idx').on(
      table.claimType,
      table.createdAt,
    ),
  }),
);

export const proposalSnapshots = pgTable(
  'proposal_snapshots',
  {
    id: text('id').primaryKey(),
    sourceProposalId: text('source_proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    snapshotVersion: integer('snapshot_version').notNull().default(1),
    status: text('status').notNull().default('active'),
    snapshotData: jsonb('snapshot_data').notNull().default(sql`'{}'::jsonb`),
    snapshotMeta: jsonb('snapshot_meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proposalSnapshotsSourceProposalIdx: index('proposal_snapshots_source_proposal_idx').on(
      table.sourceProposalId,
      table.createdAt,
    ),
    proposalSnapshotsUserIdx: index('proposal_snapshots_user_idx').on(table.userId, table.createdAt),
  }),
);

export const snapshotAccess = pgTable(
  'snapshot_access',
  {
    id: text('id').primaryKey(),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => proposalSnapshots.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    status: text('status').notNull().default('active'),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    snapshotAccessTokenUnique: uniqueIndex('snapshot_access_token_unique').on(table.token),
    snapshotAccessProposalIdx: index('snapshot_access_proposal_idx').on(table.proposalId, table.createdAt),
    snapshotAccessUserIdx: index('snapshot_access_user_idx').on(table.userId, table.createdAt),
  }),
);

export const sharedLinks = pgTable(
  'shared_links',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    recipientEmail: text('recipient_email'),
    status: text('status').notNull().default('active'),
    mode: text('mode').notNull().default('standard'),
    canView: boolean('can_view').notNull().default(true),
    canEdit: boolean('can_edit').notNull().default(false),
    canEditConfidential: boolean('can_edit_confidential').notNull().default(false),
    canReevaluate: boolean('can_reevaluate').notNull().default(false),
    canSendBack: boolean('can_send_back').notNull().default(false),
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    reportMetadata: jsonb('report_metadata').notNull().default(sql`'{}'::jsonb`),
    authorizedUserId: text('authorized_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    authorizedEmail: text('authorized_email'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedLinksTokenUnique: uniqueIndex('shared_links_token_unique').on(table.token),
    sharedLinksProposalIdx: index('shared_links_proposal_idx').on(table.proposalId, table.createdAt),
    sharedLinksUserIdx: index('shared_links_user_idx').on(table.userId, table.createdAt),
    sharedLinksRecipientIdx: index('shared_links_recipient_idx').on(table.recipientEmail, table.createdAt),
    sharedLinksAuthorizedUserIdx: index('shared_links_authorized_user_idx').on(
      table.authorizedUserId,
      table.createdAt,
    ),
    sharedLinksIdempotencyUnique: uniqueIndex('shared_links_idempotency_unique').on(
      table.userId,
      table.idempotencyKey,
    ),
  }),
);

export const sharedLinkVerifications = pgTable(
  'shared_link_verifications',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    invitedEmail: text('invited_email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedLinkVerificationsTokenUnique: uniqueIndex('shared_link_verifications_token_unique').on(
      table.token,
    ),
    sharedLinkVerificationsExpiryIdx: index('shared_link_verifications_expiry_idx').on(table.expiresAt),
  }),
);

export const sharedReportRecipientRevisions = pgTable(
  'shared_report_recipient_revisions',
  {
    id: text('id').primaryKey(),
    sharedLinkId: text('shared_link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    comparisonId: text('comparison_id'),
    actorRole: text('actor_role').notNull().default('recipient'),
    status: text('status').notNull().default('draft'),
    workflowStep: integer('workflow_step').notNull().default(0),
    sharedPayload: jsonb('shared_payload').notNull().default(sql`'{}'::jsonb`),
    recipientConfidentialPayload: jsonb('recipient_confidential_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    editorState: jsonb('editor_state').notNull().default(sql`'{}'::jsonb`),
    previousRevisionId: text('previous_revision_id').references(
      () => sharedReportRecipientRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedReportRecipientRevisionsLinkIdx: index('shared_report_recipient_revisions_link_idx').on(
      table.sharedLinkId,
      table.createdAt,
    ),
    sharedReportRecipientRevisionsDraftIdx: index('shared_report_recipient_revisions_draft_idx').on(
      table.sharedLinkId,
      table.actorRole,
      table.status,
      table.updatedAt,
    ),
    sharedReportRecipientRevisionsUniqueDraft: uniqueIndex(
      'shared_report_recipient_revisions_unique_draft',
    )
      .on(table.sharedLinkId, table.actorRole, table.status)
      .where(sql`${table.status} = 'draft'`),
    sharedReportRecipientRevisionsProposalIdx: index(
      'shared_report_recipient_revisions_proposal_idx',
    ).on(table.proposalId, table.createdAt),
  }),
);

export const sharedReportEvaluationRuns = pgTable(
  'shared_report_evaluation_runs',
  {
    id: text('id').primaryKey(),
    sharedLinkId: text('shared_link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    comparisonId: text('comparison_id'),
    revisionId: text('revision_id')
      .notNull()
      .references(() => sharedReportRecipientRevisions.id, { onDelete: 'cascade' }),
    actorRole: text('actor_role').notNull().default('recipient'),
    status: text('status').notNull().default('pending'),
    resultPublicReport: jsonb('result_public_report').notNull().default(sql`'{}'::jsonb`),
    resultJson: jsonb('result_json').notNull().default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedReportEvaluationRunsLinkIdx: index('shared_report_evaluation_runs_link_idx').on(
      table.sharedLinkId,
      table.createdAt,
    ),
    sharedReportEvaluationRunsRevisionIdx: index('shared_report_evaluation_runs_revision_idx').on(
      table.revisionId,
      table.createdAt,
    ),
    sharedReportEvaluationRunsProposalIdx: index('shared_report_evaluation_runs_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    sharedReportEvaluationRunsStatusIdx: index('shared_report_evaluation_runs_status_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const sharedLinkResponses = pgTable(
  'shared_link_responses',
  {
    id: text('id').primaryKey(),
    sharedLinkId: text('shared_link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    value: text('value'),
    valueType: text('value_type').notNull().default('text'),
    rangeMin: text('range_min'),
    rangeMax: text('range_max'),
    visibility: text('visibility').notNull().default('full'),
    enteredByParty: text('entered_by_party').notNull().default('b'),
    responderEmail: text('responder_email'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedLinkResponsesLinkIdx: index('shared_link_responses_link_idx').on(
      table.sharedLinkId,
      table.createdAt,
    ),
    sharedLinkResponsesProposalIdx: index('shared_link_responses_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    sharedLinkResponsesResponderIdx: index('shared_link_responses_responder_idx').on(
      table.responderEmail,
      table.createdAt,
    ),
  }),
);

export const sharedReportDeliveries = pgTable(
  'shared_report_deliveries',
  {
    id: text('id').primaryKey(),
    sharedLinkId: text('shared_link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sentToEmail: text('sent_to_email').notNull(),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedReportDeliveriesLinkIdx: index('shared_report_deliveries_link_idx').on(
      table.sharedLinkId,
      table.createdAt,
    ),
    sharedReportDeliveriesProposalIdx: index('shared_report_deliveries_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    sharedReportDeliveriesUserIdx: index('shared_report_deliveries_user_idx').on(
      table.userId,
      table.createdAt,
    ),
    sharedReportDeliveriesStatusIdx: index('shared_report_deliveries_status_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const proposalEvaluations = pgTable(
  'proposal_evaluations',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('manual'),
    status: text('status').notNull().default('completed'),
    score: integer('score'),
    summary: text('summary'),
    inputSharedHash: text('input_shared_hash'),
    inputConfHash: text('input_conf_hash'),
    inputSharedLen: integer('input_shared_len'),
    inputConfLen: integer('input_conf_len'),
    inputVersion: integer('input_version'),
    result: jsonb('result').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proposalEvaluationsProposalIdx: index('proposal_evaluations_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    proposalEvaluationsUserIdx: index('proposal_evaluations_user_idx').on(table.userId, table.createdAt),
  }),
);

export const documentComparisons = pgTable(
  'document_comparisons',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    draftStep: integer('draft_step').notNull().default(1),
    partyALabel: text('party_a_label').notNull().default('Document A'),
    partyBLabel: text('party_b_label').notNull().default('Document B'),
    companyName: text('company_name'),
    companyWebsite: text('company_website'),
    docAText: text('doc_a_text'),
    docBText: text('doc_b_text'),
    docASpans: jsonb('doc_a_spans').notNull().default(sql`'[]'::jsonb`),
    docBSpans: jsonb('doc_b_spans').notNull().default(sql`'[]'::jsonb`),
    evaluationResult: jsonb('evaluation_result').notNull().default(sql`'{}'::jsonb`),
    publicReport: jsonb('public_report').notNull().default(sql`'{}'::jsonb`),
    inputs: jsonb('inputs').notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentComparisonsUserIdx: index('document_comparisons_user_idx').on(
      table.userId,
      table.createdAt,
    ),
    documentComparisonsProposalIdx: index('document_comparisons_proposal_idx').on(
      table.proposalId,
      table.createdAt,
    ),
    documentComparisonsStatusIdx: index('document_comparisons_status_idx').on(
      table.status,
      table.updatedAt,
    ),
  }),
);

export const documentComparisonCoachCache = pgTable(
  'document_comparison_coach_cache',
  {
    id: text('id').primaryKey(),
    comparisonId: text('comparison_id')
      .notNull()
      .references(() => documentComparisons.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cacheHash: text('cache_hash').notNull(),
    mode: text('mode').notNull().default('full'),
    intent: text('intent'),
    selectionTarget: text('selection_target'),
    selectionTextHash: text('selection_text_hash'),
    promptVersion: text('prompt_version').notNull().default('coach-v1'),
    provider: text('provider').notNull().default('vertex'),
    model: text('model').notNull().default('unknown'),
    result: jsonb('result').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentComparisonCoachCacheUnique: uniqueIndex('doc_comparison_coach_cache_unique').on(
      table.comparisonId,
      table.cacheHash,
    ),
    documentComparisonCoachCacheComparisonIdx: index('doc_comparison_coach_cache_comparison_idx').on(
      table.comparisonId,
      table.createdAt,
    ),
    documentComparisonCoachCacheUserIdx: index('doc_comparison_coach_cache_user_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export const userDocuments = pgTable(
  'user_documents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    uploaderUserId: text('uploader_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Nullable: legacy rows may still have disk storage_key; new rows use content_bytes
    storageKey: text('storage_key'),
    // File bytes stored directly in Postgres (bytea); null for legacy disk-stored rows
    contentBytes: bytea('content_bytes'),
    status: text('status').notNull().default('processing'),
    extractedText: text('extracted_text'),
    summaryText: text('summary_text'),
    summaryUpdatedAt: timestamp('summary_updated_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDocumentsUserIdx: index('user_documents_user_idx').on(table.userId, table.createdAt),
  }),
);

export const billingReferences = pgTable(
  'billing_references',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    plan: text('plan').notNull().default('starter'),
    status: text('status').notNull().default('inactive'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    billingCustomerUnique: uniqueIndex('billing_customer_unique').on(table.stripeCustomerId),
    billingSubscriptionUnique: uniqueIndex('billing_subscription_unique').on(table.stripeSubscriptionId),
  }),
);
