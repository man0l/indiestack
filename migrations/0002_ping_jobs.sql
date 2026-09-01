ALTER TABLE monitors ADD COLUMN keyword TEXT;
ALTER TABLE monitors ADD COLUMN keyword_mode TEXT;
ALTER TABLE monitors ADD COLUMN max_latency_ms INTEGER;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  interval_min INTEGER NOT NULL,
  grace_min INTEGER NOT NULL DEFAULT 2,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_beat_at INTEGER,
  last_error TEXT,
  consecutive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_jobs_token ON jobs (token);
