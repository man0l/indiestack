import {
  clearCookie,
  isAdmin,
  mintAdminToken,
  resolveAdminToken,
  safeEqual,
  setCookie,
} from "./kernel/auth";
import {
  ALERT_SETTING_KEYS,
  clearAlertError,
  sendTestAlert,
} from "./kernel/alert";
import { PLUGINS } from "./kernel/catalog";
import { getSetting, setSetting } from "./kernel/db";
import { redirect } from "./kernel/http";
import { collect, dispatch, firstKicker, sumHealth } from "./kernel/plugin";
import { runTick } from "./kernel/tick";
import { deployOverview } from "./integrations";
import { listJobs } from "./heartbeat/plugin";
import { listLogSources } from "./logs/index";
import { TEMPLATES } from "./templates/index";
import { listAnalyticsSites } from "./analytics/index";
import { goalStats, listGoals } from "./goals/plugin";
import { siteStats } from "./analytics/index";
import { parseQuery, queryLogs } from "./explorer/query";
import { listSignals, listWatchers } from "./signals/index";
import { crawlSummary, ingestSnippet } from "./aicrawl/index";
import { parseHttpUrl } from "./kernel/util";
import { adminShell, ago, html, loginPage, overallOf, revealPage, settingsCard, statusPage } from "./ui";

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
  async scheduled(_controller, env) {
    await runTick(env).catch((err) => {
      console.error("tick failed", String(err));
    });
  },
} satisfies ExportedHandler<Env>;

async function logSourceList(env: Env): Promise<Array<{ id: string; name: string }>> {
  const rows = await env.DB.prepare("SELECT id, name FROM log_sources ORDER BY created_at ASC").all<{
    id: string;
    name: string;
  }>();
  return rows.results ?? [];
}

