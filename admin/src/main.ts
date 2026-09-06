import './app.css';
import { mount } from 'svelte';

// Islands: the Worker serves the shell (sidebar + content) as server HTML.
// The router swaps .acontent content via /api/page/:id and mounts islands — no reloads.
// Each island is a dynamic import so Vite code-splits: every admin page loads
// only its own chunk instead of the whole bundle.
const loaders: Record<string, () => Promise<{ default: object }>> = {
  overview: () => import('./lib/Overview.svelte'),
  topbar: () => import('./lib/Topbar.svelte'),
  ping: () => import('./lib/plugins/Ping.svelte'),
  deploys: () => import('./lib/plugins/Deploys.svelte'),
  integrations: () => import('./lib/plugins/Deploys.svelte'),
  heartbeat: () => import('./lib/plugins/Heartbeats.svelte'),
  logs: () => import('./lib/plugins/Logs.svelte'),
  templates: () => import('./lib/plugins/Templates.svelte'),
  settings: () => import('./lib/plugins/Settings.svelte'),
  backup: () => import('./lib/plugins/Backup.svelte'),
  share: () => import('./lib/plugins/Share.svelte'),
  agents: () => import('./lib/plugins/Agents.svelte'),
  widgets: () => import('./lib/plugins/Widgets.svelte'),
  goals: () => import('./lib/plugins/Goals.svelte'),
  signals: () => import('./lib/plugins/Signals.svelte'),
  aicrawl: () => import('./lib/plugins/AICrawlers.svelte'),
  revenue: () => import('./lib/plugins/Revenue.svelte'),
  analytics: () => import('./lib/plugins/Analytics.svelte'),
  explorer: () => import('./lib/plugins/Explorer.svelte'),
};

type IslandWindow = Window & { __isl?: boolean };

function showIslandError(name: string) {
  if (document.querySelector('.island-err[role="alert"]')) return;
  const d = document.createElement('div');
  d.className = 'island-err';
  d.setAttribute('role', 'alert');
  d.innerHTML = `<b>Interactive dashboard failed to load.</b> Island "${name}" did not mount. Reload the page.`;
  document.querySelector('.acontent')?.prepend(d);
}

function markMounted() {
  (window as IslandWindow).__isl = true;
  // Signals the Worker shell that live islands own the look now: its bare
  // button/input/label styles are gated on body:not(.isl) (see src/ui.ts).
  document.body.classList.add('isl');
  document.querySelectorAll('.island-err[role="alert"]').forEach((n) => n.remove());
}

async function mountIslands(root: ParentNode): Promise<void> {
  const els = [...root.querySelectorAll<HTMLElement>('[data-island]')];
  await Promise.all(
    els.map(async (el) => {
      const name = el.getAttribute('data-island');
      const load = name ? loaders[name] : null;
      if (!name || !load) {
        if (name) {
          console.warn(`unknown island: ${name}`);
          showIslandError(name);
        }
        return;
      }
      try {
        const mod = await load();
        el.innerHTML = '';
        mount(mod.default as never, { target: el });
        markMounted();
      } catch (e) {
        console.warn(`island failed: ${name}`, e);
        showIslandError(name);
      }
    }),
  );
}

function setActiveNav(path: string) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.sitem, .ditem')) {
    const active = a.getAttribute('href') === path || (path === '/admin' && a.getAttribute('href') === '/admin');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function closeDrawer() {
  document.querySelectorAll<HTMLDetailsElement>('details.drawer[open]').forEach((d) => d.removeAttribute('open'));
}

function idOf(path: string): string {
  if (path === '/admin') return 'overview';
  const m = path.match(/^\/admin\/p\/([\w-]+)$/);
  return m ? m[1] : 'overview';
}

async function navigate(path: string, push = true) {
  const id = idOf(path);
  const res = await fetch(`/api/page/${id}`, { headers: { accept: 'application/json' } });
  if (res.status === 401) { location.href = '/admin'; return; }
  if (!res.ok) { location.href = path; return; } // no-JS fallback: full load
  const page = (await res.json()) as { content: string; island: string | null; footer: string | null; cards?: Array<{ id: string; label: string }> };
  if (push) history.pushState(null, '', path);
  document.title = `admin · ${page.island ? id : id}`;
  const label = id === 'overview' ? 'overview' : (page.cards?.find((c) => c.id === id)?.label ?? id);
  const titleEl = document.querySelector('.atitle');
  if (titleEl) titleEl.textContent = label;
  const amain = document.querySelector('.amain');
  if (!amain) return;
  const slot = amain.querySelector('.acontent');
  if (!slot) { location.href = path; return; } // shell changed: full load
  // SPA implies JS: paint skeletons, never the server HTML flash.
  const paint = page.island
    ? `<div class="island-loading flex flex-col gap-2" aria-hidden="true"><div class="h-12 animate-pulse rounded-lg bg-muted"></div><div class="h-12 animate-pulse rounded-lg bg-muted"></div><div class="h-12 animate-pulse rounded-lg bg-muted"></div></div>`
    : page.content;
  slot.innerHTML = `<div class="dark" ${page.island ? `data-island="${page.island}"` : ''}>${paint}</div>
    ${page.footer ? `<footer>${page.footer}</footer>` : ''}`;
  setActiveNav(path);
  closeDrawer();
  (window as IslandWindow).__isl = false;
  await mountIslands(amain);
  if (page.island && !(window as IslandWindow).__isl) showIslandError(page.island);
  bindCheckForm(amain);
}

function bindCheckForm(root: ParentNode) {
  const form = root.querySelector<HTMLFormElement>('#check-form');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    if (btn) btn.disabled = true;
    fetch('/admin/check', { method: 'POST' })
      .then(() => navigate(location.pathname, false))
      .finally(() => { if (btn) btn.disabled = false; });
  });
}

function isSpaPath(href: string): boolean {
  return /^\/admin(\/p\/[\w-]+)?$/.test(href);
}

function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/admin"]');
  if (!a) return;
  const href = a.getAttribute('href')!;
  // plugin sub-pages (edit monitor etc.) stay full loads for now
  if (!isSpaPath(href)) return;
  e.preventDefault();
  navigate(href);
}

document.addEventListener('click', onClick);
window.addEventListener('popstate', () => navigate(location.pathname, false));

// First load: hydrate server-rendered islands + wire the shell for SPA nav
void mountIslands(document);
setActiveNav(location.pathname);
bindCheckForm(document);
