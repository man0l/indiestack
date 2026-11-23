import { getSettings, setSetting } from "../kernel/db";
import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx, TickStats } from "../kernel/plugin";
import { listAnalyticsSites } from "../analytics/index";
import { esc, ago } from "../ui";
import {
  KEEP_DAYS,
  baseUrl,
  connected,
  disconnect,
  encryptionOn,
  finishAuth,
  isoDay,
  maybeSync,
  startAuth,
  syncNow,
  whoami,
} from "./index";

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

function reply(request: Request, ok: boolean, text: string, extra?: Record<string, unknown>): Response {
  if (wantsJson(request)) {
    return Response.json(ok ? { ok, msg: text, ...extra } : { ok, error: text }, { status: ok ? 200 : 400 });
  }
  return redirect(`/admin/p/slashloop?msg=${encodeURIComponent(text)}`);
}

const errText = (e: unknown) => String(e instanceof Error ? e.message : e);

async function pageData(env: Env) {
  const s = await getSettings(env.DB, ["slashloop_user", "slashloop_last_sync", "slashloop_last_error", "slashloop_default_site"]);
  const sites = await listAnalyticsSites(env.DB);
  const since30 = isoDay(Date.now() - 29 * 86400000);
  const lanes = await env.DB.prepare(
    `SELECT l.lane, l.site_id, l.accounts, l.seen_at,
            COALESCE((SELECT SUM(views) FROM slashloop_daily d WHERE d.lane = l.lane AND d.day >= ?), 0) AS views30
     FROM slashloop_lanes l ORDER BY views30 DESC, l.lane`,
  )
    .bind(since30)
    .all<{ lane: string; site_id: string | null; accounts: number; seen_at: number; views30: number }>();
  const days = await env.DB.prepare(
    "SELECT lane, day, views FROM slashloop_daily WHERE day >= ? ORDER BY day",
  )
    .bind(since30)
    .all<{ lane: string; day: string; views: number }>();
  return {
    connected: await connected(env),
    server: baseUrl(env),
    user: s.slashloop_user,
    encrypted: encryptionOn(env),
    lastSyncAt: s.slashloop_last_sync ? Number(s.slashloop_last_sync) : null,
    lastError: s.slashloop_last_error,
    defaultSiteId: s.slashloop_default_site,
    lanes: (lanes.results ?? []).map((l) => ({
      lane: l.lane,
      label: l.lane || "no lane",
      siteId: l.site_id,
      accounts: Number(l.accounts),
      views30: Number(l.views30),
      days: (days.results ?? []).filter((d) => d.lane === l.lane).map((d) => ({ day: d.day, views: Number(d.views) })),
    })),
    sites: sites.map((x) => ({ id: x.id, name: x.name })),
  };
}

export const slashloop: Plugin = {
  id: "slashloop",
  deps: ["analytics"],
  adminNav: { group: "growth", label: "slashloop" },
  adminFooter:
    `Signs in to Slashloop with OAuth (the same login your MCP agents use) and reads get_social_stats hourly: views gained per account per day, grouped by lane. Read-only; ${KEEP_DAYS} days kept. Tokens stay in your D1 (sealed with SLASHLOOP_ENC_KEY when that Worker secret is set).`,
  async summary(ctx: SectionCtx) {
    if (!(await connected(ctx.env))) return "";
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM slashloop_lanes").first<{ n: number }>();
    return `${n?.n ?? 0} lanes`;
  },
  async adminSection(ctx: SectionCtx) {
    const d = await pageData(ctx.env);
    const rows = d.lanes
      .map(
        (l) => `<div class="row">
          <div class="dot ${l.siteId ? "up" : "unknown"}"></div>
          <div>
            <div class="name">${esc(l.label)}</div>
            <div class="url">${l.accounts} account(s) · 30 days: ${l.views30} views</div>
          </div>
          <div class="meta"></div>
        </div>`,
      )
      .join("");
    return `<h2>slashloop</h2>
    <p class="sub">${d.connected ? `Connected${d.user ? ` as ${esc(d.user)}` : ""}${d.lastSyncAt ? ` · synced ${esc(ago(d.lastSyncAt))}` : ""}.` : "Not connected."}</p>
    <div class="list">${rows || `<p class="sub">No lanes yet.</p>`}</div>`;
  },
  async occupied(ctx: SectionCtx) {
    return connected(ctx.env);
  },
  async tick(env, now): Promise<TickStats> {
    const n = await maybeSync(env, now).catch((e) => {
      console.error("[slashloop] sync failed", errText(e));
      return 0;
    });
    return n ? { slashloop: n } : {};
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request, url, origin } = ctx;

    if (path === "/admin/slashloop/data" && method === "GET") {
      return Response.json(await pageData(env));
    }

    if (path === "/admin/slashloop/callback" && method === "GET") {
      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description");
        return redirect(`/admin/p/slashloop?msg=${encodeURIComponent(`Slashloop sign-in cancelled: ${desc || error}`)}`);
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      if (!code || !state) return redirect("/admin/p/slashloop?msg=missing%20code");
      try {
        await finishAuth(env, code, state);
      } catch (e) {
        return redirect(`/admin/p/slashloop?msg=${encodeURIComponent(errText(e))}`);
      }
      const email = await whoami(env);
      if (email) await setSetting(env.DB, "slashloop_user", email);
      let note = "";
      try {
        const r = await syncNow(env, Date.now());
        note = ` — ${r.lanes} lane(s), ${r.days} lane-day(s) loaded`;
      } catch (e) {
        note = ` — first sync failed: ${errText(e)}`;
      }
      return redirect(`/admin/p/slashloop?msg=${encodeURIComponent(`Slashloop connected${email ? ` as ${email}` : ""}${note}`)}`);
    }

    if (method !== "POST") return null;

    if (path === "/admin/slashloop/connect") {
      try {
        const to = await startAuth(env, origin);
        return wantsJson(request) ? Response.json({ ok: true, url: to }) : redirect(to);
      } catch (e) {
        return reply(request, false, errText(e));
      }
    }

    if (path === "/admin/slashloop/disconnect") {
      await disconnect(env);
      return reply(request, true, "disconnected — tokens and Slashloop numbers removed");
    }

    if (path === "/admin/slashloop/sync") {
      try {
        const r = await syncNow(env, Date.now());
        return reply(request, true, `synced ${r.lanes} lane(s), ${r.days} lane-day(s)`);
      } catch (e) {
        return reply(request, false, errText(e));
      }
    }

    if (path === "/admin/slashloop/lane") {
      const form = await request.formData();
      const lane = String(form.get("lane") ?? "");
      const siteId = String(form.get("site_id") ?? "").trim() || null;
      await env.DB.prepare("UPDATE slashloop_lanes SET site_id = ? WHERE lane = ?").bind(siteId, lane).run();
      return reply(request, true, siteId ? "linked — its views show on that site's analytics chart" : "unlinked");
    }

    if (path === "/admin/slashloop/default-site") {
      const form = await request.formData();
      const siteId = String(form.get("site_id") ?? "").trim();
      if (siteId) await setSetting(env.DB, "slashloop_default_site", siteId);
      else await env.DB.prepare("DELETE FROM settings WHERE key = 'slashloop_default_site'").run();
      if (form.get("apply_all") === "1") {
        await env.DB.prepare("UPDATE slashloop_lanes SET site_id = ?").bind(siteId || null).run();
      }
      return reply(request, true, "saved — new lanes land on that site");
    }
    return null;
  },
};
