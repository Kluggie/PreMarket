-- Add explicit public directory opt-in flag to user_profiles.
-- Profiles are private by default (false); only appear in the public
-- directory after the user explicitly enables this toggle.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_public_directory boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS user_profiles_public_dir_idx
  ON user_profiles (is_public_directory, updated_at);
