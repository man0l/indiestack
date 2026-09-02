import './app.css';
import { mount } from 'svelte';
import Overview from './lib/Overview.svelte';
import Ping from './lib/plugins/Ping.svelte';

// Islands: the Worker serves the shell (sidebar + content) as server HTML.
// Each [data-island] region is replaced by its Svelte component after load.
const islands: Record<string, any> = { overview: Overview, ping: Ping };

for (const el of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const name = el.getAttribute('data-island');
  const Component = name ? islands[name] : null;
  if (!Component) continue;
  el.innerHTML = '';
  mount(Component, { target: el });
}
