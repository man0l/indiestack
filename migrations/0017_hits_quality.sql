-- Traffic quality (SLA-1696): data-centre hits, internal navigation, UTM sources.

-- Cloudflare cf.asn of the beacon; dc = 1 when that ASN is a cloud/hosting or
-- email-security network (link scanners, headless renderers), not a person.
ALTER TABLE hits ADD COLUMN asn INTEGER;
ALTER TABLE hits ADD COLUMN dc INTEGER NOT NULL DEFAULT 0;

-- Backfill, pre-ASN rows only: US hyperscaler campus towns (AWS us-east-1
-- Ashburn / us-west-2 Boardman, GCP Council Bluffs / The Dalles, Azure Boydton /
-- Quincy / Moses Lake). Heuristic — new rows use the ASN.
UPDATE hits SET dc = 1
WHERE asn IS NULL AND country = 'US'
  AND city IN ('Ashburn', 'Boardman', 'Council Bluffs', 'The Dalles', 'Boydton', 'Quincy', 'Moses Lake');

-- Same-site referrer = a click between your own pages, not a referral.
UPDATE hits SET ref_class = 'internal'
WHERE ref IS NOT NULL AND EXISTS (
  SELECT 1 FROM analytics_sites s
  WHERE s.id = hits.site_id
    AND lower(replace(hits.ref, 'www.', '')) = lower(replace(s.name, 'www.', ''))
);

-- No referrer but tagged with UTM: the tag is the source.
UPDATE hits SET ref_class = 'ai', ref_source = lower(utm_source)
WHERE ref_class = 'direct' AND utm_source IS NOT NULL
  AND (lower(utm_source) LIKE '%chatgpt%' OR lower(utm_source) LIKE '%openai%'
    OR lower(utm_source) LIKE '%perplexity%' OR lower(utm_source) LIKE '%claude%'
    OR lower(utm_source) LIKE '%gemini%' OR lower(utm_source) LIKE '%copilot%');
UPDATE hits SET ref_class = 'email', ref_source = lower(utm_source)
WHERE ref_class = 'direct' AND utm_source IS NOT NULL
  AND lower(coalesce(utm_medium, '')) IN ('email', 'e-mail', 'newsletter');
UPDATE hits SET ref_class = 'social', ref_source = lower(utm_source)
WHERE ref_class = 'direct' AND utm_source IS NOT NULL
  AND lower(utm_source) IN ('youtube', 'yt', 'x', 'twitter', 'reddit', 'linkedin', 'facebook',
    'instagram', 'tiktok', 'threads', 'bluesky', 'hn', 'producthunt', 'pinterest');
UPDATE hits SET ref_class = 'campaign', ref_source = lower(utm_source)
WHERE ref_class = 'direct' AND utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crawler_fetches_site_day ON crawler_fetches (site_id, day);
