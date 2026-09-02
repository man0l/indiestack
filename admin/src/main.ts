import './app.css';
import { mount } from 'svelte';
import Overview from './lib/Overview.svelte';
import Ping from './lib/plugins/Ping.svelte';
import Deploys from './lib/plugins/Deploys.svelte';

// Islands: the Worker serves the shell (sidebar + content) as server HTML.
// The router swaps .amain content via /api/page/:id and mounts islands — no reloads.
const islands: Record<string, any> = { overview: Overview, ping: Ping, deploys: Deploys };

function mountIslands(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-island]')) {
    const name = el.getAttribute('data-island');
    const Component = name ? islands[name] : null;
    if (!Component) continue;
    el.innerHTML = '';
    mount(Component, { target: el });
  }
}

function setActiveNav(path: string) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.sitem')) {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === path || (path === '/admin' && href === '/admin'));
  }
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
  const page = (await res.json()) as { content: string; island: string | null; footer: string | null };
  if (push) history.pushState(null, '', path);
  document.title = `admin · ${page.island ? id : id}`;
  const amain = document.querySelector('.amain');
  if (!amain) return;
  amain.innerHTML = `
    <div class="ahead">
      <form id="check-form" method="post" action="/admin/check" style="display:inline"><button type="submit">check now</button></form>
    </div>
    <div ${page.island ? `data-island="${page.island}"` : ''}>${page.content}</div>
    ${page.footer ? `<footer>${page.footer}</footer>` : ''}`;
  setActiveNav(path);
  mountIslands(amain);
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

function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/admin"]');
  if (!a || a.dataset.spaBound) return;
  const href = a.getAttribute('href')!;
  // plugin sub-pages (edit monitor etc.) stay full loads for now
  if (!/^\/admin(\/p\/[\w-]+)?$/.test(href)) return;
  e.preventDefault();
  a.dataset.spaBound = '1';
  navigate(href);
}

document.addEventListener('click', onClick);
window.addEventListener('popstate', () => navigate(location.pathname, false));

// First load: hydrate server-rendered islands + wire the shell for SPA nav
mountIslands(document);
setActiveNav(location.pathname);
bindCheckForm(document);
