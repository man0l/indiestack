// App Store Connect → Analytics Reports API.
//
// Flow (all with an ES256 JWT signed from the user's .p8 key):
//   POST /v1/analyticsReportRequests (ONGOING + ONE_TIME_SNAPSHOT for backfill)
//   GET  /v1/analyticsReportRequests/{id}/reports       → pick the two standard reports
//   GET  /v1/analyticsReports/{id}/instances?DAILY      → queue new instances
//   GET  /v1/analyticsReportInstances/{id}/segments     → gzip TSV download URLs
// The tick downloads at most a couple of instances per minute, so a 90-day
// backfill trickles in instead of spending the 10 ms CPU budget at once.
// Apple's data lags ~2–3 days; the first reports appear 24–48 h after the
// first request.

import { getSettings, setSetting } from "../kernel/db";

const API = "https://api.appstoreconnect.apple.com";

export const MAX_APPS = 3;
export const KEEP_DAYS = 90;
const DISCOVER_EVERY_MS = 6 * 60 * 60 * 1000;
/** Instances can gain late-arriving batches; re-read ones this fresh on discovery. */
const REFRESH_RECENT_DAYS = 5;
const INSTANCES_PER_TICK = 2;
const MAX_ATTEMPTS = 5;
const MAX_SEGMENT_BYTES = 20 * 1024 * 1024;

export const SETTING_KEYS = ["appstore_issuer_id", "appstore_key_id", "appstore_p8"] as const;

export type Creds = { issuerId: string; keyId: string; p8: string };

export type AppRow = {
  id: string;
  apple_id: string;
  name: string;
  site_id: string | null;
  ongoing_request_id: string | null;
  snapshot_request_id: string | null;
  status: "pending" | "ready" | "error";
  last_discover_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
  created_at: number;
};

export type Report = "engagement" | "downloads";
type Src = "ongoing" | "snapshot";

export type Metric =
  | "impressions"
  | "search_impressions"
  | "page_views"
  | "downloads"
  | "first_downloads"
  | "search_downloads";

export type DayRow = {
  day: string;
  impressions: number;
  searchImpressions: number;
  pageViews: number;
  downloads: number;
  firstDownloads: number;
  searchDownloads: number;
};

type EncEnv = Env & { APPSTORE_ENC_KEY?: string };

// ---------- credentials (optionally AES-GCM sealed with a Worker secret) ----------

const te = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? te.encode(input) : input;
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sealKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", te.encode(`appstore:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(env: EncEnv, plain: string): Promise<string> {
  const secret = env.APPSTORE_ENC_KEY?.trim();
  if (!secret) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(secret), te.encode(plain));
  return `enc1:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

async function unseal(env: EncEnv, stored: string): Promise<string> {
  if (!stored.startsWith("enc1:")) return stored;
  const secret = env.APPSTORE_ENC_KEY?.trim();
  if (!secret) throw new Error("the .p8 key is encrypted but Worker secret APPSTORE_ENC_KEY is not set");
  const [, iv, ct] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

export function encryptionOn(env: Env): boolean {
  return Boolean((env as EncEnv).APPSTORE_ENC_KEY?.trim());
}

export async function loadCreds(env: Env): Promise<Creds | null> {
  const s = await getSettings(env.DB, SETTING_KEYS);
  if (!s.appstore_issuer_id || !s.appstore_key_id || !s.appstore_p8) return null;
  return {
    issuerId: s.appstore_issuer_id,
    keyId: s.appstore_key_id,
    p8: await unseal(env as EncEnv, s.appstore_p8),
  };
}

export async function saveCreds(env: Env, c: Creds): Promise<void> {
  await setSetting(env.DB, "appstore_issuer_id", c.issuerId);
  await setSetting(env.DB, "appstore_key_id", c.keyId);
  await setSetting(env.DB, "appstore_p8", await seal(env as EncEnv, c.p8));
}

/** Normalize a pasted .p8 (PEM, or bare base64). Returns null if it is not PKCS#8 base64. */
export function normalizeP8(input: string): string | null {
  const body = input
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) return null;
  try {
    atob(body);
  } catch {
    return null;
  }
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
}

// ---------- JWT + HTTP ----------

const jwtCache = new Map<string, { token: string; exp: number }>();

export async function signJwt(c: Creds, now = Date.now()): Promise<string> {
  const cacheKey = `${c.issuerId}:${c.keyId}`;
  const hit = jwtCache.get(cacheKey);
  if (hit && hit.exp - 60_000 > now) return hit.token;
  const der = unb64(normalizeP8(c.p8)!.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  // Apple rejects tokens that live longer than 20 minutes.
  const exp = iat + 15 * 60;
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: c.keyId, typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: c.issuerId, iat, exp, aud: "appstoreconnect-v1" }),
  )}`;
  // WebCrypto ECDSA output is raw r||s (IEEE P1363) — exactly what JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(input)));
  const token = `${input}.${b64url(sig)}`;
  jwtCache.set(cacheKey, { token, exp: exp * 1000 });
  return token;
}

