import { getSetting, setSetting } from "../kernel/db";
import { trunc } from "../kernel/util";
import { putLogEvents } from "../logs/index";
import type { CommitInfo, DeployResult, DeployTarget } from "../integrations/index";

/**
 * Cloudflare submodule of integrations: Workers list + observability logs.
 *
 * Depends on integrations for the token-in-settings convention
 * (`cloudflare_token` / `cloudflare_user`). Only calls read endpoints:
 * token verify, accounts + workers scripts list, telemetry query.
 */

/** Prefilled one-click token: Pages read + Workers Scripts read + Workers Observability (queries need the write grant). */
export const CLOUDFLARE_TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens" +
  "?permissionGroupKeys=%5B%7B%22key%22%3A%22page%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_observability%22%2C%22type%22%3A%22edit%22%7D%5D" +
  "&accountId=%2A&zoneId=all&name=IndieStack%20cloudflare";

const UA = "indiestack-deploys/0.1";
const MAX_WORKERS = 5;

function headers(token: string | null): HeadersInit {
  const h: Record<string, string> = { accept: "application/json", "user-agent": UA };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let msg = "";
  try {
    msg = (JSON.parse(text) as { errors?: Array<{ message?: string }> }).errors?.[0]?.message ?? "";
  } catch {
    msg = text;
  }
  return trunc(msg || `http ${res.status}`, 160);
}

/** Validate a token (works with the observability scope) and return its id prefix. */
export async function connectCloudflare(token: string): Promise<string> {
  const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { success?: boolean; result?: { id?: string; status?: string } };
  if (json.success !== true || json.result?.status !== "active") throw new Error("token not active");
  return (json.result?.id ?? "").slice(0, 8) || "connected";
}

export async function cloudflareToken(env: Env): Promise<string | null> {
  return getSetting(env.DB, "cloudflare_token");
}

/** Accounts the token can see (for picking where workers live). */
export async function listAccounts(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { result?: Array<{ id?: string; name?: string }> };
  if (!Array.isArray(json.result)) throw new Error(`unexpected accounts response (${typeof json.result})`);
  return json.result
    .filter((a) => a.id)
    .map((a) => ({ id: a.id as string, name: a.name ?? a.id as string }));
}

