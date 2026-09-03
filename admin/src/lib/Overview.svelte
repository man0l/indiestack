<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, HeartPulse, GitBranch, FileText, BarChart3, LayoutGrid, BadgeDollarSign, Radio, Bot, Target, Share2, Sparkles, HardDrive, LayoutTemplate, Settings } from 'lucide-svelte';
  import * as Card from '$lib/components/ui/card';

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
  <p class="text-sm text-muted-foreground">loading…</p>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each cards as c (c.id)}
      {@const Icon = icons[c.label]}
      <a href={c.href} class="no-underline">
        <Card.Root>
          <Card.Content class="p-3.5">
            <div class="flex items-center gap-1.5">
              {#if Icon}<Icon size={14} strokeWidth={1.5} class="text-muted-foreground" />{/if}
              <span class="h-2 w-2 rounded-full {c.dot === 'up' ? 'bg-[#3ee08f]' : c.dot === 'down' ? 'bg-[#ff5d57]' : 'bg-muted-foreground'}"></span>
              <span class="text-sm font-semibold">{c.label}</span>
            </div>
            {#if c.summary}<div class="mt-1.5 text-xs text-muted-foreground">{c.summary}</div>{/if}
          </Card.Content>
        </Card.Root>
      </a>
    {/each}
  </div>
{/if}
