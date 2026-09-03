import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc } from "../ui";
import { liveVisitors, siteByToken, siteStats } from "../analytics";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 100_000) / 10)}M`;
  if (n >= 1_000) return `${Math.round((n / 100) / 10)}k`;
  return String(n);
}

function badge(parts: Array<{ text: string; color: string; bg: string }>): string {
  const width = parts.reduce((acc, p) => acc + 6 + p.text.length * 6.5 + 12, 0);
  let x = 0;
  const rects = parts
    .map((p) => {
      const w = 6 + p.text.length * 6.5 + 12;
      const el = `<rect x="${x}" width="${w}" height="20" fill="${p.bg}"/>
  <text x="${x + w / 2}" y="14" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" font-weight="600" fill="${p.color}">${esc(p.text)}</text>`;
      x += w;
      return el;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="analytics badge">
  ${rects}
</svg>`;
}

export const widgets: Plugin = {
  id: "widgets",
  adminNav: { group: "distribute", label: "widgets" },
  deps: ["analytics"],
  adminFooter: "Widgets are public images — anyone with the URL can read the number it shows.",
  adminSection(ctx: SectionCtx) {
    return `<h2>widgets</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 10px">Embeddable badges, one per site. Drop the <code>&lt;img&gt;</code> into your site footer or README.</p>
      <div class="url" style="margin:0">&lt;img src="${esc(ctx.origin)}/w/live.svg?site=&lt;site token&gt;" alt="live visitors"/&gt;</div>
      <div class="url" style="margin:6px 0 0">&lt;img src="${esc(ctx.origin)}/w/views.svg?site=&lt;site token&gt;&amp;days=7" alt="views this week"/&gt;</div>
    </div>`;
  },
  async route(ctx: RouteCtx) {
    const { path, method, url } = ctx;
    if (method !== "GET" || !path.startsWith("/w/")) return null;
    const token = url.searchParams.get("site") ?? "";
    const site = token ? await siteByToken(ctx.env.DB, token) : null;
    if (!site) return new Response("unknown site", { status: 404 });
    const headers = {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
    };

    if (path === "/w/live.svg") {
      const live = await liveVisitors(ctx.env, site.id);
      return new Response(badge([{ text: `● ${live} live`, color: "#10140a", bg: "#c8f542" }]), { headers });
    }

    if (path === "/w/views.svg") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
      const stats = await siteStats(ctx.env, site, days);
      const label = days === 1 ? "today" : `${days}d`;
      return new Response(
        badge([
          { text: `${fmt(stats.totals.views)} views`, color: "#f3f1ea", bg: "#111113" },
          { text: `${label}`, color: "#8d8b86", bg: "#0a0a0b" },
        ]),
        { headers },
      );
    }

    if (path === "/w/stats.json") {
      const stats = await siteStats(ctx.env, site, 7);
      return Response.json(
        {
          site: site.name,
          live: await liveVisitors(ctx.env, site.id),
          views_7d: stats.totals.views,
          uniques_7d: stats.totals.uniques,
          top_paths: stats.topPaths.slice(0, 5),
        },
        { headers: { "cache-control": "public, max-age=60" } },
      );
    }
    return null;
  },
};
