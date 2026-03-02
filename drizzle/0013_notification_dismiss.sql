ALTER TABLE "notifications" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_dismissed_idx" ON "notifications" ("user_id","dismissed_at");
