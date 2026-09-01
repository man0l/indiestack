import { isMuted, type Incident, type Job, type Monitor } from "./kernel/types";
import { kindOf } from "./ping/target";
import { TEMPLATES } from "./templates";

export type Stats = {
  n: number;
  ok_n: number;
  avg_latency_ms: number | null;
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg: #0e1014;
      --card: #171a21;
      --ink: #eef0f4;
      --mute: #8b919c;
      --line: #262b35;
      --up: #3ee08f;
      --down: #ff5d57;
      --wait: #e6c15c;
      --accent: #c8f542;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--ink);
      font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    main { max-width: 720px; margin: 0 auto; padding: 28px 20px 64px; }
    header {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 16px; margin-bottom: 28px; flex-wrap: wrap;
    }
    .brand { font-weight: 650; letter-spacing: -0.02em; }
    .brand span { color: var(--mute); font-weight: 500; }
    .led { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--wait); box-shadow: 0 0 0 3px color-mix(in srgb, var(--wait) 25%, transparent);
    }
    .dot.up { background: var(--up); box-shadow: 0 0 0 3px color-mix(in srgb, var(--up) 25%, transparent); }
    .dot.down { background: var(--down); box-shadow: 0 0 0 3px color-mix(in srgb, var(--down) 25%, transparent); }
    .dot.paused { background: var(--mute); box-shadow: none; }
    h1 {
      font-size: 42px; letter-spacing: -0.04em; margin: 0 0 8px;
      text-transform: uppercase;
    }
    h1.up { color: var(--up); }
    h1.down { color: var(--down); }
    h1.unknown { color: var(--wait); }
    .pct { font-size: 18px; color: var(--mute); margin: 0 0 8px; font-variant-numeric: tabular-nums; }
    .sub { color: var(--mute); margin-bottom: 28px; }
    h2 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mute); font-weight: 650; margin: 28px 0 0; }
    .list { border-top: 1px solid var(--line); }
    .row {
      display: grid;
      grid-template-columns: 14px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 14px 0;
      border-bottom: 1px solid var(--line);
    }
    .name { font-weight: 600; }
    .url { color: var(--mute); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    .meta { color: var(--mute); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .meta b { color: var(--ink); font-weight: 600; }
    form.rowish, .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
    }
    label { display: block; font-size: 12px; color: var(--mute); margin-bottom: 10px; }
    input[type=text], input[type=url], input[type=password], input[type=number], input[type=datetime-local], select, textarea {
      width: 100%;
      margin-top: 4px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--ink);
      font: inherit;
    }
    button, .btn {
      appearance: none; border: 0; border-radius: 8px;
      background: var(--accent); color: #111; font-weight: 650;
      padding: 8px 12px; cursor: pointer; font: inherit;
    }
    button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    button.danger { background: transparent; color: var(--down); border: 1px solid var(--line); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .tpl { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .tpl button { background: var(--card); color: var(--ink); border: 1px solid var(--line); font-weight: 600; }
    .err { color: var(--down); margin: 0 0 16px; }
    footer { margin-top: 36px; color: var(--mute); font-size: 12px; }
    @media (max-width: 560px) {
      h1 { font-size: 32px; }
      .row { grid-template-columns: 14px 1fr; }
      .meta, .actions { grid-column: 2; text-align: left; justify-content: flex-start; }
    }
  </style>
  ${extraHead}
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function liveStatus(enabled: number, status: string, mute_until?: number | null): string {
  return isMuted(enabled, mute_until) ? "paused" : status;
}

function overallOf(monitors: Monitor[], jobs: Job[]): { overall: string; headline: string } {
  const liveM = monitors.filter((m) => !isMuted(m.enabled, m.mute_until));
  const liveJ = jobs.filter((j) => !isMuted(j.enabled, j.mute_until));
  if (liveM.length === 0 && liveJ.length === 0) {
    return { overall: "unknown", headline: "idle" };
  }
  const down =
    liveM.filter((m) => m.status === "down").length +
    liveJ.filter((j) => j.status === "down").length;
  const known =
    liveM.filter((m) => m.status !== "unknown").length +
    liveJ.filter((j) => j.status !== "unknown").length;
  if (down > 0) return { overall: "down", headline: `${down} down` };
  if (known > 0) return { overall: "up", headline: "all systems up" };
  return { overall: "unknown", headline: "waiting" };
}

export function statusPage(
  title: string,
  monitors: Monitor[],
  jobs: Job[],
  stats: Record<string, Stats>,
  uptime24: { n: number; ok_n: number } | null,
  incidents: Incident[],
): string {
  const { overall, headline } = overallOf(monitors, jobs);
  const word = overall === "down" ? "down" : overall === "up" ? "up" : "idle";
  const pct =
    uptime24 && uptime24.n > 0
      ? `${Math.round((uptime24.ok_n / uptime24.n) * 1000) / 10}% 24h`
      : null;

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

  const jobRows =
    jobs.length === 0
      ? ""
      : `<h2>cron</h2><div class="list">${jobs
          .map((j) => {
            const muted = isMuted(j.enabled, j.mute_until);
            const dot = liveStatus(j.enabled, j.status, j.mute_until);
            return `<div class="row">
              <div class="dot ${esc(dot)}"></div>
              <div>
                <div class="name">${esc(j.name)}${muted ? " · paused" : ""}</div>
                <div class="url">heartbeat every ${j.interval_min}m · grace ${j.grace_min}m</div>
              </div>
              <div class="meta"><b>last beat</b><br/>${esc(ago(j.last_beat_at))}</div>
            </div>`;
          })
          .join("")}</div>`;

  const empty =
    monitors.length === 0 && jobs.length === 0
      ? `<p class="sub">Nothing watched yet. Add URLs or heartbeats at <a href="/admin">/admin</a>.</p>`
      : "";
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

  return page(
    `${title} · ${headline}`,
    `<header>
      <div class="brand">${esc(title)} <span>status</span></div>
      <div class="led"><div class="dot ${overall}"></div>${esc(headline)}</div>
    </header>
    <h1 class="${overall}">${esc(word)}</h1>
    ${pct ? `<p class="pct">${esc(pct)}</p>` : ""}
    <p class="sub">HTTP, ports, DNS/SSL, and heartbeats. Last 24 hours in D1.</p>
    ${empty}${httpRows}${portRows}${recordRows}${jobRows}
    <h2>incidents</h2>
    ${incidentRows}
    <footer>indiestack · one project, one worker</footer>`,
    `<meta http-equiv="refresh" content="30"/>`,
  );
}

export function loginPage(title: string, error?: string): string {
  return page(
    `admin · ${title}`,
    `<header><div class="brand">${esc(title)} <span>admin</span></div></header>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form class="card" method="post" action="/login">
       <label>token
         <input type="password" name="token" autocomplete="current-password" required autofocus/>
       </label>
       <button type="submit">enter</button>
     </form>
     <footer>This is the token shown on first visit to <code>/admin</code>. If you lost it, set Worker secret <code>ADMIN_TOKEN</code>.</footer>`,
  );
}

export function revealPage(title: string, token: string): string {
  return page(
    `setup · ${title}`,
    `<header><div class="brand">${esc(title)} <span>setup</span></div></header>
     <h1 class="unknown">copy this token</h1>
     <p class="sub">This is your <code>/admin</code> password. It is shown <b>once</b>. Copy it before you continue.</p>
     <div class="card">
       <label>admin token
         <input id="tok" type="text" readonly value="${esc(token)}" spellcheck="false"/>
       </label>
       <div class="actions">
         <button type="button" id="copy">copy</button>
         <form method="post" action="/login">
           <input type="hidden" name="token" value="${esc(token)}"/>
           <button type="submit">open admin</button>
         </form>
       </div>
     </div>
     <footer>Optional later: save the same value as Worker secret <code>ADMIN_TOKEN</code> in the Cloudflare dashboard.</footer>`,
    `<script>
      document.getElementById("copy")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const v = document.getElementById("tok")?.value ?? "";
        try { await navigator.clipboard.writeText(v); btn.textContent = "copied"; }
        catch { btn.textContent = "select and copy"; }
      });
    </script>`,
  );
}

export function adminPage(
  title: string,
  origin: string,
  monitors: Monitor[],
  jobs: Job[],
  webhook: string,
  rollups: string[],
  flash?: string,
): string {
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
                <a class="btn ghost" href="/admin/monitors/${esc(m.id)}" style="display:inline-block;text-decoration:none;border:1px solid var(--line);background:transparent;color:var(--ink)">edit</a>
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

  const jobList =
    jobs.length === 0
      ? `<p class="sub">No heartbeats. Your job should POST the URL we give you.</p>`
      : jobs
          .map((j) => {
            const beat = `${origin}/beat/${j.token}`;
            const muted = isMuted(j.enabled, j.mute_until);
            return `<div class="row">
              <div class="dot ${esc(liveStatus(j.enabled, j.status, j.mute_until))}"></div>
              <div>
                <div class="name">${esc(j.name)} · every ${j.interval_min}m + ${j.grace_min}m grace${muted ? " · paused" : ""}</div>
                <div class="url">curl -fsS -X POST ${esc(beat)}</div>
                <div class="url">last beat ${esc(ago(j.last_beat_at))}${j.last_error ? ` · ${esc(j.last_error)}` : ""}</div>
              </div>
              <div class="actions">
                <a class="btn ghost" href="/admin/jobs/${esc(j.id)}" style="display:inline-block;text-decoration:none;border:1px solid var(--line);background:transparent;color:var(--ink)">edit</a>
                <form method="post" action="/admin/jobs/${esc(j.id)}/toggle">
                  <button class="ghost" type="submit">${j.enabled ? "pause" : "resume"}</button>
                </form>
                <form method="post" action="/admin/jobs/${esc(j.id)}/delete">
                  <button class="danger" type="submit">remove</button>
                </form>
              </div>
            </div>`;
          })
          .join("");

  const history =
    rollups.length === 0
      ? `<p class="sub">Daily JSON land in R2 after midnight UTC.</p>`
      : `<ul>${rollups
          .map((d) => `<li><a href="/admin/rollups/${esc(d)}">${esc(d)}</a></li>`)
          .join("")}</ul>`;

  return page(
    `admin · ${title}`,
    `<header>
      <div class="brand">${esc(title)} <span>admin</span></div>
      <div class="actions">
        <form method="post" action="/admin/check"><button type="submit">check now</button></form>
        <form method="post" action="/logout"><button class="ghost" type="submit">logout</button></form>
      </div>
    </header>
    ${flash ? `<p class="sub">${esc(flash)}</p>` : ""}
    <p class="sub">${monitors.length}/20 monitors · ${jobs.length}/20 cron · public <a href="/">/</a></p>
    <h2>templates</h2>
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
    </form>
    <h2>monitors</h2>
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
    </form>
    <h2>cron monitor</h2>
    <div class="list">${jobList}</div>
    <form class="card" method="post" action="/admin/jobs">
      <label>name
        <input type="text" name="name" maxlength="40" placeholder="nightly-backup" required/>
      </label>
      <label>expect a beat every (minutes)
        <input type="number" name="interval_min" min="1" max="1440" value="60"/>
      </label>
      <label>grace minutes
        <input type="number" name="grace_min" min="0" max="120" value="2"/>
      </label>
      <button type="submit">add heartbeat</button>
    </form>
    <form class="card" method="post" action="/admin/settings">
      <label>alert webhook (discord / slack / generic JSON)
        <input type="url" name="webhook_url" value="${esc(webhook)}" placeholder="https://discord.com/api/webhooks/…"/>
      </label>
      <button type="submit">save webhook</button>
    </form>
    <h2>rollups</h2>
    ${history}
    <footer>HTTP uses 2-strike alerts. A heartbeat alerts on the first miss after grace. Mute times are UTC.</footer>`,
  );
}

function muteValue(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 16);
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
            .map(
              (k) =>
                `<option value="${k}"${k === kind ? " selected" : ""}>${k}</option>`,
            )
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

export function editJobPage(title: string, j: Job, origin: string): string {
  const beat = `${origin}/beat/${j.token}`;
  return page(
    `edit · ${j.name}`,
    `<header>
      <div class="brand">${esc(title)} <span>edit</span></div>
      <a href="/admin">back</a>
    </header>
    <p class="url">${esc(beat)}</p>
    <form class="card" method="post" action="/admin/jobs/${esc(j.id)}">
      <label>name
        <input type="text" name="name" maxlength="40" value="${esc(j.name)}" required/>
      </label>
      <label>expect a beat every (minutes)
        <input type="number" name="interval_min" min="1" max="1440" value="${j.interval_min}"/>
      </label>
      <label>grace minutes
        <input type="number" name="grace_min" min="0" max="120" value="${j.grace_min}"/>
      </label>
      <label>still-down nag minutes (0 = off)
        <input type="number" name="nag_min" min="0" max="1440" value="${j.nag_min ?? 0}"/>
      </label>
      <label>mute until UTC
        <input type="datetime-local" name="mute_until" value="${esc(muteValue(j.mute_until))}"/>
      </label>
      <div class="actions">
        <button type="submit">save</button>
        <a href="/admin">cancel</a>
      </div>
    </form>`,
  );
}

export function html(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}
