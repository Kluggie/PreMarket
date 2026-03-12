ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "reconstructed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "reconstructed_from_version_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "recovery_source" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_reconstructed_at_idx"
  ON "proposals" ("reconstructed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_recovery_source_idx"
  ON "proposals" ("recovery_source");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proposal_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "proposal_user_id" text,
  "actor_user_id" text,
  "actor_role" text,
  "milestone" text DEFAULT 'snapshot' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "snapshot_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_versions_proposal_idx"
  ON "proposal_versions" ("proposal_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_versions_proposal_user_idx"
  ON "proposal_versions" ("proposal_user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_versions_actor_user_idx"
  ON "proposal_versions" ("actor_user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_versions_milestone_idx"
  ON "proposal_versions" ("milestone", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proposal_events" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "proposal_user_id" text,
  "actor_user_id" text,
  "actor_role" text,
  "proposal_version_id" text,
  "request_id" text,
  "event_type" text NOT NULL,
  "event_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_events_proposal_idx"
  ON "proposal_events" ("proposal_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_proposal_user_idx"
  ON "proposal_events" ("proposal_user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_actor_user_idx"
  ON "proposal_events" ("actor_user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_type_idx"
  ON "proposal_events" ("event_type", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_version_idx"
  ON "proposal_events" ("proposal_version_id");
