import { connect } from "cloudflare:sockets";

export const MAX_MONITORS = 20;
export const MAX_JOBS = 20;
const BATCH = 5;
const FAIL_ALERT_AFTER = 2;
const HOT_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const BODY_CAP = 64 * 1024;

export type Kind = "http" | "tcp" | "udp" | "icmp" | "dns" | "ssl" | "domain";
const SSL_DAYS = 14;
const DOMAIN_DAYS = 30;

export type Monitor = {
  id: string;
  name: string;
  url: string;
  interval_min: number;
  expect_status: number;
  timeout_ms: number;
  keyword: string | null;
  keyword_mode: string | null;
  max_latency_ms: number | null;
  enabled: number;
  status: "up" | "down" | "unknown";
  last_check_at: number | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  consecutive: number;
  created_at: number;
};

export type Job = {
  id: string;
  name: string;
  token: string;
  interval_min: number;
  grace_min: number;
  enabled: number;
  status: "up" | "down" | "unknown";
  last_beat_at: number | null;
  last_error: string | null;
  consecutive: number;
  created_at: number;
};

export type CheckResult = {
  ok: boolean;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
};

export type PingOpts = {
  url: string;
  timeout_ms: number;
  expect_status: number;
  keyword?: string | null;
  keyword_mode?: string | null;
  max_latency_ms?: number | null;
};

export function kindOf(url: string): Kind {
  if (url.startsWith("tcp:")) return "tcp";
  if (url.startsWith("udp:")) return "udp";
  if (url.startsWith("icmp:")) return "icmp";
  if (url.startsWith("dns:")) return "dns";
  if (url.startsWith("ssl:")) return "ssl";
  if (url.startsWith("domain:")) return "domain";
  return "http";
}

