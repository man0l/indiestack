import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc } from "../ui";
import { listAnalyticsSites } from "../analytics";

export const MAX_GOALS = 20;

export type Goal = {
  id: string;
  site_id: string;
  name: string;
  kind: "event" | "path";
  target: string;
  created_at: number;
};

export type GoalStats = {
  goal: Goal;
  window_days: number;
  uniques: number;
  converted: number;
  rate_pct: number | null;
  bySource: Array<{ ref: string; converted: number }>;
};

/** Conversion of one goal over a window: unique visitors vs uniques who hit the target. */
export async function goalStats(env: Env, goal: Goal, days: number): Promise<GoalStats> {
  const sinceDay = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const totals = await env.DB.prepare(
    "SELECT COUNT(DISTINCT vid) AS n FROM hits WHERE site_id = ? AND day >= ?",
  )
    .bind(goal.site_id, sinceDay)
    .first<{ n: number }>();
  const convertedRows =
    goal.kind === "path"
      ? await env.DB.prepare(
          `SELECT COUNT(DISTINCT vid) AS n FROM hits
           WHERE site_id = ? AND day >= ? AND (path = ? OR path LIKE ? || '/%' OR path LIKE ? || '?%')`,
        )
          .bind(goal.site_id, sinceDay, goal.target, goal.target, goal.target)
          .first<{ n: number }>()
      : await env.DB.prepare(
          `SELECT COUNT(DISTINCT vid) AS n FROM events
           WHERE site_id = ? AND day >= ? AND name = ?`,
        )
          .bind(goal.site_id, sinceDay, goal.target)
          .first<{ n: number }>();
  const bySource =
    goal.kind === "path"
      ? await env.DB.prepare(
          `SELECT COALESCE(NULLIF(ref, ''), 'direct') AS ref, COUNT(DISTINCT vid) AS converted
           FROM hits WHERE site_id = ? AND day >= ? AND (path = ? OR path LIKE ? || '/%' OR path LIKE ? || '?%') AND ref IS NOT NULL
           GROUP BY ref ORDER BY converted DESC LIMIT 8`,
        )
          .bind(goal.site_id, sinceDay, goal.target, goal.target, goal.target)
          .all<{ ref: string; converted: number }>()
      : await env.DB.prepare(
          `SELECT COALESCE(NULLIF(e.ref, ''), 'direct') AS ref, COUNT(DISTINCT e.vid) AS converted
           FROM events e WHERE e.site_id = ? AND e.day >= ? AND e.name = ? AND e.ref IS NOT NULL
           GROUP BY e.ref ORDER BY converted DESC LIMIT 8`,
        )
          .bind(goal.site_id, sinceDay, goal.target)
          .all<{ ref: string; converted: number }>();
  const uniques = Number(totals?.n) || 0;
  const converted = Number(convertedRows?.n) || 0;
  return {
    goal,
    window_days: days,
    uniques,
    converted,
    rate_pct: uniques === 0 ? null : Math.round((converted / uniques) * 1000) / 10,
    bySource: bySource.results ?? [],
  };
}

export async function listGoals(db: D1Database): Promise<Goal[]> {
  const { results } = await db.prepare("SELECT * FROM goals ORDER BY created_at ASC").all<Goal>();
  return results ?? [];
}

export const goals: Plugin = {
  id: "goals",
  deps: ["analytics"],
  adminFooter: "Event goals match df.track('name') events; path goals match a page path. Rate is uniques who converted over all uniques.",
  async adminSection(ctx: SectionCtx) {
    const [goals, sites] = await Promise.all([listGoals(ctx.env.DB), listAnalyticsSites(ctx.env.DB)]);
    const names = new Map(sites.map((s) => [s.id, s.name]));
    const rows = await Promise.all(
      goals.map(async (g) => {
        const s7 = await goalStats(ctx.env, g, 7);
        const s30 = await goalStats(ctx.env, g, 30);
        const rate = (s: GoalStats) => (s.rate_pct == null ? "—" : `${s.rate_pct}%`);
        return `<div class="row">
          <div class="dot up"></div>
          <div>
            <div class="name">${esc(g.name)} <span class="url">(${esc(g.kind)}: ${esc(g.target)}) · ${esc(names.get(g.site_id) ?? "")}</span></div>
            <div class="url">7d ${s7.converted}/${s7.uniques} · 30d ${s30.converted}/${s30.uniques} · top: ${esc(
              s30.bySource
                .slice(0, 3)
                .map((b) => `${b.ref} (${b.converted})`)
                .join(", ") || "—",
            )}</div>
          </div>
          <div class="meta"><b>${esc(rate(s30))}</b><br/>30d</div>
          <div class="actions">
            <form method="post" action="/admin/goals/${esc(g.id)}/delete">
              <button class="danger" type="submit">remove</button>
            </form>
          </div>
        </div>`;
      }),
    );
    const siteOptions = sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    return `<h2>goals</h2>
    <div class="list">${rows.join("") || `<p class="sub">No goals yet. Track events with <code>df.track('signup')</code> and measure conversion.</p>`}</div>
    <form class="card" method="post" action="/admin/goals">
      ${sites.length ? `<label>site<select name="site_id">${siteOptions}</select></label>` : ""}
      <label>name
        <input type="text" name="name" maxlength="40" placeholder="signups" required/>
      </label>
      <label>type
        <select name="kind">
          <option value="event">event — df.track('name')</option>
          <option value="path">path — a page visit</option>
        </select>
      </label>
      <label>target (event name, or path like /signup)
        <input type="text" name="target" maxlength="120" placeholder="signup  ·  /pricing" required/>
      </label>
      <button type="submit">add goal</button>
    </form>`;
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    if (path === "/admin/goals" && method === "POST") {
      const form = await request.formData();
      const siteId = String(form.get("site_id") ?? "").trim();
      const name = String(form.get("name") ?? "").trim().slice(0, 40);
      const kind = String(form.get("kind") ?? "") === "path" ? "path" : "event";
      const target = String(form.get("target") ?? "").trim().slice(0, 120);
      if (!siteId || !name || !target) return redirect("/admin?msg=name%2C%20site%20and%20target%20required");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM goals").first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_GOALS) return redirect("/admin?msg=max%2020%20goals");
      await env.DB.prepare(
        "INSERT INTO goals (id, site_id, name, kind, target, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), siteId, name, kind, kind === "path" ? target.toLowerCase() : target, Date.now())
        .run();
      return redirect("/admin?msg=goal%20added");
    }
    const del = path.match(/^\/admin\/goals\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.prepare("DELETE FROM goals WHERE id = ?").bind(del[1]).run();
      return redirect("/admin?msg=removed");
    }
    return null;
  },
};
