import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { backupFilename, buildBackup } from "./index";

export const backup: Plugin = {
  id: "backup",
  adminFooter: "Backup is a JSON download. It includes tokens — keep the file private.",
  adminSection(_ctx: SectionCtx) {
    return `<h2>backup</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 12px">Download monitors, jobs, log sources, settings, last-24h checks, daily rollups, and recent log tails. Nothing is deleted.</p>
      <a class="btn" href="/admin/backup.json">download JSON</a>
    </div>`;
  },
  async admin(ctx: RouteCtx) {
    if (ctx.path !== "/admin/backup.json" || ctx.method !== "GET") return null;
    const body = await buildBackup(ctx.env);
    const name = backupFilename(body.exported_at);
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  },
};
