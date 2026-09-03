import { redirect } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { MAX_MONITORS } from "../kernel/types";
import { insertMonitor } from "../ping/plugin";
import { esc } from "../ui";
import { applyTemplate, TEMPLATES } from "./index";

export const templates: Plugin = {
  id: "templates",
  adminNav: { group: "monitoring", label: "templates" },
  adminSection(_ctx: SectionCtx) {
    return `<h2>templates</h2>
    <form class="card" method="post" action="/admin/templates">
      <label>host
        <input type="text" name="host" placeholder="example.com" required/>
      </label>
      <div class="tpl">
        ${TEMPLATES.map(
          (t) => `<button type="submit" name="id" value="${esc(t.id)}">${esc(t.label)}</button>`,
        ).join("")}
      </div>
      <p class="sub" style="margin:12px 0 0">One host, one click. SSL uses Certificate Transparency (not the live edge cert). Host/UDP are TCP fallbacks.</p>
    </form>`;
  },
  async admin(ctx: RouteCtx) {
    if (ctx.path !== "/admin/templates" || ctx.method !== "POST") return null;
    const form = await ctx.request.formData();
    const applied = applyTemplate(String(form.get("id") ?? ""), String(form.get("host") ?? ""));
    if (!applied) return redirect("/admin?msg=need%20a%20host");
    const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM monitors").first<{
      n: number;
    }>();
    if ((count?.n ?? 0) >= MAX_MONITORS) return redirect("/admin?msg=max%2020%20monitors");
    const now = Date.now();
    return insertMonitor(ctx.env, {
      id: crypto.randomUUID(),
      name: applied.name,
      url: applied.url,
      interval_min: applied.interval_min,
      expect_status: 0,
      timeout_ms: applied.timeout_ms,
      keyword: null,
      keyword_mode: null,
      max_latency_ms: null,
      enabled: 1,
      status: "unknown",
      last_check_at: null,
      last_status_code: null,
      last_latency_ms: null,
      last_error: null,
      consecutive: 0,
      created_at: now,
      mute_until: null,
      headers: null,
      nag_min: 0,
      last_nag_at: null,
    });
  },
};
