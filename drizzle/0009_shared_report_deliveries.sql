create table if not exists "shared_report_deliveries" (
  "id" text primary key,
  "shared_link_id" text not null references "shared_links"("id") on delete cascade,
  "proposal_id" text not null references "proposals"("id") on delete cascade,
  "user_id" text not null references "users"("id") on delete cascade,
  "sent_to_email" text not null,
  "status" text not null default 'queued',
  "provider_message_id" text,
  "last_error" text,
  "sent_at" timestamp with time zone,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create index if not exists "shared_report_deliveries_link_idx"
  on "shared_report_deliveries" ("shared_link_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_deliveries_proposal_idx"
  on "shared_report_deliveries" ("proposal_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_deliveries_user_idx"
  on "shared_report_deliveries" ("user_id", "created_at");
--> statement-breakpoint

create index if not exists "shared_report_deliveries_status_idx"
  on "shared_report_deliveries" ("status", "created_at");
