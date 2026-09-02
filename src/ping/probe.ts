import { connect } from "cloudflare:sockets";
import { notifyAll } from "../kernel/alert";
import { MAX_MONITORS, type Monitor } from "../kernel/types";
import { readCapped, trunc } from "../kernel/util";
import { kindOf, parseHostPort } from "./target";

const BATCH = 5;
const FAIL_ALERT_AFTER = 2;
const BODY_CAP = 64 * 1024;
const SSL_DAYS = 14;
const DOMAIN_DAYS = 30;

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
  headers?: Record<string, string>;
};

export function parseHeaders(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!k || k.toLowerCase() === "user-agent") continue;
    out[k] = v;
  }
  return out;
}

function expectedOk(status: number, expect: number): boolean {
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
      headers: { "user-agent": "indiestack-ping/0.1", ...opts.headers },
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
      headers: parseHeaders(m.headers),
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

async function tcpProbe(hostname: string, port: number, timeout_ms: number): Promise<CheckResult> {
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

async function tcpConnect(hostname: string, port: number, timeout_ms: number): Promise<CheckResult> {
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

async function httpReachable(hostname: string, port: number, timeout_ms: number): Promise<CheckResult> {
  const t0 = Date.now();
  const proto = port === 80 ? "http" : "https";
  const origin =
    port === 80 || port === 443 ? `${proto}://${hostname}/` : `${proto}://${hostname}:${port}/`;
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

export async function runPings(env: Env, now: number): Promise<{ checked: number; alerts: number }> {
  const due = await env.DB.prepare(
    `SELECT * FROM monitors
     WHERE enabled = 1
       AND (mute_until IS NULL OR mute_until <= ?)
       AND (last_check_at IS NULL OR last_check_at + interval_min * 60000 <= ?)
     ORDER BY last_check_at ASC
     LIMIT ?`,
  )
    .bind(now, now, MAX_MONITORS)
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
      let lastNag = m.last_nag_at ?? null;
      if (!r.ok && consecutive === FAIL_ALERT_AFTER) {
        pendingAlerts.push(`DOWN · ${m.name} · ${m.url} · ${r.error ?? "fail"}`);
        lastNag = now;
      } else if (
        !r.ok &&
        next === "down" &&
        prev === "down" &&
        (m.nag_min ?? 0) > 0 &&
        (lastNag == null || now - lastNag >= m.nag_min * 60000)
      ) {
        pendingAlerts.push(`STILL DOWN · ${m.name} · ${m.url} · ${r.error ?? "fail"}`);
        lastNag = now;
      } else if (r.ok && prev === "down") {
        pendingAlerts.push(`UP · ${m.name} · ${m.url} · ${r.latency_ms}ms`);
        lastNag = null;
      }

      stmts.push(
        env.DB.prepare(
          `UPDATE monitors SET
             status = ?, last_check_at = ?, last_status_code = ?,
             last_latency_ms = ?, last_error = ?, consecutive = ?, last_nag_at = ?
           WHERE id = ?`,
        ).bind(next, now, r.status_code, r.latency_ms, r.error, consecutive, lastNag, m.id),
      );
    }

    await env.DB.batch(stmts);
    alerts += await notifyAll(env, pendingAlerts);
  }

  return { checked: monitors.length, alerts };
}
