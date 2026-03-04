CREATE TABLE IF NOT EXISTS "user_documents" (
  "id"                  text PRIMARY KEY,
  "user_id"             text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "uploader_user_id"    text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "filename"            text NOT NULL,
  "mime_type"           text NOT NULL,
  "size_bytes"          integer NOT NULL,
  "storage_key"         text,
  "content_bytes"       bytea,
  "status"              text NOT NULL DEFAULT 'processing',
  "extracted_text"      text,
  "summary_text"        text,
  "summary_updated_at"  timestamp with time zone,
  "error_message"       text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN IF NOT EXISTS "content_bytes" bytea;
--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN IF NOT EXISTS "summary_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_documents" ALTER COLUMN "storage_key" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_documents_user_idx" ON "user_documents" ("user_id", "created_at");
