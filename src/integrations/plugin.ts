import { redirect, toggleEnabled } from "../kernel/http";
import type { Health, Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { getSetting } from "../kernel/db";
import { clamp, trunc } from "../kernel/util";
import {
  MAX_DEPLOY_TARGETS,
  type DeployTarget,
  checkTargetNow,
  insertDeployTarget,
  insertDeployTargetsBulk,
  listDeployTargets,
  listUserRepos,
  connectGithub,
  connectVercel,
  resolveVercelProject,
  scanDeploys,
  syncGithubLogs,
  syncVercelLogs,
} from "./index";
import { adminDeploys, statusDeploys } from "./ui";

async function listTargets(db: D1Database): Promise<DeployTarget[]> {
  const { results } = await db
    .prepare("SELECT * FROM deploy_targets ORDER BY created_at ASC")
    .all<DeployTarget>();
  return results ?? [];
}

export const integrations: Plugin = {
  id: "integrations",
  adminNav: { group: "monitoring", label: "deploys" },
  adminFooter: "GitHub targets track main-branch commits; Vercel targets track production deploys. A target alerts when its repo or project stops resolving. Tokens live in your settings, never leave the Worker.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
      n: number;
    }>();
    if (!n?.n) return "";
    return `${n.n}/${MAX_DEPLOY_TARGETS} deploys`;
  },
  async adminSection(ctx: SectionCtx) {
    const targets = await listTargets(ctx.env.DB);
    const users = await ctx.env.DB.batch([
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'github_user'"),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'vercel_user'"),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'cloudflare_user'"),
    ]);
    const githubUser = (users[0]?.results ?? [])[0] as { value: string } | undefined;
    const vercelUser = (users[1]?.results ?? [])[0] as { value: string } | undefined;
    const cloudflareUser = (users[2]?.results ?? [])[0] as { value: string } | undefined;
    return adminDeploys(
      targets,
      { connected: githubUser?.value != null, who: githubUser?.value ?? null },
      { connected: vercelUser?.value != null, who: vercelUser?.value ?? null },
      { connected: cloudflareUser?.value != null, who: cloudflareUser?.value ?? null },
    );
  },
  async occupied(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
      n: number;
    }>();
    return (n?.n ?? 0) > 0;
  },
  async statusSection(ctx: SectionCtx) {
    return statusDeploys(await listTargets(ctx.env.DB));
  },
  async health(env, now): Promise<Health> {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown,
         MAX(last_check_at) AS last
       FROM deploy_targets
       WHERE enabled = 1 AND (mute_until IS NULL OR mute_until <= ?)`,
    )
      .bind(now)
      .first<{ up: number; down: number; unknown: number; last: number | null }>();
    return {
      up: Number(row?.up) || 0,
      down: Number(row?.down) || 0,
      unknown: Number(row?.unknown) || 0,
      last: row?.last ?? null,
    };
  },
  async tick(env, now) {
    const r = await scanDeploys(env, now);
    const synced = await syncVercelLogs(env, now).catch(() => 0);
    const ghSynced = await syncGithubLogs(env, now).catch(() => 0);
    const { syncCloudflareLogs } = await import("../cloudflare/index");
    const cfSynced = await syncCloudflareLogs(env, now).catch(() => 0);
    return { deploys: r.scanned, alerts: r.alerts, vercel_logs: synced, github_logs: ghSynced, cf_logs: cfSynced };
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
    const jsonOk = (msg: string) =>
      wantsJson ? Response.json({ ok: true, msg }) : redirect(`/admin?msg=${encodeURIComponent(msg)}`);
    const jsonErr = (msg: string) =>
      wantsJson ? Response.json({ ok: false, error: msg }, { status: 400 }) : redirect(`/admin?msg=${encodeURIComponent(msg)}`);

    const reposList = path === "/admin/deploys/repos" && method === "GET";
    if (reposList) {
      const token = await getSetting(env.DB, "github_token");
      if (!token) return Response.json({ repos: [], error: "connect github first" }, { status: 400 });
      try {
        return Response.json({ repos: await listUserRepos(token) });
      } catch (err) {
        return Response.json({ repos: [], error: trunc(String(err), 120) }, { status: 502 });
      }
    }

    const bulk = path === "/admin/deploys/targets/bulk" && method === "POST";
    if (bulk) {
      const body = (await request.json().catch(() => null)) as
        | { repos?: string[]; interval_min?: number }
        | null;
      const repos = [...new Set((body?.repos ?? []).map((r) => String(r).trim()).filter(Boolean))];
      if (!repos.length) return jsonErr("no repos selected");
      const token = await getSetting(env.DB, "github_token");
      if (!token) return jsonErr("connect github first");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{ n: number }>();
      const existing = new Set(
        (await listDeployTargets(env)).filter((t) => t.provider === "github").map((t) => t.repo),
      );
      const fresh = repos.filter((r) => !existing.has(r));
      if (!fresh.length) return jsonErr("already watching all selected repos");
      const room = MAX_DEPLOY_TARGETS - (count?.n ?? 0);
      if (room <= 0) return jsonErr("max 10 deploy targets");
      const toAdd = fresh.slice(0, Math.min(room, fresh.length));
      const interval = clamp(Number(body?.interval_min ?? 5), 5, 60);
      await insertDeployTargetsBulk(
        env,
        toAdd.map((repo) => ({
          id: crypto.randomUUID(),
          provider: "github" as const,
          name: repo.split("/")[1] ?? repo,
          repo,
          project: null,
          team: null,
          interval_min: interval,
          enabled: 1,
          status: "unknown" as const,
          last_check_at: null,
          last_detail: null,
          last_error: null,
          consecutive: 0,
          mute_until: null,
          nag_min: 0,
          last_nag_at: null,
          created_at: Date.now(),
          site_id: null,
          last_commits: null,
          account: null,
        })),
      );
      const skipped = repos.length - toAdd.length;
      return jsonOk(
        `watching ${toAdd.length} repo(s)${skipped ? ` · ${skipped} skipped (already watched or no room)` : ""}`,
      );
    }

        const cfbulk = path === "/admin/deploys/targets/cfbulk" && method === "POST";
    if (cfbulk) {
      const body = (await request.json().catch(() => null)) as
        | { account?: unknown; scripts?: unknown; interval_min?: unknown }
        | null;
      const account = typeof body?.account === "string" ? body.account.trim() : "";
      const names = [
        ...new Set(
          (Array.isArray(body?.scripts) ? body.scripts : [])
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (!account) return jsonErr("cloudflare account required");
      if (!names.length) return jsonErr("no workers selected");
      const token = await getSetting(env.DB, "cloudflare_token");
      if (!token) return jsonErr("connect cloudflare first");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
        n: number;
      }>();
      const existing = new Set(
        (await listDeployTargets(env))
          .filter((t) => t.provider === "cloudflare")
          .map((t) => `${t.account}::${t.project}`),
      );
      const fresh = names.filter((n) => !existing.has(`${account}::${n}`));
      if (!fresh.length) return jsonErr("already watching all selected workers");
      const room = MAX_DEPLOY_TARGETS - (count?.n ?? 0);
      if (room <= 0) return jsonErr("max 10 deploy targets");
      const toAdd = fresh.slice(0, Math.min(room, fresh.length));
      const interval = clamp(Number(body?.interval_min ?? 5), 5, 60);
      await insertDeployTargetsBulk(
        env,
        toAdd.map((name) => ({
          id: crypto.randomUUID(),
          provider: "cloudflare" as const,
          name: name.slice(0, 40),
          repo: null,
          project: name,
          team: null,
          account,
          interval_min: interval,
          enabled: 1,
          status: "unknown" as const,
          last_check_at: null,
          last_detail: null,
          last_error: null,
          consecutive: 0,
          mute_until: null,
          nag_min: 0,
          last_nag_at: null,
          created_at: Date.now(),
          site_id: null,
          last_commits: null,
        })),
      );
      const skipped = names.length - toAdd.length;
      return jsonOk(
        `watching ${toAdd.length} worker(s)${skipped ? ` · ${skipped} skipped (already watched or no room)` : ""}`,
      );
    }

    const check = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/check$/);    if (check && method === "POST") {
      const t = await checkTargetNow(env, check[1]);
      if (!t && wantsJson) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      if (wantsJson) return Response.json({ ok: true, target: t });
      return redirect("/admin?msg=checked");
    }

    const connect = path.match(/^\/admin\/deploys\/(github|vercel|cloudflare)\/connect$/);
    if (connect && method === "POST") {
      const form = await request.formData();
      const token = String(form.get("token") ?? "").trim();
      if (!token) return redirect("/admin?msg=token%20required");
      const provider = connect[1];
      try {
        const { connectCloudflare, listAccounts } = provider === "cloudflare"
          ? await import("../cloudflare/index")
          : { connectCloudflare: null, listAccounts: null };
        const who =
          provider === "github"
            ? await connectGithub(token)
            : provider === "vercel"
              ? await connectVercel(token)
              : await connectCloudflare!(token);
        const stmts = [
          env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).bind(`${provider}_token`, token),
          env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).bind(`${provider}_user`, who),
        ];
        if (provider === "cloudflare" && listAccounts) {
          // Remember the first account so the worker picker/logs work with no typing.
          const accts = await listAccounts(token).catch(() => [] as Array<{ id: string }>);
          if (accts[0]) {
            stmts.push(
              env.DB.prepare(
                "INSERT INTO settings (key, value) VALUES ('cf_account_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
              ).bind(accts[0].id),
            );
          }
        }
        await env.DB.batch(stmts);
        return jsonOk(`connected as ${who}`);
      } catch (err) {
        return jsonErr(`token rejected: ${String(err).slice(0, 80)}`);
      }
    }

    const disconnect = path.match(/^\/admin\/deploys\/(github|vercel|cloudflare)\/disconnect$/);
    if (disconnect && method === "POST") {
      const p = disconnect[1];
      // Opt-in from the disconnect confirmation: also pause this provider's
      // targets so they stop alerting instead of sitting there orphaned.
      let disable = false;
      const ct = request.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await request.json().catch(() => null)) as { disable_targets?: unknown } | null;
        disable = body?.disable_targets === true || body?.disable_targets === 1 || body?.disable_targets === "1";
      } else if (ct.includes("form-")) {
        const form = await request.formData().catch(() => null);
        const v = form?.get("disable_targets");
        disable = v === "1" || v === "on" || v === "true";
      }
      let disabled = 0;
      if (disable) {
        const r = await env.DB.prepare(
          "UPDATE deploy_targets SET enabled = 0 WHERE provider = ? AND enabled = 1",
        ).bind(p).run();
        disabled = r.meta?.changes ?? 0;
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`${p}_token`),
        env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`${p}_user`),
      ]);
      return jsonOk(disabled ? `disconnected · disabled ${disabled} ${p} target(s)` : "disconnected");
    }

    if (path === "/admin/deploys/targets" && method === "POST") {
      const form = await request.formData();
      const rawProvider = String(form.get("provider") ?? "");
      const provider =
        rawProvider === "vercel" ? "vercel" : rawProvider === "cloudflare" ? "cloudflare" : "github";
      const repo = String(form.get("repo") ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
      const projectRaw = String(form.get("project") ?? "").trim();
      const team = String(form.get("team") ?? "").trim();
      const account = String(form.get("account") ?? "").trim();
      if (provider === "github" ? !repo : !projectRaw) {
        return jsonErr("repo or project required");
      }
      if (provider === "cloudflare" && !account) {
        return jsonErr("cloudflare account id required");
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
        n: number;
      }>();
      if ((count?.n ?? 0) >= MAX_DEPLOY_TARGETS) {
        return jsonErr("max 10 deploy targets");
      }
      // Vercel: accept a project slug or id, store the canonical id so the
      // deployments query always matches. Cloudflare: the worker script name is the key.
      let project: string | null = null;
      let resolvedName = "";
      if (provider === "vercel") {
        const token = await getSetting(env.DB, "vercel_token");
        if (!token) return jsonErr("connect vercel first");
        const resolved = await resolveVercelProject(token, team || null, projectRaw);
        if (!resolved) {
          return jsonErr("project not found (check name or team)");
        }
        project = resolved.id;
        resolvedName = resolved.name;
      } else if (provider === "cloudflare") {
        const token = await getSetting(env.DB, "cloudflare_token");
        if (!token) return jsonErr("connect cloudflare first");
        project = projectRaw;
      }
      const name =
        String(form.get("name") ?? "").trim().slice(0, 40) ||
        (provider === "github" ? repo : resolvedName || projectRaw).slice(0, 40);
      const target: DeployTarget = {
        id: crypto.randomUUID(),
        provider,
        name,
        repo: provider === "github" ? repo : null,
        project,
        team: provider === "vercel" ? team || null : null,
        account: provider === "cloudflare" ? account : null,
        interval_min: clamp(Number(form.get("interval_min") ?? 5), 5, 60),
        enabled: 1,
        status: "unknown",
        last_check_at: null,
        last_detail: null,
        last_error: null,
        consecutive: 0,
        mute_until: null,
        nag_min: clamp(Number(form.get("nag_min") ?? 0), 0, 1440),
        last_nag_at: null,
        created_at: Date.now(),
        site_id: null,
        last_commits: null,
      };
      await insertDeployTarget(env, target);
      return jsonOk(`added ${target.name} — first check done`);
    }

    const tog = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "deploy_targets", tog[1]);
      return jsonOk("toggled");
    }

    if (path === "/admin/cloudflare/workers" && method === "POST") {
      const { setCfWorkers } = await import("../cloudflare/index");
      const body = (await request.json().catch(() => null)) as { workers?: unknown } | null;
      const list = Array.isArray(body?.workers) ? body.workers : [];
      const saved = await setCfWorkers(
        env,
        list.filter((w): w is string => typeof w === "string"),
      );
      return jsonOk(saved.length ? `watching logs for ${saved.length} worker(s)` : "worker logs off");
    }

    if (path === "/admin/cloudflare/mapping" && method === "POST") {
      const { setCfMapping } = await import("../cloudflare/index");
      const body = (await request.json().catch(() => null)) as { mappings?: unknown } | null;
      const raw = body?.mappings && typeof body.mappings === "object" ? body.mappings : {};
      const saved = await setCfMapping(
        env,
        raw as Record<string, string | { source: string; quiet: boolean }>,
      );
      const n = Object.keys(saved).length;
      return jsonOk(n ? `${n} worker(s) mapped to log sources` : "mapping cleared");
    }

    if (path === "/admin/vercel/mapping" && method === "POST") {
      const { setVercelMapping } = await import("./index");
      const body = (await request.json().catch(() => null)) as { mappings?: unknown } | null;
      const raw = body?.mappings && typeof body.mappings === "object" ? body.mappings : {};
      const saved = await setVercelMapping(env, raw as Record<string, string>);
      const n = Object.keys(saved).length;
      return jsonOk(n ? `${n} project(s) mapped to log sources` : "mapping cleared");
    }

    if (path === "/admin/github/mapping" && method === "POST") {
      const { setGithubMapping } = await import("./index");
      const body = (await request.json().catch(() => null)) as { mappings?: unknown } | null;
      const raw = body?.mappings && typeof body.mappings === "object" ? body.mappings : {};
      const saved = await setGithubMapping(env, raw as Record<string, string>);
      const n = Object.keys(saved).length;
      return jsonOk(n ? `${n} repo(s) mapped to log sources` : "mapping cleared");
    }

    const site = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/site$/);
    if (site && method === "POST") {
      let siteId: string | null = null;
      const ct = request.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await request.json().catch(() => null)) as { site_id?: unknown } | null;
        const v = typeof body?.site_id === "string" ? body.site_id.trim() : "";
        siteId = v || null;
      } else {
        const form = await request.formData();
        const v = String(form.get("site_id") ?? "").trim();
        siteId = v || null;
      }
      if (siteId) {
        const ok = await env.DB.prepare("SELECT id FROM analytics_sites WHERE id = ?")
          .bind(siteId)
          .first<{ id: string }>();
        if (!ok) return jsonErr("unknown analytics site");
      }
      await env.DB.prepare("UPDATE deploy_targets SET site_id = ? WHERE id = ?")
        .bind(siteId, site[1])
        .run();
      return jsonOk(siteId ? "linked to analytics site" : "unlinked");
    }

    const del = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.prepare("DELETE FROM deploy_targets WHERE id = ?").bind(del[1]).run();
      return jsonOk("removed");
    }

    return null;
  },
};
