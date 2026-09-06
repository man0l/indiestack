import { isMuted } from "./kernel/types";
import { ADMIN_CSS, ADMIN_JS } from "./kernel/assets";

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

export function page(title: string, body: string, extraHead = "", htmlClass = ""): string {
  return `<!doctype html>
<html lang="en"${htmlClass ? ` class="${htmlClass}"` : ""}>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    :root {
      color-scheme: dark;
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
      font: 15px/1.45 "Inter Variable", ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    :where(body:not(.isl)) a { color: var(--accent); text-decoration: none; }
    :where(body:not(.isl)) a:hover { text-decoration: underline; }
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
    :where(body:not(.isl)) label { display: block; font-size: 12px; color: var(--mute); margin-bottom: 10px; }
    :where(body:not(.isl)) input[type=text], :where(body:not(.isl)) input[type=url], :where(body:not(.isl)) input[type=password], :where(body:not(.isl)) input[type=number], :where(body:not(.isl)) input[type=datetime-local], :where(body:not(.isl)) select, :where(body:not(.isl)) textarea {
      width: 100%;
      margin-top: 4px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--ink);
      font: inherit;
    }
    /* Bare-element form styling serves no-JS/server pages only. Once an island
       mounts (body.isl) shadcn components own their look; shell chrome re-opts
       in via #check-form so it never leaks into islands or portal'ed overlays. */
    :where(body:not(.isl)) button, #check-form button, .btn {
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
    
    /* admin shell — sidebar ≥1024px, sticky topbar + drawer below. Breakpoints match Tailwind (640/768/1024). */
    .admin { display: flex; min-height: 100dvh; }
    .sidebar {
      width: 248px; min-width: 248px; flex-shrink: 0;
      background: #0c0d10; border-right: 1px solid var(--line);
      padding: 16px 12px 24px; position: sticky; top: 0; height: 100dvh; overflow-y: auto;
    }
    .sbrand { font-weight: 700; letter-spacing: -0.02em; margin-bottom: 16px; padding: 4px 8px; }
    .sbrand span { color: var(--mute); font-weight: 500; }
    .sg { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute); margin: 14px 0 6px; padding: 0 8px; }
    .sitem, .ditem {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: 8px; color: #a8adb7; font-size: 14px; text-decoration: none;
      min-height: 44px;
    }
    .sitem:hover, .ditem:hover { background: #171a21; color: var(--ink); text-decoration: none; }
    .sitem.active, .ditem.active { background: #171a21; color: var(--ink); font-weight: 600; }
    .sdot { width: 7px; height: 7px; border-radius: 50%; background: var(--mute); flex-shrink: 0; }
    .sdot.up { background: var(--up); }
    .sdot.down { background: var(--down); }
    .scount { margin-left: auto; color: var(--mute); font-variant-numeric: tabular-nums; font-size: 12px; }
    .amain { flex: 1; min-width: 0; padding: 0 16px 48px; }
    .acontent { max-width: 1120px; margin: 0 auto; }
    /* sticky topbar: nav + primary action always in reach */
    .atop {
      position: sticky; top: 0; z-index: 30;
      display: flex; align-items: center; gap: 10px;
      padding: 10px 0;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .abrand { font-weight: 700; letter-spacing: -0.02em; display: none; }
    .abrand span { color: var(--mute); font-weight: 500; }
    .atitle { display: none; color: var(--mute); font-size: 13px; }
    @media (min-width: 1024px) {
      .atitle { display: block; }
    }
    .atop .spacer { flex: 1; }
    .flash { color: var(--mute); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .island-err {
      border: 1px solid var(--down); border-radius: 12px;
      background: color-mix(in srgb, var(--down) 12%, transparent);
      color: var(--ink); padding: 12px 14px; margin-bottom: 16px; font-size: 14px;
    }
    .island-err b { color: var(--down); }
    .sghost { background: transparent; color: var(--mute); border: 1px solid var(--line); padding: 6px 10px; border-radius: 8px; cursor: pointer; font: inherit; }
    /* drawer (mobile nav): <details> so it works with no JS */
    .drawer { display: none; }
    .topbar-island { display: none; }
    .dbtn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--line); background: transparent; color: var(--ink);
      list-style: none; flex-shrink: 0;
    }
    .dbtn::-webkit-details-marker { display: none; }
    .drawer[open] .dback { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.55); cursor: pointer; }
    .drawer[open] .dbtn { position: relative; z-index: 42; }
    .dpanel {
      position: fixed; z-index: 41; top: 0; left: 0; bottom: 0; width: min(300px, 84vw);
      background: #0c0d10; border-right: 1px solid var(--line);
      padding: 76px 12px 24px; overflow-y: auto; overscroll-behavior: contain;
    }
    /* thin dark scrollbars everywhere (needs color-scheme: dark above) */
    * { scrollbar-width: thin; scrollbar-color: #2f3544 transparent; }
    *::-webkit-scrollbar { width: 8px; height: 8px; }
    *::-webkit-scrollbar-thumb { background: #2f3544; border-radius: 4px; }
    *::-webkit-scrollbar-track { background: transparent; }
    .dhead { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 12px; font-weight: 700; }
    .dhead span { color: var(--mute); font-weight: 500; }
    .cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 640px) {
      .cards { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
      .amain { padding: 0 20px 56px; }
    }
    @media (min-width: 768px) {
      .amain { padding: 0 24px 56px; }
    }
    .pcard {
      display: block; text-decoration: none; color: inherit;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
    }
    .pcard:hover { text-decoration: none; border-color: #2f3544; }
    .pcard b { display: block; font-size: 14px; }
    .pcard .sub { margin: 6px 0 0; font-size: 13px; }
    .pcard .dot { display: inline-block; vertical-align: middle; margin-right: 6px; }

    @media (max-width: 1023px) {
      .sidebar { display: none; }
      .drawer { display: block; }
      .topbar-island { display: block; }
      .abrand { display: block; }
    }

    @media (max-width: 639px) {
      h1 { font-size: 32px; }
      .row { grid-template-columns: 14px 1fr; }
      .meta, .actions { grid-column: 2; text-align: left; justify-content: flex-start; }
      .log-event > summary { grid-template-columns: 4.75rem 1fr; }
      .log-event > summary .meta { grid-column: 2; }
      .log-event pre { margin-left: 0; }
      .flash { display: none; }
      .atop button[type=submit] { padding: 8px 10px; }
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
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...headers },
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
  const item = (id: string, href: string, inner: string, cls: string) =>
    `<a class="${cls}${opts.activeId === id ? " active" : ""}" href="${esc(href)}"${opts.activeId === id ? ` aria-current="page"` : ""}>${inner}</a>`;
  const dot = (d: string) => `<span class="sdot ${esc(d)}"></span>`;
  const activeLabel = opts.activeId === "overview"
    ? "overview"
    : (opts.cards.find((c) => c.id === opts.activeId)?.label ?? opts.activeId);
  const count = (s: string) => (s ? `<span class="scount">${esc(s)}</span>` : "");
  const navItems = (cls: string) =>
    item("overview", "/admin", "overview", cls) +
    groups.map((g) => {
      const items = opts.cards.filter((c) => c.group === g);
      if (!items.length) return "";
      return `<div class="sg">${esc(groupLabels[g])}</div>` + items.map((c) =>
        item(c.id, c.href, `${dot(c.dot)}${esc(c.label)}${count(c.summary)}`, cls)
      ).join("");
    }).join("") +
    `<div class="sg">elsewhere</div>` +
    `<a class="${cls}" href="/">status ↗</a>` +
    `<a class="${cls}" href="/agents.md">/agents.md</a>`;
  const sidebar = `<aside class="sidebar" aria-label="admin">
    <div class="sbrand">${esc(opts.title)} <span>admin</span></div>
    <nav>${navItems("sitem")}</nav>
    <form method="post" action="/logout" style="margin-top:10px"><button class="sghost" type="submit">logout</button></form>
  </aside>`;
  const drawer = `<noscript><details class="drawer" id="navdrawer">
    <summary class="dbtn" aria-label="open menu"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14"/></svg></summary>
    <div class="dback" onclick="document.getElementById('navdrawer').removeAttribute('open')"></div>
    <nav class="dpanel" aria-label="admin">
      <div class="dhead">${esc(opts.title)} <span>admin</span></div>
      ${navItems("ditem")}
      <form method="post" action="/logout" style="margin-top:10px"><button class="sghost" type="submit">logout</button></form>
    </nav>
  </details></noscript>`;
  const navJson = JSON.stringify({ title: opts.title, activeId: opts.activeId, cards: opts.cards }).replace(
    /</g,
    "\\u003c",
  );
  return page(
    `admin · ${opts.title}`,
    `<div class="admin">
      ${sidebar}
      <div class="amain">
        <div class="atop">
          <div class="topbar-island" data-island="topbar"></div>
          <script type="application/json" id="nav-data">${navJson}</script>
          ${drawer}
          <div class="abrand">${esc(opts.title)} <span>admin</span></div>
          <span class="atitle">${esc(activeLabel)}</span>
          <div class="spacer"></div>
          ${opts.flash ? `<span class="flash">${esc(opts.flash)}</span>` : ""}
          <form id="check-form" method="post" action="/admin/check" style="display:inline"><button type="submit">check now</button></form>
        </div>
        <div class="acontent">${opts.island ? `<div class="dark" data-island="${esc(opts.island)}"><div class="island-loading flex flex-col gap-2" aria-hidden="true"><div class="h-12 animate-pulse rounded-lg bg-muted"></div><div class="h-12 animate-pulse rounded-lg bg-muted"></div><div class="h-12 animate-pulse rounded-lg bg-muted"></div></div><noscript><style>.island-loading{display:none}</style>${opts.content}</noscript></div><noscript><div class="island-err"><b>JavaScript is off.</b> Server pages work, but live tables need the admin bundle.</div></noscript><script>(function(){if(!document.querySelector('[data-island]'))return;setTimeout(function(){if(window.__isl)return;var d=document.createElement('div');d.className='island-err';d.setAttribute('role','alert');d.innerHTML='<b>Interactive dashboard failed to load.</b> Reload the page — if this persists, the admin bundle is unreachable.';var c=document.querySelector('.acontent');if(c)c.prepend(d);},6000);})();</script>` : `<div class="dark">${opts.content}</div>`}</div>
      </div>
    </div>`,
    `<style>main{max-width:none;margin:0;padding:0;background:transparent}</style><link rel="stylesheet" href="${ADMIN_CSS}"/><script type="module" src="${ADMIN_JS}"></script><style>/* admin.css loads after the shell: re-assert the dark canvas + shell tokens it collides with (--card/--accent). Islands always render inside .dark, so their tokens are untouched. */
    html,body{background:#0e1014;color:#eef0f4}
    :root{--card:#171a21;--accent:#c8f542}</style>`,
    "dark",
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
