alter table if exists "shared_links"
  add column if not exists "can_edit_confidential" boolean not null default false;
--> statement-breakpoint

create table if not exists "shared_report_recipient_revisions" (
  "id" text primary key,
  "shared_link_id" text not null references "shared_links"("id") on delete cascade,
  "proposal_id" text not null references "proposals"("id") on delete cascade,
  "comparison_id" text,
  "actor_role" text not null default 'recipient',
  "status" text not null default 'draft',
  "shared_payload" jsonb not null default '{}'::jsonb,
  "recipient_confidential_payload" jsonb not null default '{}'::jsonb,
  "previous_revision_id" text references "shared_report_recipient_revisions"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create index if not exists "shared_report_recipient_revisions_link_idx"
  on "shared_report_recipient_revisions" ("shared_link_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_recipient_revisions_draft_idx"
  on "shared_report_recipient_revisions" ("shared_link_id", "actor_role", "status", "updated_at");
--> statement-breakpoint

create unique index if not exists "shared_report_recipient_revisions_unique_draft"
  on "shared_report_recipient_revisions" ("shared_link_id", "actor_role", "status")
  where "status" = 'draft';
--> statement-breakpoint

create index if not exists "shared_report_recipient_revisions_proposal_idx"
  on "shared_report_recipient_revisions" ("proposal_id", "created_at");
