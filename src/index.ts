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
      if (obj) return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/javascript", "cache-control": "public, max-age=31536000, immutable" } });
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
  if (!match || !match.adminNav) return new Response("not found", { status: 404 });
  return renderAdminPage(env, origin, pluginId, msg);
}

async function adminSettingsPage(env: Env, origin: string, msg: string | null): Promise<Response> {
  return renderAdminPage(env, origin, "settings", msg);
}

async function renderAdminPage(
  env: Env,
  origin: string,
  activeId: string,
  msg: string | null,
): Promise<Response> {
  const now = Date.now();
  const cards = await collectNavCards(env, now);
  let content: string;
  if (activeId === "overview") {
    content = overviewCards(cards);
  } else if (activeId === "settings") {
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
    if (plugin?.adminFooter) content += `<footer>${plugin.adminFooter}</footer>`;
  }
  if (activeId !== "overview" && activeId !== "settings") {
    // shared settings are still reachable from the system page, not inside each plugin's own content
  }
  return html(adminShell({ title: env.APP_NAME, activeId, cards, content, flash: msg ?? undefined }));
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
