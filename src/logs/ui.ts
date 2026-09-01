import { esc, ghostLink } from "../ui";
import type { LogSource } from "./index";

export function adminLogs(sources: LogSource[], origin: string): string {
  const logList =
    sources.length === 0
      ? `<p class="sub">No log sources. POST errors here — not access logs. Kept 24h in R2.</p>`
      : sources
          .map((s) => {
            const url = `${origin}/log/${s.token}`;
            return `<div class="row">
              <div class="dot ${s.enabled ? "up" : "paused"}"></div>
              <div>
                <div class="name">${esc(s.name)}${s.enabled ? "" : " · paused"}</div>
                <div class="url">curl -fsS -X POST ${esc(url)} -H 'content-type: application/json' -d '{"level":"error","message":"…"}'</div>
              </div>
              <div class="actions">
                ${ghostLink(`/admin/logs/${s.id}`, "open")}
                <form method="post" action="/admin/logs/${esc(s.id)}/toggle">
                  <button class="ghost" type="submit">${s.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/logs/${esc(s.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  return `<h2>logs</h2>
    <p class="sub" style="margin:8px 0 0"><a href="/admin/logs">log manager</a> — filter, search, expand, tail.</p>
    <div class="list">${logList}</div>
    <form class="card" method="post" action="/admin/logs">
      <label>name
        <input type="text" name="name" maxlength="40" placeholder="api-errors" required/>
      </label>
      <button type="submit">add log source</button>
    </form>`;
}
