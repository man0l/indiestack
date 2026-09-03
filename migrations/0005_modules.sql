-- agents plugin: tokens AI agents use to read status and call MCP.
CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_agent_tokens_token ON agent_tokens (token);

-- analytics plugin: sites that embed the collector snippet.
CREATE TABLE analytics_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_analytics_sites_token ON analytics_sites (token);

-- one row per pageview. One D1 write per hit, capped per site per day.
CREATE TABLE hits (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  path TEXT NOT NULL,
  ref TEXT,
  country TEXT
);

CREATE INDEX idx_hits_site_day_ts ON hits (site_id, day, ts);
CREATE INDEX idx_hits_day ON hits (day);

-- integrations plugin: GitHub / Vercel deployments the user connected by token.
CREATE TABLE deploy_targets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  repo TEXT,
  project TEXT,
  team TEXT,
  interval_min INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check_at INTEGER,
  last_detail TEXT,
  last_error TEXT,
  consecutive INTEGER NOT NULL DEFAULT 0,
  mute_until INTEGER,
  nag_min INTEGER NOT NULL DEFAULT 0,
  last_nag_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_deploy_targets_provider ON deploy_targets (provider);
