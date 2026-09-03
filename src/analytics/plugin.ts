import { redirect, toggleEnabled } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import {
  MAX_ANALYTICS_SITES,
  type EventPayload,
  collectorScript,
  identifyHash,
  listAnalyticsSites,
  maybePruneHits,
  parseHit,
  recordEvent,
  recordHit,
  refHost,
  siteByToken,
  siteStats,
  visitorBucket,
  type HitPayload,
} from "./index";
import { adminAnalytics } from "./ui";

const READ_CAPPED = 4 * 1024;

async function readBody(request: Request): Promise<string> {
  return await request.text().then((t) => t.slice(0, READ_CAPPED));
}

export const analytics: Plugin = {
  id: "analytics",
  adminNav: { group: "growth", label: "analytics" },
  adminFooter: "Analytics is cookie-free, capped at 2,000 views/site/day, 30-day retention in D1.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM analytics_sites").first<{
      n: number;
    }>();
    if (!n?.n) return "";
    return `${n.n}/${MAX_ANALYTICS_SITES} sites`;
  },
  async adminSection(ctx: SectionCtx) {
    const sites = await listAnalyticsSites(ctx.env.DB);
    const stats = await Promise.all(sites.map((s) => siteStats(ctx.env, s)));
    return adminAnalytics(stats, ctx.origin);
  },
  async occupied(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM analytics_sites").first<{
      n: number;
    }>();
    return (n?.n ?? 0) > 0;
  },
  async tick(env, now) {
    await maybePruneHits(env, now);
    return {};
  },
  async route(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;

    if (path === "/a.js" && method === "GET") {
      return new Response(collectorScript(), {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    if (path === "/hit") {
      if (method !== "POST") return new Response(null, { status: 204 });
      const payload = parseHit(await readBody(request));
      if (!payload) return new Response(null, { status: 204 });
      const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      await recordHit(env, payload as HitPayload, country, ip).catch(() => {});
      return new Response(null, { status: 204 });
    }

    // Custom events (df.track) and visitor identification (df.identify).
    if (path === "/event") {
      if (method !== "POST") return new Response(null, { status: 204 });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await readBody(request)) as Record<string, unknown>;
      } catch {
        return new Response(null, { status: 204 });
      }
      const token = typeof body.s === "string" ? body.s : "";
      const site = token ? await siteByToken(env.DB, token) : null;
      if (!site) return new Response(null, { status: 204 });
      const name = typeof body.e === "string" && body.e.trim() ? body.e.trim().toLowerCase().slice(0, 40) : "";
      const email = typeof body.i === "string" && body.i.trim() ? body.i.trim().slice(0, 120) : "";
      if (!name && !email) return new Response(null, { status: 204 });
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
      const vid = await visitorBucket(env, site.token, ip, day);
      const ident = email ? await identifyHash(env, email) : null;
      const rawPath = typeof body.p === "string" && body.p.startsWith("/") ? body.p.slice(0, 200) : "/";
      const rawRef = typeof body.r === "string" && body.r ? body.r.slice(0, 200) : null;
      const payload: EventPayload = {
        name: name || "__identify",
        path: rawPath,
        ref: rawRef ? refHost(rawRef) : null,
        country,
        vid,
        ident,
      };
      await recordEvent(env, site, payload).catch(() => {});
      return new Response(null, { status: 204 });
    }
    return null;
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    if (path === "/admin/analytics" && method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim().slice(0, 40);
      if (!name) return redirect("/admin?msg=name%20required");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM analytics_sites").first<{
        n: number;
      }>();
      if ((count?.n ?? 0) >= MAX_ANALYTICS_SITES) {
        return redirect("/admin?msg=max%203%20analytics%20sites");
      }
      await env.DB.prepare(
        "INSERT INTO analytics_sites (id, name, token, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), name, crypto.randomUUID().replaceAll("-", ""), Date.now())
        .run();
      return redirect("/admin?msg=site%20added%20%E2%80%94%20paste%20the%20snippet");
    }
    const tog = path.match(/^\/admin\/analytics\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "analytics_sites", tog[1]);
      return redirect("/admin?msg=toggled");
    }
    const del = path.match(/^\/admin\/analytics\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM hits WHERE site_id = ?").bind(del[1]),
        env.DB.prepare("DELETE FROM analytics_sites WHERE id = ?").bind(del[1]),
      ]);
      return redirect("/admin?msg=removed");
    }
    return null;
  },
};
