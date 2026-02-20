ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "template_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text,
	"category" text DEFAULT 'custom' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"party_a_label" text DEFAULT 'Party A' NOT NULL,
	"party_b_label" text DEFAULT 'Party B' NOT NULL,
	"is_tool" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"user_id" text NOT NULL,
	"section_key" text,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"section_id" text,
	"user_id" text NOT NULL,
	"question_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"field_type" text DEFAULT 'text' NOT NULL,
	"value_type" text DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"visibility_default" text DEFAULT 'full' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"section_id" text,
	"value" text,
	"value_type" text DEFAULT 'text' NOT NULL,
	"range_min" text,
	"range_max" text,
	"visibility" text DEFAULT 'full' NOT NULL,
	"claim_type" text,
	"entered_by_party" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"source_proposal_id" text NOT NULL,
	"proposal_id" text,
	"user_id" text NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_access" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_opened_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'templates'
	) THEN
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "name" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "description" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "slug" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "category" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "status" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "party_a_label" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "party_b_label" text;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "is_tool" boolean;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "view_count" integer;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "sort_order" integer;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;

		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "name" TYPE text USING "name"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "description" TYPE text USING "description"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "slug" TYPE text USING "slug"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "category" TYPE text USING "category"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "status" TYPE text USING "status"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "party_a_label" TYPE text USING "party_a_label"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "party_b_label" TYPE text USING "party_b_label"::text;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "is_tool" TYPE boolean USING "is_tool"::boolean;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "view_count" TYPE integer USING NULLIF("view_count"::text, '')::integer;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "sort_order" TYPE integer USING NULLIF("sort_order"::text, '')::integer;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "metadata" TYPE jsonb USING CASE WHEN "metadata" IS NULL THEN '{}'::jsonb ELSE "metadata"::jsonb END;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "templates" ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at"::timestamptz;
		EXCEPTION WHEN others THEN NULL;
		END;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'template_sections'
	) THEN
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "template_id" text;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "section_key" text;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "title" text;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "description" text;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "sort_order" integer;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "template_sections" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'template_questions'
	) THEN
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "template_id" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "section_id" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "question_key" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "label" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "description" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "field_type" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "value_type" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "required" boolean;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "visibility_default" text;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "sort_order" integer;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "options" jsonb;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "template_questions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'proposal_responses'
	) THEN
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "proposal_id" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "question_id" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "section_id" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "value" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "value_type" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "range_min" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "range_max" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "visibility" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "claim_type" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "entered_by_party" text;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "proposal_responses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'proposal_snapshots'
	) THEN
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "source_proposal_id" text;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "proposal_id" text;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "snapshot_version" integer;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "status" text;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "snapshot_data" jsonb;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "snapshot_meta" jsonb;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "proposal_snapshots" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'snapshot_access'
	) THEN
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "snapshot_id" text;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "proposal_id" text;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "user_id" text;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "token" text;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "status" text;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "last_opened_at" timestamp with time zone;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
		ALTER TABLE "snapshot_access" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_section_id_template_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."template_sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proposal_responses" ADD CONSTRAINT "proposal_responses_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proposal_responses" ADD CONSTRAINT "proposal_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proposal_snapshots" ADD CONSTRAINT "proposal_snapshots_source_proposal_id_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proposal_snapshots" ADD CONSTRAINT "proposal_snapshots_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proposal_snapshots" ADD CONSTRAINT "proposal_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "snapshot_access" ADD CONSTRAINT "snapshot_access_snapshot_id_proposal_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."proposal_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "snapshot_access" ADD CONSTRAINT "snapshot_access_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "snapshot_access" ADD CONSTRAINT "snapshot_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR undefined_column THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_user_idx" ON "templates" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_status_idx" ON "templates" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_category_idx" ON "templates" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_sections_template_idx" ON "template_sections" USING btree ("template_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_sections_user_idx" ON "template_sections" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_questions_template_idx" ON "template_questions" USING btree ("template_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_questions_section_idx" ON "template_questions" USING btree ("section_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_questions_user_idx" ON "template_questions" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "template_questions_template_key_unique" ON "template_questions" USING btree ("template_id","question_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_responses_proposal_idx" ON "proposal_responses" USING btree ("proposal_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_responses_user_idx" ON "proposal_responses" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_responses_claim_type_idx" ON "proposal_responses" USING btree ("claim_type","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_snapshots_source_proposal_idx" ON "proposal_snapshots" USING btree ("source_proposal_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_snapshots_user_idx" ON "proposal_snapshots" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_access_token_unique" ON "snapshot_access" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_access_proposal_idx" ON "snapshot_access" USING btree ("proposal_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_access_user_idx" ON "snapshot_access" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_party_a_email_idx" ON "proposals" USING btree ("party_a_email","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_party_b_email_idx" ON "proposals" USING btree ("party_b_email","created_at");
