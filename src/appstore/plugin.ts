import { getSetting } from "../kernel/db";
import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx, TickStats } from "../kernel/plugin";
import { listAnalyticsSites } from "../analytics/index";
import { esc, ago } from "../ui";
import {
  MAX_APPS,
  SETTING_KEYS,
  dailyFor,
  encryptionOn,
  isoDay,
  listAppRows,
  listApps,
  loadCreds,
  normalizeP8,
  probeCreds,
  saveCreds,
  syncStep,
} from "./index";

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

function reply(request: Request, ok: boolean, text: string, extra?: Record<string, unknown>): Response {
  if (wantsJson(request)) {
    return Response.json(ok ? { ok, msg: text, ...extra } : { ok, error: text }, { status: ok ? 200 : 400 });
  }
  return redirect(`/admin/p/appstore?msg=${encodeURIComponent(text)}`);
}

async function pageData(env: Env) {
  const [keyId, apps, sites] = [
    await getSetting(env.DB, "appstore_key_id"),
    await listAppRows(env.DB),
    await listAnalyticsSites(env.DB),
  ];
  const since30 = isoDay(Date.now() - 30 * 86400000);
  const counts = await env.DB.prepare(
    "SELECT app_id, state, COUNT(*) AS n FROM appstore_instances GROUP BY app_id, state",
  ).all<{ app_id: string; state: string; n: number }>();
  const out = [];
  for (const a of apps) {
    const days = await dailyFor(env.DB, [a.id], since30);
    const sum = (k: "impressions" | "searchImpressions" | "downloads" | "searchDownloads") =>
      days.reduce((n, d) => n + d[k], 0);
    const c = (state: string) =>
      Number((counts.results ?? []).find((r) => r.app_id === a.id && r.state === state)?.n ?? 0);
    out.push({
      id: a.id,
      appleId: a.apple_id,
      name: a.name,
      siteId: a.site_id,
      status: a.status,
      lastSyncAt: a.last_sync_at,
      lastDiscoverAt: a.last_discover_at,
      lastError: a.last_error,
      instances: { queued: c("queued"), done: c("done"), failed: c("failed") },
      totals30: {
        impressions: sum("impressions"),
        searchImpressions: sum("searchImpressions"),
        downloads: sum("downloads"),
        searchDownloads: sum("searchDownloads"),
      },
      lastDay: days.at(-1)?.day ?? null,
      days,
    });
  }
  return {
    connected: keyId != null,
    keyId,
    encrypted: encryptionOn(env),
    maxApps: MAX_APPS,
    apps: out,
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
  };
}

