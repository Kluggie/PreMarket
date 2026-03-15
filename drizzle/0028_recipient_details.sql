ALTER TABLE "document_comparisons"
  ADD COLUMN IF NOT EXISTS "recipient_name" text,
  ADD COLUMN IF NOT EXISTS "recipient_email" text;--> statement-breakpoint

ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "party_b_name" text;
