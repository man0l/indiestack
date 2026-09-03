<script lang="ts">
  import { onMount } from 'svelte';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
  import BadgeDollarSignIcon from '@lucide/svelte/icons/badge-dollar-sign';
  import RadioIcon from '@lucide/svelte/icons/radio';
  import BotIcon from '@lucide/svelte/icons/bot';
  import TargetIcon from '@lucide/svelte/icons/target';
  import Share2Icon from '@lucide/svelte/icons/share-2';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
  import LayoutTemplateIcon from '@lucide/svelte/icons/layout-template';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import * as Card from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Empty from '$lib/components/ui/empty';
  import FolderIcon from '@lucide/svelte/icons/folder';

    const icons: Record<string, any> = {
    monitors: ActivityIcon, heartbeats: HeartPulseIcon, deploys: GitBranchIcon, logs: FileTextIcon, analytics: ChartColumnIcon, widgets: LayoutGridIcon, revenue: BadgeDollarSignIcon, signals: RadioIcon, 'ai crawlers': BotIcon, goals: TargetIcon, share: Share2Icon, 'ai agents': SparklesIcon, backup: HardDriveIcon, templates: LayoutTemplateIcon, settings: SettingsIcon,
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
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each Array(8) as _, i (i)}
      <Skeleton class="h-24 rounded-xl" />
    {/each}
  </div>
{:else if cards.length === 0}
  <Empty.Root>
    <Empty.Header>
      <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
      <Empty.Title>No modules yet</Empty.Title>
      <Empty.Description>Plugins register here when they declare adminNav.</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each cards as c (c.id)}
      {@const Icon = icons[c.label]}
      <a href={c.href} class="no-underline">
        <Card.Root>
          <Card.Content class="p-3.5">
            <div class="flex items-center gap-1.5">
              {#if Icon}<Icon class="text-muted-foreground" />{/if}
              <span class="size-2 rounded-full {c.dot === 'up' ? 'bg-success' : c.dot === 'down' ? 'bg-destructive' : 'bg-muted-foreground'}"></span>
              <span class="text-sm font-semibold">{c.label}</span>
            </div>
            {#if c.summary}<div class="mt-1.5 truncate text-xs text-muted-foreground">{c.summary}</div>{/if}
          </Card.Content>
        </Card.Root>
      </a>
    {/each}
  </div>
{/if}
