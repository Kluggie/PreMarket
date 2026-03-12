ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "archived_by_party_a_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "archived_by_party_b_at" timestamp with time zone;--> statement-breakpoint

UPDATE "proposals"
SET "archived_by_party_a_at" = coalesce("archived_by_party_a_at", "archived_at")
WHERE "archived_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_archived_by_party_a_at_idx"
  ON "proposals" ("archived_by_party_a_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_archived_by_party_b_at_idx"
  ON "proposals" ("archived_by_party_b_at");
