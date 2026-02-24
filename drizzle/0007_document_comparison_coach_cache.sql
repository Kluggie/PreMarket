create table if not exists "document_comparison_coach_cache" (
  "id" text primary key not null,
  "comparison_id" text not null references "document_comparisons"("id") on delete cascade,
  "user_id" text not null references "users"("id") on delete cascade,
  "cache_hash" text not null,
  "mode" text not null default 'full',
  "intent" text,
  "selection_target" text,
  "selection_text_hash" text,
  "prompt_version" text not null default 'coach-v1',
  "provider" text not null default 'vertex',
  "model" text not null default 'unknown',
  "result" jsonb not null default '{}'::jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

create unique index if not exists "doc_comparison_coach_cache_unique"
  on "document_comparison_coach_cache" ("comparison_id", "cache_hash");
--> statement-breakpoint

create index if not exists "doc_comparison_coach_cache_comparison_idx"
  on "document_comparison_coach_cache" ("comparison_id", "created_at");
--> statement-breakpoint

create index if not exists "doc_comparison_coach_cache_user_idx"
  on "document_comparison_coach_cache" ("user_id", "created_at");