type AscResult = { status: number; json: any };

export async function asc(c: Creds, pathOrUrl: string, init?: { method?: string; body?: unknown }): Promise<AscResult> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${await signJwt(c)}`,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export function ascError(r: AscResult): string {
  const e = r.json?.errors?.[0];
  const detail = e ? `${e.title ?? ""}${e.detail ? `: ${e.detail}` : ""}`.trim() : "";
  if (r.status === 401) return "App Store Connect rejected the key (401). Check issuer id, key id and the .p8.";
  if (r.status === 403) return `Forbidden (403)${detail ? ` — ${detail}` : ""}. The first report request needs an Admin key.`;
  return `App Store Connect ${r.status}${detail ? ` — ${detail}` : ""}`.slice(0, 300);
}

/** GET every page of a list endpoint (follows links.next), capped. */
async function ascAll(c: Creds, path: string, maxPages = 5): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  for (let i = 0; next && i < maxPages; i++) {
    const r = await asc(c, next);
    if (r.status !== 200) throw new Error(ascError(r));
    out.push(...(r.json?.data ?? []));
    next = r.json?.links?.next ?? null;
  }
  return out;
}

export async function listApps(c: Creds): Promise<Array<{ appleId: string; name: string; bundleId: string }>> {
  const data = await ascAll(c, "/v1/apps?fields[apps]=name,bundleId&limit=200", 2);
  return data.map((a) => ({
    appleId: String(a.id),
    name: String(a.attributes?.name ?? a.id),
    bundleId: String(a.attributes?.bundleId ?? ""),
  }));
}

/** Validate a key with the cheapest call there is. */
export async function probeCreds(c: Creds): Promise<string | null> {
  try {
    const r = await asc(c, "/v1/apps?limit=1&fields[apps]=name");
    return r.status === 200 ? null : ascError(r);
  } catch (e) {
    return `could not sign or send the request: ${String(e).slice(0, 200)}`;
  }
}

// ---------- report requests + discovery ----------

async function ensureRequest(c: Creds, appleId: string, accessType: "ONGOING" | "ONE_TIME_SNAPSHOT"): Promise<string> {
  const r = await asc(c, "/v1/analyticsReportRequests", {
    method: "POST",
    body: {
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType },
        relationships: { app: { data: { type: "apps", id: appleId } } },
      },
    },
  });
  if (r.status === 201 && r.json?.data?.id) return String(r.json.data.id);
  // Only one request per app and access type: reuse the existing one.
  if (r.status === 409 || r.status === 422) {
    const list = await asc(c, `/v1/apps/${appleId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=10`);
    const found = (list.json?.data ?? []).find((d: any) => !d.attributes?.stoppedDueToInactivity) ?? list.json?.data?.[0];
    if (found?.id) return String(found.id);
  }
  throw new Error(ascError(r));
}

/** Report names are not a documented enum, so match loosely and prefer "standard". */
export function pickReports(reports: Array<{ id: string; name: string }>): Partial<Record<Report, string>> {
  const out: Partial<Record<Report, string>> = {};
  const rank = (n: string) => (n.includes("standard") ? 0 : 1);
  const sorted = [...reports].sort((a, b) => rank(a.name.toLowerCase()) - rank(b.name.toLowerCase()));
  for (const r of sorted) {
    const n = r.name.toLowerCase();
    if (n.includes("detailed")) continue;
    if (!out.engagement && n.includes("discovery and engagement")) out.engagement = r.id;
    else if (!out.downloads && n.includes("download") && !n.includes("pre-order")) out.downloads = r.id;
  }
  return out;
}

async function discoverRequest(env: Env, c: Creds, app: AppRow, requestId: string, src: Src, now: number): Promise<number> {
  const reports = (await ascAll(c, `/v1/analyticsReportRequests/${requestId}/reports?limit=200`, 3)).map((r) => ({
    id: String(r.id),
    name: String(r.attributes?.name ?? ""),
  }));
  const picked = pickReports(reports);
  const cutoff = isoDay(now - KEEP_DAYS * 86400000);
  const fresh = isoDay(now - REFRESH_RECENT_DAYS * 86400000);
  let queued = 0;
  for (const kind of ["engagement", "downloads"] as const) {
    const reportId = picked[kind];
    if (!reportId) continue;
    const instances = await ascAll(c, `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`, 4);
    const stmts: D1PreparedStatement[] = [];
    for (const inst of instances) {
      const pd = String(inst.attributes?.processingDate ?? "");
      if (!pd || pd < cutoff) continue;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO appstore_instances (instance_id, app_id, report, src, processing_date, state)
           VALUES (?, ?, ?, ?, ?, 'queued')
           ON CONFLICT(instance_id) DO UPDATE SET state = 'queued', attempts = 0
           WHERE appstore_instances.state = 'done' AND excluded.processing_date >= ?`,
        ).bind(String(inst.id), app.id, kind, src, pd, fresh),
      );
    }
    if (stmts.length) {
      const res = await env.DB.batch(stmts);
      queued += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    }
  }
  return queued;
}