/** Worker scripts in one account (for the picker). */
export async function listWorkers(token: string, account: string): Promise<string[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts?per_page=100`,
    { headers: headers(token) },
  );
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { result?: Array<{ id?: string }> };
  const result = json.result;
  if (!Array.isArray(result)) throw new Error(`unexpected scripts response (${typeof result})`);
  return result.map((s) => s.id ?? "").filter(Boolean).sort();
}

const WORKERS_TTL = 3600;

/** Cached worker list — the scripts API is the slow call on this page. */
export async function cachedWorkers(
  env: Env,
  token: string,
  account: string,
  fresh = false,
): Promise<string[]> {
  const key = `cf:workers:${account}`;
  if (!fresh) {
    try {
      const hit = await env.CACHE.get<string[]>(key, "json");
      if (hit) return hit;
    } catch {
      /* fall through to live */
    }
  }
  const list = await listWorkers(token, account);
  try {
    await env.CACHE.put(key, JSON.stringify(list), { expirationTtl: WORKERS_TTL });
  } catch {
    /* cache is best-effort */
  }
  return list;
}

/** Stored account id: explicit setting first, then legacy Pages-target fallback. */
export async function getCfAccountId(env: Env): Promise<string | null> {
  const direct = await getSetting(env.DB, "cf_account_id");
  if (direct) return direct;
  const row = await env.DB.prepare(
    "SELECT account FROM deploy_targets WHERE provider = 'cloudflare' AND account IS NOT NULL ORDER BY created_at ASC",
  ).first<{ account: string | null }>();
  return row?.account ?? null;
}

/** Worker script names selected for the logs explorer (capped). */
export async function getCfWorkers(env: Env): Promise<string[]> {
  const raw = await getSetting(env.DB, "cf_workers");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is string => typeof s === "string" && Boolean(s)).slice(0, MAX_WORKERS);
  } catch {
    return [];
  }
}

export async function setCfWorkers(env: Env, workers: string[]): Promise<string[]> {
  const clean = [...new Set(workers.map((w) => w.trim()).filter(Boolean))].slice(0, MAX_WORKERS);
  await setSetting(env.DB, "cf_workers", JSON.stringify(clean));
  return clean;
}

/** worker -> log source, plus prefs. `quiet` hides GET/POST access lines. */
export type CfLogPref = { source: string; quiet: boolean };

/** Accepts legacy string values ({worker: "src-id"}) and {source, quiet} objects. */
export async function getCfMapping(env: Env): Promise<Record<string, CfLogPref>> {
  const raw = await getSetting(env.DB, "cf_worker_sources");
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Record<string, CfLogPref> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v) out[k.slice(0, 64)] = { source: v, quiet: false };
      else if (v && typeof v === "object" && typeof (v as { source?: unknown }).source === "string") {
        const vv = v as { source: string; quiet?: unknown };
        if (vv.source) {
          out[k.slice(0, 64)] = { source: vv.source, quiet: vv.quiet === true };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function setCfMapping(
  env: Env,
  mapping: Record<string, string | CfLogPref>,
): Promise<Record<string, CfLogPref>> {
  const valid = await env.DB.prepare("SELECT id FROM log_sources").all<{ id: string }>();
  const ids = new Set((valid.results ?? []).map((r) => r.id));
  const clean: Record<string, CfLogPref> = {};
  for (const [k, v] of Object.entries(mapping).slice(0, 20)) {
    if (typeof k !== "string" || !k) continue;
    const source = typeof v === "string" ? v : (v as CfLogPref)?.source;
    const quiet = typeof v === "object" && v !== null && (v as CfLogPref).quiet === true;
    if (typeof source === "string" && ids.has(source)) {
      clean[k.slice(0, 64)] = { source, quiet };
    }
  }
  await setSetting(env.DB, "cf_worker_sources", JSON.stringify(clean));
  return clean;
}

export type WorkerLogEvent = { ts: number; level: string; message: string; service: string };

/**
 * Recent log events for worker scripts via the telemetry query API.
 * Called from the cron tick (throttled to one query every few minutes) and
 * from admin pickers; queries cost against the account.
 * Needs the Workers Observability grant + invocation_logs enabled.
 */
export async function queryTelemetry(
  env: Env,
  account: string,
  services: string[],
  opts?: { level?: string; hours?: number; limit?: number },
): Promise<{ events: WorkerLogEvent[]; error: string | null }> {
  const token = await cloudflareToken(env);
  if (!token) return { events: [], error: "cloudflare not connected" };
  if (!account) return { events: [], error: "cloudflare account required" };
  const names = [...new Set(services.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_WORKERS);
  if (!names.length) return { events: [], error: null };
  const to = Date.now();
  const from = to - Math.min(168, Math.max(1, opts?.hours ?? 24)) * 3600_000;
  const filters: Array<Record<string, unknown>> = [
    names.length === 1
      ? { key: "$metadata.service", operation: "eq", type: "string", value: names[0] }
      : { key: "$metadata.service", operation: "in", type: "string", value: names.join(",") },
  ];
  if (opts?.level) {
    filters.push({ key: "$metadata.level", operation: "eq", type: "string", value: opts.level });
  }
  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/observability/telemetry/query`,
      {
        method: "POST",
        headers: { ...headers(token), "content-type": "application/json" },
        body: JSON.stringify({
          queryId: "indiestack-worker-logs",
          timeframe: { from, to },
          parameters: { filterCombination: "and", filters },
          view: "events",
          limit: Math.min(100, Math.max(1, opts?.limit ?? 50)),
        }),
      },
    );
  } catch (err) {
    return { events: [], error: trunc(String(err), 160) };
  }
  if (res.status === 401 || res.status === 403) {
    return { events: [], error: "token rejected (needs Workers Scripts + Observability grants)" };
  }
  if (!res.ok) return { events: [], error: `cloudflare ${res.status}` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { events: [], error: "bad telemetry response" };
  }
  const raw = (json as { result?: { events?: { events?: unknown[] } } })?.result?.events?.events;
  if (!Array.isArray(raw)) return { events: [], error: null };
  const events: WorkerLogEvent[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const src = (o.source ?? o) as Record<string, unknown>;
    const tsRaw = o.timestamp ?? o["@timestamp"] ?? src.timestamp ?? to;
    const service =
      String(
        src.service ?? (o as { $metadata?: { service?: unknown } }).$metadata?.service ?? "",
      ) || names[0];
    events.push({
      ts: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || to,
      level: String(src.level ?? "info"),
      message: String(
        src.message ?? (o as { $metadata?: { message?: unknown } }).$metadata?.message ?? JSON.stringify(src).slice(0, 300),
      ),
      service,
    });
  }
  events.sort((a, b) => b.ts - a.ts);
  return { events, error: null };
}

const CF_LOG_EVERY_MS = 5 * 60 * 1000;
const CF_LOG_CAP = 50;

/** Request logging (GET /api/x), cron heartbeat lines — infra noise, not app events. */
const QUIET_NOISE_RE =
  /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s|\* \* \* \* \*|^tick\b/i;

/**
 * Cron pull: recent telemetry of mapped workers into log_events (D1).
 * The UNIQUE (source_id, ts, message) index makes re-pulls idempotent, so a
 * small lookback window is enough to cover the poll gap without cursors.
 * Mappings with `quiet` drop infra noise (GET/POST access lines, cron
 * heartbeats) at write time.
 */
