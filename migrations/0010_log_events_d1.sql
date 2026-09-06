-- Log events move from per-event R2 objects to one indexed D1 table.
-- One SQL query serves the explorer (source/level/search filters), and the
-- UNIQUE index makes provider syncs idempotent via INSERT ... DO NOTHING
-- (replaces the per-project timestamp cursors).
CREATE TABLE log_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  level TEXT,
  message TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_log_events_unique ON log_events (source_id, ts, message);
CREATE INDEX idx_log_events_ts ON log_events (ts DESC);
