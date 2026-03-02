alter table if exists "shared_report_recipient_revisions"
  add column if not exists "workflow_step" integer not null default 0;
--> statement-breakpoint

alter table if exists "shared_report_recipient_revisions"
  add column if not exists "editor_state" jsonb not null default '{}'::jsonb;
--> statement-breakpoint

create table if not exists "shared_report_evaluation_runs" (
  "id" text primary key,
  "shared_link_id" text not null references "shared_links"("id") on delete cascade,
  "proposal_id" text not null references "proposals"("id") on delete cascade,
  "comparison_id" text,
  "revision_id" text not null references "shared_report_recipient_revisions"("id") on delete cascade,
  "actor_role" text not null default 'recipient',
  "status" text not null default 'pending',
  "result_public_report" jsonb not null default '{}'::jsonb,
  "result_json" jsonb not null default '{}'::jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create index if not exists "shared_report_evaluation_runs_link_idx"
  on "shared_report_evaluation_runs" ("shared_link_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_evaluation_runs_revision_idx"
  on "shared_report_evaluation_runs" ("revision_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_evaluation_runs_proposal_idx"
  on "shared_report_evaluation_runs" ("proposal_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_evaluation_runs_status_idx"
  on "shared_report_evaluation_runs" ("status", "created_at");
