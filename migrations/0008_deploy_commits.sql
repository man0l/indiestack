-- integrations: link a deploy target to an analytics site (for commit markers
-- on the analytics chart) and persist the last fetched commits for display.
ALTER TABLE deploy_targets ADD COLUMN site_id TEXT;
ALTER TABLE deploy_targets ADD COLUMN last_commits TEXT;
