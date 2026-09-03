-- analytics: privacy-safe daily visitor bucket. vid = hash(salt + ip + day),
-- so it counts unique visitors per day without storing or linking IPs across days.
ALTER TABLE hits ADD COLUMN vid TEXT;

CREATE INDEX idx_hits_site_day_vid ON hits (site_id, day, vid);
