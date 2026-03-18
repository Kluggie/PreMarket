-- Add explicit public directory opt-in flag to user_profiles.
-- Profiles are private by default (false); only appear in the public
-- directory after the user explicitly enables this toggle.
alter table user_profiles
  add column if not exists is_public_directory boolean not null default false;
--> statement-breakpoint

create index if not exists user_profiles_public_dir_idx
  on user_profiles (is_public_directory, updated_at);
