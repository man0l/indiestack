import { ago, esc, ghostLink, page } from "../ui";
import type { LogEvent, LogSource } from "./index";

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
                ${ghostLink(`/admin/logs/${s.id}`, "tail")}
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
    <div class="list">${logList}</div>
    <form class="card" method="post" action="/admin/logs">
      <label>name
        <input type="text" name="name" maxlength="40" placeholder="api-errors" required/>
      </label>
      <button type="submit">add log source</button>
    </form>`;
}

export function logsPage(title: string, origin: string, source: LogSource, events: LogEvent[]): string {
  const url = `${origin}/log/${source.token}`;
  const rows =
    events.length === 0
      ? `<p class="sub">No events in the last 24h.</p>`
      : `<div class="list">${events
          .map((e) => {
            const lvl = (e.level ?? "").toLowerCase();
            return `<div class="row">
              <div class="log-lvl ${esc(lvl)}">${esc(e.level ?? "log")}</div>
              <div>
                <div class="name">${esc(e.message)}</div>
              </div>
              <div class="meta">${esc(ago(e.ts))}</div>
            </div>`;
          })
          .join("")}</div>`;
  return page(
    `logs · ${source.name}`,
    `<header>
      <div class="brand">${esc(title)} <span>logs</span></div>
      <a href="/admin">back</a>
    </header>
    <h1 class="unknown">${esc(source.name)}</h1>
    <p class="url">curl -fsS -X POST ${esc(url)} -H 'content-type: application/json' -d '{"level":"error","message":"…"}'</p>
    <p class="sub">${source.enabled ? "live · last 50 · dropped after 24h" : "paused · ingest returns 404"}</p>
    <h2>tail</h2>
    ${rows}`,
  );
}
