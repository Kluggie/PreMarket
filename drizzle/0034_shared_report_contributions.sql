CREATE TABLE IF NOT EXISTS "shared_report_contributions" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL REFERENCES "proposals"("id") ON DELETE cascade,
  "comparison_id" text,
  "shared_link_id" text REFERENCES "shared_links"("id") ON DELETE set null,
  "author_role" text NOT NULL,
  "author_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "visibility" text NOT NULL,
  "round_number" integer,
  "sequence_index" integer NOT NULL,
  "source_kind" text DEFAULT 'manual' NOT NULL,
  "content_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "previous_contribution_id" text REFERENCES "shared_report_contributions"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shared_report_contributions_proposal_seq_unique"
  ON "shared_report_contributions" ("proposal_id", "sequence_index");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_report_contributions_proposal_seq_idx"
  ON "shared_report_contributions" ("proposal_id", "sequence_index");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_report_contributions_proposal_visibility_idx"
  ON "shared_report_contributions" ("proposal_id", "visibility", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_report_contributions_proposal_author_idx"
  ON "shared_report_contributions" ("proposal_id", "author_role", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_report_contributions_link_idx"
  ON "shared_report_contributions" ("shared_link_id", "created_at");
