CREATE TABLE IF NOT EXISTS "user_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "user_email" text NOT NULL,
  "pseudonym" text,
  "user_type" text DEFAULT 'individual' NOT NULL,
  "title" text,
  "industry" text,
  "location" text,
  "bio" text,
  "website" text,
  "privacy_mode" text DEFAULT 'pseudonymous' NOT NULL,
  "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "social_links_ai_consent" boolean DEFAULT false NOT NULL,
  "notification_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "document_verified" boolean DEFAULT false NOT NULL,
  "verification_status" text DEFAULT 'unverified' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "pseudonym" text,
  "type" text DEFAULT 'startup' NOT NULL,
  "industry" text,
  "location" text,
  "website" text,
  "bio" text,
  "is_public_directory" boolean DEFAULT false NOT NULL,
  "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verification_status" text DEFAULT 'unverified' NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "user_email" text NOT NULL,
  "organization_id" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "user_id" text,
  "user_email" text,
  "action" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_profiles_user_unique" ON "user_profiles" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_profiles_email_unique" ON "user_profiles" USING btree ("user_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_privacy_idx" ON "user_profiles" USING btree ("privacy_mode", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_industry_idx" ON "user_profiles" USING btree ("industry", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_location_idx" ON "user_profiles" USING btree ("location", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "organizations_public_idx" ON "organizations" USING btree ("is_public_directory", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_type_idx" ON "organizations" USING btree ("type", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_industry_idx" ON "organizations" USING btree ("industry", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_location_idx" ON "organizations" USING btree ("location", "updated_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "memberships_user_org_unique" ON "memberships" USING btree ("user_id", "organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_email_idx" ON "memberships" USING btree ("user_email", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_org_idx" ON "memberships" USING btree ("organization_id", "updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type", "entity_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id", "created_at");