export async function discoverApp(env: Env, c: Creds, app: AppRow, now: number): Promise<number> {
  let ongoing = app.ongoing_request_id;
  let snapshot = app.snapshot_request_id;
  if (!ongoing) {
    ongoing = await ensureRequest(c, app.apple_id, "ONGOING");
    await env.DB.prepare("UPDATE appstore_apps SET ongoing_request_id = ? WHERE id = ?").bind(ongoing, app.id).run();
  }
  if (!snapshot) {
    // Backfill is a nice-to-have; a failed snapshot must not block the ongoing feed.
    snapshot = await ensureRequest(c, app.apple_id, "ONE_TIME_SNAPSHOT").catch(() => null);
    if (snapshot) {
      await env.DB.prepare("UPDATE appstore_apps SET snapshot_request_id = ? WHERE id = ?").bind(snapshot, app.id).run();
    }
  }
  let queued = await discoverRequest(env, c, app, ongoing, "ongoing", now);
  if (snapshot) queued += await discoverRequest(env, c, app, snapshot, "snapshot", now).catch(() => 0);
  return queued;
}

// ---------- download + parse ----------

/** Parse an Analytics Reports TSV into per-day metric totals for one app. */
export function aggregateTsv(report: Report, tsv: string, appleId: string): Map<string, Map<Metric, number>> {
  const out = new Map<string, Map<Metric, number>>();
  const lines = tsv.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().replace(/^"|"$/g, ""));
  const col = (name: string) => header.indexOf(name);
  const iDate = col("Date");
  const iApp = col("App Apple Identifier");
  const iSource = col("Source Type");
  const iCount = col("Counts");
  const iEvent = col("Event");
  const iType = col("Download Type");
  if (iDate < 0 || iCount < 0) return out;
  const add = (day: string, m: Metric, v: number) => {
    let d = out.get(day);
    if (!d) out.set(day, (d = new Map()));
    d.set(m, (d.get(m) ?? 0) + v);
  };
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li]) continue;
    const f = lines[li].split("\t").map((v) => v.trim().replace(/^"|"$/g, ""));
    if (iApp >= 0 && f[iApp] && f[iApp] !== appleId) continue;
    const day = f[iDate]?.slice(0, 10);
    const n = Number(f[iCount]);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(n)) continue;
    const search = iSource >= 0 && f[iSource] === "App Store search";
    if (report === "engagement") {
      const ev = iEvent >= 0 ? f[iEvent] : "";
      if (ev === "Impression") {
        add(day, "impressions", n);
        if (search) add(day, "search_impressions", n);
      } else if (ev === "Page view") {
        add(day, "page_views", n);
      }
    } else {
      const t = iType >= 0 ? f[iType] : "";
      if (t === "First-time Download" || t === "Redownload") {
        add(day, "downloads", n);
        if (t === "First-time Download") add(day, "first_downloads", n);
        if (search) add(day, "search_downloads", n);
      }
    }
  }
  return out;
}

