export const MAX_ANALYTICS_SITES = 3;
export const MAX_HITS_PER_SITE_DAY = 2000;
export const MAX_PATH = 200;

export type AnalyticsSite = {
  id: string;
  name: string;
  token: string;
  enabled: number;
  created_at: number;
};

export async function listAnalyticsSites(db: D1Database): Promise<AnalyticsSite[]> {
  const { results } = await db
    .prepare("SELECT * FROM analytics_sites ORDER BY created_at ASC")
    .all<AnalyticsSite>();
  return results ?? [];
}

export function collectorScript(): string {
  return `(function(){
  var s=document.currentScript;
  if(!s) return;
  var site=s.getAttribute("data-site")||"";
  if(!site) return;
  if(document.visibilityState==="prerender") return;
  var o=new URL(s.src).origin;
  var last=location.pathname;
  function post(path,obj){
    obj.s=site;
    var b=JSON.stringify(obj);
    if(navigator.sendBeacon) navigator.sendBeacon(o+path,b);
    else fetch(o+path,{method:"POST",body:b,keepalive:true});
  }
  function pv(){post("/hit",{p:location.pathname.slice(0,200),r:(document.referrer||"").slice(0,200),w:window.innerWidth||0});}
  function nav(){
    if(location.pathname!==last){last=location.pathname;pv();}
  }
  window.df={
    track:function(n){try{post("/event",{e:String(n).slice(0,40),p:location.pathname.slice(0,200),r:(document.referrer||"").slice(0,200)});}catch(_){}},
    identify:function(m){try{post("/event",{i:String(m).slice(0,120),p:location.pathname.slice(0,200),r:(document.referrer||"").slice(0,200)});}catch(_){}}
  };
  pv();
  if(history.pushState){
    history.pushState=function(f){return function(){var r=f.apply(this,arguments);nav();return r;};}(history.pushState);
    history.replaceState=function(f){return function(){var r=f.apply(this,arguments);nav();return r;};}(history.replaceState);
    window.addEventListener("popstate",nav);
  }
})();`;
}

export type HitPayload = { s: string; p: string; r?: string | null; w?: number };

export function parseHit(raw: string): HitPayload | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const s = typeof v.s === "string" ? v.s.trim() : "";
    if (!s) return null;
    let p = typeof v.p === "string" && v.p.startsWith("/") ? v.p.slice(0, MAX_PATH) : "/";
    if (p.startsWith("/beat") || p.startsWith("/log") || p.startsWith("/hit") || p.startsWith("/mcp")) {
      p = "/";
    }
    const r = typeof v.r === "string" && v.r ? v.r.slice(0, MAX_PATH) : null;
    return { s, p, r };
  } catch {
    return null;
  }
}

export type RecordHitResult = { ok: boolean; counted: boolean };

// Per-isolate cache so hits don't pay a settings read each time.
let saltCache: string | null = null;

