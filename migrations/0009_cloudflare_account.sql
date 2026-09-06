-- integrations: Cloudflare Pages targets need their account id (the Pages API
-- is scoped per account, unlike GitHub/Vercel tokens).
ALTER TABLE deploy_targets ADD COLUMN account TEXT;
