<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, HeartPulse, GitBranch, FileText, BarChart3, LayoutGrid, BadgeDollarSign, Radio, Bot, Target, Share2, Sparkles, HardDrive, LayoutTemplate, Settings } from 'lucide-svelte';
  import Card from './Card.svelte';

  const icons: Record<string, any> = {
    monitors: Activity, heartbeats: HeartPulse, deploys: GitBranch, logs: FileText, analytics: BarChart3, widgets: LayoutGrid, revenue: BadgeDollarSign, signals: Radio, 'ai crawlers': Bot, goals: Target, share: Share2, 'ai agents': Sparkles, backup: HardDrive, templates: LayoutTemplate, settings: Settings,
  };

  let cards: any[] = $state([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    const r = await fetch('/api/overview');
    if (r.ok) cards = (await r.json()).cards ?? [];
    loading = false;
  }

  onMount(load);
</script>

{#if loading}
  <p class="text-sm text-[#8b919c]">loading…</p>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each cards as c (c.id)}
      <Card label={c.label} summary={c.summary} dot={c.dot} href={c.href} icon={icons[c.label]} />
    {/each}
  </div>
{/if}
