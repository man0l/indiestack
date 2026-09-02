<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, HeartPulse, GitBranch, FileText, BarChart3, LayoutGrid, BadgeDollarSign, Radio, Bot, Target, Share2, Sparkles, HardDrive, LayoutTemplate, Settings } from 'lucide-svelte';
  import Sidebar from './lib/Sidebar.svelte';
  import Card from './lib/Card.svelte';
  const icons: Record<string, any> = {
    monitors: Activity, heartbeats: HeartPulse, deploys: GitBranch, logs: FileText, analytics: BarChart3, widgets: LayoutGrid, revenue: BadgeDollarSign, signals: Radio, 'ai crawlers': Bot, goals: Target, share: Share2, 'ai agents': Sparkles, backup: HardDrive, templates: LayoutTemplate, settings: Settings,
  };
  let overview: any[] = $state([]);
  let activeId = $state('overview');
  import Ping from './lib/plugins/Ping.svelte';
  async function load(route: string) {
    const id = route === '/admin' ? '' : route.replace('/admin/p/', '');
    activeId = id || 'overview';
    if (!id) { const r = await fetch('/api/overview'); if (r.ok) overview = (await r.json()).cards ?? []; }
  }
  onMount(() => { load(location.pathname); window.addEventListener('popstate', () => load(location.pathname)); document.addEventListener('click', e => { const a = (e.target as HTMLElement).closest('a[href^="/admin"]'); if (!a) return; const href = a.getAttribute('href')!; if (href.startsWith('/admin')) { e.preventDefault(); history.pushState(null,'',href); load(href);} }); });
</script>

<div class="flex min-h-screen bg-[#0e1014] text-[#eef0f4]">
  <Sidebar {overview} {activeId} {icons} />
  <main class="flex-1 p-5">
    {#if activeId === 'overview'}
      <div class="mb-4 flex gap-3"><form method="post" action="/admin/check"><button class="rounded-lg bg-[#c8f542] px-3 py-1.5 text-sm font-semibold text-black">check now</button></form></div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each overview as c}<Card label={c.label} summary={c.summary} dot={c.dot} href={c.href} icon={icons[c.label]} />{/each}
      </div>
    {:else if activeId === 'ping'}
      <Ping />
    {:else}
      <div id="amain">loading…</div>
    {/if}
  </main>
</div>
