CREATE INDEX IF NOT EXISTS starter_usage_events_type_idx
  ON starter_usage_events (event_type, created_at);
