-- slashloop: social views per lane, pulled from a Slashloop account over OAuth + MCP.
-- Tokens and the dynamically-registered client id live in settings.

-- A Slashloop lane (accounts sharing a `lane:<name>` tag; '' = accounts with no
-- lane). site_id picks the analytics chart its views land on.
CREATE TABLE slashloop_lanes (
  lane TEXT PRIMARY KEY,
  site_id TEXT,
  accounts INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL
);

-- Views gained per lane per UTC day (get_social_stats mode=gained). Each sync
-- rewrites its window, so late snapshots on Slashloop's side just replace.
CREATE TABLE slashloop_daily (
  lane TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL,
  PRIMARY KEY (lane, day)
);

CREATE INDEX idx_slashloop_daily_day ON slashloop_daily (day);
