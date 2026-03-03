alter table if exists user_profiles
  add column if not exists tagline text;
