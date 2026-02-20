import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
    partyAEmail: text('party_a_email'),
    partyBEmail: text('party_b_email'),
    summary: text('summary'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proposalsUserCreatedIdx: index('proposals_user_created_idx').on(table.userId, table.createdAt),
    proposalsStatusIdx: index('proposals_status_idx').on(table.status),
    proposalsPartyAEmailIdx: index('proposals_party_a_email_idx').on(table.partyAEmail, table.createdAt),
    proposalsPartyBEmailIdx: index('proposals_party_b_email_idx').on(table.partyBEmail, table.createdAt),
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
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    reportMetadata: jsonb('report_metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sharedLinksTokenUnique: uniqueIndex('shared_links_token_unique').on(table.token),
    sharedLinksProposalIdx: index('shared_links_proposal_idx').on(table.proposalId, table.createdAt),
    sharedLinksUserIdx: index('shared_links_user_idx').on(table.userId, table.createdAt),
    sharedLinksIdempotencyUnique: uniqueIndex('shared_links_idempotency_unique').on(
      table.userId,
      table.idempotencyKey,
    ),
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
