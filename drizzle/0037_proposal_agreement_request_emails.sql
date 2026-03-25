CREATE TABLE IF NOT EXISTS "proposal_agreement_request_emails" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL REFERENCES "proposals"("id") ON DELETE cascade,
  "requested_by_role" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "recipient_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "recipient_email" text,
  "deliver_after" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "dedupe_key" text NOT NULL,
  "suppressed_reason" text,
  "suppressed_at" timestamp with time zone,
  "last_error" text,
  "sent_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_agreement_request_emails_dedupe_unique"
  ON "proposal_agreement_request_emails" ("dedupe_key");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_agreement_request_emails_cycle_unique"
  ON "proposal_agreement_request_emails" ("proposal_id", "requested_by_role", "requested_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_agreement_request_emails_status_idx"
  ON "proposal_agreement_request_emails" ("status", "deliver_after");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_agreement_request_emails_proposal_idx"
  ON "proposal_agreement_request_emails" ("proposal_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_agreement_request_emails_recipient_idx"
  ON "proposal_agreement_request_emails" ("recipient_user_id", "created_at");
