ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "proposal_type" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "draft_step" integer;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "source_proposal_id" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "document_comparison_id" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "received_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "evaluated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "last_shared_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "status_reason" text;
--> statement-breakpoint

UPDATE "proposals"
SET
  "proposal_type" = COALESCE(NULLIF("proposal_type", ''), 'standard'),
  "draft_step" = COALESCE("draft_step", 1);
--> statement-breakpoint

ALTER TABLE "proposals" ALTER COLUMN "proposal_type" SET DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "proposal_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "draft_step" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "draft_step" SET NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'proposals'
      AND constraint_name = 'proposals_source_proposal_id_proposals_id_fk'
  ) THEN
    ALTER TABLE "proposals"
      ADD CONSTRAINT "proposals_source_proposal_id_proposals_id_fk"
      FOREIGN KEY ("source_proposal_id")
      REFERENCES "proposals"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_type_idx" ON "proposals" USING btree ("proposal_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_draft_step_idx" ON "proposals" USING btree ("draft_step", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_source_proposal_idx" ON "proposals" USING btree ("source_proposal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_document_comparison_idx" ON "proposals" USING btree ("document_comparison_id");
--> statement-breakpoint

ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "mode" text;
--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "can_view" boolean;
--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "can_edit" boolean;
--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "can_reevaluate" boolean;
--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "can_send_back" boolean;
--> statement-breakpoint
ALTER TABLE "shared_links" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "shared_links"
SET
  "mode" = COALESCE(NULLIF("mode", ''), 'standard'),
  "can_view" = COALESCE("can_view", true),
  "can_edit" = COALESCE("can_edit", false),
  "can_reevaluate" = COALESCE("can_reevaluate", false),
  "can_send_back" = COALESCE("can_send_back", false);
--> statement-breakpoint

ALTER TABLE "shared_links" ALTER COLUMN "mode" SET DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "mode" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_view" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_view" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_edit" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_edit" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_reevaluate" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_reevaluate" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_send_back" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "shared_links" ALTER COLUMN "can_send_back" SET NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_links_recipient_idx" ON "shared_links" USING btree ("recipient_email", "created_at");
--> statement-breakpoint

ALTER TABLE "billing_references" ADD COLUMN IF NOT EXISTS "stripe_price_id" text;
--> statement-breakpoint
ALTER TABLE "billing_references" ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proposal_evaluations" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "user_id" text NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "score" integer,
  "summary" text,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'proposal_evaluations'
      AND constraint_name = 'proposal_evaluations_proposal_id_proposals_id_fk'
  ) THEN
    ALTER TABLE "proposal_evaluations"
      ADD CONSTRAINT "proposal_evaluations_proposal_id_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'proposal_evaluations'
      AND constraint_name = 'proposal_evaluations_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "proposal_evaluations"
      ADD CONSTRAINT "proposal_evaluations_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_evaluations_proposal_idx" ON "proposal_evaluations" USING btree ("proposal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_evaluations_user_idx" ON "proposal_evaluations" USING btree ("user_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_comparisons" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "proposal_id" text,
  "title" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "draft_step" integer DEFAULT 1 NOT NULL,
  "party_a_label" text DEFAULT 'Document A' NOT NULL,
  "party_b_label" text DEFAULT 'Document B' NOT NULL,
  "doc_a_text" text,
  "doc_b_text" text,
  "doc_a_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "doc_b_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evaluation_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "public_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'document_comparisons'
      AND constraint_name = 'document_comparisons_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "document_comparisons"
      ADD CONSTRAINT "document_comparisons_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'document_comparisons'
      AND constraint_name = 'document_comparisons_proposal_id_proposals_id_fk'
  ) THEN
    ALTER TABLE "document_comparisons"
      ADD CONSTRAINT "document_comparisons_proposal_id_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_comparisons_user_idx" ON "document_comparisons" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comparisons_proposal_idx" ON "document_comparisons" USING btree ("proposal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comparisons_status_idx" ON "document_comparisons" USING btree ("status", "updated_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shared_link_responses" (
  "id" text PRIMARY KEY NOT NULL,
  "shared_link_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "question_id" text NOT NULL,
  "value" text,
  "value_type" text DEFAULT 'text' NOT NULL,
  "range_min" text,
  "range_max" text,
  "visibility" text DEFAULT 'full' NOT NULL,
  "entered_by_party" text DEFAULT 'b' NOT NULL,
  "responder_email" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'shared_link_responses'
      AND constraint_name = 'shared_link_responses_shared_link_id_shared_links_id_fk'
  ) THEN
    ALTER TABLE "shared_link_responses"
      ADD CONSTRAINT "shared_link_responses_shared_link_id_shared_links_id_fk"
      FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'shared_link_responses'
      AND constraint_name = 'shared_link_responses_proposal_id_proposals_id_fk'
  ) THEN
    ALTER TABLE "shared_link_responses"
      ADD CONSTRAINT "shared_link_responses_proposal_id_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shared_link_responses_link_idx" ON "shared_link_responses" USING btree ("shared_link_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_link_responses_proposal_idx" ON "shared_link_responses" USING btree ("proposal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_link_responses_responder_idx" ON "shared_link_responses" USING btree ("responder_email", "created_at");
