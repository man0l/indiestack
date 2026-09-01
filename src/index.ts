import {
  clearCookie,
  isAdmin,
  mintAdminToken,
  resolveAdminToken,
  safeEqual,
  setCookie,
} from "./kernel/auth";
import { PLUGINS } from "./kernel/catalog";
import { getSetting, setSetting } from "./kernel/db";
import { redirect } from "./kernel/http";
import { collect, dispatch, firstKicker, sumHealth } from "./kernel/plugin";
import { runTick } from "./kernel/tick";
import { parseHttpUrl } from "./kernel/util";
import { adminPage, ago, html, loginPage, overallOf, revealPage, statusPage } from "./ui";

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
      return admin(env, ctx.origin, url.searchParams.get("msg"));
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

async function admin(env: Env, origin: string, msg: string | null): Promise<Response> {
  const sectionCtx = { env, origin, title: env.APP_NAME };
  const sections = await collect(PLUGINS, "adminSection", sectionCtx);
  const summaries = await collect(PLUGINS, "summary", sectionCtx);
  const webhook = (await getSetting(env.DB, "webhook_url")) ?? "";
  const listed = await env.BUCKET.list({ prefix: "rollups/" });
  const rollups = listed.objects
    .map((o) => o.key.replace(/^rollups\//, "").replace(/\.json$/, ""))
    .sort()
    .reverse();
  const footers = [
    ...PLUGINS.map((p) => p.adminFooter).filter((s): s is string => Boolean(s)),
    "Mute times are UTC.",
  ];
  return html(
    adminPage(env.APP_NAME, sections, summaries, webhook, rollups, footers, msg ?? undefined),
  );
}

async function saveSettings(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const webhook = String(form.get("webhook_url") ?? "").trim();
  if (webhook) {
    const parsed = parseHttpUrl(webhook);
    if (!parsed) return redirect("/admin?msg=bad%20webhook");
    await setSetting(env.DB, "webhook_url", parsed.toString());
  } else {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind("webhook_url").run();
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
