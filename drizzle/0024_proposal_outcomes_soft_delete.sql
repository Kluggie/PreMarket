ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "party_a_outcome" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "party_a_outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "party_b_outcome" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "party_b_outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "deleted_by_party_a_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "deleted_by_party_b_at" timestamp with time zone;--> statement-breakpoint

UPDATE "proposals"
SET
  "party_a_outcome" = CASE
    WHEN lower(coalesce("status", '')) = 'won' THEN 'won'
    WHEN lower(coalesce("status", '')) = 'lost' THEN 'lost'
    ELSE "party_a_outcome"
  END,
  "party_b_outcome" = CASE
    WHEN lower(coalesce("status", '')) = 'won' THEN 'won'
    WHEN lower(coalesce("status", '')) = 'lost' THEN 'lost'
    ELSE "party_b_outcome"
  END,
  "party_a_outcome_at" = CASE
    WHEN lower(coalesce("status", '')) IN ('won', 'lost')
      THEN coalesce("party_a_outcome_at", "closed_at", "updated_at", "created_at", now())
    ELSE "party_a_outcome_at"
  END,
  "party_b_outcome_at" = CASE
    WHEN lower(coalesce("status", '')) IN ('won', 'lost')
      THEN coalesce("party_b_outcome_at", "closed_at", "updated_at", "created_at", now())
    ELSE "party_b_outcome_at"
  END,
  "closed_at" = CASE
    WHEN lower(coalesce("status", '')) IN ('won', 'lost')
      THEN coalesce("closed_at", "updated_at", "created_at", now())
    ELSE "closed_at"
  END
WHERE lower(coalesce("status", '')) IN ('won', 'lost');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_party_a_outcome_idx"
  ON "proposals" ("party_a_outcome", "updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_party_b_outcome_idx"
  ON "proposals" ("party_b_outcome", "updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_deleted_by_party_a_at_idx"
  ON "proposals" ("deleted_by_party_a_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_deleted_by_party_b_at_idx"
  ON "proposals" ("deleted_by_party_b_at");
