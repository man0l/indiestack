import { esc, ghostLink } from "../ui";
import type { AgentToken } from "./index";

export function adminAgents(tokens: AgentToken[], origin: string): string {
  const list =
    tokens.length === 0
      ? `<p class="sub">No agent tokens. Mint one, then point Claude, Cursor, or your own agent at the MCP URL.</p>`
      : tokens
          .map((t) => {
            const mcp = `${origin}/mcp/${t.token}`;
            return `<div class="row">
              <div class="dot ${t.enabled ? "up" : "paused"}"></div>
              <div>
                <div class="name">${esc(t.name)}${t.enabled ? "" : " · paused"}</div>
                <div class="url">MCP ${esc(mcp)}</div>
                <div class="url">status: curl -H "Authorization: Bearer ${esc(t.token)}" ${esc(origin)}/agent/status.json</div>
              </div>
              <div class="actions">
                <form method="post" action="/admin/agents/${esc(t.id)}/toggle">
                  <button class="ghost" type="submit">${t.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/agents/${esc(t.id)}/delete">
                  <button class="danger" type="submit">revoke</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  return `<h2>ai agents</h2>
    <div class="card">
      <p class="sub" style="margin:0 0 10px">Your stack speaks agent: public <a href="/agents.md">/agents.md</a>, a status JSON, and MCP tools (overview, monitors, heartbeats, deploys, incidents, analytics).</p>
      <div class="actions" style="justify-content:flex-start">
        ${ghostLink("/agents.md", "open /agents.md")}
      </div>
    </div>
    <div class="list">${list}</div>
    <form class="card" method="post" action="/admin/agents">
      <label>agent name
        <input type="text" name="name" maxlength="40" placeholder="claude" required/>
      </label>
      <button type="submit">mint agent token</button>
    </form>`;
}
