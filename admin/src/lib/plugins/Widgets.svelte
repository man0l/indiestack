<script lang="ts">
  import { onMount } from 'svelte';
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Separator } from '$lib/components/ui/separator';
  import FolderIcon from '@lucide/svelte/icons/folder';

  type Site = { id: string; name: string; token: string };

  let sites: Site[] = $state([]);
  let loading = $state(true);
  let err = $state('');

  async function load() {
    loading = true;
    err = '';
    try {
      const r = await fetch('/api/widgets');
      if (r.ok) sites = (await r.json()).sites ?? [];
      else err = 'failed to load sites';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const live = (s: Site) => `${location.origin}/w/live.svg?site=${s.token}`;
  const views = (s: Site) => `${location.origin}/w/views.svg?site=${s.token}&days=7`;
  const stats = (s: Site) => `${location.origin}/w/stats.json?site=${s.token}`;
</script>

{#if err}
  <Alert.Root class="mb-3" variant="destructive">
    <Alert.Title>Something went wrong</Alert.Title>
    <Alert.Description>{err}</Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Header>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <LayoutGridIcon />
        <Card.Title>widgets</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
      </div>
    </div>
    <Card.Description
      >Embeddable badges, one per site. Drop the <code>&lt;img&gt;</code> into your site footer or README.
      Widgets are public images — anyone with the URL can read the number it shows.</Card.Description
    >
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-24 rounded-lg" />
        <Skeleton class="h-24 rounded-lg" />
      </div>
    {:else if sites.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderIcon /></Empty.Media>
          <Empty.Title>No sites yet</Empty.Title>
          <Empty.Description>Add an analytics site first.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-4">
        {#each sites as s (s.id)}
          <div>
            <div class="mb-2 flex flex-wrap items-center gap-3">
              <span class="text-sm font-semibold">{s.name}</span>
              <img src={live(s)} alt="live visitors" class="h-5" loading="lazy" />
              <img src={views(s)} alt="views this week" class="h-5" loading="lazy" />
            </div>
            <div class="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
              <div class="truncate">&lt;img src="{live(s)}" alt="live visitors"/&gt;</div>
              <div class="truncate">&lt;img src="{views(s)}" alt="views this week"/&gt;</div>
              <div class="truncate">{stats(s)}</div>
            </div>
          </div>
          <Separator />
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
