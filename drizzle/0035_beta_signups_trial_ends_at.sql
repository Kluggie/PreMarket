-- Add trial_ends_at to beta_signups so promo access expires after 30 days.
-- Existing rows: NULL means the row pre-dates this column. Plan resolution
-- treats NULL as non-expired for backwards compatibility (the promo was
-- already implicitly granted and we do not want to retroactively revoke it).
ALTER TABLE "beta_signups" ADD COLUMN "trial_ends_at" timestamp with time zone;
