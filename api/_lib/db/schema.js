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
