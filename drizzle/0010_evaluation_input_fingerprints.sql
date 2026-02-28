alter table if exists "proposal_evaluations"
  add column if not exists "input_shared_hash" text;
--> statement-breakpoint

alter table if exists "proposal_evaluations"
  add column if not exists "input_conf_hash" text;
--> statement-breakpoint

alter table if exists "proposal_evaluations"
  add column if not exists "input_shared_len" integer;
--> statement-breakpoint

alter table if exists "proposal_evaluations"
  add column if not exists "input_conf_len" integer;
--> statement-breakpoint

alter table if exists "proposal_evaluations"
  add column if not exists "input_version" integer;
