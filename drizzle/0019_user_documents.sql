-- Documents feature: general context files per user
CREATE TABLE IF NOT EXISTS "user_documents" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "uploader_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'processing',
  "extracted_text" text,
  "summary_text" text,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_documents_user_idx"
  ON "user_documents" ("user_id", "created_at");