async function getSalt(env: Env): Promise<string> {
  if (saltCache) return saltCache;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'analytics_salt'")
    .first<{ value: string }>();
  if (row?.value) {
    saltCache = row.value;
    return saltCache;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('analytics_salt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(salt)
    .run();
  saltCache = salt;
  return salt;
}

/** Daily-rotated visitor bucket: hash(salt + ip + day). Cannot be linked across days. */
export async function visitorBucket(env: Env, siteToken: string, ip: string, day: string): Promise<string> {
  const salt = await getSalt(env);
  const data = new TextEncoder().encode(`${salt}${siteToken}${ip}${day}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Collapse a referrer URL to its hostname — the unit people actually read. */
export function refHost(raw: string): string {
  try {
    const u = new URL(raw);
    return (u.hostname || raw).slice(0, 100);
  } catch {
    return raw.slice(0, 100);
  }
}

export async function recordHit(
  env: Env,
  payload: HitPayload,
  country: string | null,
  ip: string,
): Promise<RecordHitResult> {
  const site = await env.DB.prepare(
    "SELECT id, token FROM analytics_sites WHERE token = ? AND enabled = 1",
  )
    .bind(payload.s)
    .first<{ id: string; token: string }>();
  if (!site) return { ok: false, counted: false };
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  // Read-guard so a spike cannot eat the owner's D1 write quota.
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM hits WHERE site_id = ? AND day = ?",
  )
    .bind(site.id, day)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_HITS_PER_SITE_DAY) {
    return { ok: true, counted: false };
  }
  const vid = await visitorBucket(env, site.token, ip, day);
  await env.DB.prepare(
    "INSERT INTO hits (site_id, day, ts, path, ref, country, vid) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      site.id,
      day,
      now,
      payload.p,
      payload.r ? refHost(payload.r) : null,
      country,
      vid,
    )
    .run();
  return { ok: true, counted: true };
}

export type SiteStats = {
  site: AnalyticsSite;
  totals: { views: number; uniques: number };
  days: Array<{ day: string; views: number; uniques: number }>;
  topPaths: Array<{ path: string; views: number; uniques: number }>;
  topRefs: Array<{ ref: string; views: number }>;
  topCountries: Array<{ country: string; views: number }>;
};

/** Stats for a site id — used by the share plugin for public dashboards. */
export async function siteStatsById(env: Env, siteId: string, days = 7): Promise<SiteStats | null> {
  const site = await env.DB.prepare("SELECT * FROM analytics_sites WHERE id = ?")
    .bind(siteId)
    .first<AnalyticsSite>();
  if (!site) return null;
  return siteStats(env, site, days);
}

export async function siteStats(env: Env, site: AnalyticsSite, days = 7): Promise<SiteStats> {
  const sinceDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byDay = await env.DB.prepare(
    `SELECT day, COUNT(*) AS views, COUNT(DISTINCT vid) AS uniques
     FROM hits WHERE site_id = ? AND day >= ? GROUP BY day ORDER BY day ASC`,
  )
    .bind(site.id, sinceDay)
    .all<{ day: string; views: number; uniques: number }>();
  const totalsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS uniques
     FROM hits WHERE site_id = ? AND day >= ?`,
  )
    .bind(site.id, sinceDay)
    .first<{ views: number; uniques: number }>();
  const paths = await env.DB.prepare(
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT vid) AS uniques
     FROM hits WHERE site_id = ? AND day >= ? GROUP BY path ORDER BY views DESC LIMIT 8`,
  )
    .bind(site.id, sinceDay)
    .all<{ path: string; views: number; uniques: number }>();
  const refs = await env.DB.prepare(
    `SELECT ref, COUNT(*) AS views FROM hits
     WHERE site_id = ? AND day >= ? AND ref IS NOT NULL AND ref != ''
     GROUP BY ref ORDER BY views DESC LIMIT 8`,
  )
    .bind(site.id, sinceDay)
    .all<{ ref: string; views: number }>();
  const countries = await env.DB.prepare(
    `SELECT country, COUNT(*) AS views FROM hits
     WHERE site_id = ? AND day >= ? AND country IS NOT NULL
     GROUP BY country ORDER BY views DESC LIMIT 8`,
  )
    .bind(site.id, sinceDay)
    .all<{ country: string; views: number }>();
  return {
    site,
    totals: {
      views: Number(totalsRow?.views) || 0,
      uniques: Number(totalsRow?.uniques) || 0,
    },
    days: byDay.results ?? [],
    topPaths: paths.results ?? [],
    topRefs: refs.results ?? [],
    topCountries: countries.results ?? [],
  };
}

const PRUNE_EVERY_MS = 60 * 60 * 1000;
const KEEP_DAYS = 30;

export const MAX_EVENT_NAME = 40;
const MAX_EVENTS_PER_SITE_DAY = 2000;

export async function siteByToken(db: D1Database, token: string): Promise<AnalyticsSite | null> {
  return (
    (await db.prepare("SELECT * FROM analytics_sites WHERE token = ? AND enabled = 1").bind(token).first<AnalyticsSite>()) ??
    null
  );
}

export type EventPayload = { name: string; path: string; ref: string | null; country: string | null; vid: string; ident: string | null };

export async function recordEvent(env: Env, site: AnalyticsSite, p: EventPayload): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND day = ?",
  )
    .bind(site.id, day)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_EVENTS_PER_SITE_DAY) return false;
  await env.DB.prepare(
    `INSERT INTO events (id, site_id, day, ts, name, path, ref, country, vid, ident)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      site.id,
      day,
      Date.now(),
      p.name,
      p.path,
      p.ref,
      p.country,
      p.vid,
      p.ident,
    )
    .run();
  return true;
}

export async function liveVisitors(env: Env, siteId: string, windowMs = 5 * 60_000): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(DISTINCT vid) AS n FROM hits WHERE site_id = ? AND ts >= ?",
  )
    .bind(siteId, Date.now() - windowMs)
    .first<{ n: number }>();
  return Number(row?.n) || 0;
}