export function buildTarget(kind: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === "http") {
    try {
      const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }
  if (kind === "icmp" || kind === "ssl" || kind === "domain") {
    const host = trimmed
      .replace(/^(icmp|ssl|domain):\/\//i, "")
      .replace(/\/$/, "")
      .split("/")[0];
    if (!host || host.includes("://") || host.includes(" ")) return null;
    return `${kind}://${host}`;
  }
  if (kind === "dns") {
    const body = trimmed.replace(/^dns:\/\//i, "");
    const [hostPart, typePart] = body.split("/");
    const host = hostPart?.trim();
    const type = (typePart ?? "A").trim().toUpperCase() || "A";
    if (!host || !/^[A-Z0-9]+$/.test(type)) return null;
    return `dns://${host}/${type}`;
  }
  const hp = parseHostPort(trimmed.replace(/^(tcp|udp):\/\//i, ""));
  if (!hp) return null;
  if (hp.port === 25) return null;
  if (kind === "udp") return `udp://${hp.hostname}:${hp.port}`;
  return `tcp://${hp.hostname}:${hp.port}`;
}

function parseHostPort(raw: string): { hostname: string; port: number } | null {
  const v6 = raw.match(/^\[([^\]]+)\]:(\d+)$/);
  const v4 = raw.match(/^([^:/]+):(\d+)$/);
  const m = v6 ?? v4;
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname: m[1], port };
}

export function expectedOk(status: number, expect: number): boolean {
  if (expect > 0) return status === expect;
  return status >= 200 && status < 300;
}

export async function ping(opts: PingOpts): Promise<CheckResult> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout_ms);
  const keyword = (opts.keyword ?? "").trim();
  const mode = opts.keyword_mode === "absent" ? "absent" : keyword ? "exists" : "";
  try {
    const res = await fetch(opts.url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": "indiestack-ping/0.1" },
    });
    const latency_ms = Date.now() - t0;
    let body = "";
    if (keyword && res.body) body = await readCapped(res.body, BODY_CAP);
    else if (res.body) await res.body.cancel();

    let error: string | null = null;
    if (!expectedOk(res.status, opts.expect_status)) {
      error = `status ${res.status}`;
    } else if (mode === "exists" && !body.includes(keyword)) {
      error = "missing keyword";
    } else if (mode === "absent" && body.includes(keyword)) {
      error = "keyword present";
    } else if (
      opts.max_latency_ms != null &&
      opts.max_latency_ms > 0 &&
      latency_ms > opts.max_latency_ms
    ) {
      error = `slow ${latency_ms}ms > ${opts.max_latency_ms}ms`;
    }

    return {
      ok: error == null,
      status_code: res.status,
      latency_ms,
      error,
    };
  } catch (err) {
    const latency_ms = Date.now() - t0;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status_code: null,
      latency_ms,
      error: aborted ? `timeout ${opts.timeout_ms}ms` : trunc(String(err), 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probe(m: Monitor): Promise<CheckResult> {
  const kind = kindOf(m.url);
  if (kind === "http") {
    return ping({
      url: m.url,
      timeout_ms: m.timeout_ms,
      expect_status: m.expect_status,
      keyword: m.keyword,
      keyword_mode: m.keyword_mode,
      max_latency_ms: m.max_latency_ms,
    });
  }
  if (kind === "icmp") {
    const host = m.url.replace(/^icmp:\/\//i, "").replace(/\/$/, "");
    return icmpProbe(host, m.timeout_ms);
  }
  if (kind === "dns") return dnsProbe(m.url, m.timeout_ms);
  if (kind === "ssl") return sslProbe(m.url.replace(/^ssl:\/\//i, "").replace(/\/$/, ""), m.timeout_ms);
  if (kind === "domain") {
    return domainProbe(m.url.replace(/^domain:\/\//i, "").replace(/\/$/, ""), m.timeout_ms);
  }
  const hp = parseHostPort(m.url.replace(/^(tcp|udp):\/\//i, ""));
  if (!hp) return { ok: false, status_code: null, latency_ms: 0, error: "bad host:port" };
  const r = await tcpProbe(hp.hostname, hp.port, m.timeout_ms);
  if (kind === "udp" && !r.ok) {
    return {
      ...r,
      error: `${r.error ?? "fail"} · UDP via TCP (Workers have no datagrams)`,
    };
  }
  return r;
}

async function dnsProbe(url: string, timeout_ms: number): Promise<CheckResult> {
  const t0 = Date.now();
  const body = url.replace(/^dns:\/\//i, "");
  const [host, typeRaw] = body.split("/");
  const type = (typeRaw ?? "A").toUpperCase();
  if (!host) return { ok: false, status_code: null, latency_ms: 0, error: "bad dns target" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout_ms);
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${encodeURIComponent(type)}`,
      {
        headers: { accept: "application/dns-json", "user-agent": "indiestack-ping/0.1" },
        signal: ac.signal,
      },
    );
    const json = (await res.json()) as { Status?: number; Answer?: unknown[] };
    const latency_ms = Date.now() - t0;
    const status = json.Status ?? -1;
    if (status === 3) return { ok: false, status_code: status, latency_ms, error: "NXDOMAIN" };
    if (status !== 0) return { ok: false, status_code: status, latency_ms, error: `dns status ${status}` };
    const n = json.Answer?.length ?? 0;
    if (n === 0) return { ok: false, status_code: 0, latency_ms, error: `no ${type} records` };
    return { ok: true, status_code: n, latency_ms, error: null };
  } catch (err) {
    return failErr(err, t0, timeout_ms);
  } finally {
    clearTimeout(timer);
  }
}

async function sslProbe(host: string, timeout_ms: number): Promise<CheckResult> {
  const t0 = Date.now();
  const live = await tlsLive(host, timeout_ms);
  if (!live.ok) return live;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout_ms);
  try {
    const res = await fetch(
      `https://crt.sh/?Identity=${encodeURIComponent(host)}&exclude=expired&output=json`,
      { headers: { "user-agent": "indiestack-ping/0.1" }, signal: ac.signal },
    );
    const text = await readCapped(res.body ?? new ReadableStream(), 200_000);
    const parsed = JSON.parse(text) as
      | { not_after?: string; common_name?: string; name_value?: string }
      | Array<{ not_after?: string; common_name?: string; name_value?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const hostLower = host.toLowerCase();
    let latest = 0;
    for (const row of rows) {
      const names = `${row.common_name ?? ""} ${row.name_value ?? ""}`.toLowerCase();
      if (!names.includes(hostLower)) continue;
      const t = Date.parse(row.not_after ?? "");
      if (t > latest) latest = t;
    }
    const latency_ms = Date.now() - t0;
    if (!latest) {
      return { ok: true, status_code: live.status_code, latency_ms, error: null };
    }
    const days = Math.floor((latest - Date.now()) / 86400000);
    if (days < SSL_DAYS) {
      return { ok: false, status_code: days, latency_ms, error: `ssl expires in ${days}d` };
    }
    return { ok: true, status_code: days, latency_ms, error: null };
  } catch (err) {
    if (live.ok) return { ...live, error: null };
    return failErr(err, t0, timeout_ms);
  } finally {
    clearTimeout(timer);
  }
}

async function domainProbe(host: string, timeout_ms: number): Promise<CheckResult> {
  const t0 = Date.now();
  const tld = host.split(".").pop() ?? "";
  const urls = [`https://rdap.org/domain/${encodeURIComponent(host)}`];
  if (tld === "com" || tld === "net") {
    urls.unshift(`https://rdap.verisign.com/${tld}/v1/domain/${encodeURIComponent(host)}`);
  }
  let lastErr = "rdap failed";
  for (const url of urls) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout_ms);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/rdap+json, application/json", "user-agent": "indiestack-ping/0.1" },
        signal: ac.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        lastErr = `rdap ${res.status}`;
        if (res.body) await res.body.cancel();
        continue;
      }
      const json = (await res.json()) as {
        events?: Array<{ eventAction?: string; eventDate?: string }>;
      };
      const exp = json.events?.find((e) => (e.eventAction ?? "").toLowerCase().includes("expir"));
      const when = exp?.eventDate ? Date.parse(exp.eventDate) : NaN;
      const latency_ms = Date.now() - t0;
      if (!Number.isFinite(when)) {
        return { ok: false, status_code: null, latency_ms, error: "no expiration in rdap" };
      }
      const days = Math.floor((when - Date.now()) / 86400000);
      if (days < DOMAIN_DAYS) {
        return { ok: false, status_code: days, latency_ms, error: `domain expires in ${days}d` };
      }
      return { ok: true, status_code: days, latency_ms, error: null };
    } catch (err) {
      lastErr = trunc(String(err), 200);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status_code: null, latency_ms: Date.now() - t0, error: lastErr };
}

async function tlsLive(host: string, timeout_ms: number): Promise<CheckResult> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout_ms);
  try {
    const res = await fetch(`https://${host}/`, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": "indiestack-ping/0.1" },
    });
    if (res.body) await res.body.cancel();
    return { ok: true, status_code: res.status, latency_ms: Date.now() - t0, error: null };
  } catch (err) {
    return failErr(err, t0, timeout_ms);
  } finally {
    clearTimeout(timer);
  }
}

function failErr(err: unknown, t0: number, timeout_ms: number): CheckResult {
  const aborted = err instanceof Error && err.name === "AbortError";
  return {
    ok: false,
    status_code: null,
    latency_ms: Date.now() - t0,
    error: aborted ? `timeout ${timeout_ms}ms` : trunc(String(err), 200),
  };
}

async function icmpProbe(hostname: string, timeout_ms: number): Promise<CheckResult> {
  const https = await httpReachable(hostname, 443, timeout_ms);
  if (https.ok) return https;
  const http = await httpReachable(hostname, 80, timeout_ms);
  if (http.ok) return http;
  const ssh = await tcpConnect(hostname, 22, timeout_ms);
  if (ssh.ok) return ssh;
  return {
    ok: false,
    status_code: null,
    latency_ms: https.latency_ms,
    error: `no ICMP on Workers; HTTPS/HTTP/22 failed (${ssh.error ?? https.error ?? "down"})`,
  };
}

async function tcpProbe(
  hostname: string,
  port: number,
  timeout_ms: number,
): Promise<CheckResult> {
  if (port === 25) {
    return { ok: false, status_code: 25, latency_ms: 0, error: "port 25 blocked by Workers" };
  }
  // Raw TCP to Cloudflare-proxied HTTP(S) is blocked. fetch() is the real check.
  if (port === 443 || port === 80) {
    return httpReachable(hostname, port, timeout_ms);
  }
  const raw = await tcpConnect(hostname, port, timeout_ms);
  if (raw.ok) return raw;
  const msg = raw.error ?? "";
  if (msg.includes("HTTP-based service") || msg.includes("cannot connect to the specified address")) {
    return httpReachable(hostname, port === 80 ? 80 : 443, timeout_ms);
  }
  return raw;
}

async function tcpConnect(
  hostname: string,
  port: number,
  timeout_ms: number,
): Promise<CheckResult> {
  const t0 = Date.now();
  let socket: Socket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    socket = connect({ hostname, port }, { allowHalfOpen: false });
    await Promise.race([
      socket.opened,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timeout ${timeout_ms}ms`)), timeout_ms);
      }),
    ]);
    const latency_ms = Date.now() - t0;
    await socket.close().catch(() => {});
    return { ok: true, status_code: port, latency_ms, error: null };
  } catch (err) {
    await socket?.close().catch(() => {});
    return {
      ok: false,
      status_code: null,
      latency_ms: Date.now() - t0,
      error: trunc(String(err), 200),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function httpReachable(
  hostname: string,
  port: number,
  timeout_ms: number,
): Promise<CheckResult> {
  const t0 = Date.now();
  const proto = port === 80 ? "http" : "https";
  const origin = port === 80 || port === 443 ? `${proto}://${hostname}/` : `${proto}://${hostname}:${port}/`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout_ms);
  try {
    const res = await fetch(origin, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": "indiestack-ping/0.1" },
    });
    if (res.body) await res.body.cancel();
    return { ok: true, status_code: res.status, latency_ms: Date.now() - t0, error: null };
  } catch (err) {
    return failErr(err, t0, timeout_ms);
  } finally {
    clearTimeout(timer);
  }
}

export async function getSetting(
  db: D1Database,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value)
    .run();
}

export async function runTick(
  env: Env,
): Promise<{ checked: number; jobs: number; alerts: number }> {
  const t0 = Date.now();
  const now = Date.now();
  const webhook = await getSetting(env.DB, "webhook_url");
  const pinged = await runPings(env, now, webhook);
  const hearts = await scanHeartbeats(env, now, webhook);
  await maybeRollup(env, now);
  await maybePrune(env, now);
  const alerts = pinged.alerts + hearts.alerts;
  console.log(
    JSON.stringify({
      msg: "tick",
      checked: pinged.checked,
      jobs: hearts.scanned,
      alerts,
      ms: Date.now() - t0,
    }),
  );
  return { checked: pinged.checked, jobs: hearts.scanned, alerts };
}

export async function recordBeat(
  env: Env,
  token: string,
): Promise<Job | null> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE token = ?")
    .bind(token)
    .first<Job>();
  if (!job) return null;
  const now = Date.now();
  const prev = job.status;
  await env.DB.prepare(
    `UPDATE jobs SET status = 'up', last_beat_at = ?, last_error = NULL, consecutive = 0
     WHERE id = ?`,
  )
    .bind(now, job.id)
    .run();
  if (prev === "down" && job.enabled) {
    const webhook = await getSetting(env.DB, "webhook_url");
    if (webhook) {
      await sendAlert(webhook, `UP · ${job.name} · beat received`).catch((err) =>
        console.error("alert failed", String(err)),
      );
    }
  }
  return { ...job, status: "up", last_beat_at: now, last_error: null, consecutive: 0 };
}

async function runPings(
  env: Env,
  now: number,
  webhook: string | null,
): Promise<{ checked: number; alerts: number }> {
  const due = await env.DB.prepare(
    `SELECT * FROM monitors
     WHERE enabled = 1
       AND (last_check_at IS NULL OR last_check_at + interval_min * 60000 <= ?)
     ORDER BY last_check_at ASC
     LIMIT ?`,
  )
    .bind(now, MAX_MONITORS)
    .all<Monitor>();

  const monitors = due.results ?? [];
  let alerts = 0;

  for (let i = 0; i < monitors.length; i += BATCH) {
    const slice = monitors.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((m) => probe(m)));

    const stmts: D1PreparedStatement[] = [];
    const pendingAlerts: string[] = [];

    for (let j = 0; j < slice.length; j++) {
      const m = slice[j];
      const r = results[j];
      const prev = m.status;
      const next: "up" | "down" = r.ok ? "up" : "down";
      const consecutive = next === prev ? m.consecutive + 1 : 1;

      stmts.push(
        env.DB.prepare(
          `INSERT INTO checks (monitor_id, ts, ok, status_code, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(m.id, now, r.ok ? 1 : 0, r.status_code, r.latency_ms, r.error),
      );
      stmts.push(
        env.DB.prepare(
          `UPDATE monitors SET
             status = ?, last_check_at = ?, last_status_code = ?,
             last_latency_ms = ?, last_error = ?, consecutive = ?
           WHERE id = ?`,
        ).bind(next, now, r.status_code, r.latency_ms, r.error, consecutive, m.id),
      );

      if (!r.ok && consecutive === FAIL_ALERT_AFTER) {
        pendingAlerts.push(`DOWN · ${m.name} · ${m.url} · ${r.error ?? "fail"}`);
      } else if (r.ok && prev === "down") {
        pendingAlerts.push(`UP · ${m.name} · ${m.url} · ${r.latency_ms}ms`);
      }
    }

    await env.DB.batch(stmts);
    alerts += await flushAlerts(webhook, pendingAlerts);
  }

  return { checked: monitors.length, alerts };
}

async function scanHeartbeats(
  env: Env,
  now: number,
  webhook: string | null,
): Promise<{ scanned: number; alerts: number }> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM jobs WHERE enabled = 1",
  ).all<Job>();
  const jobs = results ?? [];
  const stmts: D1PreparedStatement[] = [];
  const pendingAlerts: string[] = [];

  for (const j of jobs) {
    const anchor = j.last_beat_at ?? j.created_at;
    const deadline = anchor + (j.interval_min + j.grace_min) * 60000;
    if (now < deadline) continue;
    if (j.status === "down") continue;
    stmts.push(
      env.DB.prepare(
        `UPDATE jobs SET status = 'down', last_error = ?, consecutive = 1 WHERE id = ?`,
      ).bind("missed beat", j.id),
    );
    pendingAlerts.push(
      `DOWN · ${j.name} · missed beat (every ${j.interval_min}m, last ${agoMs(anchor, now)})`,
    );
  }

  if (stmts.length) await env.DB.batch(stmts);
  const alerts = await flushAlerts(webhook, pendingAlerts);
  return { scanned: jobs.length, alerts };
}

async function maybeRollup(env: Env, now: number): Promise<void> {
  const today = ymd(now);
  const last = await getSetting(env.DB, "last_rollup");
  if (!last) {
    await setSetting(env.DB, "last_rollup", today);
    return;
  }
  if (last === today) return;

  const yesterday = ymd(now - 86400000);
  const start = Date.parse(`${yesterday}T00:00:00.000Z`);
  const end = start + 86400000;

  const stats = await env.DB.prepare(
    `SELECT m.id, m.name, m.url,
            COUNT(c.id) AS n,
            SUM(c.ok) AS ok_n,
            AVG(c.latency_ms) AS avg_latency_ms
     FROM monitors m
     LEFT JOIN checks c ON c.monitor_id = m.id AND c.ts >= ? AND c.ts < ?
     GROUP BY m.id`,
  )
    .bind(start, end)
    .all<{
      id: string;
      name: string;
      url: string;
      n: number;
      ok_n: number | null;
      avg_latency_ms: number | null;
    }>();

  const jobs = await env.DB.prepare(
    "SELECT id, name, status, last_beat_at, interval_min FROM jobs",
  ).all<{
    id: string;
    name: string;
    status: string;
    last_beat_at: number | null;
    interval_min: number;
  }>();

  const body = JSON.stringify({
    date: yesterday,
    monitors: (stats.results ?? []).map((row) => {
      const n = Number(row.n) || 0;
      const ok_n = Number(row.ok_n) || 0;
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        checks: n,
        up: ok_n,
        down: Math.max(0, n - ok_n),
        avg_latency_ms: row.avg_latency_ms == null ? null : Math.round(row.avg_latency_ms),
        uptime_pct: n === 0 ? null : Math.round((ok_n / n) * 1000) / 10,
      };
    }),
    jobs: jobs.results ?? [],
  });

  await env.BUCKET.put(`rollups/${yesterday}.json`, body, {
    httpMetadata: { contentType: "application/json" },
  });
  await setSetting(env.DB, "last_rollup", today);
}

async function maybePrune(env: Env, now: number): Promise<void> {
  const last = Number((await getSetting(env.DB, "last_prune_at")) ?? 0);
  if (now - last < PRUNE_EVERY_MS) return;
  await env.DB.prepare("DELETE FROM checks WHERE ts < ?")
    .bind(now - HOT_MS)
    .run();
  await setSetting(env.DB, "last_prune_at", String(now));
}

async function flushAlerts(webhook: string | null, texts: string[]): Promise<number> {
  if (!webhook || texts.length === 0) return 0;
  let n = 0;
  for (const text of texts) {
    try {
      await sendAlert(webhook, text);
      n++;
    } catch (err) {
      console.error("alert failed", String(err));
    }
  }
  return n;
}

async function sendAlert(webhook: string, text: string): Promise<void> {
  const discord = webhook.includes("discord.com");
  const payload = discord ? { content: text } : { text };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.body) await res.body.cancel();
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let out = "";
  try {
    while (out.length < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (out.length >= cap) {
        out = out.slice(0, cap);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function agoMs(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
