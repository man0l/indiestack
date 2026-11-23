// Slashloop → social views per lane, over the same OAuth 2.1 + MCP surface
// Slashloop's agents use. Nothing on Slashloop's side is IndieStack-specific:
//
//   GET  {base}/.well-known/oauth-authorization-server  → endpoints
//   POST {base}/register   dynamic client registration (public client, PKCE S256)
//   GET  {base}/authorize  the user signs in on Slashloop (Google) and approves
//   POST {base}/token      code → access + refresh token; refresh rotates
//   POST {base}/mcp        tools/call get_social_stats (read-only, free)
//
// The tick re-reads the last few weeks hourly and rewrites that window, so
// Slashloop's late daily snapshots simply replace earlier numbers.

import { getSettings, setSetting } from "../kernel/db";
import { listAnalyticsSites } from "../analytics/index";

export const DEFAULT_BASE = "https://mcp.slashloop.dev";
export const KEEP_DAYS = 90;
const SYNC_EVERY_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const PENDING_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

export const SETTING_KEYS = [
  "slashloop_client",
  "slashloop_pending",
  "slashloop_tokens",
  "slashloop_user",
  "slashloop_last_sync",
  "slashloop_last_error",
  "slashloop_default_site",
] as const;

type SlEnv = Env & { SLASHLOOP_URL?: string; SLASHLOOP_ENC_KEY?: string };

type Meta = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
};

type Client = { base: string; redirectUri: string; clientId: string };
type Pending = { state: string; verifier: string; ts: number; base: string; redirectUri: string; clientId: string };
export type Tokens = { access: string; refresh: string | null; expiresAt: number; base: string; clientId: string };