/** Earliest known touch for an identified visitor — the attribution source for a payment.
 *  Journey: ident → the vid(s) that identified → earliest non-direct referrer seen for them. */
export async function firstTouch(
  env: Env,
  siteId: string,
  ident: string,
): Promise<{ ref: string | null; path: string | null } | null> {
  const { results: vidRows } = await env.DB.prepare(
    `SELECT DISTINCT vid FROM events
     WHERE site_id = ? AND ident = ? AND vid IS NOT NULL LIMIT 10`,
  )
    .bind(siteId, ident)
    .all<{ vid: string }>();
  const vids = (vidRows ?? []).map((r) => r.vid);
  if (vids.length === 0) return null;
  const placeholders = vids.map(() => "?").join(", ");
  const hit = await env.DB.prepare(
    `SELECT ts, ref, path FROM hits
     WHERE site_id = ? AND vid IN (${placeholders}) AND ref IS NOT NULL AND ref != ''
     ORDER BY ts ASC LIMIT 1`,
  )
    .bind(siteId, ...vids)
    .first<{ ts: number; ref: string; path: string }>();
  const ev = await env.DB.prepare(
    `SELECT ts, ref, path FROM events
     WHERE site_id = ? AND vid IN (${placeholders}) AND ref IS NOT NULL AND ref != ''
     ORDER BY ts ASC LIMIT 1`,
  )
    .bind(siteId, ...vids)
    .first<{ ts: number; ref: string; path: string }>();
  const pick = [hit, ev]
    .filter((r): r is { ts: number; ref: string; path: string } => Boolean(r))
    .sort((a, b) => a.ts - b.ts)[0];
  return pick ? { ref: refHost(pick.ref), path: pick.path ?? null } : null;
}

/** Salted, non-reversible identity hash for identified visitors. */
export async function identifyHash(env: Env, email: string): Promise<string> {
  const salt = await getSalt(env);
  const data = new TextEncoder().encode(`ident${salt}${email.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function topEvents(
  env: Env,
  siteId: string,
  days: number,
  limit = 8,
): Promise<Array<{ name: string; views: number }>> {
  const sinceDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT name, COUNT(*) AS views FROM events
     WHERE site_id = ? AND day >= ? AND name != '__identify'
     GROUP BY name ORDER BY views DESC LIMIT ?`,
  )
    .bind(siteId, sinceDay, limit)
    .all<{ name: string; views: number }>();
  return results ?? [];
}

export async function maybePruneHits(env: Env, now: number): Promise<void> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_hit_prune_at'")
    .first<{ value: string }>();
  const last = Number(row?.value ?? 0);
  if (now - last < PRUNE_EVERY_MS) return;
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM hits WHERE day < ?").bind(cutoff).run();
  await env.DB.prepare("DELETE FROM events WHERE day < ?").bind(cutoff).run();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('last_hit_prune_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(String(now))
    .run();
}