export async function syncCloudflareLogs(env: Env, now: number): Promise<number> {
  const mapping = await getCfMapping(env);
  const names = Object.keys(mapping).slice(0, MAX_WORKERS);
  if (!names.length) return 0;
  const last = Number((await getSetting(env.DB, "cf_log_poll_at")) ?? 0);
  if (now - last < CF_LOG_EVERY_MS) return 0;
  const account = await getCfAccountId(env);
  if (!account) return 0;
  const { events, error } = await queryTelemetry(env, account, names, { hours: 1, limit: CF_LOG_CAP }).catch(
    () => ({ events: [] as WorkerLogEvent[], error: "telemetry failed" as string | null }),
  );
  let synced = 0;
  const byService = new Map<string, WorkerLogEvent[]>();
  for (const e of events) {
    const pref = mapping[e.service];
    if (!pref) continue;
    if (pref.quiet && QUIET_NOISE_RE.test(e.message)) continue;
    const list = byService.get(e.service) ?? [];
    list.push(e);
    byService.set(e.service, list);
  }
  for (const [service, list] of byService) {
    synced += await putLogEvents(
      env,
      mapping[service].source,
      list.map((e) => ({
        ts: e.ts,
        level: e.level,
        message: `[${e.service}] ${e.message}`,
        data: { service: e.service, message: e.message },
      })),
    ).catch(() => 0);
  }
  await setSetting(env.DB, "cf_log_poll_at", String(now)).catch(() => {});
  await setSetting(env.DB, "cf_log_last", JSON.stringify({ at: now, synced, error })).catch(() => {});
  return synced;
}

export type WorkerVersion = { number: number; message: string; source: string; ts: number };

type ScriptVersion = {
  id?: string;
  number?: number;
  metadata?: { created_on?: string; author_email?: string; source?: string };
  annotations?: Record<string, string>;
};

/** The versions list usually returns an array, but normalize defensively. */
function asVersionList(json: unknown): ScriptVersion[] {
  const r = (json as { result?: unknown })?.result;
  if (Array.isArray(r)) return r as ScriptVersion[];
  if (r && typeof r === "object") {
    for (const v of Object.values(r)) {
      if (Array.isArray(v)) return v as ScriptVersion[];
    }
  }
  throw new Error(`unexpected versions response (${Array.isArray(r) ? "array" : typeof r})`);
}

/** Latest script versions of one worker, newest first. */
export async function listWorkerVersions(
  token: string,
  account: string,
  script: string,
  perPage = 3,
): Promise<WorkerVersion[]> {
  const qs = new URLSearchParams({ per_page: String(Math.min(10, Math.max(1, perPage))) });
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(script)}/versions?${qs}`,
    { headers: headers(token) },
  );
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { result?: ScriptVersion[] };
  return asVersionList(json).map((v) => ({
    number: Number(v.number) || 0,
    message:
      v.annotations?.["workers/message"] || v.annotations?.["workers/tag"] || "",
    source: v.metadata?.source ?? "",
    ts: v.metadata?.created_on ? Date.parse(v.metadata.created_on) : Date.now(),
  }));
}

/**
 * Latest deployments (script versions) of a worker, mapped to the shared
 * commit shape so they land on the analytics chart like GitHub commits.
 */
export async function cloudflareProbe(t: DeployTarget, token: string | null): Promise<DeployResult> {
  if (!token) return { ok: null, detail: null, error: "cloudflare not connected", commits: [] };
  if (!t.account || !t.project) {
    return { ok: null, detail: null, error: "account id + worker required", commits: [] };
  }
  let versions: WorkerVersion[];
  try {
    versions = await listWorkerVersions(token, t.account, t.project, 10);
  } catch (err) {
    const msg = String(err);
    if (/http 40[13]/.test(msg)) return { ok: false, detail: null, error: msg, commits: [] };
    if (/http 404/.test(msg)) {
      return { ok: false, detail: null, error: "worker not found (check name or account id)", commits: [] };
    }
    return { ok: null, detail: null, error: msg, commits: [] };
  }
  if (!versions.length) return { ok: null, detail: "no versions yet", error: null, commits: [] };
  // Script versions ARE the deployments (wrangler push, dashboard, CI).
  // Reuse the shared marker shape so they land on the analytics chart.
  const commits: CommitInfo[] = versions.map((v) => ({
    sha: `v${v.number}`,
    msg: (v.message || (v.source ? `${v.source} deploy` : "deploy")).split("\n")[0].slice(0, 120),
    ts: v.ts,
    url: null,
    merge: false,
  }));
  const head = commits[0];
  return { ok: true, detail: `${t.project} · ${head.sha} ${head.msg}`, error: null, commits };
}
