CREATE TABLE IF NOT EXISTS "beta_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "status" text DEFAULT 'applied' NOT NULL,
  "user_id" text,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "beta_applications"
    ADD CONSTRAINT "beta_applications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "beta_applications_email_unique"
  ON "beta_applications" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_applications_status_idx"
  ON "beta_applications" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_applications_user_idx"
  ON "beta_applications" USING btree ("user_id", "created_at");
--> statement-breakpoint

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "dedupe_key" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_unique"
  ON "notifications" USING btree ("user_id", "dedupe_key");