export const appstore: Plugin = {
  id: "appstore",
  deps: ["analytics"],
  adminNav: { group: "growth", label: "app store" },
  adminFooter:
    "App Store Connect Analytics Reports: impressions and downloads, daily, ~2–3 days behind Apple. Your key stays in your D1 (sealed with APPSTORE_ENC_KEY when that Worker secret is set) and only talks to api.appstoreconnect.apple.com.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM appstore_apps").first<{ n: number }>();
    return n?.n ? `${n.n}/${MAX_APPS} apps` : "";
  },
  async adminSection(ctx: SectionCtx) {
    const d = await pageData(ctx.env);
    const rows = d.apps
      .map(
        (a) => `<div class="row">
          <div class="dot ${a.status === "ready" ? "up" : a.status === "error" ? "down" : "unknown"}"></div>
          <div>
            <div class="name">${esc(a.name)}</div>
            <div class="url">30 days: ${a.totals30.searchImpressions} search impressions · ${a.totals30.downloads} downloads${
              a.lastSyncAt ? ` · synced ${esc(ago(a.lastSyncAt))}` : " · waiting for Apple"
            }${a.lastError ? ` · ${esc(a.lastError)}` : ""}</div>
          </div>
          <div class="meta"></div>
        </div>`,
      )
      .join("");
    return `<h2>app store</h2>
    <p class="sub">${d.connected ? `Connected with key ${esc(d.keyId ?? "")}.` : "Not connected. Add an App Store Connect API key (Admin role) below."}</p>
    <div class="list">${rows || `<p class="sub">No apps tracked yet.</p>`}</div>`;
  },
  async occupied(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM appstore_apps").first<{ n: number }>();
    return (n?.n ?? 0) > 0;
  },
  async tick(env, now): Promise<TickStats> {
    // Throttled inside: discovery every 6h per app, ≤2 instance downloads per tick.
    const r = await syncStep(env, now).catch((e) => {
      console.error("[appstore] sync failed", String(e));
      return { queued: 0, processed: 0 };
    });
    return r.processed ? { appstore: r.processed } : {};
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;

    if (path === "/admin/appstore/data" && method === "GET") {
      return Response.json(await pageData(env));
    }

    if (path === "/admin/appstore/apps" && method === "GET") {
      try {
        const creds = await loadCreds(env);
        if (!creds) return Response.json({ ok: false, error: "connect a key first" }, { status: 400 });
        return Response.json({ ok: true, apps: await listApps(creds) });
      } catch (e) {
        return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 502 });
      }
    }

    if (method !== "POST") return null;

    if (path === "/admin/appstore/connect") {
      const form = await request.formData();
      const issuerId = String(form.get("issuer_id") ?? "").trim();
      const keyId = String(form.get("key_id") ?? "").trim().toUpperCase();
      const file = form.get("p8_file");
      let rawP8 = String(form.get("p8") ?? "");
      if (!rawP8.trim() && file && typeof file !== "string") rawP8 = await file.text();
      const p8 = normalizeP8(rawP8);
      if (!/^[0-9a-f-]{36}$/i.test(issuerId)) return reply(request, false, "issuer id should be a UUID");
      if (!/^[A-Z0-9]{8,12}$/.test(keyId)) return reply(request, false, "key id looks wrong (10 characters)");
      if (!p8) return reply(request, false, "paste the .p8 private key (or pick the file)");
      const creds = { issuerId, keyId, p8 };
      const problem = await probeCreds(creds);
      if (problem) return reply(request, false, problem);
      await saveCreds(env, creds);
      return reply(request, true, "App Store Connect key connected — pick an app");
    }

    if (path === "/admin/appstore/disconnect") {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM settings WHERE key IN (${SETTING_KEYS.map(() => "?").join(", ")})`).bind(...SETTING_KEYS),
        env.DB.prepare("DELETE FROM appstore_daily"),
        env.DB.prepare("DELETE FROM appstore_instances"),
        env.DB.prepare("DELETE FROM appstore_apps"),
      ]);
      return reply(request, true, "disconnected — key and App Store data removed");
    }

    if (path === "/admin/appstore/app") {
      const form = await request.formData();
      const appleId = String(form.get("apple_id") ?? "").trim();
      const name = String(form.get("name") ?? "").trim().slice(0, 80) || appleId;
      const siteId = String(form.get("site_id") ?? "").trim() || null;
      if (!/^\d{5,15}$/.test(appleId)) return reply(request, false, "pick an app");
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM appstore_apps").first<{ n: number }>();
      if ((n?.n ?? 0) >= MAX_APPS) return reply(request, false, `max ${MAX_APPS} apps`);
      const id = crypto.randomUUID();
      const res = await env.DB.prepare(
        "INSERT OR IGNORE INTO appstore_apps (id, apple_id, name, site_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      )
        .bind(id, appleId, name, siteId, Date.now())
        .run();
      if (!res.meta.changes) return reply(request, false, "that app is already tracked");
      // Create the report requests now so Apple's 24–48 h clock starts immediately.
      await syncStep(env, Date.now(), true).catch(() => {});
      const row = await env.DB.prepare("SELECT status, last_error FROM appstore_apps WHERE id = ?")
        .bind(id)
        .first<{ status: string; last_error: string | null }>();
      if (row?.status === "error") return reply(request, false, `app added, but: ${row.last_error}`);
      return reply(request, true, "app added — Apple delivers the first reports within 24–48 h");
    }

    const link = path.match(/^\/admin\/appstore\/app\/([^/]+)\/link$/);
    if (link) {
      const form = await request.formData();
      const siteId = String(form.get("site_id") ?? "").trim() || null;
      await env.DB.prepare("UPDATE appstore_apps SET site_id = ? WHERE id = ?").bind(siteId, link[1]).run();
      return reply(request, true, siteId ? "linked — numbers show on that site's analytics chart" : "unlinked");
    }

    const del = path.match(/^\/admin\/appstore\/app\/([^/]+)\/delete$/);
    if (del) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM appstore_daily WHERE app_id = ?").bind(del[1]),
        env.DB.prepare("DELETE FROM appstore_instances WHERE app_id = ?").bind(del[1]),
        env.DB.prepare("DELETE FROM appstore_apps WHERE id = ?").bind(del[1]),
      ]);
      return reply(request, true, "app removed");
    }

    if (path === "/admin/appstore/sync") {
      const r = await syncStep(env, Date.now(), true);
      return reply(
        request,
        true,
        `sync: ${r.queued} new report day(s) queued, ${r.processed} downloaded${r.queued > r.processed ? " — the rest trickle in each minute" : ""}`,
      );
    }
    return null;
  },
};
