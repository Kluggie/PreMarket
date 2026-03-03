ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "authorized_user_id" text;--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "authorized_email" text;--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "authorized_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'shared_links'
      AND constraint_name = 'shared_links_authorized_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "shared_links"
      ADD CONSTRAINT "shared_links_authorized_user_id_users_id_fk"
      FOREIGN KEY ("authorized_user_id")
      REFERENCES "users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_links_authorized_user_idx" ON "shared_links" ("authorized_user_id", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shared_link_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "invited_email" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shared_link_verifications_token_unique"
  ON "shared_link_verifications" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_link_verifications_expiry_idx"
  ON "shared_link_verifications" ("expires_at");
