import { redirect, toggleEnabled } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { html } from "../ui";
import {
  MAX_LOG_SOURCES,
  deleteSourceLogs,
  getLogSource,
  ingest,
  listEvents,
  listLogSources,
  maybePruneLogs,
} from "./index";
import { adminLogs, logsPage } from "./ui";

export const logs: Plugin = {
  id: "logs",
  adminFooter: "Logs are admin-only, 8KB max, 24h in R2.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM log_sources").first<{ n: number }>();
    return `${n?.n ?? 0}/10 logs`;
  },
  async adminSection(ctx: SectionCtx) {
    return adminLogs(await listLogSources(ctx.env.DB), ctx.origin);
  },
  async tick(env, now) {
    await maybePruneLogs(env, now);
    return {};
  },
  async route(ctx: RouteCtx) {
    const log = ctx.path.match(/^\/log\/([A-Za-z0-9_-]+)$/);
    if (!log) return null;
    if (ctx.method !== "POST") {
      return Response.json({ ok: false, error: "POST only" }, { status: 405 });
    }
    const result = await ingest(ctx.env, log[1], ctx.request);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true, ts: result.ts });
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request, origin } = ctx;
    if (path === "/admin/logs" && method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim().slice(0, 40);
      if (!name) return redirect("/admin?msg=name%20required");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM log_sources").first<{
        n: number;
      }>();
      if ((count?.n ?? 0) >= MAX_LOG_SOURCES) return redirect("/admin?msg=max%2010%20log%20sources");
      await env.DB.prepare(
        "INSERT INTO log_sources (id, name, token, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), name, crypto.randomUUID().replaceAll("-", ""), Date.now())
        .run();
      return redirect("/admin?msg=log%20source%20added");
    }
    const tog = path.match(/^\/admin\/logs\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "log_sources", tog[1]);
      return redirect("/admin?msg=toggled");
    }
    const del = path.match(/^\/admin\/logs\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await deleteSourceLogs(env, del[1]);
      await env.DB.prepare("DELETE FROM log_sources WHERE id = ?").bind(del[1]).run();
      return redirect("/admin?msg=removed");
    }
    const id = path.match(/^\/admin\/logs\/([^/]+)$/);
    if (id && method === "GET") {
      const source = await getLogSource(env.DB, id[1]);
      if (!source) return redirect("/admin?msg=not%20found");
      const events = await listEvents(env, source.id);
      return html(logsPage(env.APP_NAME, origin, source, events));
    }
    return null;
  },
};
