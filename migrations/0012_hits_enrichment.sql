-- Phase 1+2 analytics enrichment: referrer classification, search keywords,
-- device/browser/os, geo beyond country, UTM campaigns, new/returning flag.
ALTER TABLE hits ADD COLUMN ref_class TEXT;
ALTER TABLE hits ADD COLUMN ref_source TEXT;
ALTER TABLE hits ADD COLUMN search_term TEXT;
ALTER TABLE hits ADD COLUMN ref_path TEXT;
ALTER TABLE hits ADD COLUMN device TEXT;
ALTER TABLE hits ADD COLUMN browser TEXT;
ALTER TABLE hits ADD COLUMN os TEXT;
ALTER TABLE hits ADD COLUMN city TEXT;
ALTER TABLE hits ADD COLUMN region TEXT;
ALTER TABLE hits ADD COLUMN utm_source TEXT;
ALTER TABLE hits ADD COLUMN utm_medium TEXT;
ALTER TABLE hits ADD COLUMN utm_campaign TEXT;
-- 1 = first-ever hit of this visitor id (persistent mode); daily mode is always 1.
ALTER TABLE hits ADD COLUMN new_visitor INTEGER NOT NULL DEFAULT 1;

-- Crawler plane: verified page fetches by AI/search crawlers (UA self-ID
-- confirmed against published IP ranges where available).
CREATE TABLE crawler_fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  path TEXT NOT NULL,
  crawler TEXT NOT NULL,
  vendor TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  ua TEXT
);
CREATE INDEX idx_crawler_fetches_ts ON crawler_fetches (ts DESC);
