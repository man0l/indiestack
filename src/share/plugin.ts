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

function bars(days: Array<{ day: string; views: number; uniques: number }>): string {
  if (days.length === 0) return `<p class="sub">No views yet.</p>`;
  const max = Math.max(...days.map((d) => d.views), 1);
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:90px;border-bottom:1px solid var(--line);padding:0 4px">${days
    .map(
      (d) =>
        `<div title="${esc(d.day)} · ${d.views} views / ${d.uniques} uniques" style="flex:1;background:var(--accent);opacity:.85;height:${Math.max(3, Math.round((d.views / max) * 84))}px"></div>`,
    )
    .join("")}</div>
  <p class="sub" style="margin:6px 0 0">${esc(days[0]?.day ?? "")} → ${esc(days[days.length - 1]?.day ?? "")}</p>`;
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
  deps: ["analytics", "goals"],
  adminFooter: "Share links are public: visitors see views, uniques, top paths, referrers and goals — never raw visitor data.",
  async adminSection(ctx: SectionCtx) {
    const [sites, shares] = await Promise.all([listAnalyticsSites(ctx.env.DB), listShares(ctx.env.DB)]);
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

    const days = 14;
    const stats = await siteStatsById(ctx.env, row.id, days);
    const live = await liveVisitors(ctx.env, row.id);
    const events = await topEvents(ctx.env, row.id, days);
    const goals = (await listGoals(ctx.env.DB)).filter((g) => g.site_id === row.id);
    const goalRows = await Promise.all(goals.map(async (g) => ({ g, s: await goalStats(ctx.env, g, 30) })));

    const body = `<header>
      <div class="brand">${esc(row.name)} <span>analytics · shared</span></div>
      <div class="led"><div class="dot up"></div>${live} live</div>
    </header>
    <h1 class="up">${stats ? stats.totals.views : 0} views</h1>
    <p class="pct">${stats ? stats.totals.uniques : 0} uniques · last ${days} days</p>
    ${bars(stats?.days ?? [])}
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
