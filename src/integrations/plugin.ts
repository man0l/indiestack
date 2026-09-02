import { redirect, toggleEnabled } from "../kernel/http";
import type { Health, Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { getSetting } from "../kernel/db";
import { clamp } from "../kernel/util";
import {
  MAX_DEPLOY_TARGETS,
  type DeployTarget,
  connectGithub,
  connectVercel,
  insertDeployTarget,
  resolveVercelProject,
  scanDeploys,
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
  adminFooter: "Deploys alert on the first failed production deploy. Tokens live in your settings, never leave the Worker.",
  async summary(ctx: SectionCtx) {
    const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
      n: number;
    }>();
    if (!n?.n) return "";
    return `${n.n}/${MAX_DEPLOY_TARGETS} deploys`;
  },
  async adminSection(ctx: SectionCtx) {
    const [targets, githubUser, vercelUser] = await Promise.all([
      listTargets(ctx.env.DB),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'github_user'")
        .first<{ value: string }>(),
      ctx.env.DB.prepare("SELECT value FROM settings WHERE key = 'vercel_user'")
        .first<{ value: string }>(),
    ]);
    return adminDeploys(
      targets,
      { connected: githubUser?.value != null, who: githubUser?.value ?? null },
      { connected: vercelUser?.value != null, who: vercelUser?.value ?? null },
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
    return { deploys: r.scanned, alerts: r.alerts };
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;

    const connect = path.match(/^\/admin\/deploys\/(github|vercel)\/connect$/);
    if (connect && method === "POST") {
      const form = await request.formData();
      const token = String(form.get("token") ?? "").trim();
      if (!token) return redirect("/admin?msg=token%20required");
      const provider = connect[1];
      try {
        const who = provider === "github" ? await connectGithub(token) : await connectVercel(token);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).bind(`${provider}_token`, token),
          env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).bind(`${provider}_user`, who),
        ]);
        return redirect(`/admin?msg=${encodeURIComponent(`connected as ${who}`)}`);
      } catch (err) {
        return redirect(
          `/admin?msg=${encodeURIComponent(`token rejected: ${String(err).slice(0, 80)}`)}`,
        );
      }
    }

    const disconnect = path.match(/^\/admin\/deploys\/(github|vercel)\/disconnect$/);
    if (disconnect && method === "POST") {
      const p = disconnect[1];
      await env.DB.batch([
        env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`${p}_token`),
        env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`${p}_user`),
      ]);
      return redirect("/admin?msg=disconnected");
    }

    if (path === "/admin/deploys/targets" && method === "POST") {
      const form = await request.formData();
      const provider = String(form.get("provider") ?? "") === "vercel" ? "vercel" : "github";
      const repo = String(form.get("repo") ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
      const projectRaw = String(form.get("project") ?? "").trim();
      const team = String(form.get("team") ?? "").trim();
      if (provider === "github" ? !repo : !projectRaw) {
        return redirect("/admin?msg=repo%20or%20project%20required");
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_targets").first<{
        n: number;
      }>();
      if ((count?.n ?? 0) >= MAX_DEPLOY_TARGETS) {
        return redirect("/admin?msg=max%2010%20deploy%20targets");
      }
      // Vercel: accept a project slug or id, store the canonical id so the
      // deployments query always matches.
      let project: string | null = null;
      let resolvedName = "";
      if (provider === "vercel") {
        const token = await getSetting(env.DB, "vercel_token");
        if (!token) return redirect("/admin?msg=connect%20vercel%20first");
        const resolved = await resolveVercelProject(token, team || null, projectRaw);
        if (!resolved) {
          return redirect("/admin?msg=project%20not%20found%20(check%20name%20or%20team)");
        }
        project = resolved.id;
        resolvedName = resolved.name;
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
      };
      await insertDeployTarget(env, target);
      return redirect("/admin?msg=deploy%20target%20added");
    }

    const tog = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "deploy_targets", tog[1]);
      return redirect("/admin?msg=toggled");
    }

    const del = path.match(/^\/admin\/deploys\/targets\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.prepare("DELETE FROM deploy_targets WHERE id = ?").bind(del[1]).run();
      return redirect("/admin?msg=removed");
    }

    return null;
  },
};
