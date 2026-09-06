-- Visitor-ID mode per analytics site:
--   'daily'      cookie-free daily-rotating hash (privacy-first, uniques reset daily)
--   'persistent' first-party localStorage UUID honored server-side (returning
--                visitors tracked across days; site should disclose analytics
--                storage in its privacy/cookie policy)
ALTER TABLE analytics_sites ADD COLUMN id_mode TEXT NOT NULL DEFAULT 'daily';
