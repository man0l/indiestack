import { redirect, toggleEnabled } from "../kernel/http";
import type { Health, Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { MAX_MONITORS, type Incident, type Monitor } from "../kernel/types";
import { clamp, parseMuteUntil } from "../kernel/util";
import { html } from "../ui";
import { runPings, probe } from "./probe";
import { buildTarget, kindOf } from "./target";
import { adminMonitors, editMonitorPage, statusIncidents, statusMonitors, type Stats } from "./ui";

export async function listMonitors(db: D1Database): Promise<Monitor[]> {
  const { results } = await db
    .prepare("SELECT * FROM monitors ORDER BY created_at ASC")
    .all<Monitor>();
  return results ?? [];
}

export async function insertMonitor(env: Env, m: Monitor): Promise<Response> {
  const result = await probe(m);
  const status = result.ok ? "up" : "down";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO monitors (
         id, name, url, interval_min, expect_status, timeout_ms,
         keyword, keyword_mode, max_latency_ms, created_at, status, last_check_at,
         last_status_code, last_latency_ms, last_error, consecutive,
         mute_until, headers, nag_min
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      m.id,
      m.name,
      m.url,
      m.interval_min,
      m.expect_status,
      m.timeout_ms,
      m.keyword,
      m.keyword_mode,
      m.max_latency_ms,
      m.created_at,
      status,
      Date.now(),
      result.status_code,
      result.latency_ms,
      result.error,
      m.mute_until ?? null,
      m.headers ?? null,
      m.nag_min ?? 0,
    ),
    env.DB.prepare(
      `INSERT INTO checks (monitor_id, ts, ok, status_code, latency_ms, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(m.id, Date.now(), result.ok ? 1 : 0, result.status_code, result.latency_ms, result.error),
  ]);
  return redirect(`/admin?msg=${encodeURIComponent(`added ${m.name}`)}`);
}

async function addMonitor(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "http");
  const rawUrl = String(form.get("url") ?? "").trim();
  const url = buildTarget(kind, rawUrl);
  if (!url) {
    return redirect(
      kind === "tcp" || kind === "udp"
        ? "/admin?msg=need%20host:port%20(not%20port%2025)"
        : "/admin?msg=bad%20target",
    );
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM monitors").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MONITORS) return redirect("/admin?msg=max%2020%20monitors");
  const hostish = url.replace(/^[a-z]+:\/\//, "").replace(/\/$/, "");
  const name = String(form.get("name") ?? "").trim() || hostish.slice(0, 40);
  const maxLatencyRaw = Number(form.get("max_latency_ms") ?? 0);
  const maxLatency =
    Number.isFinite(maxLatencyRaw) && maxLatencyRaw > 0 ? clamp(maxLatencyRaw, 1, 15000) : null;
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 80) || null;
  return insertMonitor(env, {
    id: crypto.randomUUID(),
    name: name.slice(0, 40),
    url,
    interval_min: clamp(Number(form.get("interval_min") ?? 5), 1, 60),
    expect_status: clamp(Number(form.get("expect_status") ?? 0), 0, 599),
    timeout_ms: clamp(Number(form.get("timeout_ms") ?? 8000), 1000, 15000),
    keyword,
    keyword_mode: keyword
      ? String(form.get("keyword_mode") ?? "exists") === "absent"
        ? "absent"
        : "exists"
      : null,
    max_latency_ms: maxLatency,
    enabled: 1,
    status: "unknown",
    last_check_at: null,
    last_status_code: null,
    last_latency_ms: null,
    last_error: null,
    consecutive: 0,
    created_at: Date.now(),
    mute_until: parseMuteUntil(String(form.get("mute_until") ?? "")),
    headers: String(form.get("headers") ?? "").trim() || null,
    nag_min: clamp(Number(form.get("nag_min") ?? 0), 0, 1440),
    last_nag_at: null,
  });
}

async function updateMonitor(id: string, request: Request, env: Env): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
    .bind(id)
    .first<Monitor>();
  if (!existing) return redirect("/admin?msg=not%20found");
  const form = await request.formData();
  const kind = String(form.get("kind") ?? kindOf(existing.url));
  const url = buildTarget(kind, String(form.get("url") ?? existing.url));
  if (!url) return redirect(`/admin/monitors/${id}?err=bad`);
  const name = String(form.get("name") ?? existing.name).trim().slice(0, 40) || existing.name;
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 80) || null;
  await env.DB.prepare(
    `UPDATE monitors SET
       name = ?, url = ?, interval_min = ?, expect_status = ?, timeout_ms = ?,
       max_latency_ms = ?, keyword = ?, keyword_mode = ?, headers = ?,
       nag_min = ?, mute_until = ?
     WHERE id = ?`,
  )
    .bind(
      name,
      url,
      clamp(Number(form.get("interval_min") ?? existing.interval_min), 1, 60),
      clamp(Number(form.get("expect_status") ?? existing.expect_status), 0, 599),
      clamp(Number(form.get("timeout_ms") ?? existing.timeout_ms), 1000, 15000),
      Number(form.get("max_latency_ms") ?? 0) > 0
        ? clamp(Number(form.get("max_latency_ms")), 1, 15000)
        : null,
      keyword,
      keyword ? (String(form.get("keyword_mode")) === "absent" ? "absent" : "exists") : null,
      String(form.get("headers") ?? "").trim() || null,
      clamp(Number(form.get("nag_min") ?? 0), 0, 1440),
      parseMuteUntil(String(form.get("mute_until") ?? "")),
      id,
    )
    .run();
  return redirect("/admin?msg=saved");
}

export const ping: Plugin = {
  id: "ping",
  adminFooter: "HTTP uses 2-strike alerts.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM monitors").first<{ n: number }>();
    return `${n?.n ?? 0}/20 monitors`;
  },
  async adminSection(ctx: SectionCtx) {
    return adminMonitors(await listMonitors(ctx.env.DB));
  },
  async occupied(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM monitors").first<{ n: number }>();
    return (n?.n ?? 0) > 0;
  },
  async statusKicker(ctx: SectionCtx) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const row = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n, SUM(ok) AS ok_n FROM checks WHERE ts >= ?",
    )
      .bind(since)
      .first<{ n: number; ok_n: number | null }>();
    if (!row || Number(row.n) === 0) return null;
    return `${Math.round((Number(row.ok_n) / Number(row.n)) * 1000) / 10}% 24h`;
  },
  async statusSection(ctx: SectionCtx) {
    const monitors = await listMonitors(ctx.env.DB);
    const statsRows = await ctx.env.DB.prepare(
      `SELECT monitor_id AS id, COUNT(*) AS n, SUM(ok) AS ok_n, AVG(latency_ms) AS avg_latency_ms
       FROM checks GROUP BY monitor_id`,
    ).all<{ id: string; n: number; ok_n: number; avg_latency_ms: number | null }>();
    const stats: Record<string, Stats> = {};
    for (const row of statsRows.results ?? []) {
      stats[row.id] = {
        n: Number(row.n) || 0,
        ok_n: Number(row.ok_n) || 0,
        avg_latency_ms: row.avg_latency_ms,
      };
    }
    return statusMonitors(monitors, stats);
  },
  async statusTail(ctx: SectionCtx) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const inc = await ctx.env.DB.prepare(
      `SELECT c.ts, c.error, m.name, m.url
       FROM checks c JOIN monitors m ON m.id = c.monitor_id
       WHERE c.ok = 0 AND c.ts >= ?
       ORDER BY c.ts DESC LIMIT 12`,
    )
      .bind(since)
      .all<Incident>();
    return statusIncidents(inc.results ?? []);
  },
  async health(env, now): Promise<Health> {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown,
         MAX(last_check_at) AS last
       FROM monitors
       WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)`,
    )
      .bind(now)
      .first<{ up: number; down: number; unknown: number; last: number | null }>();
    return {
      up: Number(row?.up) || 0,
      down: Number(row?.down) || 0,
      unknown: Number(row?.unknown) || 0,
      last: row?.last ?? null,
    };
  },
  async tick(env, now, webhook) {
    const r = await runPings(env, now, webhook);
    return { checked: r.checked, alerts: r.alerts };
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    if (path === "/admin/monitors" && method === "POST") return addMonitor(request, env);
    const tog = path.match(/^\/admin\/monitors\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "monitors", tog[1]);
      return redirect("/admin?msg=toggled");
    }
    const del = path.match(/^\/admin\/monitors\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM checks WHERE monitor_id = ?").bind(del[1]),
        env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(del[1]),
      ]);
      return redirect("/admin?msg=removed");
    }
    const id = path.match(/^\/admin\/monitors\/([^/]+)$/);
    if (id && method === "GET") {
      const m = await env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
        .bind(id[1])
        .first<Monitor>();
      if (!m) return redirect("/admin?msg=not%20found");
      return html(editMonitorPage(env.APP_NAME, m));
    }
    if (id && method === "POST") return updateMonitor(id[1], request, env);
    return null;
  },
};
