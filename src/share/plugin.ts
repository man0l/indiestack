import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc, html, liveStatus, page } from "../ui";
import { listAnalyticsSites, liveVisitors, siteStatsById, topEvents } from "../analytics";
import { goalStats, listGoals } from "../goals/plugin";

export type SiteShare = {
  site_id: string;
  token: string;
  enabled: number;
  created_at: number;
};

async function listShares(db: D1Database): Promise<SiteShare[]> {
  const { results } = await db.prepare("SELECT * FROM site_shares").all<SiteShare>();
  return results ?? [];
}

function chart(days: Array<{ day: string; views: number; uniques: number }>): string {
  const width = 700;
  const height = 200;
  const padding = 28;
  const now = new Date();
  const axis = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + i)).toISOString().slice(0, 10),
  );
  const values = axis.map((day) => days.find((d) => d.day === day) ?? { day, views: 0, uniques: 0 });
  const max = Math.max(...values.flatMap((d) => [d.views, d.uniques]), 1);
  const x = (i: number) => padding + (i / 6) * (width - padding * 2);
  const y = (value: number) => height - padding - (value / max) * (height - padding * 2);
  const line = (key: "views" | "uniques") => values.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  return `<style>
    .share-chart { --chart-primary: oklch(0.922 0 0); --chart-muted: oklch(0.708 0 0); --chart-border: oklch(1 0 0 / 10%); margin-bottom:12px; }
    .share-chart-legend { display:flex;flex-wrap:wrap;gap:16px;margin-bottom:4px;font-size:12px;color:var(--chart-muted); }
    .share-chart-legend span { display:flex;align-items:center;gap:6px; }
    .share-chart-legend i { width:16px;border-top:2px solid var(--chart-primary); }
    .share-chart-legend .uniques { border-top:2px dashed var(--chart-muted); }
    .share-chart-plot { position:relative; }
    .share-chart svg { display:block;width:100%;height:auto; }
    .share-chart-hit { position:absolute;top:0;height:100%; }
    .share-chart-hit button { display:block;width:100%;height:100%;padding:0;border:0;border-radius:0;background:transparent;cursor:crosshair; }
    .share-chart-tooltip { display:none;position:absolute;top:0;z-index:10;width:256px;max-width:80%;padding:12px;border:1px solid var(--chart-border);border-radius:12px;background:oklch(0.205 0 0);color:var(--ink);font-size:12px;box-shadow:0 20px 25px -5px #0005;pointer-events:none; }
    .share-chart-hit:hover + .share-chart-tooltip, .share-chart-hit:focus-within + .share-chart-tooltip { display:block; }
  </style>
  <div class="share-chart">
    <div class="share-chart-legend"><span><i></i>views</span><span><i class="uniques"></i>uniques</span></div>
    <div class="share-chart-plot">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="visitors last 7 days">
        ${[0.25, 0.5, 0.75].map((g) => `<line x1="${padding}" x2="${width - padding}" y1="${padding + g * (height - padding * 2)}" y2="${padding + g * (height - padding * 2)}" stroke="var(--chart-border)" stroke-width="1" />`).join("")}
        <polyline points="${line("views")}" fill="none" stroke="var(--chart-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <polyline points="${line("uniques")}" fill="none" stroke="var(--chart-muted)" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" />
        ${values.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.views)}" r="3" fill="var(--chart-primary)"><title>${d.day} · ${d.views} views / ${d.uniques} uniques</title></circle>`).join("")}
        ${axis.map((day, i) => `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--chart-muted)">${day.slice(5)}</text>`).join("")}
      </svg>
      ${values.map((d, i) => {
        const left = i === 0 ? padding : (x(i - 1) + x(i)) / 2;
        const right = i === 6 ? width - padding : (x(i) + x(i + 1)) / 2;
        const label = `${d.day} · ${d.views} views / ${d.uniques} uniques`;
        return `<div class="share-chart-hit" style="left:${left / width * 100}%;width:${(right - left) / width * 100}%"><button type="button" aria-label="${esc(label)}" aria-describedby="chart-day-${i}"></button></div><div class="share-chart-tooltip" id="chart-day-${i}" role="tooltip" style="left:min(${Math.min(65, i / 6 * 100)}%, calc(100% - 264px))"><b>${esc(label)}</b></div>`;
      }).join("")}
    </div>
  </div>`;
}

function list(rows: Array<Record<string, unknown>>, key: string, label: string): string {
  if (rows.length === 0) return "";
  return `<h2>${esc(label)}</h2><div class="list">${rows
    .map(
      (r) =>
        `<div class="row"><div class="dot up" style="visibility:hidden"></div><div><div class="name">${esc(String(r[key] ?? "")).slice(0, 80)}</div></div><div class="meta"><b>${esc(String(r.views ?? ""))}</b></div></div>`,
    )
    .join("")}</div>`;
}

export const share: Plugin = {
  id: "share",
  adminNav: { group: "distribute", label: "share" },
  deps: ["analytics", "goals"],
  adminFooter: "Share links are public: visitors see views, uniques, top paths, referrers and goals — never raw visitor data.",
  async adminSection(ctx: SectionCtx) {
    const sites = await listAnalyticsSites(ctx.env.DB);
    const shares = await listShares(ctx.env.DB);
    const bySite = new Map(shares.map((s) => [s.site_id, s]));
    const rows = sites
      .map((site) => {
        const existing = bySite.get(site.id);
        const on = Boolean(existing?.enabled);
        const url = existing ? `${ctx.origin}/share/${existing.token}` : null;
        return `<div class="row">
          <div class="dot ${on ? "up" : "paused"}"></div>
          <div>
            <div class="name">${esc(site.name)}${on ? " · public" : " · private"}</div>
            <div class="url">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : "no share link"}</div>
          </div>
          <div class="actions">
            <form method="post" action="/admin/share/${esc(site.id)}/toggle">
              <button class="ghost" type="submit">${on ? "make private" : "share publicly"}</button>
            </form>
          </div>
        </div>`;
      })
      .join("");
    return `<h2>share</h2>
    <div class="list">${rows || `<p class="sub">Add an analytics site first.</p>`}</div>`;
  },
  async admin(ctx: RouteCtx) {
    const tog = ctx.path.match(/^\/admin\/share\/([^/]+)\/toggle$/);
    if (tog && ctx.method === "POST") {
      const siteId = tog[1];
      const existing = await ctx.env.DB.prepare("SELECT * FROM site_shares WHERE site_id = ?")
        .bind(siteId)
        .first<SiteShare>();
      if (!existing) {
        await ctx.env.DB.prepare(
          "INSERT INTO site_shares (site_id, token, enabled, created_at) VALUES (?, ?, 1, ?)",
        )
          .bind(siteId, crypto.randomUUID().replaceAll("-", ""), Date.now())
          .run();
        return redirect("/admin?msg=share%20link%20created");
      }
      await ctx.env.DB.prepare("UPDATE site_shares SET enabled = 1 - enabled WHERE site_id = ?")
        .bind(siteId)
        .run();
      return redirect("/admin?msg=toggled");
    }
    return null;
  },
  async route(ctx: RouteCtx) {
    const m = ctx.path.match(/^\/share\/([a-f0-9]{16,64})$/);
    if (!m || ctx.method !== "GET") return null;
    const row = await ctx.env.DB.prepare(
      "SELECT s.* FROM site_shares sh JOIN analytics_sites s ON s.id = sh.site_id WHERE sh.token = ? AND sh.enabled = 1 AND s.enabled = 1",
    )
      .bind(m[1])
      .first<{ id: string; name: string }>();
    if (!row) return new Response("not found", { status: 404 });

    const days = 7;
    const stats = await siteStatsById(ctx.env, row.id, days);
    const live = await liveVisitors(ctx.env, row.id);
    const events = await topEvents(ctx.env, row.id, days);
    const goals = (await listGoals(ctx.env.DB)).filter((g) => g.site_id === row.id);
    const goalRows = [];
    for (const g of goals) goalRows.push({ g, s: await goalStats(ctx.env, g, 30) });

    const body = `<header>
      <div class="brand">${esc(row.name)} <span>analytics · shared</span></div>
      <div class="led"><div class="dot up"></div>${live} live</div>
    </header>
    <h1 class="up">${stats ? stats.totals.views : 0} views</h1>
    <p class="pct">${stats ? stats.totals.uniques : 0} uniques · last ${days} days</p>
    ${chart(stats?.days ?? [])}
    ${list((stats?.topPaths ?? []) as unknown as Array<Record<string, unknown>>, "path", "top pages")}
    ${list((stats?.topRefs ?? []) as unknown as Array<Record<string, unknown>>, "ref", "referrers")}
    ${list((stats?.topCountries ?? []) as unknown as Array<Record<string, unknown>>, "country", "countries")}
    ${list(events as unknown as Array<Record<string, unknown>>, "name", "events")}
    ${
      goalRows.length
        ? `<h2>goals · 30d</h2><div class="list">${goalRows
            .map(
              (r) =>
                `<div class="row"><div class="dot ${liveStatus(1, "up")}"></div><div><div class="name">${esc(r.g.name)}</div><div class="url">${r.s.converted}/${r.s.uniques} uniques converted</div></div><div class="meta"><b>${r.s.rate_pct == null ? "—" : `${r.s.rate_pct}%`}</b></div></div>`,
            )
            .join("")}</div>`
        : ""
    }
    <footer>shared analytics · powered by IndieStack · <a href="https://x.com/manol_ai" target="_blank" rel="noopener">@manol_ai</a></footer>`;

    return html(page(`${row.name} · analytics`, body, `<meta http-equiv="refresh" content="30"/>`), 200, {
      "cache-control": "no-store",
    });
  },
};
