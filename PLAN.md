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
| TCP port | ping | `connect()` |
| UDP / ICMP | ping | TCP fallback (see below) |

## Ports (what Workers can actually do)

| Kind | UptimeRobot | Here |
|---|---|---|
| TCP port | SYN to host:port | **Real** `connect()` from `cloudflare:sockets`. Port 25 blocked. Cloudflare IPs blocked. |
| UDP port | UDP datagram + reply | **No datagram API.** We TCP-SYN the same port (DNS-over-TCP works for `:53`). Pure-UDP services (WireGuard, game servers) will look down. |
| ICMP ping | Echo request | **No raw ICMP.** We try TCP 443, then 80, then 22. Host-up, not ping. |

## DNS / SSL / domain expiry — investigation (not built)

**DNS records — doable next.** Query DNS-over-HTTPS from the Worker:

```
GET https://cloudflare-dns.com/dns-query?name=example.com&type=A
Accept: application/dns-json
```

Store a fingerprint of answers in D1; alert on change or NXDOMAIN. No UDP/53 needed. Free. ~1 fetch per check.

**Domain expiry — doable next.** RDAP over HTTPS, not WHOIS:

```
GET https://rdap.org/domain/example.com
```

JSON `events[]` with `eventAction: "expiration"`. Alert at 30/14/7 days like UR. Some TLDs have weak RDAP; fallback `https://rdap.verisign.com/com/v1/domain/…` for .com/.net.

**SSL expiry — no first-class API.** `fetch()` and `connect()`/`startTls()` do **not** expose the peer certificate (`SocketInfo` is only addresses). Options:

1. Parse the TLS handshake ourselves — we never see raw handshake bytes after `startTls()`.
2. `node:tls` `getPeerCertificate()` — not a supported Workers API.
3. Third party: `crt.sh/?q=example.com&output=json` (CT logs, not the live edge cert; can miss short-lived / custom CA).
4. If the site is on Cloudflare, SSL for SaaS / zone APIs need an API token (not free-tier-generic).

Recommend: ship DNS + RDAP expiry; skip live SSL until the runtime exposes the cert.

## What we will not take

Multi-region confirm, SMS/voice, team seats, status-page subscribers, incident comments, a job **runner**.

## Layout

One Worker. Copy-paste folders under `src/`. Each plugin exports a `Plugin` and is listed once in `kernel/catalog.ts`. Kernel mounts routes, admin slots, status slots, and tick — do not edit `ui.ts` to add a feature.

- **kernel/** — types, D1, auth, alerts (webhook + Telegram + email), R2 rollups, `scheduled()` tick, plugin host
- **ping/** — HTTP/TCP/DNS/SSL/domain probes
- **heartbeat/** — `/beat/:token`; tick marks it down if `last_beat + interval + grace` is in the past
- **integrations/** — GitHub / Vercel deploy monitoring. The user connects with their own token (validated live, stored in settings); tick checks each target's latest production deployment, alerts on first failure
- **logs/** — `POST /log/:token` → R2 (no D1 write on ingest); source CRUD
- **explorer/** — log manager (filter/search/expand/tail/analyze). Hard-depends on logs.
- **analytics/** — cookie-free pageviews: `/a.js` collector (SPA-aware) + `POST /hit`; one D1 write per view, capped 2k/site/day, 30-day retention; uniques via a daily-rotated visitor hash (salt + ip + day — never stored, never linked across days); referrers normalized to hostname; admin dashboard. Base for the growth plugins: also ingests custom events (`df.track`) and visitor identification (`df.identify` → salted hash) into `events`.
- **widgets/** — deps: analytics. Public SVG badges (`/w/live.svg`, `/w/views.svg`) + `/w/stats.json` for embedding.
- **revenue/** — deps: analytics. Stripe webhook `POST /stripe/<site token>` (signature-verified) + Payment API `POST /revenue/<site token>`; payments attributed to the identified visitor's first-touch referrer via `df.identify`.
- **signals/** — deps: analytics. External events — GitHub commits (reuses deploy token), X mentions (bearer key), Reddit mentions (script-app id/secret). Watchers poll every 15 min on the tick; keys live in settings.
- **aicrawl/** — deps: analytics. Server-side AI crawler tracking: `POST /crawlers/<site token>` ingest middleware for the owner's own Workers; user agents classified against a vendor directory (OpenAI, Anthropic, Perplexity, Google-Extended, Meta, Bytespider, …); AI referrals detected from hit referrers.
- **goals/** — deps: analytics. Conversion goals over `df.track` events or page paths; uniques-converted rate, broken down by referrer.
- **share/** — deps: analytics, goals. Public read-only dashboard per site at `/share/<token>` (live, views/uniques chart, top pages, referrers, countries, events, goals).
- **agents/** — `/agents.md` (public agent guide), agent tokens, `GET /agent/status.json`, MCP at `POST /mcp/:token` (stateless JSON-RPC streamable HTTP, read-only tools). Reads other plugins' tables directly — keep after them in the catalog.
- **backup/** — admin JSON export/import of D1 + recent R2; restore upserts by id, does not delete extra rows
- **templates/** — one-click HTTPS/SSH/DNS/SSL/domain monitors
- **index.ts** — Worker entry · **ui.ts** — page chrome only

Caps: 20 HTTP monitors, 20 jobs, 10 log sources, 10 deploy targets, 3 analytics sites, 5 agent tokens. Default HTTP interval 5 min. Heartbeat grace default 2 min. Alert on first missed beat (grace is the buffer).

## Alerts

One alert batch fans out to every configured channel (`kernel/alert.ts` `notifyAll`):
Discord/Slack/generic webhook, Telegram (bot token + chat id), email (Resend API key).
All credentials live in the `settings` table, edited in `/admin`. GitHub / Vercel
tokens are connected in the integrations admin section, validated against the
provider on save, never sent anywhere else.

## AI

The stack is AI-native, bring-your-own-agent: `/agents.md` is the public how-to,
agent tokens gate `GET /agent/status.json` and `POST /mcp/:token` (tools:
get_overview, list_monitors, list_heartbeats, list_deploys, recent_incidents,
get_analytics). No hosted AI, no upsell — an AI SRE is an LLM pointed at this data.

## Later (not this pass)

OAuth for GitHub/Vercel (today: personal-access tokens), event ingest / R2 archive, shadcn-style `add` CLI. Same Worker when they happen.
