ALTER TABLE "proposals" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_archived_at_idx" ON "proposals" ("archived_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_closed_at_idx" ON "proposals" ("closed_at");