async function gunzipText(res: Response): Promise<string> {
  if (!res.body) return "";
  // Segments are .gz; tolerate a CDN that already decoded them.
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return new TextDecoder().decode(buf);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

type InstanceRow = { instance_id: string; app_id: string; report: Report; src: Src; attempts: number };

async function processInstance(env: Env, c: Creds, inst: InstanceRow, app: AppRow, now: number): Promise<void> {
  const segments = await ascAll(c, `/v1/analyticsReportInstances/${inst.instance_id}/segments?limit=200`, 2);
  const totals = new Map<string, Map<Metric, number>>();
  for (const seg of segments) {
    const url = seg.attributes?.url;
    if (!url) continue;
    if (Number(seg.attributes?.sizeInBytes ?? 0) > MAX_SEGMENT_BYTES) throw new Error("segment too large");
    // Pre-signed URL: no Authorization header.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`segment download ${res.status}`);
    const part = aggregateTsv(inst.report, await gunzipText(res), app.apple_id);
    for (const [day, ms] of part) {
      let d = totals.get(day);
      if (!d) totals.set(day, (d = new Map()));
      for (const [m, v] of ms) d.set(m, (d.get(m) ?? 0) + v);
    }
  }
  const cutoff = isoDay(now - KEEP_DAYS * 86400000);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM appstore_daily WHERE instance_id = ?").bind(inst.instance_id),
  ];
  for (const [day, ms] of totals) {
    if (day < cutoff) continue;
    for (const [m, v] of ms) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO appstore_daily (app_id, instance_id, src, day, metric, value) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(app.id, inst.instance_id, inst.src, day, m, Math.round(v)),
      );
    }
  }
  stmts.push(
    env.DB.prepare(
      "UPDATE appstore_instances SET state = 'done', error = NULL, done_at = ? WHERE instance_id = ?",
    ).bind(now, inst.instance_id),
    env.DB.prepare(
      "UPDATE appstore_apps SET status = 'ready', last_sync_at = ?, last_error = NULL WHERE id = ?",
    ).bind(now, app.id),
  );
  await env.DB.batch(stmts);
}

// ---------- tick ----------

export async function listAppRows(db: D1Database): Promise<AppRow[]> {
  const { results } = await db.prepare("SELECT * FROM appstore_apps ORDER BY created_at ASC").all<AppRow>();
  return results ?? [];
}

