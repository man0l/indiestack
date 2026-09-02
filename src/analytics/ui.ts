import { esc, ghostLink } from "../ui";
import type { SiteStats } from "./index";

function miniBars(days: Array<{ day: string; views: number; uniques: number }>): string {
  if (days.length === 0) return `<span class="url">no views yet</span>`;
  const max = Math.max(...days.map((d) => d.views), 1);
  return days
    .map(
      (d) =>
        `<div style="display:inline-block;text-align:center;margin-right:10px;font:10px/1.4 ui-monospace,monospace;color:var(--mute)">
           <div style="display:inline-block;width:10px;background:var(--accent);height:${Math.max(2, Math.round((d.views / max) * 36))}px;vertical-align:bottom"></div>
           <div>${d.day.slice(5)} · ${d.views}v</div>
           <div>${d.uniques}u</div>
         </div>`,
    )
    .join("");
}

function topList(rows: Array<Record<string, unknown>>, labelKey: string): string {
  if (rows.length === 0) return `<span class="url">—</span>`;
  return rows
    .map((r) => `<div class="url">${esc(String(r[labelKey] ?? "")).slice(0, 80)} · ${esc(String(r.views))}</div>`)
    .join("");
}

export function adminAnalytics(stats: SiteStats[], origin: string): string {
  const blocks = stats
    .map(
      (s) => `<div class="card">
        <label>${esc(s.site.name)}${s.site.enabled ? "" : " · paused"}</label>
        <p class="sub" style="margin:0 0 8px">7 days: <b>${s.totals.views}</b> views · <b>${s.totals.uniques}</b> uniques · snippet:</p>
        <div class="url" style="margin-bottom:10px">&lt;script defer src="${esc(origin)}/a.js" data-site="${esc(s.site.token)}"&gt;&lt;/script&gt;</div>
        <div style="margin-bottom:10px">${miniBars(s.days)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div><b>top paths</b>${topList(s.topPaths, "path")}</div>
          <div><b>top referrers</b>${topList(s.topRefs, "ref")}</div>
          <div><b>countries</b>${topList(s.topCountries, "country")}</div>
        </div>
        <div class="actions" style="margin-top:10px">
          <form method="post" action="/admin/analytics/${esc(s.site.id)}/toggle">
            <button class="ghost" type="submit">${s.site.enabled ? "pause" : "resume"}</button>
          </form>
          <form method="post" action="/admin/analytics/${esc(s.site.id)}/delete">
            <button class="danger" type="submit">remove</button>
          </form>
        </div>
      </div>`,
    )
    .join("");

  return `<h2>analytics</h2>
    <div class="list">${stats.length === 0 ? `<p class="sub">No sites. Add one, paste the snippet, get cookie-free pageviews.</p>` : blocks}</div>
    <form class="card" method="post" action="/admin/analytics">
      <label>site name
        <input type="text" name="name" maxlength="40" placeholder="marketing site" required/>
      </label>
      <button type="submit">add site</button>
    </form>
    <p class="sub" style="margin:0">Cookie-free. One D1 write per view, capped at 2,000 views/site/day so a spike can't eat your free plan. 30-day retention. ${ghostLink("/a.js", "view collector")}</p>`;
}
