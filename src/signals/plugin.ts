import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { esc, ago } from "../ui";
import { listAnalyticsSites } from "../analytics";
import { dueWatchers, listSignals, listWatchers, MAX_WATCHERS, pollWatcher } from "./index";

function keyHint(configured: boolean): string {
  return configured ? `✓ key configured` : `⚠ key not configured yet — add it below`;
}

export const signals: Plugin = {
  id: "signals",
  deps: ["analytics"],
  adminFooter: "Signals poll every 15 minutes. X needs a bearer key; Reddit needs a script-type app id/secret; GitHub reuses the deploy token.",
  async adminSection(ctx: SectionCtx) {
    const [watchers, signals, sites] = await Promise.all([
      listWatchers(ctx.env.DB),
      listSignals(ctx.env.DB),
      listAnalyticsSites(ctx.env.DB),
    ]);
    const [xBearer, redditId, redditSecret] = await Promise.all([
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'signals_x_bearer'").first<{ value: string }>(),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'signals_reddit_client_id'").first<{ value: string }>(),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'signals_reddit_client_secret'").first<{ value: string }>(),
    ]);

    const watcherRows =
      watchers.length === 0
        ? `<p class="sub">No watchers. Watch a repo for commits or a keyword for mentions.</p>`
        : watchers
            .map(
              (w) => `<div class="row">
              <div class="dot ${w.last_status && !w.last_status.startsWith("ok") && !w.last_status.startsWith("no") ? "down" : "up"}"></div>
              <div>
                <div class="name">${esc(w.source)} · ${esc(w.query)}${w.last_status ? ` · ${esc(w.last_status)}` : ""}</div>
                <div class="url">polled ${esc(ago(w.last_poll_at))}</div>
              </div>
              <div class="actions">
                <form method="post" action="/admin/signals/${esc(w.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`,
            )
            .join("");

    const siteOptions = sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    const signalsRows =
      signals.length === 0
        ? ""
        : signals
            .map(
              (s) => `<div class="row">
              <div class="dot up"></div>
              <div>
                <div class="name">${esc(s.source)} · ${esc(s.title)}</div>
                <div class="url">${esc(s.author ?? "")}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">open</a>` : ""} · ${esc(ago(s.ts))}</div>
              </div>
              <div class="meta"></div>
            </div>`,
            )
            .join("");

    const siteSelect = sites.length
      ? `<label>site
          <select name="site_id">${siteOptions}</select>
        </label>`
      : `<p class="sub">Add an analytics site first.</p>`;

    return `<h2>signals</h2>
    <div class="list">${watcherRows}</div>
    <form class="card" method="post" action="/admin/signals">
      ${siteSelect}
      <label>source
        <select name="source">
          <option value="github">GitHub commits (owner/repo)</option>
          <option value="x">X mentions (keyword or @handle — needs bearer key)</option>
          <option value="reddit">Reddit mentions (keyword — needs app id/secret)</option>
        </select>
      </label>
      <label>query
        <input type="text" name="query" maxlength="80" placeholder="man0l/indiestack  ·  indiestack  ·  @manol_ai" required/>
      </label>
      <button type="submit">add watcher</button>
    </form>
    ${signalsRows ? `<h2>recent signals</h2><div class="list">${signalsRows}</div>` : ""}
    <h2>api keys</h2>
    <form class="card" method="post" action="/admin/signals/keys">
      <label>X bearer token — ${keyHint(Boolean(xBearer?.value))}
        <input type="password" name="signals_x_bearer" value="${esc(xBearer?.value ?? "")}" placeholder="paste…"/>
      </label>
      <label>Reddit client id — ${keyHint(Boolean(redditId?.value))}
        <input type="text" name="signals_reddit_client_id" value="${esc(redditId?.value ?? "")}" placeholder="script-type app"/>
      </label>
      <label>Reddit client secret
        <input type="password" name="signals_reddit_client_secret" value="${esc(redditSecret?.value ?? "")}"/>
      </label>
      <button type="submit">save keys</button>
    </form>`;
  },
  async tick(env, now) {
    const due = await dueWatchers(env, now);
    let polled = 0;
    for (const w of due) {
      const status = await pollWatcher(env, w);
      await env.DB.prepare(
        "UPDATE signal_watchers SET last_poll_at = ?, last_status = ? WHERE id = ?",
      )
        .bind(now, status, w.id)
        .run();
      polled++;
    }
    return { signals_polled: polled };
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;

    if (path === "/admin/signals" && method === "POST") {
      const form = await request.formData();
      const siteId = String(form.get("site_id") ?? "").trim();
      const source = String(form.get("source") ?? "");
      const query = String(form.get("query") ?? "").trim().slice(0, 80);
      if (!siteId || !query || !["github", "x", "reddit"].includes(source)) {
        return redirect("/admin?msg=site%2C%20source%20and%20query%20required");
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM signal_watchers").first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_WATCHERS) return redirect("/admin?msg=max%2010%20watchers");
      await env.DB.prepare(
        "INSERT INTO signal_watchers (id, site_id, source, query, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), siteId, source, query, Date.now())
        .run();
      return redirect("/admin?msg=watcher%20added%20%E2%80%94%20first%20poll%20on%20next%20tick");
    }

    if (path === "/admin/signals/keys" && method === "POST") {
      const form = await request.formData();
      for (const key of ["signals_x_bearer", "signals_reddit_client_id", "signals_reddit_client_secret"]) {
        const value = String(form.get(key) ?? "").trim();
        if (value) {
          await env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
            .bind(key, value.slice(0, 300))
            .run();
        }
      }
      return redirect("/admin?msg=signal%20keys%20saved");
    }

    const del = path.match(/^\/admin\/signals\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM signals WHERE watcher_id = ?").bind(del[1]),
        env.DB.prepare("DELETE FROM signal_watchers WHERE id = ?").bind(del[1]),
      ]);
      return redirect("/admin?msg=removed");
    }
    return null;
  },
};