export type SocialDay = { day: string; views: number; byLane: Record<string, number> };

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function baseUrl(env: Env): string {
  return ((env as SlEnv).SLASHLOOP_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

// ---------- tokens at rest (AES-GCM sealed when SLASHLOOP_ENC_KEY is set) ----------

const te = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sealKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", te.encode(`slashloop:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(env: SlEnv, plain: string): Promise<string> {
  const secret = env.SLASHLOOP_ENC_KEY?.trim();
  if (!secret) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(secret), te.encode(plain));
  return `enc1:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

async function unseal(env: SlEnv, stored: string): Promise<string> {
  if (!stored.startsWith("enc1:")) return stored;
  const secret = env.SLASHLOOP_ENC_KEY?.trim();
  if (!secret) throw new Error("Slashloop tokens are encrypted but Worker secret SLASHLOOP_ENC_KEY is not set — reconnect");
  const [, iv, ct] = stored.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

export function encryptionOn(env: Env): boolean {
  return Boolean((env as SlEnv).SLASHLOOP_ENC_KEY?.trim());
}

async function loadTokens(env: Env): Promise<Tokens | null> {
  const s = await getSettings(env.DB, ["slashloop_tokens"]);
  if (!s.slashloop_tokens) return null;
  return JSON.parse(await unseal(env as SlEnv, s.slashloop_tokens)) as Tokens;
}

async function saveTokens(env: Env, t: Tokens): Promise<void> {
  await setSetting(env.DB, "slashloop_tokens", await seal(env as SlEnv, JSON.stringify(t)));
}

// ---------- OAuth client ----------

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { error: `non-JSON response (${r.status})` };
  }
  return { status: r.status, body };
}

async function metadata(base: string): Promise<Meta> {
  const { status, body } = await fetchJson(`${base}/.well-known/oauth-authorization-server`);
  if (status !== 200 || typeof body.authorization_endpoint !== "string" || typeof body.token_endpoint !== "string") {
    throw new Error(`${base} does not look like a Slashloop MCP server (no OAuth metadata, ${status})`);
  }
  return body as unknown as Meta;
}

async function ensureClient(env: Env, base: string, meta: Meta, redirectUri: string): Promise<string> {
  const s = await getSettings(env.DB, ["slashloop_client"]);
  if (s.slashloop_client) {
    const c = JSON.parse(s.slashloop_client) as Client;
    if (c.base === base && c.redirectUri === redirectUri) return c.clientId;
  }
  if (!meta.registration_endpoint) throw new Error("Slashloop does not offer client registration");
  const { status, body } = await fetchJson(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `IndieStack (${new URL(redirectUri).host})`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (status >= 300 || typeof body.client_id !== "string") {
    throw new Error(`client registration failed (${status}): ${String(body.error_description ?? body.error ?? "")}`);
  }
  const c: Client = { base, redirectUri, clientId: body.client_id };
  await setSetting(env.DB, "slashloop_client", JSON.stringify(c));
  return c.clientId;
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", te.encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** Step 1: register (once per redirect URI), stash PKCE + state, return Slashloop's authorize URL. */
export async function startAuth(env: Env, origin: string): Promise<string> {
  const base = baseUrl(env);
  const redirectUri = `${origin}/admin/slashloop/callback`;
  const meta = await metadata(base);
  const clientId = await ensureClient(env, base, meta, redirectUri);
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const pending: Pending = { state, verifier, ts: Date.now(), base, redirectUri, clientId };
  await setSetting(env.DB, "slashloop_pending", JSON.stringify(pending));
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

function tokensFrom(body: Record<string, unknown>, base: string, clientId: string, prevRefresh: string | null): Tokens {
  if (typeof body.access_token !== "string") throw new Error("token response had no access_token");
  const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  return {
    access: body.access_token,
    refresh: typeof body.refresh_token === "string" ? body.refresh_token : prevRefresh,
    expiresAt: Date.now() + ttl * 1000,
    base,
    clientId,
  };
}

/** Step 2: the callback. Checks state, swaps the code for tokens. */
export async function finishAuth(env: Env, code: string, state: string): Promise<void> {
  const s = await getSettings(env.DB, ["slashloop_pending"]);
  if (!s.slashloop_pending) throw new Error("no Slashloop sign-in in progress — start again");
  const p = JSON.parse(s.slashloop_pending) as Pending;
  await env.DB.prepare("DELETE FROM settings WHERE key = 'slashloop_pending'").run();
  if (p.state !== state) throw new Error("sign-in state did not match — start again");
  if (Date.now() - p.ts > PENDING_TTL_MS) throw new Error("sign-in took too long — start again");
  const meta = await metadata(p.base);
  const { status, body } = await fetchJson(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
    }),
  });
  if (status !== 200) throw new Error(`token exchange failed (${status}): ${String(body.error_description ?? body.error ?? "")}`);
  await saveTokens(env, tokensFrom(body, p.base, p.clientId, null));
  await env.DB.prepare("DELETE FROM settings WHERE key = 'slashloop_last_error'").run();
}

class AuthLost extends Error {}

async function accessToken(env: Env): Promise<string> {
  const t = await loadTokens(env);
  if (!t) throw new AuthLost("not connected");
  if (t.expiresAt - 60_000 > Date.now()) return t.access;
  if (!t.refresh) throw new AuthLost("session expired — reconnect Slashloop");
  const meta = await metadata(t.base);
  const { status, body } = await fetchJson(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: t.clientId }),
  });
  if (status === 400 || status === 401) throw new AuthLost("Slashloop revoked the session — reconnect");
  if (status !== 200) throw new Error(`token refresh failed (${status})`);
  const next = tokensFrom(body, t.base, t.clientId, t.refresh);
  await saveTokens(env, next);
  return next.access;
}

/** Best effort: tell Slashloop to drop the grant, then forget everything locally. */
export async function disconnect(env: Env): Promise<void> {
  try {
    const t = await loadTokens(env);
    if (t?.refresh) {
      const meta = await metadata(t.base);
      if (meta.revocation_endpoint) {
        await fetch(meta.revocation_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: t.refresh, client_id: t.clientId }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      }
    }
  } catch {
    // Local removal still happens; the grant expires on Slashloop's side.
  }
  const keep = SETTING_KEYS.filter((k) => k !== "slashloop_client" && k !== "slashloop_default_site");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM settings WHERE key IN (${keep.map(() => "?").join(", ")})`).bind(...keep),
    env.DB.prepare("DELETE FROM slashloop_daily"),
    env.DB.prepare("DELETE FROM slashloop_lanes"),
  ]);
}