/** One step of sync: discover stale apps, then drain a few queued instances. */
export async function syncStep(env: Env, now: number, force = false): Promise<{ queued: number; processed: number }> {
  const apps = await listAppRows(env.DB);
  if (apps.length === 0) return { queued: 0, processed: 0 };
  let queued = 0;
  let processed = 0;
  let creds: Creds | null = null;
  const getCreds = async () => (creds ??= await loadCreds(env));

  for (const app of apps) {
    if (!force && app.last_discover_at && now - app.last_discover_at < DISCOVER_EVERY_MS) continue;
    const c = await getCreds().catch(() => null);
    if (!c) break;
    try {
      queued += await discoverApp(env, c, app, now);
      await env.DB.prepare(
        "UPDATE appstore_apps SET last_discover_at = ?, last_error = NULL, status = CASE WHEN status = 'error' THEN 'pending' ELSE status END WHERE id = ?",
      )
        .bind(now, app.id)
        .run();
    } catch (e) {
      await env.DB.prepare(
        "UPDATE appstore_apps SET last_discover_at = ?, status = 'error', last_error = ? WHERE id = ?",
      )
        .bind(now, String(e instanceof Error ? e.message : e).slice(0, 300), app.id)
        .run();
    }
  }

  const { results: pending } = await env.DB.prepare(
    "SELECT instance_id, app_id, report, src, attempts FROM appstore_instances WHERE state = 'queued' ORDER BY processing_date DESC LIMIT ?",
  )
    .bind(INSTANCES_PER_TICK)
    .all<InstanceRow>();
  for (const inst of pending ?? []) {
    const app = apps.find((a) => a.id === inst.app_id);
    if (!app) {
      await env.DB.prepare("DELETE FROM appstore_instances WHERE instance_id = ?").bind(inst.instance_id).run();
      continue;
    }
    const c = await getCreds().catch(() => null);
    if (!c) break;
    try {
      await processInstance(env, c, inst, app, now);
      processed++;
    } catch (e) {
      const attempts = inst.attempts + 1;
      await env.DB.prepare(
        "UPDATE appstore_instances SET attempts = ?, state = ?, error = ? WHERE instance_id = ?",
      )
        .bind(attempts, attempts >= MAX_ATTEMPTS ? "failed" : "queued", String(e).slice(0, 300), inst.instance_id)
        .run();
    }
  }

  if (queued > 0 || force) await prune(env, now);
  return { queued, processed };
}

async function prune(env: Env, now: number): Promise<void> {
  const cutoff = isoDay(now - KEEP_DAYS * 86400000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM appstore_daily WHERE day < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM appstore_instances WHERE processing_date < ?").bind(cutoff),
  ]);
}

// ---------- reads ----------

export function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Per-day totals across the given apps. For each app/day/metric, ongoing rows win over snapshot rows. */
export async function dailyFor(db: D1Database, appIds: string[], sinceDay: string): Promise<DayRow[]> {
  if (appIds.length === 0) return [];
  const ph = appIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT app_id, day, metric,
              COALESCE(SUM(CASE WHEN src = 'ongoing' THEN value END), SUM(value)) AS v
       FROM appstore_daily WHERE app_id IN (${ph}) AND day >= ?
       GROUP BY app_id, day, metric`,
    )
    .bind(...appIds, sinceDay)
    .all<{ app_id: string; day: string; metric: Metric; v: number }>();
  const byDay = new Map<string, DayRow>();
  const key: Record<Metric, keyof Omit<DayRow, "day">> = {
    impressions: "impressions",
    search_impressions: "searchImpressions",
    page_views: "pageViews",
    downloads: "downloads",
    first_downloads: "firstDownloads",
    search_downloads: "searchDownloads",
  };
  for (const r of results ?? []) {
    const k = key[r.metric];
    if (!k) continue;
    let d = byDay.get(r.day);
    if (!d) {
      d = { day: r.day, impressions: 0, searchImpressions: 0, pageViews: 0, downloads: 0, firstDownloads: 0, searchDownloads: 0 };
      byDay.set(r.day, d);
    }
    d[k] += Number(r.v) || 0;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** App Store days for every app linked to an analytics site — the analytics chart overlay. */
export async function dailyForSite(db: D1Database, siteId: string, sinceDay: string): Promise<DayRow[]> {
  const { results } = await db
    .prepare("SELECT id FROM appstore_apps WHERE site_id = ?")
    .bind(siteId)
    .all<{ id: string }>()
    .catch(() => ({ results: [] as Array<{ id: string }> }));
  return dailyFor(db, (results ?? []).map((r) => r.id), sinceDay);
}
