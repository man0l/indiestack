import { ago, esc, page } from "../ui";
import type { LogSource } from "../logs/index";
import type { LogQuery, ViewEvent } from "./query";

export function explorerPage(
  title: string,
  origin: string,
  sources: LogSource[],
  query: LogQuery,
  events: ViewEvent[],
  analysis?: { text: string } | { error: string },
): string {
  const selected = sources.find((s) => s.id === query.sourceId) ?? null;
  const ingest =
    selected != null
      ? `<p class="url">curl -fsS -X POST ${esc(`${origin}/log/${selected.token}`)} -H 'content-type: application/json' -d '{"level":"error","message":"…"}'</p>`
      : `<p class="sub">All sources · last 24h · expand a row for JSON.</p>`;

  const filter = `<form class="card" method="get" action="/admin/logs">
      <label>source
        <select name="source">
          <option value="">all sources</option>
          ${sources
            .map(
              (s) =>
                `<option value="${esc(s.id)}"${s.id === query.sourceId ? " selected" : ""}>${esc(s.name)}</option>`,
            )
            .join("")}
        </select>
      </label>
      <label>level
        <select name="level">
          ${["", "error", "warn", "log"]
            .map((lv) => {
              const label = lv || "any";
              const sel = (query.level ?? "") === lv ? " selected" : "";
              return `<option value="${esc(lv)}"${sel}>${esc(label)}</option>`;
            })
            .join("")}
        </select>
      </label>
      <label>search
        <input type="text" name="q" value="${esc(query.q)}" placeholder="payment failed" maxlength="80"/>
      </label>
      <button type="submit">filter</button>
    </form>`;

  const rows =
    events.length === 0
      ? `<p class="sub">No events match.</p>`
      : `<div class="list">${events
          .map((e) => {
            const lvl = (e.level ?? "log").toLowerCase();
            const payload =
              e.data == null ? "" : esc(typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2));
            return `<details class="row" style="display:block;padding:14px 0">
              <summary style="cursor:pointer;list-style:none;display:grid;grid-template-columns:14px 1fr auto;gap:12px;align-items:center">
                <span class="log-lvl ${esc(lvl)}">${esc(e.level ?? "log")}</span>
                <span>
                  <span class="name">${esc(e.message)}</span>
                  ${query.sourceId ? "" : `<div class="url">${esc(e.source_name)}</div>`}
                </span>
                <span class="meta">${esc(ago(e.ts))}</span>
              </summary>
              ${payload ? `<pre class="url" style="white-space:pre-wrap;margin:12px 0 0">${payload}</pre>` : `<p class="sub">No payload.</p>`}
            </details>`;
          })
          .join("")}</div>`;

  const analysisHtml = analysis
    ? "error" in analysis
      ? `<p class="err">${esc(analysis.error)}</p>`
      : `<div class="card"><p class="sub" style="margin:0 0 8px">Workers AI</p><div class="url">${esc(analysis.text).replace(/\n/g, "<br/>")}</div></div>`
    : "";

  const hidden = `<input type="hidden" name="source" value="${esc(query.sourceId ?? "")}"/>
      <input type="hidden" name="level" value="${esc(query.level ?? "")}"/>
      <input type="hidden" name="q" value="${esc(query.q)}"/>`;

  const heading = selected ? selected.name : "manager";
  return page(
    `logs · ${heading}`,
    `<header>
      <div class="brand">${esc(title)} <span>logs</span></div>
      <a href="/admin">back</a>
    </header>
    <h1 class="unknown">${esc(heading)}</h1>
    ${ingest}
    ${filter}
    <form method="post" action="/admin/logs/analyze" style="margin:12px 0">
      ${hidden}
      <button type="submit"${events.length === 0 ? " disabled" : ""}>analyze with Workers AI</button>
    </form>
    ${analysisHtml}
    <h2>tail</h2>
    <p class="sub">${events.length} event${events.length === 1 ? "" : "s"} · click a row to expand</p>
    ${rows}`,
  );
}
