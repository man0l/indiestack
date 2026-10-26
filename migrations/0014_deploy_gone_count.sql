-- Consecutive "project gone" (404) probes. A deleted Vercel project is not a
-- failed deploy: it stays unknown and auto-disables after a few checks.
ALTER TABLE deploy_targets ADD COLUMN gone_count INTEGER NOT NULL DEFAULT 0;
