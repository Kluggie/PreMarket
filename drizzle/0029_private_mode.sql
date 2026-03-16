ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "is_private_mode" boolean NOT NULL DEFAULT false;
