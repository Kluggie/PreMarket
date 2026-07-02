-- Add review lock to track when a revision has been successfully reviewed
ALTER TABLE "shared_report_recipient_revisions" 
ADD COLUMN "is_review_locked" boolean DEFAULT false NOT NULL;

--> statement-breakpoint

-- Index for finding locked revisions
CREATE INDEX IF NOT EXISTS "shared_report_recipient_revisions_locked_idx"
  ON "shared_report_recipient_revisions" ("shared_link_id", "is_review_locked");
