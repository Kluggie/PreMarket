ALTER TABLE "user_documents"
  ADD COLUMN IF NOT EXISTS "content_bytes" bytea,
  ADD COLUMN IF NOT EXISTS "summary_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_documents"
  ALTER COLUMN "storage_key" DROP NOT NULL;
