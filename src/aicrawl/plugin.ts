import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc } from "../ui";
import { listAnalyticsSites, siteByToken } from "../analytics";
import { classifyCrawler, crawlSummary, ingestSnippet, maybePruneCrawls } from "./index";

export const aicrawl: Plugin = {
  id: "aicrawl",
  adminNav: { group: "growth", label: "ai crawlers" },
  deps: ["analytics"],
  adminFooter: "AI crawlers are recorded server-side — paste the middleware into the Workers you own. Other bots land under other-bot.",
  async adminSection(ctx: SectionCtx) {
    const sites = await listAnalyticsSites(ctx.env.DB);
    const blocks = await Promise.all(
      sites.map(async (site) => {
        const s = await crawlSummary(ctx.env, site.id);
        const vendorRows =
          s.byVendor.length === 0
            ? `<span class="url">no crawls recorded yet</span>`
            : s.byVendor
                .map(
                  (v) =>
                    `<div class="url">${esc(v.vendor)} · ${v.n} hit(s) · last ${esc(new Date(v.last_ts).toISOString().slice(0, 16))}Z</div>`,
                )
                .join("");
        const pathRows =
          s.topPaths.length === 0
            ? `<span class="url">—</span>`
            : s.topPaths.map((p) => `<div class="url">${esc(p.path)} · ${p.n}</div>`).join("");
        const refRows =
          s.referrals.length === 0
            ? `<span class="url">—</span>`
            : s.referrals.map((r) => `<div class="url">${esc(r.ref)} · ${r.views}</div>`).join("");
        return `<div class="card">
          <label>${esc(site.name)}</label>
          <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px">
            <div><b>crawlers (30d)</b>${vendorRows}</div>
            <div><b>top crawled paths</b>${pathRows}</div>
            <div><b>AI referrals</b>${refRows}</div>
          </div>
          <p class="sub" style="margin:10px 0 0">middleware for this site's Worker:</p>
          <div class="url" style="white-space:pre-wrap">${esc(ingestSnippet(ctx.origin, site.token))}</div>
        </div>`;
      }),
    );
    return `<h2>ai crawlers</h2>
    ${sites.length === 0 ? `<p class="sub">Add an analytics site first.</p>` : blocks.join("")}`;
  },
  async tick(env, now) {
    await maybePruneCrawls(env, now);
    return {};
  },
  async route(ctx: RouteCtx) {
    const crawl = ctx.path.match(/^\/crawlers\/([A-Za-z0-9_-]+)$/);
    if (!crawl || ctx.method !== "POST") return null;
    const site = await siteByToken(ctx.env.DB, crawl[1]);
    if (!site) return new Response(null, { status: 204 });
    let body: { ua?: unknown; p?: unknown };
    try {
      body = JSON.parse(await ctx.request.text().then((t) => t.slice(0, 2048))) as typeof body;
    } catch {
      return new Response(null, { status: 204 });
    }
    const ua = typeof body.ua === "string" ? body.ua.slice(0, 200) : (ctx.request.headers.get("user-agent") ?? "");
    const vendor = classifyCrawler(ua);
    if (!vendor) return new Response(null, { status: 204 });
    const path = typeof body.p === "string" && body.p.startsWith("/") ? body.p.slice(0, 200) : "/";
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM crawls WHERE site_id = ? AND day = ?")
      .bind(site.id, day)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 5000) return new Response(null, { status: 204 });
    await ctx.env.DB.prepare(
      "INSERT INTO crawls (site_id, day, ts, vendor, agent, path) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(site.id, day, now, vendor, ua || null, path)
      .run()
      .catch(() => {});
    return new Response(null, { status: 204 });
  },
};
