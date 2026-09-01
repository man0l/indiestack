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

- **Kernel** — one `scheduled()` tick, D1, R2 rollups, admin token, webhook
- **ping** — Worker GETs your URL
- **cron monitor** — your job POSTs `/beat/:token`; tick marks it down if `last_beat + interval + grace` is in the past

Caps: 20 HTTP monitors, 20 jobs. Default HTTP interval 5 min. Heartbeat grace default 2 min. Alert on first missed beat (grace is the buffer).

## Later (not this pass)

Analytics (Analytics Engine), event ingest / R2 archive, shadcn-style `add` CLI. Same Worker when they happen.
