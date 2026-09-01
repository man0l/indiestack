import { recordBeat } from "./heartbeat";
import {
  clearCookie,
  isAdmin,
  mintAdminToken,
  resolveAdminToken,
  safeEqual,
  setCookie,
} from "./kernel/auth";
import { getSetting, listJobs, listMonitors, setSetting } from "./kernel/db";
import { runTick } from "./kernel/tick";
import { MAX_JOBS, MAX_MONITORS, type Incident, type Job, type Monitor } from "./kernel/types";
import { clamp, parseHttpUrl, parseMuteUntil } from "./kernel/util";
import { buildTarget, kindOf, probe } from "./ping";
import { applyTemplate } from "./templates";
import {
  adminPage,
  ago,
  editJobPage,
  editMonitorPage,
  html,
  loginPage,
  revealPage,
  statusPage,
  type Stats,
} from "./ui";

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
  async scheduled(_controller, env) {
    await runTick(env).catch((err) => {
      console.error("tick failed", String(err));
    });
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  const beat = path.match(/^\/beat\/([A-Za-z0-9_-]+)$/);
  if (beat && (method === "GET" || method === "POST")) {
    return beatJob(beat[1], env);
  }

  if (path === "/health.json" && method === "GET") {
    return healthJson(env);
  }
  if ((path === "/health" || path === "/") && method === "HEAD") {
    const h = await health(env);
    return new Response(null, { status: h.down > 0 ? 503 : 200 });
  }
  if (path === "/health" && method === "GET") {
    const h = await health(env);
    return new Response(h.down > 0 ? "down" : "up", {
      status: h.down > 0 ? 503 : 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if ((path === "/" || path === "/status") && method === "GET") {
    return status(env);
  }
  if (path === "/login" && method === "POST") {
    return login(request, env);
  }
  if (path === "/logout" && method === "POST") {
    return redirect("/", { "set-cookie": clearCookie(request) });
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    const blocked = await gateAdmin(request, env);
    if (blocked) return blocked;
    if (path === "/admin" && method === "GET") {
      return admin(env, url.origin, url.searchParams.get("msg"));
    }
    if (path === "/admin/monitors" && method === "POST") {
      return addMonitor(request, env);
    }
    if (path === "/admin/templates" && method === "POST") {
      return addTemplate(request, env);
    }
    const monToggle = path.match(/^\/admin\/monitors\/([^/]+)\/toggle$/);
    if (monToggle && method === "POST") {
      return toggleRow(env, "monitors", monToggle[1]);
    }
    const monDel = path.match(/^\/admin\/monitors\/([^/]+)\/delete$/);
    if (monDel && method === "POST") {
      return deleteMonitor(monDel[1], env);
    }
    const monId = path.match(/^\/admin\/monitors\/([^/]+)$/);
    if (monId && method === "GET") return showEditMonitor(monId[1], env);
    if (monId && method === "POST") return updateMonitor(monId[1], request, env);
    if (path === "/admin/jobs" && method === "POST") {
      return addJob(request, env);
    }
    const jobToggle = path.match(/^\/admin\/jobs\/([^/]+)\/toggle$/);
    if (jobToggle && method === "POST") {
      return toggleRow(env, "jobs", jobToggle[1]);
    }
    const jobDel = path.match(/^\/admin\/jobs\/([^/]+)\/delete$/);
    if (jobDel && method === "POST") {
      return deleteJob(jobDel[1], env);
    }
    const jobId = path.match(/^\/admin\/jobs\/([^/]+)$/);
    if (jobId && method === "GET") return showEditJob(jobId[1], env, url.origin);
    if (jobId && method === "POST") return updateJob(jobId[1], request, env);
    if (path === "/admin/settings" && method === "POST") {
      return saveSettings(request, env);
    }
    if (path === "/admin/check" && method === "POST") {
      const result = await runTick(env);
      return redirect(
        `/admin?msg=${encodeURIComponent(`checked ${result.checked} · jobs ${result.jobs}`)}`,
      );
    }
    const roll = path.match(/^\/admin\/rollups\/(\d{4}-\d{2}-\d{2})$/);
    if (roll && method === "GET") {
      const obj = await env.BUCKET.get(`rollups/${roll[1]}.json`);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }

  return new Response("not found", { status: 404 });
}

async function beatJob(token: string, env: Env): Promise<Response> {
  const job = await recordBeat(env, token);
  if (!job) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });
  return Response.json({
    ok: true,
    name: job.name,
    last_beat_at: job.last_beat_at,
  });
}

async function status(env: Env): Promise<Response> {
  const monitors = await listMonitors(env.DB);
  const jobs = await listJobs(env.DB);
  const statsRows = await env.DB.prepare(
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
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const uptimeRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n, SUM(ok) AS ok_n FROM checks WHERE ts >= ?",
  )
    .bind(since)
    .first<{ n: number; ok_n: number | null }>();
  const uptime24 =
    uptimeRow && Number(uptimeRow.n) > 0
      ? { n: Number(uptimeRow.n), ok_n: Number(uptimeRow.ok_n) || 0 }
      : null;
  const inc = await env.DB.prepare(
    `SELECT c.ts, c.error, m.name, m.url
     FROM checks c JOIN monitors m ON m.id = c.monitor_id
     WHERE c.ok = 0 AND c.ts >= ?
     ORDER BY c.ts DESC LIMIT 12`,
  )
    .bind(since)
    .all<Incident>();
  return html(statusPage(env.APP_NAME, monitors, jobs, stats, uptime24, inc.results ?? []));
}

async function admin(env: Env, origin: string, msg: string | null): Promise<Response> {
  const monitors = await listMonitors(env.DB);
  const jobs = await listJobs(env.DB);
  const webhook = (await getSetting(env.DB, "webhook_url")) ?? "";
  const listed = await env.BUCKET.list({ prefix: "rollups/" });
  const rollups = listed.objects
    .map((o) => o.key.replace(/^rollups\//, "").replace(/\.json$/, ""))
    .sort()
    .reverse();
  return html(adminPage(env.APP_NAME, origin, monitors, jobs, webhook, rollups, msg ?? undefined));
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
  if ((count?.n ?? 0) >= MAX_MONITORS) {
    return redirect("/admin?msg=max%2020%20monitors");
  }

  const hostish = url.replace(/^[a-z]+:\/\//, "").replace(/\/$/, "");
  const name = String(form.get("name") ?? "").trim() || hostish.slice(0, 40);
  const interval = clamp(Number(form.get("interval_min") ?? 5), 1, 60);
  const expectStatus = clamp(Number(form.get("expect_status") ?? 0), 0, 599);
  const timeoutMs = clamp(Number(form.get("timeout_ms") ?? 8000), 1000, 15000);
  const maxLatencyRaw = Number(form.get("max_latency_ms") ?? 0);
  const maxLatency =
    Number.isFinite(maxLatencyRaw) && maxLatencyRaw > 0 ? clamp(maxLatencyRaw, 1, 15000) : null;
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 80) || null;
  const keywordMode = keyword
    ? String(form.get("keyword_mode") ?? "exists") === "absent"
      ? "absent"
      : "exists"
    : null;
  const id = crypto.randomUUID();
  const now = Date.now();
  return saveMonitor(env, {
    id,
    name: name.slice(0, 40),
    url,
    interval_min: interval,
    expect_status: expectStatus,
    timeout_ms: timeoutMs,
    keyword,
    keyword_mode: keywordMode,
    max_latency_ms: maxLatency,
    enabled: 1,
    status: "unknown",
    last_check_at: null,
    last_status_code: null,
    last_latency_ms: null,
    last_error: null,
    consecutive: 0,
    created_at: now,
    mute_until: parseMuteUntil(String(form.get("mute_until") ?? "")),
    headers: String(form.get("headers") ?? "").trim() || null,
    nag_min: clamp(Number(form.get("nag_min") ?? 0), 0, 1440),
    last_nag_at: null,
  });
}

async function addTemplate(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const applied = applyTemplate(String(form.get("id") ?? ""), String(form.get("host") ?? ""));
  if (!applied) return redirect("/admin?msg=need%20a%20host");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM monitors").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MONITORS) return redirect("/admin?msg=max%2020%20monitors");
  const now = Date.now();
  return saveMonitor(env, {
    id: crypto.randomUUID(),
    name: applied.name,
    url: applied.url,
    interval_min: applied.interval_min,
    expect_status: 0,
    timeout_ms: applied.timeout_ms,
    keyword: null,
    keyword_mode: null,
    max_latency_ms: null,
    enabled: 1,
    status: "unknown",
    last_check_at: null,
    last_status_code: null,
    last_latency_ms: null,
    last_error: null,
    consecutive: 0,
    created_at: now,
    mute_until: null,
    headers: null,
    nag_min: 0,
    last_nag_at: null,
  });
}

async function saveMonitor(env: Env, m: Monitor): Promise<Response> {
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

async function addJob(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (!name) return redirect("/admin?msg=name%20required");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_JOBS) return redirect("/admin?msg=max%2020%20jobs");
  const interval = clamp(Number(form.get("interval_min") ?? 60), 1, 1440);
  const grace = clamp(Number(form.get("grace_min") ?? 2), 0, 120);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "");
  await env.DB.prepare(
    `INSERT INTO jobs (id, name, token, interval_min, grace_min, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, name, token, interval, grace, Date.now())
    .run();
  return redirect("/admin?msg=heartbeat%20added");
}

async function deleteMonitor(id: string, env: Env): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM checks WHERE monitor_id = ?").bind(id),
    env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id),
  ]);
  return redirect("/admin?msg=removed");
}

async function deleteJob(id: string, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
  return redirect("/admin?msg=removed");
}

async function toggleRow(env: Env, table: "monitors" | "jobs", id: string): Promise<Response> {
  await env.DB.prepare(`UPDATE ${table} SET enabled = 1 - enabled WHERE id = ?`).bind(id).run();
  return redirect("/admin?msg=toggled");
}

async function saveSettings(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const webhook = String(form.get("webhook_url") ?? "").trim();
  if (webhook) {
    const parsed = parseHttpUrl(webhook);
    if (!parsed) return redirect("/admin?msg=bad%20webhook");
    await setSetting(env.DB, "webhook_url", parsed.toString());
  } else {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind("webhook_url").run();
  }
  return redirect("/admin?msg=saved");
}

async function login(request: Request, env: Env): Promise<Response> {
  const expected = await resolveAdminToken(env);
  if (!expected) {
    const minted = await mintAdminToken(env);
    if (minted.created) return html(revealPage(env.APP_NAME, minted.token));
  }
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const want = (await resolveAdminToken(env)) ?? "";
  if (!want || !(await safeEqual(token, want))) {
    return html(loginPage(env.APP_NAME, "wrong token"), 401);
  }
  return redirect("/admin", { "set-cookie": setCookie(request, token) });
}

async function gateAdmin(request: Request, env: Env): Promise<Response | null> {
  let expected = await resolveAdminToken(env);
  if (!expected) {
    const minted = await mintAdminToken(env);
    if (minted.created) return html(revealPage(env.APP_NAME, minted.token));
    expected = minted.token;
  }
  if (!(await isAdmin(request, expected))) {
    return html(loginPage(env.APP_NAME), 401);
  }
  return null;
}

async function showEditMonitor(id: string, env: Env): Promise<Response> {
  const m = await env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<Monitor>();
  if (!m) return redirect("/admin?msg=not%20found");
  return html(editMonitorPage(env.APP_NAME, m));
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

async function showEditJob(id: string, env: Env, origin: string): Promise<Response> {
  const j = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Job>();
  if (!j) return redirect("/admin?msg=not%20found");
  return html(editJobPage(env.APP_NAME, j, origin));
}

async function updateJob(id: string, request: Request, env: Env): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Job>();
  if (!existing) return redirect("/admin?msg=not%20found");
  const form = await request.formData();
  const name = String(form.get("name") ?? existing.name).trim().slice(0, 40) || existing.name;
  await env.DB.prepare(
    `UPDATE jobs SET name = ?, interval_min = ?, grace_min = ?, nag_min = ?, mute_until = ?
     WHERE id = ?`,
  )
    .bind(
      name,
      clamp(Number(form.get("interval_min") ?? existing.interval_min), 1, 1440),
      clamp(Number(form.get("grace_min") ?? existing.grace_min), 0, 120),
      clamp(Number(form.get("nag_min") ?? 0), 0, 1440),
      parseMuteUntil(String(form.get("mute_until") ?? "")),
      id,
    )
    .run();
  return redirect("/admin?msg=saved");
}

async function health(env: Env): Promise<{ up: number; down: number; unknown: number }> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down,
       SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
     FROM (
       SELECT status FROM monitors
       WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)
       UNION ALL
       SELECT status FROM jobs
       WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)
     ) AS live`,
  )
    .bind(now, now)
    .first<{ up: number; down: number; unknown: number }>();
  return {
    up: Number(row?.up) || 0,
    down: Number(row?.down) || 0,
    unknown: Number(row?.unknown) || 0,
  };
}

async function healthJson(env: Env): Promise<Response> {
  const h = await health(env);
  const lastCheck = (
    await env.DB.prepare("SELECT MAX(last_check_at) AS ts FROM monitors").first<{
      ts: number | null;
    }>()
  )?.ts;
  const lastBeat = (
    await env.DB.prepare("SELECT MAX(last_beat_at) AS ts FROM jobs").first<{
      ts: number | null;
    }>()
  )?.ts;
  const last = Math.max(lastCheck ?? 0, lastBeat ?? 0) || null;
  return Response.json({
    ok: h.down === 0,
    ...h,
    checked: ago(last),
  });
}

function redirect(location: string, headers?: HeadersInit): Response {
  return new Response(null, {
    status: 303,
    headers: { location, ...headers },
  });
}
