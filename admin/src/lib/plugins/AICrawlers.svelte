<script lang="ts">
  import { onMount } from 'svelte';
  import BotIcon from '@lucide/svelte/icons/bot';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import * as Empty from '$lib/components/ui/empty';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FolderIcon from '@lucide/svelte/icons/folder';

  type CrawlSite = {
    id: string;
    name: string;
    byVendor: Array<{ vendor: string; n: number; last_ts: number }>;
    topPaths: Array<{ path: string; n: number }>;
    referrals: Array<{ ref: string; views: number }>;
    snippet: string;
  };

  let sites: CrawlSite[] = $state([]);
  let loading = $state(true);
  let err = $state('');

  async function load() {
    loading = true;
    err = '';
    try {
      const r = await fetch('/api/aicrawls');
      if (r.ok) sites = (await r.json()).sites ?? [];
      else err = 'failed to load crawls';
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const ts = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';
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
        <BotIcon />
        <Card.Title>ai crawlers</Card.Title>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onclick={load}>
          <RefreshCwIcon data-icon="inline-start" /> refresh
        </Button>
      </div>
    </div>
    <Card.Description>Server-side AI crawler tracking plus AI referrals. Other bots land under other-bot.</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if loading}
      <div class="flex flex-col gap-2">
        <Skeleton class="h-32 rounded-lg" />
        <Skeleton class="h-32 rounded-lg" />
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
          <div class="rounded-xl border border-border bg-card p-4">
            <div class="mb-3 text-sm font-semibold">{s.name}</div>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">crawlers (30d)</div>
                {#if s.byVendor.length === 0}
                  <span class="text-xs text-muted-foreground">no crawls recorded yet</span>
                {:else}
                  {#each s.byVendor as v (v.vendor)}
                    <div class="truncate text-xs text-muted-foreground">{v.vendor} · {v.n} hit(s) · last {ts(v.last_ts)}</div>
                  {/each}
                {/if}
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">top crawled paths</div>
                {#if s.topPaths.length === 0}
                  <span class="text-xs text-muted-foreground">—</span>
                {:else}
                  {#each s.topPaths as p (p.path)}
                    <div class="truncate text-xs text-muted-foreground">{p.path} · {p.n}</div>
                  {/each}
                {/if}
              </div>
              <div>
                <div class="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI referrals</div>
                {#if s.referrals.length === 0}
                  <span class="text-xs text-muted-foreground">—</span>
                {:else}
                  {#each s.referrals as r (r.ref)}
                    <div class="truncate text-xs text-muted-foreground">{r.ref} · {r.views}</div>
                  {/each}
                {/if}
              </div>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">middleware for this site's Worker:</p>
            <div class="mt-1 truncate font-mono text-xs text-muted-foreground">{s.snippet}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