// ---------- MCP (stateless streamable HTTP; responses may be JSON or SSE) ----------

type RpcResult = { result?: Record<string, unknown>; error?: { message?: string } };

export function parseRpc(contentType: string, text: string, id: number): RpcResult | null {
  const candidates: string[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) candidates.push(line.slice(5).trim());
  } else candidates.push(text);
  for (const c of candidates) {
    try {
      const msg = JSON.parse(c);
      for (const m of Array.isArray(msg) ? msg : [msg]) if (m && m.id === id) return m as RpcResult;
    } catch {
      continue;
    }
  }
  return null;
}

async function mcp(
  base: string,
  token: string,
  session: string | null,
  id: number | null,
  method: string,
  params: Record<string, unknown>,
): Promise<{ result: Record<string, unknown> | null; session: string | null }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (session) headers["mcp-session-id"] = session;
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(id == null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (r.status === 401) throw new AuthLost("Slashloop rejected the token — reconnect");
  const text = await r.text();
  if (r.status >= 300) throw new Error(`Slashloop MCP ${method} failed (${r.status}): ${text.slice(0, 160)}`);
  const nextSession = r.headers.get("mcp-session-id") ?? session;
  if (id == null) return { result: null, session: nextSession };
  const msg = parseRpc(r.headers.get("content-type") ?? "", text, id);
  if (!msg) throw new Error(`Slashloop MCP ${method}: no response`);
  if (msg.error) throw new Error(`Slashloop MCP ${method}: ${msg.error.message ?? "error"}`);
  return { result: msg.result ?? {}, session: nextSession };
}

/** Initialize, then call one tool; returns the parsed JSON text payload. */
async function callTool(env: Env, name: string, args: Record<string, unknown>): Promise<unknown> {
  const token = await accessToken(env);
  const base = (await loadTokens(env))?.base ?? baseUrl(env);
  const init = await mcp(base, token, null, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "indiestack", version: "1" },
  });
  await mcp(base, token, init.session, null, "notifications/initialized", {});
  const { result } = await mcp(base, token, init.session, 2, "tools/call", { name, arguments: args });
  const content = (result?.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text ?? "";
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // whoami and friends may answer in prose.
  }
  if (result?.isError) {
    const p = parsed as { message?: string; error?: string };
    throw new Error(`${name}: ${p?.message ?? p?.error ?? text.slice(0, 160)}`);
  }
  return parsed;
}

// ---------- stats ----------

export type StatsResult = {
  accounts: Array<{ id: string; lane: string | null; name?: string | null; profile?: string | null; provider?: string }>;
  buckets: Array<{ start: string; byAccount: Record<string, number> }>;
};

/** Collapse per-account daily views into per-lane totals ('' = no lane). */
export function laneTotals(stats: StatsResult): {
  rows: Array<{ lane: string; day: string; views: number }>;
  lanes: Map<string, number>;
} {
  const laneOf = new Map<string, string>();
  const lanes = new Map<string, number>();
  for (const a of stats.accounts ?? []) {
    const lane = a.lane ?? "";
    laneOf.set(a.id, lane);
    lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
  }
  const acc = new Map<string, number>();
  for (const b of stats.buckets ?? []) {
    for (const [acct, v] of Object.entries(b.byAccount ?? {})) {
      const lane = laneOf.get(acct) ?? "";
      const k = `${lane}\u0000${b.start}`;
      acc.set(k, (acc.get(k) ?? 0) + (Number(v) || 0));
    }
  }
  const rows = [...acc].map(([k, views]) => {
    const [lane, day] = k.split("\u0000");
    return { lane, day, views };
  });
  return { rows, lanes };
}

async function defaultSite(env: Env): Promise<string | null> {
  const s = await getSettings(env.DB, ["slashloop_default_site"]);
  if (s.slashloop_default_site) return s.slashloop_default_site;
  const sites = await listAnalyticsSites(env.DB);
  return sites.length === 1 ? sites[0].id : null;
}

