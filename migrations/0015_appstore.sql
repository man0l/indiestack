-- appstore: App Store Connect Analytics Reports (search impressions, downloads).
-- Credentials (issuer id, key id, .p8) live in settings; one ASC key, up to 3 apps.

-- A tracked app. site_id links it to an analytics site so its numbers land on
-- that site's chart next to deploy/commit markers.
CREATE TABLE appstore_apps (
  id TEXT PRIMARY KEY,
  apple_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  site_id TEXT,
  ongoing_request_id TEXT,
  snapshot_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_discover_at INTEGER,
  last_sync_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

-- One row per report instance Apple delivers. Queued on discovery, downloaded
-- one at a time by the tick so a backfill never blows the CPU budget.
CREATE TABLE appstore_instances (
  instance_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  report TEXT NOT NULL,
  src TEXT NOT NULL,
  processing_date TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  done_at INTEGER
);

CREATE INDEX idx_appstore_instances_state ON appstore_instances (state, processing_date);

-- Daily totals contributed by each instance. Keyed by instance so a re-download
-- replaces, never double-counts. src = ongoing | snapshot: when both cover a day
-- the ongoing rows win (see dailyFor in src/appstore/index.ts).
CREATE TABLE appstore_daily (
  app_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  src TEXT NOT NULL,
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (instance_id, day, metric)
);

CREATE INDEX idx_appstore_daily_app_day ON appstore_daily (app_id, day);
