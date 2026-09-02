import { redirect, toggleEnabled } from "../kernel/http";
import type { Plugin, RouteCtx, SectionCtx } from "../kernel/plugin";
import { agentsMarkdown, handleAgentStatus, handleMcp, listAgentTokens, MAX_AGENT_TOKENS } from "./index";
import { adminAgents } from "./ui";

export const agents: Plugin = {
  id: "agents",
  adminNav: { group: "distribute", label: "ai agents" },
  adminFooter: "Agent tokens are read-only. Revoke replaces the token the agent knows.",
  async adminSection(ctx: SectionCtx) {
    return adminAgents(await listAgentTokens(ctx.env.DB), ctx.origin);
  },
  async route(ctx: RouteCtx) {
    const { path, method, env, request, url } = ctx;

    const md = path.match(/^\/agents\.md\/?$/);
    if (md && method === "GET") {
      return new Response(agentsMarkdown(env, ctx.origin), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    const status = path.match(/^\/agent\/status\.json\/?$/);
    if (status && method === "GET") {
      return handleAgentStatus(env, request, url);
    }

    const mcp = path.match(/^\/mcp\/([A-Za-z0-9_-]+)\/?$/);
    if (mcp) {
      if (method !== "POST") {
        return new Response("MCP is POST-only JSON-RPC (streamable HTTP, stateless). See /agents.md", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      return handleMcp(env, mcp[1], request);
    }
    return null;
  },
  async admin(ctx: RouteCtx) {
    const { path, method, env, request } = ctx;
    if (path === "/admin/agents" && method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim().slice(0, 40);
      if (!name) return redirect("/admin?msg=name%20required");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_tokens").first<{
        n: number;
      }>();
      if ((count?.n ?? 0) >= MAX_AGENT_TOKENS) return redirect("/admin?msg=max%205%20agent%20tokens");
      await env.DB.prepare(
        "INSERT INTO agent_tokens (id, name, token, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), name, crypto.randomUUID().replaceAll("-", ""), Date.now())
        .run();
      return redirect("/admin?msg=agent%20token%20minted");
    }
    const tog = path.match(/^\/admin\/agents\/([^/]+)\/toggle$/);
    if (tog && method === "POST") {
      await toggleEnabled(env.DB, "agent_tokens", tog[1]);
      return redirect("/admin?msg=toggled");
    }
    const del = path.match(/^\/admin\/agents\/([^/]+)\/delete$/);
    if (del && method === "POST") {
      await env.DB.prepare("DELETE FROM agent_tokens WHERE id = ?").bind(del[1]).run();
      return redirect("/admin?msg=revoked");
    }
    return null;
  },
};
