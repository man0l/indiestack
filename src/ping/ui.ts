import { isMuted, type Incident, type Monitor } from "../kernel/types";
import { ago, esc, ghostLink, liveStatus, muteValue, page } from "../ui";
import { kindOf } from "./target";

export type Stats = {
  n: number;
  ok_n: number;
  avg_latency_ms: number | null;
};

export function adminMonitors(monitors: Monitor[]): string {
  const list =
    monitors.length === 0
      ? `<p class="sub">No monitors. Add HTTP, TCP, UDP, or a host check below.</p>`
      : monitors
          .map((m) => {
            const extra = [
              kindOf(m.url),
              m.keyword ? `keyword ${m.keyword_mode ?? "exists"} “${m.keyword}”` : "",
              m.expect_status ? `status ${m.expect_status}` : "",
              m.max_latency_ms ? `slow >${m.max_latency_ms}ms` : "",
              m.last_error ?? "",
            ]
              .filter(Boolean)
              .join(" · ");
            const muted = isMuted(m.enabled, m.mute_until);
            return `<div class="row">
              <div class="dot ${esc(liveStatus(m.enabled, m.status, m.mute_until))}"></div>
              <div>
                <div class="name">${esc(m.name)} · every ${m.interval_min}m${muted ? " · paused" : ""}</div>
                <div class="url">${esc(m.url)}${extra ? ` · ${esc(extra)}` : ""}</div>
              </div>
              <div class="actions">
                ${ghostLink(`/admin/monitors/${m.id}`, "edit")}
                <form method="post" action="/admin/monitors/${esc(m.id)}/toggle">
                  <button class="ghost" type="submit">${m.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/monitors/${esc(m.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  return `<h2>monitors</h2>
    <div class="list">${list}</div>
    <form class="card" method="post" action="/admin/monitors">
      <label>type
        <select name="kind">
          <option value="http">HTTP(S)</option>
          <option value="tcp">TCP port</option>
          <option value="udp">UDP port (TCP probe — no datagrams on Workers)</option>
          <option value="icmp">Host (TCP 443/80/22 — no ICMP on Workers)</option>
          <option value="dns">DNS (DoH A/AAAA/MX)</option>
          <option value="ssl">SSL expiry (~14d)</option>
          <option value="domain">Domain expiry (~30d)</option>
        </select>
      </label>
      <label>target
        <input type="text" name="url" placeholder="https://example.com  or  example.com:22" required/>
      </label>
      <label>name (optional)
        <input type="text" name="name" maxlength="40" placeholder="api"/>
      </label>
      <label>interval minutes
        <input type="number" name="interval_min" min="1" max="60" value="5"/>
      </label>
      <label>expected status (0 = any 2xx)
        <input type="number" name="expect_status" min="0" max="599" value="0"/>
      </label>
      <label>timeout ms
        <input type="number" name="timeout_ms" min="1000" max="15000" value="8000"/>
      </label>
      <label>slow if slower than ms (0 = off)
        <input type="number" name="max_latency_ms" min="0" max="15000" value="0"/>
      </label>
      <label>keyword (optional)
        <input type="text" name="keyword" maxlength="80" placeholder="ok"/>
      </label>
      <label>keyword mode
        <select name="keyword_mode">
          <option value="exists">must contain</option>
          <option value="absent">must not contain</option>
        </select>
      </label>
      <label>headers (one Header: value per line, HTTP only)
        <textarea name="headers" rows="3" placeholder="Authorization: Bearer …"></textarea>
      </label>
      <label>still-down nag minutes (0 = off)
        <input type="number" name="nag_min" min="0" max="1440" value="0"/>
      </label>
      <label>mute until UTC
        <input type="datetime-local" name="mute_until"/>
      </label>
      <button type="submit">add monitor</button>
    </form>`;
}

export function statusMonitors(monitors: Monitor[], stats: Record<string, Stats>): string {
  const http = monitors.filter((m) => kindOf(m.url) === "http");
  const ports = monitors.filter((m) => ["tcp", "udp", "icmp"].includes(kindOf(m.url)));
  const records = monitors.filter((m) => ["dns", "ssl", "domain"].includes(kindOf(m.url)));
  const row = (m: Monitor) => {
    const st = stats[m.id];
    const uptime = st && st.n > 0 ? `${Math.round((st.ok_n / st.n) * 1000) / 10}% 24h` : "—";
    const lat = m.last_latency_ms != null ? `${m.last_latency_ms}ms` : "—";
    const muted = isMuted(m.enabled, m.mute_until);
    const dot = liveStatus(m.enabled, m.status, m.mute_until);
    return `<div class="row">
              <div class="dot ${esc(dot)}"></div>
              <div>
                <div class="name">${esc(m.name)}${muted ? " · paused" : ""}</div>
                <div class="url">${esc(m.url)}</div>
              </div>
              <div class="meta"><b>${esc(lat)}</b><br/>${esc(ago(m.last_check_at))} · ${esc(uptime)}</div>
            </div>`;
  };
  const httpRows =
    http.length === 0 ? "" : `<h2>http</h2><div class="list">${http.map(row).join("")}</div>`;
  const portRows =
    ports.length === 0 ? "" : `<h2>ports</h2><div class="list">${ports.map(row).join("")}</div>`;
  const recordRows =
    records.length === 0
      ? ""
      : `<h2>dns / ssl / domain</h2><div class="list">${records.map(row).join("")}</div>`;
  return `${httpRows}${portRows}${recordRows}`;
}

export function statusIncidents(incidents: Incident[]): string {
  const incidentRows =
    incidents.length === 0
      ? `<p class="sub">No failed checks in the last 24h.</p>`
      : `<div class="list">${incidents
          .map(
            (i) => `<div class="row">
              <div class="dot down"></div>
              <div>
                <div class="name">${esc(i.name)}</div>
                <div class="url">${esc(i.error ?? "fail")} · ${esc(i.url)}</div>
              </div>
              <div class="meta">${esc(ago(i.ts))}</div>
            </div>`,
          )
          .join("")}</div>`;
  return `<h2>incidents</h2>${incidentRows}`;
}

export function editMonitorPage(title: string, m: Monitor): string {
  const kind = kindOf(m.url);
  return page(
    `edit · ${m.name}`,
    `<header>
      <div class="brand">${esc(title)} <span>edit</span></div>
      <a href="/admin">back</a>
    </header>
    <form class="card" method="post" action="/admin/monitors/${esc(m.id)}">
      <label>name
        <input type="text" name="name" maxlength="40" value="${esc(m.name)}" required/>
      </label>
      <label>type
        <select name="kind">
          ${["http", "tcp", "udp", "icmp", "dns", "ssl", "domain"]
            .map((k) => `<option value="${k}"${k === kind ? " selected" : ""}>${k}</option>`)
            .join("")}
        </select>
      </label>
      <label>target
        <input type="text" name="url" value="${esc(m.url)}" required/>
      </label>
      <label>interval minutes
        <input type="number" name="interval_min" min="1" max="60" value="${m.interval_min}"/>
      </label>
      <label>expected status (HTTP, 0 = any 2xx)
        <input type="number" name="expect_status" min="0" max="599" value="${m.expect_status}"/>
      </label>
      <label>timeout ms
        <input type="number" name="timeout_ms" min="1000" max="15000" value="${m.timeout_ms}"/>
      </label>
      <label>slow if slower than ms (0 = off)
        <input type="number" name="max_latency_ms" min="0" max="15000" value="${m.max_latency_ms ?? 0}"/>
      </label>
      <label>keyword
        <input type="text" name="keyword" maxlength="80" value="${esc(m.keyword ?? "")}"/>
      </label>
      <label>keyword mode
        <select name="keyword_mode">
          <option value="exists"${m.keyword_mode !== "absent" ? " selected" : ""}>must contain</option>
          <option value="absent"${m.keyword_mode === "absent" ? " selected" : ""}>must not contain</option>
        </select>
      </label>
      <label>headers (one Header: value per line, HTTP only)
        <textarea name="headers" rows="3" placeholder="Authorization: Bearer …">${esc(m.headers ?? "")}</textarea>
      </label>
      <label>still-down nag minutes (0 = off)
        <input type="number" name="nag_min" min="0" max="1440" value="${m.nag_min ?? 0}"/>
      </label>
      <label>mute until UTC
        <input type="datetime-local" name="mute_until" value="${esc(muteValue(m.mute_until))}"/>
      </label>
      <div class="actions">
        <button type="submit">save</button>
        <a href="/admin">cancel</a>
      </div>
    </form>`,
  );
}
