create table if not exists "email_dedupes" (
  "id" text primary key not null,
  "dedupe_key" text not null,
  "category" text not null,
  "to_email" text not null,
  "created_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create unique index if not exists "email_dedupes_key_unique"
  on "email_dedupes" ("dedupe_key");
--> statement-breakpoint

create index if not exists "email_dedupes_category_idx"
  on "email_dedupes" ("category", "created_at");
