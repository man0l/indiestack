import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { MAX_BACKUP_BYTES, backupFilename, buildBackup, parseBackup, restoreBackup } from "./index";

export const backup: Plugin = {
  id: "backup",
  adminFooter: "Backup JSON includes tokens. Raw analytics hits are 30-day ephemeral and not exported. Restore upserts by id and does not delete extra rows.",
  adminSection(_ctx: SectionCtx) {
    return `<h2>backup</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 12px">Download monitors, jobs, log sources, deploy targets, agent tokens, analytics sites, settings, checks, rollups, and recent log tails. Restore upserts those rows. Extra rows you added after the file are kept. Settings in the file overwrite, including the admin token.</p>
      <div class="actions" style="justify-content:flex-start">
        <a class="btn" href="/admin/backup.json">download JSON</a>
      </div>
      <form method="post" action="/admin/backup" enctype="multipart/form-data" style="margin-top:16px">
        <label>restore from JSON
          <input type="file" name="file" accept="application/json,.json" required/>
        </label>
        <button type="submit">restore</button>
      </form>
    </div>`;
  },
  async admin(ctx: RouteCtx) {
    if (ctx.path === "/admin/backup.json" && ctx.method === "GET") {
      const body = await buildBackup(ctx.env);
      const name = backupFilename(body.exported_at);
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
        },
      });
    }
    if (ctx.path === "/admin/backup" && ctx.method === "POST") {
      const form = await ctx.request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return redirect("/admin?msg=need%20a%20backup%20file");
      }
      if (file.size > MAX_BACKUP_BYTES) {
        return redirect("/admin?msg=backup%20file%20too%20large");
      }
      let parsed;
      try {
        parsed = parseBackup(await file.text());
      } catch (err) {
        return redirect(`/admin?msg=${encodeURIComponent(truncErr(err))}`);
      }
      try {
        const stats = await restoreBackup(ctx.env, parsed);
        return redirect(
          `/admin?msg=${encodeURIComponent(
            `restored ${stats.monitors} monitors · ${stats.jobs} jobs · ${stats.log_sources} logs · ${stats.deploy_targets} deploys · ${stats.agent_tokens} agents · ${stats.analytics_sites} sites · ${stats.checks} checks`,
          )}`,
        );
      } catch (err) {
        return redirect(`/admin?msg=${encodeURIComponent(truncErr(err))}`);
      }
    }
    return null;
  },
};

function truncErr(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.slice(0, 80);
}
