ALTER TABLE "user_documents"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS "status_reason" text;
--> statement-breakpoint
UPDATE "user_documents"
SET "visibility" = 'confidential'
WHERE "visibility" IS NULL OR "visibility" NOT IN ('confidential', 'shared');
--> statement-breakpoint
ALTER TABLE "user_documents"
  DROP CONSTRAINT IF EXISTS "user_documents_visibility_check";
--> statement-breakpoint
ALTER TABLE "user_documents"
  ADD CONSTRAINT "user_documents_visibility_check"
  CHECK ("visibility" IN ('confidential', 'shared'));
