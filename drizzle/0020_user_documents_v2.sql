-- Documents v2: store file bytes in Postgres (bytea) + summary_updated_at
-- Also makes storage_key nullable since file content now lives in content_bytes.

ALTER TABLE "user_documents"
  ADD COLUMN IF NOT EXISTS "content_bytes" bytea,
  ADD COLUMN IF NOT EXISTS "summary_updated_at" timestamp with time zone;

-- Allow storage_key to be null (new uploads will not populate it)
ALTER TABLE "user_documents"
  ALTER COLUMN "storage_key" DROP NOT NULL;
