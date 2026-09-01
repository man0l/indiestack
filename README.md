# IndieStack

Uptime checks and cron **monitoring** that run on **your** Cloudflare account. One project, one Worker, one user, **$0**.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/man0l/indiestack)

**The form will ask for GitHub. That is required.** Cloudflare does not upload the Worker from this page; it creates a **new** repo under *your* GitHub and deploys from there (so every later `git push` ships). Click **New GitHub connection**, authorize the Cloudflare GitHub App, then **Deploy**. Leave D1/R2 on “Create new”. Leave `ADMIN_TOKEN` blank if the form shows it.

If GitHub already has a repo named `indiestack`, change **Project name** on that screen (e.g. `indiestack-ops`) or the create will fail.

After deploy, open `https://<worker>.workers.dev/admin`. A random token is generated and shown **once** — copy it, then continue. That is your login. The Worker cannot write Cloudflare secrets itself; the token is stored in your D1. You can later paste the same value as Worker secret `ADMIN_TOKEN` in the dashboard if you want.

Do not want a second GitHub repo? Skip the button and use [CLI deploy](#cli-deploy-if-you-skip-the-button) from this repo.

This is not a hosted SaaS. The Worker **is** the monitor.

## Why this exists

Indie hackers already have a Cloudflare account. After they ship, they still pay UptimeRobot / Better Stack / cron-job.org to answer three questions:

1. Is the site up?
2. Did the nightly job run?
3. Where do I send people for a status page?

Those tools are fine. They are also someone else’s database, someone else’s branding, and a card on file the moment you need 60-second checks or a heartbeat. IndieStack spends the free-tier quota you already have instead.

## How it beats the paid tools (on Workers Free)

| | IndieStack | UptimeRobot | Better Stack | cron-job.org |
|---|---|---|---|---|
| Price for a side project | **$0** on the CF account you already use | $0 hobby, then ~$7–10/mo for 60s checks | Starts paid for anything serious | Free with caps, then paid |
| Who holds the data | **Your** D1 + R2 | Theirs | Theirs | Theirs |
| Who sees your URLs / job tokens | You | Them | Them | Them |
| Code | This repo, you keep it | Closed | Closed | Closed |
| HTTP uptime | Yes | Yes | Yes | No |
| Keyword / expected status / slow | Yes | Yes (plan-gated) | Partial | No |
| Cron **monitor** (heartbeat) | Yes | Paid-tier feature in practice | Not the point | They *run* jobs, they don’t watch yours |
| Status page | `/` on your Worker | Their domain + branding | Theirs | No |
| Alerts | Discord / Slack / webhook | Email + SMS credits + integrations | Many, paid | Email |
| SMS / voice / 15s checks / 50 monitors | No | Yes, paid | Yes, paid | n/a |

The trick is not “more features.” It is **enough features, on infra you already have, with data that never leaves your account.**

A typical indie setup — 10 URLs every 5 minutes + a few heartbeats — is a few thousand Worker requests and D1 writes per day. Workers Free is 100k requests/day and 100k D1 writes/day. You will not hit it.

What you give up vs the paid tools: no SMS, no multi-region probe network, no 15-second interval (Cloudflare cron is 1 minute min), no 50-monitor hobby farm, no team seats. If you need those, pay UptimeRobot. If you need “Discord pings me when the site or the backup dies,” this is it.

## After you click the button

1. Open `https://<worker>.workers.dev/admin`.
2. Copy the generated token (shown once), then you are in.
3. Add `https://your-app.example` — public status is `/`.
4. Optional: Discord/Slack webhook for down/up.
5. Optional: add a **cron monitor**. Your job hits:

```bash
curl -fsS -X POST https://<worker>.workers.dev/beat/<token>
```

If that line stops running, `/` goes red and the webhook fires. IndieStack does **not** run the job. It notices that the job did not run.

6. Optional: add a **log source**. Your app POSTs JSON (8KB max). Events live 24h in R2, admin-only at `/admin/logs/…` — they do **not** appear on `/`.

```bash
curl -fsS -X POST https://<worker>.workers.dev/log/<token> \
  -H 'content-type: application/json' \
  -d '{"level":"error","message":"payment failed"}'
```

No D1 write on ingest. Not an access log.

`/health` is 200 when everything enabled is up, 503 otherwise. `/health.json` is for scripts.

## Free-tier envelope (designed in)

| Cloudflare limit | How IndieStack stays inside |
|---|---|
| 5 cron triggers / account | **One** tick (`* * * * *`). Jobs are rows, not extra crons. |
| 100k Worker requests / day | Shared with your app. 20 URLs × 5 min ≈ 6k checks/day. |
| 100k D1 writes / day | Two writes per HTTP check. Heartbeats only write on beat / miss. Log ingest writes **R2 only**. |
| 10 ms CPU | `fetch()` wait is free. Bodies are capped at 64KB and only read for keywords. |
| No email sending on free | Webhooks only. |

Caps in the app: 20 HTTP monitors, 20 heartbeats, 10 log sources. Default interval 5 minutes. HTTP alerts after 2 failures. Heartbeats alert on the first miss after grace. Logs prune after 24h.

## Local

```bash
cp .dev.vars.example .dev.vars   # ADMIN_TOKEN=change-me
npm install
npm run dev
```

http://localhost:8787 — status  
http://localhost:8787/admin — token from `.dev.vars`  
http://localhost:8787/__scheduled — force a tick

## CLI deploy (if you skip the button)

```bash
npx wrangler login
npx wrangler d1 create indiestack          # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create indiestack
npx wrangler secret put ADMIN_TOKEN
npm run deploy                             # applies D1 migrations, then deploys
```

## What it is not

Not a log platform. Not a cron **manager**. Not Datadog. Plan and non-goals: [PLAN.md](PLAN.md).
