import { redirect, toggleEnabled } from "../kernel/http";
import type { Health, Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { MAX_JOBS, type Job } from "../kernel/types";
import { clamp, parseMuteUntil } from "../kernel/util";
import { html } from "../ui";
import { recordBeat, scanHeartbeats } from "./index";
import { adminJobs, editJobPage, statusJobs } from "./ui";

export async function listJobs(db: D1Database): Promise<Job[]> {
  const { results } = await db.prepare("SELECT * FROM jobs ORDER BY created_at ASC").all<Job>();
  return results ?? [];
}

export const heartbeat: Plugin = {
  id: "heartbeat",
  adminNav: { group: "monitoring", label: "heartbeats" },
  adminFooter: "A heartbeat alerts on the first miss after grace.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    return `${n?.n ?? 0}/20 cron`;
  },
  async adminSection(ctx: SectionCtx) {
    return adminJobs(await listJobs(ctx.env.DB), ctx.origin);
  },
  async occupied(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    return (n?.n ?? 0) > 0;
  },
  async statusSection(ctx: SectionCtx) {
    return statusJobs(await listJobs(ctx.env.DB));
  },
  async health(env, now): Promise<Health> {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown,
         MAX(last_beat_at) AS last
       FROM jobs
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
  async tick(env, now) {
    const r = await scanHeartbeats(env, now);
    return { jobs: r.scanned, alerts: r.alerts };
  },
  async route(ctx: RouteCtx) {
    const beat = ctx.path.match(/^\/beat\/([A-Za-z0-9_-]+)$/);
    if (!beat || (ctx.method !== "GET" && ctx.method !== "POST")) return null;
    const job = await recordBeat(ctx.env, beat[1]);
    if (!job) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });
    return Response.json({ ok: true, name: job.name, last_beat_at: job.last_beat_at });
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request, origin } = ctx;
    if (path === "/admin/jobs" && method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim().slice(0, 40);
      if (!name) return redirect("/admin?msg=name%20required");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_JOBS) return redirect("/admin?msg=max%2020%20jobs");
      await env.DB.prepare(
        `INSERT INTO jobs (id, name, token, interval_min, grace_min, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          name,
          crypto.randomUUID().replaceAll("-", ""),
          clamp(Number(form.get("interval_min") ?? 60), 1, 1440),
          clamp(Number(form.get("grace_min") ?? 2), 0, 120),
          Date.now(),
        )
        .run();
      return redirect("/admin?msg=heartbeat%20added");
    }
    const tog = path.match(/^\/admin\/jobs\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "jobs", tog[1]);
      return redirect("/admin?msg=toggled");
    }
    const del = path.match(/^\/admin\/jobs\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(del[1]).run();
      return redirect("/admin?msg=removed");
    }
    const id = path.match(/^\/admin\/jobs\/([^/]+)$/);
    if (id && method === "GET") {
      const j = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id[1]).first<Job>();
      if (!j) return redirect("/admin?msg=not%20found");
      return html(editJobPage(env.APP_NAME, j, origin));
    }
    if (id && method === "POST") {
      const existing = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
        .bind(id[1])
        .first<Job>();
      if (!existing) return redirect("/admin?msg=not%20found");
      const form = await request.formData();
      const name =
        String(form.get("name") ?? existing.name).trim().slice(0, 40) || existing.name;
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
          id[1],
        )
        .run();
      return redirect("/admin?msg=saved");
    }
    return null;
  },
};