async function lastVercelSync(env: Env): Promise<{ at: number; synced: number; error: string | null } | null> {
  const raw = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vercel_log_last'")
    .first<{ value: string }>()
    .then((r) => r?.value ?? null)
    .catch(() => null);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { at?: unknown; synced?: unknown; error?: unknown };
    return {
      at: typeof o.at === "number" ? o.at : 0,
      synced: typeof o.synced === "number" ? o.synced : 0,
      error: typeof o.error === "string" ? o.error : null,
    };
  } catch {
    return null;
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ctx = {
    request,
    env,
    url,
    path: url.pathname,
    method: request.method,
    origin: url.origin,
  };

  if (ctx.path === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  const routed = await dispatch(PLUGINS, "route", ctx);
  if (routed) return routed;

  if (ctx.path.startsWith("/_app/") && ctx.method === "GET") {
    const name = ctx.path.slice(6);
    if (!name.includes("..") && !name.includes("\\")) {
      const obj = await env.BUCKET.get(`assets/${name}`);
      if (obj) return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/javascript", "cache-control": "no-cache" } });
    }
  }

  if (ctx.path === "/api/overview" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const cards = await collectNavCards(env, Date.now());
    return Response.json({ cards });
  }
  if (ctx.path === "/api/monitors" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const monitors = await env.DB.prepare("SELECT * FROM monitors ORDER BY created_at").all();
    return Response.json({ monitors: monitors.results ?? [] });
  }
  if (ctx.path === "/api/heartbeats" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    return Response.json({ heartbeats: await listJobs(env.DB) });
  }
  if (ctx.path === "/api/logsources" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    return Response.json({ sources: await listLogSources(env.DB) });
  }
  if (ctx.path === "/api/templates" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    return Response.json({
      templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, interval_min: t.interval_min })),
    });
  }
  if (ctx.path === "/api/vercelprojects" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const team = (url.searchParams.get("team") ?? "").trim() || null;
    const fresh = url.searchParams.get("fresh") === "1";
    const { getVercelMapping, listVercelProjects, listVercelTeams } = await import("./integrations/index");
    const token = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vercel_token'")
      .first<{ value: string }>()
      .then((r) => r?.value ?? null);
    if (!token) {
      return Response.json({ connected: false, projects: [], mapping: {} });
    }
    // Projects/teams only change on deploy or team shuffle: short KV cache keeps the page snappy.
    const cacheKey = `vc:projteam:${team ?? "_"}`;
    type ProjectLists = { projects: Array<{ id: string; name: string }>; teams: Array<{ id: string; slug: string }> };
    let lists: ProjectLists | null = fresh
      ? null
      : ((await env.CACHE.get(cacheKey, "json").catch(() => null)) as ProjectLists | null);
    let error: string | null = null;
    if (!lists) {
      try {
        lists = { projects: await listVercelProjects(token, team), teams: await listVercelTeams(token).catch(() => []) };
        await env.CACHE.put(cacheKey, JSON.stringify(lists), { expirationTtl: 180 }).catch(() => {});
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    return Response.json({
      connected: true,
      projects: lists?.projects ?? [],
      teams: lists?.teams ?? [],
      mapping: await getVercelMapping(env),
      sync: await lastVercelSync(env),
      error,
    });
  }
  if (ctx.path === "/api/cfworkers" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const fresh = url.searchParams.get("fresh") === "1";
    const { cloudflareToken, getCfAccountId, getCfMapping, cachedWorkers, listAccounts } =
      await import("./cloudflare/index");
    const token = await cloudflareToken(env);
    if (!token) {
      return Response.json({
        connected: false,
        account: null,
        accounts: [],
        scripts: [],
        mapping: {},
        sources: [],
      });
    }
    let account = await getCfAccountId(env);
    let accounts: Array<{ id: string; name: string }> = [];
    try {
      // The accounts call is pure latency when the account id is already stored.
      if (!account || fresh) {
        accounts = await listAccounts(token);
        if (!account && accounts[0]) {
          account = accounts[0].id;
          await env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES ('cf_account_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).bind(account).run();
        }
      }
    } catch (err) {
      return Response.json({
        connected: true,
        account,
        accounts,
        scripts: [],
        mapping: await getCfMapping(env),
        sources: await logSourceList(env),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    let scripts: string[] = [];
    let error: string | null = null;
    try {
      if (account) {
        scripts = await cachedWorkers(env, token, account, fresh);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return Response.json({
      connected: true,
      account,
      accounts,
      scripts,
      mapping: await getCfMapping(env),
      sources: await logSourceList(env),
      error,
    });
  }
  if (ctx.path === "/api/logevents" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const q = parseQuery(url, url.searchParams.get("source"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const { events, sources } = await queryLogs(env, { ...q, limit });
    return Response.json({
      events,
      sources: sources.map((s) => ({ id: s.id, name: s.name })),
    });
  }
  if (ctx.path === "/api/analytics" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const sites = await listAnalyticsSites(env.DB);
    const shareRows = await env.DB.prepare("SELECT site_id, token, enabled FROM site_shares").all<{
      site_id: string;
      token: string;
      enabled: number;
    }>();
    const shareBySite = new Map(
      (shareRows.results ?? []).map((r) => [
        r.site_id,
        { on: Boolean(r.enabled), url: `${origin}/share/${r.token}` },
      ]),
    );
    const linked = await env.DB.prepare(
      "SELECT site_id, provider, last_commits FROM deploy_targets WHERE site_id IS NOT NULL",
    ).all<{ site_id: string; provider: string; last_commits: string | null }>();
    type Annotation = {
      day: string;
      kind: "commit" | "deploy" | "mention";
      label: string;
      sub: string;
      url: string | null;
    };
    const annotationsBySite = new Map<string, Annotation[]>();
    const push = (siteId: string, a: Annotation) => {
      annotationsBySite.set(siteId, [...(annotationsBySite.get(siteId) ?? []), a]);
    };
    for (const row of linked.results ?? []) {
      try {
        const arr = JSON.parse(row.last_commits ?? "[]") as Array<Record<string, unknown>>;
        if (!Array.isArray(arr)) continue;
        for (const c of arr) {
          if (!c || typeof c !== "object" || !c.sha) continue;
          push(row.site_id, {
            day: new Date(Number(c.ts) || Date.now()).toISOString().slice(0, 10),
            kind: row.provider === "github" ? "commit" : "deploy",
            label: String(c.sha).slice(0, 7),
            sub: String(c.msg ?? "").slice(0, 120),
            url: typeof c.url === "string" ? c.url : null,
          });
        }
      } catch {
        continue;
      }
    }
    const mentions = await env.DB.prepare(
      "SELECT site_id, source, title, author, url, ts FROM signals ORDER BY ts DESC LIMIT 60",
    ).all<{ site_id: string; source: string; title: string; author: string | null; url: string | null; ts: number }>();
    for (const m of mentions.results ?? []) {
      push(m.site_id, {
        day: new Date(m.ts).toISOString().slice(0, 10),
        kind: "mention",
        label: m.source === "x" ? `@${m.author ?? "x"}` : m.source,
        sub: m.title.slice(0, 140),
        url: m.url,
      });
    }
    return Response.json({
      sites: await Promise.all(
        sites.map(async (site) => {
          const s = await siteStats(env, site, 7);
          return {
            id: site.id,
            name: site.name,
            enabled: site.enabled,
            idMode: site.id_mode,
            totals: s.totals,
            days: s.days,
            topPaths: s.topPaths,
            topRefs: s.topRefs,
            topCountries: s.topCountries,
            annotations: annotationsBySite.get(site.id) ?? [],
            share: shareBySite.get(site.id) ?? { on: false, url: null },
            snippet: `<script defer src="${origin}/a.js" data-site="${site.token}"><\/script>`,
          };
        }),
      ),
    });
  }
  if (ctx.path === "/api/revenue" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const since = Date.now() - 30 * 86400000;
    const [payments, secret, totals, bySource] = await Promise.all([
      env.DB.prepare("SELECT * FROM payments ORDER BY ts DESC LIMIT 20").all(),
      env.DB.prepare("SELECT value FROM settings WHERE key = 'stripe_webhook_secret'").first<{
        value: string;
      }>(),
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(amount_cents) AS cents FROM payments WHERE ts >= ?")
        .bind(since)
        .first<{ n: number; cents: number | null }>(),
      env.DB.prepare(
        `SELECT COALESCE(source_ref, 'direct') AS src, COUNT(*) AS n, SUM(amount_cents) AS cents
         FROM payments WHERE ts >= ? GROUP BY src ORDER BY cents DESC LIMIT 8`,
      )
        .bind(since)
        .all<{ src: string; n: number; cents: number }>(),
    ]);
    const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;
    return Response.json({
      secret: Boolean(secret?.value),
      totals: { n: totals?.n ?? 0, label: money(Number(totals?.cents ?? 0), "USD") },
      bySource: (bySource.results ?? []).map((r) => ({
        src: r.src,
        n: r.n,
        label: money(Number(r.cents), "USD"),
      })),
      payments: (payments.results ?? []).map((p: Record<string, unknown>) => ({
        amount: money(Number(p.amount_cents), String(p.currency)),
        from: p.source_ref ? String(p.source_ref) : "direct",
        detail: `${String(p.source_path ?? "")}${p.customer ? ` · ${String(p.customer)}` : ""}`,
        ts: Number(p.ts),
      })),
    });
  }
  if (ctx.path === "/api/aicrawls" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const sites = await listAnalyticsSites(env.DB);
    return Response.json({
      sites: await Promise.all(
        sites.map(async (site) => ({
          id: site.id,
          name: site.name,
          ...(await crawlSummary(env, site.id)),
          snippet: ingestSnippet(origin, site.token),
        })),
      ),
    });
  }
  if (ctx.path === "/api/signals" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const [watchers, signals, sites] = await Promise.all([
      listWatchers(env.DB),
      listSignals(env.DB),
      listAnalyticsSites(env.DB),
    ]);
    const [x, rid, rsec] = await Promise.all(
      ["signals_x_bearer", "signals_reddit_client_id", "signals_reddit_client_secret"].map((k) =>
        env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(k).first<{ value: string }>(),
      ),
    );
    return Response.json({
      watchers,
      signals,
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
      keys: { x: Boolean(x?.value), redditId: Boolean(rid?.value), redditSecret: Boolean(rsec?.value) },
    });
  }
  if (ctx.path === "/api/goals" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const [goals, sites] = await Promise.all([listGoals(env.DB), listAnalyticsSites(env.DB)]);
    const names = new Map(sites.map((s) => [s.id, s.name]));
    return Response.json({
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
      goals: await Promise.all(
        goals.map(async (g) => {
          const [s7, s30] = await Promise.all([goalStats(env, g, 7), goalStats(env, g, 30)]);
          return {
            id: g.id,
            name: g.name,
            kind: g.kind,
            target: g.target,
            site_name: names.get(g.site_id) ?? "",
            s7: { converted: s7.converted, uniques: s7.uniques, rate: s7.rate_pct },
            s30: { converted: s30.converted, uniques: s30.uniques, rate: s30.rate_pct },
            top: s30.bySource
              .slice(0, 3)
              .map((b) => `${b.ref} (${b.converted})`)
              .join(", "),
          };
        }),
      ),
    });
  }
  if (ctx.path === "/api/widgets" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const sites = await listAnalyticsSites(env.DB);
    return Response.json({
      sites: sites.map((s) => ({ id: s.id, name: s.name, token: s.token })),
    });
  }
  if (ctx.path === "/api/agents" && ctx.method === "GET") {    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const tokens = await env.DB.prepare("SELECT * FROM agent_tokens ORDER BY created_at").all();
    return Response.json({ tokens: tokens.results ?? [] });
  }
  if (ctx.path === "/api/shares" && ctx.method === "GET") {    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const sites = await listAnalyticsSites(env.DB);
    const shares = await env.DB.prepare("SELECT * FROM site_shares").all<{
      site_id: string;
      token: string;
      enabled: number;
    }>();
    const bySite = new Map((shares.results ?? []).map((s) => [s.site_id, s]));
    return Response.json({
      shares: sites.map((site) => {
        const existing = bySite.get(site.id);
        return {
          site_id: site.id,
          site_name: site.name,
          on: Boolean(existing?.enabled),
          url: existing ? `${origin}/share/${existing.token}` : null,
        };
      }),
    });
  }
  if (ctx.path === "/api/settings" && ctx.method === "GET") {    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const settings = await loadSettings(env, [...ALERT_SETTING_KEYS, "last_alert_error"]);
    const listed = await env.BUCKET.list({ prefix: "rollups/" });
    const rollups = listed.objects
      .map((o) => o.key.replace(/^rollups\//, "").replace(/\.json$/, ""))
      .sort()
      .reverse();
    return Response.json({ settings, rollups });
  }
  if (ctx.path === "/api/deploys" && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    return Response.json(await deployOverview(env));
  }
  const apiPage = ctx.path.match(/^\/api\/page\/([\w-]+)$/);
  if (apiPage && ctx.method === "GET") {
    const gate = await gateAdmin(request, env);
    if (gate) return gate;
    const page = await buildAdminPage(env, ctx.origin, apiPage[1]);
    return Response.json(page);
  }

  if (ctx.path === "/health.json" && ctx.method === "GET") {
    return healthJson(env);
  }
  if ((ctx.path === "/health" || ctx.path === "/") && ctx.method === "HEAD") {
    const h = await sumHealth(PLUGINS, env, Date.now());
    return new Response(null, { status: h.down > 0 ? 503 : 200 });
  }
  if (ctx.path === "/health" && ctx.method === "GET") {
    const h = await sumHealth(PLUGINS, env, Date.now());
    return new Response(h.down > 0 ? "down" : "up", {
      status: h.down > 0 ? 503 : 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if ((ctx.path === "/" || ctx.path === "/status") && ctx.method === "GET") {
    return status(env, ctx.origin);
  }
  if (ctx.path === "/login" && ctx.method === "POST") {
    return login(request, env);
  }
  if (ctx.path === "/logout" && ctx.method === "POST") {
    return redirect("/", { "set-cookie": clearCookie(request) });
  }

  if (ctx.path === "/admin" || ctx.path.startsWith("/admin/")) {
    const blocked = await gateAdmin(request, env);
    if (blocked) return blocked;
    if (ctx.path === "/admin" && ctx.method === "GET") {
      return adminOverview(env, ctx.origin, url.searchParams.get("msg"));
    }
    const pluginPage = ctx.path.match(/^\/admin\/p\/([\w-]+)$/);
    if (pluginPage && ctx.method === "GET") {
      if (pluginPage[1] === "settings") {
        return adminSettingsPage(env, ctx.origin, url.searchParams.get("msg"));
      }
      return adminPluginPage(pluginPage[1], env, ctx.origin, url.searchParams.get("msg"));
    }
    if (ctx.path === "/admin/settings" && ctx.method === "POST") {
      return saveSettings(request, env);
    }
    if (ctx.path === "/admin/check" && ctx.method === "POST") {
      const result = await runTick(env);
      return redirect(
        `/admin?msg=${encodeURIComponent(`checked ${result.checked} · jobs ${result.jobs}`)}`,
      );
    }
    if (ctx.path === "/admin/test-alert" && ctx.method === "POST") {
      const result = await sendTestAlert(env);
      if (result.error) {
        return redirect(`/admin?msg=${encodeURIComponent(`test failed: ${result.error}`)}`);
      }
      await clearAlertError(env).catch(() => {});
      return redirect("/admin?msg=test%20alert%20sent");
    }
    const roll = ctx.path.match(/^\/admin\/rollups\/(\d{4}-\d{2}-\d{2})$/);
    if (roll && ctx.method === "GET") {
      const obj = await env.BUCKET.get(`rollups/${roll[1]}.json`);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "application/json" },
      });
    }
    const admined = await dispatch(PLUGINS, "admin", ctx);
    if (admined) return admined;
    if (ctx.path.startsWith("/admin/")) return new Response("not found", { status: 404 });
    return new Response("not found", { status: 404 });
  }

  return new Response("not found", { status: 404 });
}

async function status(env: Env, origin: string): Promise<Response> {
  const now = Date.now();
  const sectionCtx = { env, origin, title: env.APP_NAME };
  const health = await sumHealth(PLUGINS, env, now);
  const overall = overallOf(health);
  const kicker = await firstKicker(PLUGINS, sectionCtx);
  const sections = [
    ...(await collect(PLUGINS, "statusSection", sectionCtx)),
    ...(await collect(PLUGINS, "statusTail", sectionCtx)),
  ];
  let empty = true;
  for (const p of PLUGINS) {
    if (p.occupied && (await p.occupied(sectionCtx))) {
      empty = false;
      break;
    }
  }
  return html(statusPage(env.APP_NAME, overall, kicker, sections, empty));
}

async function adminOverview(env: Env, origin: string, msg: string | null): Promise<Response> {
  return renderAdminPage(env, origin, "overview", msg);
}

async function adminPluginPage(pluginId: string, env: Env, origin: string, msg: string | null): Promise<Response> {
  const match = PLUGINS.find((p) => p.id === pluginId);
  if (!match || !match.adminSection) return new Response("not found", { status: 404 });
  return renderAdminPage(env, origin, pluginId, msg);
}

async function adminSettingsPage(env: Env, origin: string, msg: string | null): Promise<Response> {
  return renderAdminPage(env, origin, "settings", msg);
}

async function buildAdminPage(
  env: Env,
  origin: string,
  activeId: string,
): Promise<{ activeId: string; cards: any[]; content: string; island: string | null; footer: string | null }> {
  const now = Date.now();
  const cards = await collectNavCards(env, now);
  let content: string;
  let island: string | null = null;
  let footer: string | null = null;
  if (activeId === "overview") {
    island = "overview";
    content = overviewCards(cards);
  } else if (activeId === "settings") {
    island = "settings";
    const settings = await loadSettings(env, [...ALERT_SETTING_KEYS, "last_alert_error"]);
    const listed = await env.BUCKET.list({ prefix: "rollups/" });
    const rollups = listed.objects
      .map((o) => o.key.replace(/^rollups\//, "").replace(/\.json$/, ""))
      .sort()
      .reverse();
    content = settingsCard(settings, rollups);
  } else {
    const plugin = PLUGINS.find((p) => p.id === activeId);
    if (!plugin || !plugin.adminSection) content = `<p class="sub">Not found.</p>`;
    else content = await plugin.adminSection({ env, origin, title: env.APP_NAME });
    footer = plugin?.adminFooter ?? null;
    // Islands exist per plugin; the Svelte bundle replaces this div's content on mount.
    if (["ping", "integrations", "heartbeat", "logs", "templates", "settings", "backup", "share", "agents", "widgets", "goals", "signals", "aicrawl", "revenue", "analytics", "explorer"].includes(activeId)) island = activeId;
  }
  return { activeId, cards, content, island, footer };
}

async function renderAdminPage(
  env: Env,
  origin: string,
  activeId: string,
  msg: string | null,
): Promise<Response> {
  const page = await buildAdminPage(env, origin, activeId);
  return html(adminShell({ title: env.APP_NAME, activeId: page.activeId, cards: page.cards, content: page.content, flash: msg ?? undefined, island: page.island }));
}

function overviewCards(cards: Array<{ id: string; label: string; group: string; summary: string; dot: string; href: string }>): string {
  if (cards.length === 0) return `<p class="sub">No modules yet.</p>`;
  return `<div class="cards">` + cards.map((c) =>
    `<a class="pcard" href="${c.href}">
      <div class="dot ${c.dot}" style="width:8px;height:8px;border-radius:50%;background:var(--mute);display:inline-block;margin-right:6px;vertical-align:middle"></div>
      <b style="display:inline">${c.label}</b>
      ${c.summary ? `<div class="sub" style="margin:6px 0 0">${c.summary}</div>` : ""}
    </a>`
  ).join("") + `</div>`;
}

async function collectNavCards(env: Env, now: number): Promise<Array<{ id: string; label: string; group: string; summary: string; dot: string; href: string }>> {
  const sectionCtx = { env, origin: "", title: env.APP_NAME };
  const summaries = new Map<string, string>();
  for (const p of PLUGINS) {
    if (p.summary) {
      try { summaries.set(p.id, await p.summary(sectionCtx) || ""); } catch { summaries.set(p.id, ""); }
    }
  }
  const cards: Array<{ id: string; label: string; group: string; summary: string; dot: string; href: string }> = [];
  for (const p of PLUGINS) {
    if (!p.adminNav) continue;
    // health dot: if the plugin exposes health, sample it
    let dot = "unknown";
    if (p.health) {
      try {
        const h = await p.health(env, now);
        if ((h.down ?? 0) > 0) dot = "down";
        else if ((h.up ?? 0) > 0) dot = "up";
        else dot = "unknown";
      } catch {}
    }
    const nav = p.adminNav;
    cards.push({ id: p.id, label: nav.label, group: nav.group, summary: summaries.get(p.id) ?? "", dot, href: `/admin/p/${p.id}` });
  }
  const hasRevenue = cards.some((c) => c.id === "revenue");
  cards.push({ id: "settings", label: "settings", group: "system", summary: hasRevenue ? "" : "", dot: "unknown", href: "/admin/p/settings" });
  return cards;
}

const SETTING_FORM_KEYS = [
  "webhook_url",
  "telegram_bot_token",
  "telegram_chat_id",
  "resend_api_key",
  "alert_email",
  "alert_from",
];

async function loadSettings(env: Env, keys: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    keys.map(async (key) => {
      out[key] = (await getSetting(env.DB, key)) ?? "";
    }),
  );
  return out;
}

async function saveSettings(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  for (const key of SETTING_FORM_KEYS) {
    const value = String(form.get(key) ?? "").trim();
    if (key === "webhook_url" && value) {
      const parsed = parseHttpUrl(value);
      if (!parsed) return redirect("/admin?msg=bad%20webhook");
      await setSetting(env.DB, key, parsed.toString());
      continue;
    }
    if (value) {
      await setSetting(env.DB, key, value.slice(0, 200));
    } else {
      await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
    }
  }
  return redirect("/admin?msg=saved");
}

async function login(request: Request, env: Env): Promise<Response> {
  const expected = await resolveAdminToken(env);
  if (!expected) {
    const minted = await mintAdminToken(env);
    if (minted.created) return html(revealPage(env.APP_NAME, minted.token));
  }
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const want = (await resolveAdminToken(env)) ?? "";
  if (!want || !(await safeEqual(token, want))) {
    return html(loginPage(env.APP_NAME, "wrong token"), 401);
  }
  return redirect("/admin", { "set-cookie": setCookie(request, token) });
}

async function gateAdmin(request: Request, env: Env): Promise<Response | null> {
  let expected = await resolveAdminToken(env);
  if (!expected) {
    const minted = await mintAdminToken(env);
    if (minted.created) return html(revealPage(env.APP_NAME, minted.token));
    expected = minted.token;
  }
  if (!(await isAdmin(request, expected))) {
    return html(loginPage(env.APP_NAME), 401);
  }
  return null;
}

async function healthJson(env: Env): Promise<Response> {
  const h = await sumHealth(PLUGINS, env, Date.now());
  return Response.json({
    ok: h.down === 0,
    up: h.up,
    down: h.down,
    unknown: h.unknown,
    checked: ago(h.last ?? null),
  });
}
