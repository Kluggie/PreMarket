ALTER TABLE "document_comparisons"
ADD COLUMN IF NOT EXISTS "company_name" text;

--> statement-breakpoint
ALTER TABLE "document_comparisons"
ADD COLUMN IF NOT EXISTS "company_website" text;