/** Pull the window and rewrite it. First run backfills KEEP_DAYS. */
export async function syncNow(env: Env, now: number): Promise<{ days: number; lanes: number }> {
  const hasData = await env.DB.prepare("SELECT 1 AS x FROM slashloop_daily LIMIT 1").first();
  const from = isoDay(now - ((hasData ? WINDOW_DAYS : KEEP_DAYS) - 1) * DAY_MS);
  const to = isoDay(now);
  try {
    const stats = (await callTool(env, "get_social_stats", { from, to, bucket: "day", mode: "gained" })) as StatsResult;
    if (!stats || !Array.isArray(stats.buckets)) throw new Error("get_social_stats returned no buckets");
    const { rows, lanes } = laneTotals(stats);
    const site = await defaultSite(env);
    const stmts = [
      env.DB.prepare("DELETE FROM slashloop_daily WHERE day >= ? OR day < ?").bind(from, isoDay(now - KEEP_DAYS * DAY_MS)),
      ...rows.map((r) =>
        env.DB.prepare("INSERT OR REPLACE INTO slashloop_daily (lane, day, views) VALUES (?, ?, ?)").bind(r.lane, r.day, r.views),
      ),
      ...[...lanes].map(([lane, n]) =>
        env.DB.prepare(
          `INSERT INTO slashloop_lanes (lane, site_id, accounts, seen_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(lane) DO UPDATE SET accounts = excluded.accounts, seen_at = excluded.seen_at`,
        ).bind(lane, site, n, now),
      ),
    ];
    await env.DB.batch(stmts);
    await setSetting(env.DB, "slashloop_last_sync", String(now));
    await env.DB.prepare("DELETE FROM settings WHERE key = 'slashloop_last_error'").run();
    return { days: rows.length, lanes: lanes.size };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 240);
    await setSetting(env.DB, "slashloop_last_error", msg);
    if (e instanceof AuthLost && msg !== "not connected") {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'slashloop_tokens'").run();
    }
    throw e;
  }
}

/** Tick entry: hourly, only when connected. */
export async function maybeSync(env: Env, now: number): Promise<number> {
  const s = await getSettings(env.DB, ["slashloop_tokens", "slashloop_last_sync"]);
  if (!s.slashloop_tokens) return 0;
  if (s.slashloop_last_sync && now - Number(s.slashloop_last_sync) < SYNC_EVERY_MS) return 0;
  // Stamp first so a slow or failing Slashloop is retried next hour, not every minute.
  await setSetting(env.DB, "slashloop_last_sync", String(now));
  const r = await syncNow(env, now);
  return r.days;
}

export async function whoami(env: Env): Promise<string | null> {
  const r = (await callTool(env, "whoami", {}).catch(() => null)) as { email?: string } | string | null;
  if (r && typeof r === "object" && typeof r.email === "string") return r.email;
  if (typeof r === "string") return r.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  return null;
}

export async function connected(env: Env): Promise<boolean> {
  const s = await getSettings(env.DB, ["slashloop_tokens"]);
  return s.slashloop_tokens != null;
}

/** Social views for one analytics site: lanes linked to it, summed per day. */
export async function socialForSite(db: D1Database, siteId: string, sinceDay: string): Promise<SocialDay[]> {
  const r = await db
    .prepare(
      `SELECT d.day, d.lane, d.views FROM slashloop_daily d JOIN slashloop_lanes l ON l.lane = d.lane
       WHERE l.site_id = ? AND d.day >= ? ORDER BY d.day`,
    )
    .bind(siteId, sinceDay)
    .all<{ day: string; lane: string; views: number }>();
  const out = new Map<string, SocialDay>();
  for (const row of r.results ?? []) {
    const d = out.get(row.day) ?? { day: row.day, views: 0, byLane: {} };
    d.views += Number(row.views);
    d.byLane[row.lane || "no lane"] = (d.byLane[row.lane || "no lane"] ?? 0) + Number(row.views);
    out.set(row.day, d);
  }
  return [...out.values()];
}
