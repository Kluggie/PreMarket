CREATE TABLE IF NOT EXISTS "beta_signups" (
  "id" uuid PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "email_normalized" text NOT NULL,
  "user_id" text,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "beta_signups"
    ADD CONSTRAINT "beta_signups_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "beta_signups_email_normalized_unique"
  ON "beta_signups" USING btree ("email_normalized");
--> statement-breakpoint

INSERT INTO "beta_signups" (
  "id",
  "email",
  "email_normalized",
  "user_id",
  "source",
  "created_at"
)
SELECT
  (
    substr(md5(deduped.email_normalized), 1, 8) || '-' ||
    substr(md5(deduped.email_normalized), 9, 4) || '-' ||
    substr(md5(deduped.email_normalized), 13, 4) || '-' ||
    substr(md5(deduped.email_normalized), 17, 4) || '-' ||
    substr(md5(deduped.email_normalized), 21, 12)
  )::uuid AS id,
  deduped.email,
  deduped.email_normalized,
  deduped.user_id,
  deduped.source,
  deduped.created_at
FROM (
  SELECT DISTINCT ON (lower(trim(ba.email)))
    trim(ba.email) AS email,
    lower(trim(ba.email)) AS email_normalized,
    ba.user_id,
    ba.source,
    ba.created_at
  FROM "beta_applications" ba
  WHERE trim(coalesce(ba.email, '')) <> ''
    AND ba.status IN ('applied', 'approved')
  ORDER BY lower(trim(ba.email)), ba.created_at ASC
) deduped
ON CONFLICT ("email_normalized") DO NOTHING;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "beta_signups_created_at_idx"
  ON "beta_signups" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_signups_user_idx"
  ON "beta_signups" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_signups_source_idx"
  ON "beta_signups" USING btree ("source", "created_at");
