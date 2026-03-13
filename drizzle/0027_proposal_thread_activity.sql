ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "last_thread_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "last_thread_actor_role" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "last_thread_activity_type" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_last_thread_activity_idx"
  ON "proposals" ("last_thread_activity_at", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_last_thread_actor_idx"
  ON "proposals" ("last_thread_actor_role", "last_thread_activity_at");--> statement-breakpoint

WITH latest_thread_event AS (
  SELECT DISTINCT ON ("proposal_id")
    "proposal_id",
    "actor_role",
    "event_type",
    "created_at"
  FROM "proposal_events"
  WHERE
    "event_type" IN ('proposal.sent', 'proposal.received', 'proposal.send_back')
    OR ("event_type" = 'proposal.re_evaluated' AND "actor_role" = 'party_b')
  ORDER BY
    "proposal_id",
    "created_at" DESC,
    CASE
      WHEN "event_type" = 'proposal.send_back' THEN 4
      WHEN "event_type" = 'proposal.received' THEN 3
      WHEN "event_type" = 'proposal.re_evaluated' THEN 2
      WHEN "event_type" = 'proposal.sent' THEN 1
      ELSE 0
    END DESC
)
UPDATE "proposals" AS "p"
SET
  "last_thread_activity_at" = "l"."created_at",
  "last_thread_actor_role" = "l"."actor_role",
  "last_thread_activity_type" = "l"."event_type"
FROM latest_thread_event AS "l"
WHERE "p"."id" = "l"."proposal_id";--> statement-breakpoint

UPDATE "proposals"
SET
  "last_thread_activity_at" = CASE
    WHEN "received_at" IS NOT NULL AND ("sent_at" IS NULL OR "received_at" >= "sent_at") THEN "received_at"
    WHEN "sent_at" IS NOT NULL THEN "sent_at"
    ELSE "last_thread_activity_at"
  END,
  "last_thread_actor_role" = CASE
    WHEN "received_at" IS NOT NULL AND ("sent_at" IS NULL OR "received_at" >= "sent_at") THEN 'party_b'
    WHEN "sent_at" IS NOT NULL THEN 'party_a'
    ELSE "last_thread_actor_role"
  END,
  "last_thread_activity_type" = CASE
    WHEN "received_at" IS NOT NULL AND ("sent_at" IS NULL OR "received_at" >= "sent_at") THEN 'proposal.received.legacy'
    WHEN "sent_at" IS NOT NULL THEN 'proposal.sent.legacy'
    ELSE "last_thread_activity_type"
  END
WHERE
  "last_thread_activity_at" IS NULL
  AND ("sent_at" IS NOT NULL OR "received_at" IS NOT NULL);
