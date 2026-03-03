CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "ip_hash" text,
  "user_agent" text,
  "device_label" text,
  "mfa_passed_at" timestamp with time zone
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'auth_sessions'
      AND constraint_name = 'auth_sessions_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "auth_sessions"
      ADD CONSTRAINT "auth_sessions_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" ("user_id", "last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_active_idx" ON "auth_sessions" ("user_id", "revoked_at", "last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_revoked_idx" ON "auth_sessions" ("revoked_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "org_id" text,
  "event_type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ip_hash" text,
  "user_agent" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'audit_events'
      AND constraint_name = 'audit_events_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "audit_events"
      ADD CONSTRAINT "audit_events_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'audit_events'
      AND constraint_name = 'audit_events_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "audit_events"
      ADD CONSTRAINT "audit_events_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id")
      REFERENCES "organizations"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_user_idx" ON "audit_events" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_org_idx" ON "audit_events" ("org_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_type_idx" ON "audit_events" ("event_type", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_mfa" (
  "user_id" text PRIMARY KEY NOT NULL,
  "totp_secret_encrypted" text,
  "enabled_at" timestamp with time zone,
  "backup_codes_hashed" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_mfa'
      AND constraint_name = 'user_mfa_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "user_mfa"
      ADD CONSTRAINT "user_mfa_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_enabled_idx" ON "user_mfa" ("enabled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_updated_idx" ON "user_mfa" ("updated_at");
