-- Migration 0035 was recorded in __drizzle_migrations but the ALTER TABLE was
-- not applied on the production database. This migration adds the column using
-- IF NOT EXISTS so it is safe to run regardless of current schema state.
ALTER TABLE "beta_signups" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
