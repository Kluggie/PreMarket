CREATE INDEX IF NOT EXISTS starter_usage_events_user_idx
  ON starter_usage_events (user_id, created_at);
