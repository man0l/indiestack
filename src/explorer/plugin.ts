import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { html } from "../ui";
import { analyzeLogs } from "./analyze";
import { parseQuery, queryLogs, type LogQuery } from "./query";
import { explorerPage } from "./ui";

/** Hard dependency: ingest + sources live in the logs plugin (`../logs`). */
export const explorer: Plugin = {
  id: "explorer",
  adminFooter: "Log manager needs the logs plugin. Filter/search/tail/analyze are here.",
  adminSection(_ctx: SectionCtx) {
    return `<h2>log manager</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 12px">Filter, search, expand JSON, and tail. Requires the logs plugin.</p>
      <a class="btn" href="/admin/logs">open manager</a>
    </div>`;
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, url, origin } = ctx;

    if (path === "/admin/logs/analyze" && method === "POST") {
      const form = await ctx.request.formData();
      const q: LogQuery = {
        sourceId: String(form.get("source") ?? "").trim() || null,
        level: String(form.get("level") ?? "").trim().toLowerCase() || null,
        q: String(form.get("q") ?? "").trim(),
        limit: 100,
      };
      const { events, sources } = await queryLogs(env, q);
      const label =
        sources.find((s) => s.id === q.sourceId)?.name ?? (q.sourceId ? q.sourceId : "all sources");
      const analysis = await analyzeLogs(env, label, events);
      return html(explorerPage(env.APP_NAME, origin, sources, q, events, analysis));
    }

    const perSourceAnalyze = path.match(/^\/admin\/logs\/([^/]+)\/analyze$/);
    if (perSourceAnalyze && method === "POST") {
      const q = parseQuery(url, perSourceAnalyze[1]);
      const { events, sources } = await queryLogs(env, q);
      const label = sources.find((s) => s.id === q.sourceId)?.name ?? q.sourceId ?? "logs";
      const analysis = await analyzeLogs(env, label, events);
      return html(explorerPage(env.APP_NAME, origin, sources, q, events, analysis));
    }

    if (path === "/admin/logs" && method === "GET") {
      const q = parseQuery(url, url.searchParams.get("source"));
      const { events, sources } = await queryLogs(env, q);
      return html(explorerPage(env.APP_NAME, origin, sources, q, events));
    }

    const id = path.match(/^\/admin\/logs\/([^/]+)$/);
    if (id && method === "GET") {
      if (id[1] === "analyze") return null;
      const q = parseQuery(url, id[1]);
      const { events, sources } = await queryLogs(env, q);
      if (q.sourceId && !sources.some((s) => s.id === q.sourceId)) {
        return new Response("not found", { status: 404 });
      }
      return html(explorerPage(env.APP_NAME, origin, sources, q, events));
    }
    return null;
  },
};
