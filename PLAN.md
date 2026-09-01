# Plan

One project = one Worker = one user. Copy-paste modules that share one tick, one D1, one dashboard, one webhook.

## What this is

Day-1 ops you own on the Cloudflare free plan: **is the site up, and did the job run?**

Not a log platform. Not a cron manager (we do not fire jobs). Not Datadog.

## UptimeRobot → what we take

| UR feature | Here | Why |
|---|---|---|
| HTTP(S) monitor | ping | Core |
| Keyword exists / absent | ping | Page can be 200 and still wrong |
| Expected status | ping | Non-2xx health endpoints |
| Slow response | ping | Latency ceiling, optional |
| Maintenance window | pause | `enabled=0`; no calendar UI |
| 2-strike down | ping only | One HTTP blip is not an outage |
| Heartbeat / cron monitor | **jobs** | Job pings us; we notice silence |
| Status page | `/` | HTTP + jobs on one page |
| Webhook alerts | Discord / Slack / JSON | Email is paid on CF |
| Public API | `/health.json`, `/beat/:token` | Enough for scripts |
| Check interval | 1–60 min | CF cron is 1 min min |

## What we will not take

ICMP ping, raw ports, UDP, DNS records, SSL/domain expiry, multi-region confirm, SMS/voice, team seats, status-page subscribers, incident comments, a job **runner**.

## Layout

- **Kernel** — one `scheduled()` tick, D1, R2 rollups, admin token, webhook
- **ping** — Worker GETs your URL
- **cron monitor** — your job POSTs `/beat/:token`; tick marks it down if `last_beat + interval + grace` is in the past

Caps: 20 HTTP monitors, 20 jobs. Default HTTP interval 5 min. Heartbeat grace default 2 min. Alert on first missed beat (grace is the buffer).

## Later (not this pass)

Analytics (Analytics Engine), event ingest / R2 archive, shadcn-style `add` CLI. Same Worker when they happen.
