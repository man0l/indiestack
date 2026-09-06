-- AI-bots package model: the tracked project's SDK ships the event, the
-- worker is the classification/verification truth. Crawler fetches are
-- attributed to the analytics site that installed the SDK.
ALTER TABLE crawler_fetches ADD COLUMN site_id TEXT;
ALTER TABLE crawler_fetches ADD COLUMN category TEXT;
ALTER TABLE crawler_fetches ADD COLUMN status_code INTEGER;
ALTER TABLE crawler_fetches ADD COLUMN hostname TEXT;
CREATE INDEX idx_crawler_fetches_site ON crawler_fetches (site_id, ts DESC);
