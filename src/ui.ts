import { isMuted } from "./kernel/types";

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

export function liveStatus(enabled: number, status: string, mute_until?: number | null): string {
  return isMuted(enabled, mute_until) ? "paused" : status;
}

export function muteValue(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 16);
}

export function ghostLink(href: string, label: string): string {
  return `<a class="btn ghost" href="${esc(href)}" style="display:inline-block;text-decoration:none;border:1px solid var(--line);background:transparent;color:var(--ink)">${esc(label)}</a>`;
}

export function page(title: string, body: string, extraHead = ""): string {
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
    .log-lvl { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mute); }
    .log-lvl.error, .log-lvl.err, .log-lvl.fatal { color: var(--down); }
    .log-lvl.warn, .log-lvl.warning { color: var(--wait); }
    .log-event { display: block; padding: 14px 0; border-bottom: 1px solid var(--line); }
    .log-event > summary {
      cursor: pointer;
      list-style: none;
      display: grid;
      grid-template-columns: 4.75rem minmax(0, 1fr) auto;
      gap: 12px 16px;
      align-items: start;
    }
    .log-event > summary::-webkit-details-marker { display: none; }
    .log-event .log-lvl { padding-top: 3px; min-width: 4.75rem; }
    .log-event pre { margin: 12px 0 0  calc(4.75rem + 16px); }
    footer { margin-top: 36px; color: var(--mute); font-size: 12px; }
    details.fold { margin: 16px 0; }
    details.fold > summary {
      cursor: pointer;
      color: var(--mute);
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 650;
      user-select: none;
    }
    details.fold > summary::-webkit-details-marker { display: none; }
    details.fold > summary::before { content: "+  "; }
    details.fold[open] > summary::before { content: "–  "; }
    details.fold .card { margin-top: 8px; }
    
    /* admin shell — sidebar + cards (linear dark) */
    .admin { display: flex; min-height: 100dvh; }
    .sidebar {
      width: 220px; min-width: 220px; flex-shrink: 0;
      background: #0c0d10; border-right: 1px solid var(--line);
      padding: 16px 12px; position: sticky; top: 0; height: 100dvh; overflow-y: auto;
    }
    .sbrand { font-weight: 700; letter-spacing: -0.02em; margin-bottom: 16px; }
    .sbrand span { color: var(--mute); font-weight: 500; }
    .sg { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute); margin: 14px 0 6px; }
    .sitem {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; border-radius: 7px; color: #a8adb7; font-size: 13px; text-decoration: none;
    }
    .sitem:hover { background: #171a21; color: var(--ink); text-decoration: none; }
    .sitem.active { background: #171a21; color: var(--ink); }
    .sdot { width: 7px; height: 7px; border-radius: 50%; background: var(--mute); flex-shrink: 0; }
    .sdot.up { background: var(--up); }
    .sdot.down { background: var(--down); }
    .scount { margin-left: auto; color: var(--mute); font-variant-numeric: tabular-nums; font-size: 12px; }
    .amain { flex: 1; min-width: 0; padding: 20px 22px 56px; }
    .ahead { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .flash { color: var(--mute); font-size: 13px; }
    .sghost { background: transparent; color: var(--mute); border: 1px solid var(--line); padding: 6px 10px; border-radius: 8px; cursor: pointer; font: inherit; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .pcard {
      display: block; text-decoration: none; color: inherit;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
    }
    .pcard:hover { text-decoration: none; border-color: #2f3544; }
    .pcard b { display: block; font-size: 14px; }
    .pcard .sub { margin: 6px 0 0; font-size: 13px; }
    .pcard .dot { display: inline-block; vertical-align: middle; margin-right: 6px; }

    @media (max-width: 820px) {
      .admin { flex-direction: column; }
      .sidebar { width: auto; min-width: 0; height: auto; position: static; display: flex; gap: 8px; overflow-x: auto; white-space: nowrap; }
      .sidebar .sg { display: none; }
      .amain { padding: 16px; }
    }

    @media (max-width: 560px) {
      h1 { font-size: 32px; }
      .row { grid-template-columns: 14px 1fr; }
      .meta, .actions { grid-column: 2; text-align: left; justify-content: flex-start; }
      .log-event > summary { grid-template-columns: 4.75rem 1fr; }
      .log-event .meta { grid-column: 2; text-align: left; }
      .log-event pre { margin-left: 0; }
    }
  </style>
  ${extraHead}
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

export function html(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
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

export function statusPage(
  title: string,
  overall: { overall: string; headline: string },
  kicker: string | null,
  sections: string[],
  empty: boolean,
): string {
  const word = overall.overall === "down" ? "down" : overall.overall === "up" ? "up" : "idle";
  const emptyHtml = empty
    ? `<p class="sub">Nothing watched yet. Add URLs or heartbeats at <a href="/admin">/admin</a>.</p>`
    : "";
  return page(
    `${title} · ${overall.headline}`,
    `<header>
      <div class="brand">${esc(title)} <span>status</span></div>
      <div class="led"><div class="dot ${overall.overall}"></div>${esc(overall.headline)}</div>
    </header>
    <h1 class="${overall.overall}">${esc(word)}</h1>
    ${kicker ? `<p class="pct">${esc(kicker)}</p>` : ""}
    <p class="sub">Last 24 hours in D1.</p>
    ${emptyHtml}${sections.join("")}
    <footer>indiestack · one project, one worker · built by <a href="https://x.com/manol_ai" target="_blank" rel="noopener">@manol_ai</a></footer>`,
    `<meta http-equiv="refresh" content="30"/>`,
  );
}

export type AdminCard = {
  id: string;
  label: string;
  group: string;
  summary: string;
  dot: string;
  href: string;
};

export function adminShell(opts: {
  title: string;
  activeId: string;
  cards: AdminCard[];
  content: string;
  flash?: string;
  island?: string | null;
}): string {
  const groups = ["monitoring", "growth", "distribute", "system"] as const;
  const groupLabels: Record<string, string> = {
    monitoring: "monitoring",
    growth: "growth",
    distribute: "distribute",
    system: "system",
  };
  const sidebar = `<aside class="sidebar">
    <div class="sbrand">${opts.title} <span>admin</span></div>
    <a class="sitem ${opts.activeId === "overview" ? "active" : ""}" href="/admin">overview</a>
    ${groups.map((g) => {
      const items = opts.cards.filter((c) => c.group === g);
      if (!items.length) return "";
      return `<div class="sg">${esc(groupLabels[g])}</div>` + items.map((c) =>
        `<a class="sitem ${opts.activeId === c.id ? "active" : ""}" href="${esc(c.href)}"><span class="sdot ${esc(c.dot)}"></span>${esc(c.label)}${c.summary ? `<span class="scount">${esc(c.summary)}</span>` : ""}</a>`
      ).join("");
    }).join("")}
    <div class="sg">elsewhere</div>
    <a class="sitem" href="/">status ↗</a>
    <a class="sitem" href="/agents.md">/agents.md</a>
    <form method="post" action="/logout" style="margin-top:10px"><button class="sghost" type="submit">logout</button></form>
  </aside>`;
  return page(
    `admin · ${opts.title}`,
    `<div class="admin">
      ${sidebar}
      <div class="amain">
        <div class="ahead">
          <form id="check-form" method="post" action="/admin/check" style="display:inline"><button type="submit">check now</button></form>
          ${opts.flash ? `<span class="flash">${esc(opts.flash)}</span>` : ""}
        </div>
        <div ${opts.island ? `data-island="${esc(opts.island)}"` : ""}>${opts.content}</div>
      </div>
    </div>`,
    `<style>main{max-width:none;margin:0;padding:0;background:transparent}</style><script type="module" src="/_app/admin.js"></script>`,
  );
}

export function settingsCard(settings: Record<string, string>, rollups: string[]): string {
  const s = (k: string) => esc(settings[k] ?? "");
  const history = rollups.length === 0
    ? `<p class="sub">Daily JSON land in R2 after midnight UTC.</p>`
    : `<ul>${rollups.map((d) => `<li><a href="/admin/rollups/${esc(d)}">${esc(d)}</a></li>`).join("")}</ul>`;
  return `<form class="card" method="post" action="/admin/settings">
    <label>alert webhook (discord / slack / generic JSON)
      <input type="url" name="webhook_url" value="${s("webhook_url")}" placeholder="https://discord.com/api/webhooks/…"/>
    </label>
    <label>telegram bot token (optional)
      <input type="text" name="telegram_bot_token" value="${s("telegram_bot_token")}" placeholder="123456:ABC-DEF…"/>
    </label>
    <label>telegram chat id (optional)
      <input type="text" name="telegram_chat_id" value="${s("telegram_chat_id")}" placeholder="123456789"/>
    </label>
    <label>resend api key (optional — email alerts)
      <input type="password" name="resend_api_key" value="${s("resend_api_key")}" placeholder="re_…"/>
    </label>
    <label>alert email (to, needs resend key)
      <input type="email" name="alert_email" value="${s("alert_email")}" placeholder="you@example.com"/>
    </label>
    <label>alert email from (optional — resend domain)
      <input type="email" name="alert_from" value="${s("alert_from")}" placeholder="onboarding@resend.dev"/>
    </label>
    <button type="submit">save channels</button>
  </form>
  <form class="card" method="post" action="/admin/test-alert">
    <label>test the channels — sends one TEST text to every configured channel
      <input type="text" readonly value="${s("last_alert_error") ? `last error: ${s("last_alert_error")}` : "no delivery errors recorded"}" spellcheck="false"/>
    </label>
    <button type="submit">send test alert</button>
  </form>
  <h2>rollups</h2>
  ${history}`;
}

export function overallOf(health: { up: number; down: number; unknown: number }): {
  overall: string;
  headline: string;
} {
  const n = health.up + health.down + health.unknown;
  if (n === 0) return { overall: "unknown", headline: "idle" };
  if (health.down > 0) return { overall: "down", headline: `${health.down} down` };
  if (health.up > 0) return { overall: "up", headline: "all systems up" };
  return { overall: "unknown", headline: "waiting" };
}
